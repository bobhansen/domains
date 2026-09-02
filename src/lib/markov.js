import { getCache, setCache } from './cache.js';
import { languageByCode, localeForLanguage } from './languages.js';

const MODEL_VERSION = 'g3v2';

function getSegmenter(locale) {
  if (typeof Intl === 'undefined' || typeof Intl.Segmenter !== 'function') return null;
  try {
    return new Intl.Segmenter(locale || undefined, { granularity: 'grapheme' });
  } catch {
    try {
      return new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    } catch {
      return null;
    }
  }
}

// Firefox < 125 has no Intl.Segmenter. Word lists are letters, so a code-point
// walk that glues combining marks onto the previous character is enough.
function splitGraphemesFallback(text) {
  const out = [];
  for (const cp of String(text || '')) {
    if (out.length && /^\p{M}$/u.test(cp)) {
      out[out.length - 1] += cp;
    } else {
      out.push(cp);
    }
  }
  return out;
}

export function splitGraphemes(text, locale) {
  const value = String(text || '');
  const segmenter = getSegmenter(locale);
  if (segmenter) return Array.from(segmenter.segment(value), (part) => part.segment);
  return splitGraphemesFallback(value);
}

export function graphemeCount(text, locale) {
  return splitGraphemes(text, locale).length;
}

function isLetterGrapheme(g) {
  return /^\p{L}\p{M}*$/u.test(g);
}

function parseWordCsv(text) {
  const lines = String(text || '').split(/\r?\n/);
  const words = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    if (i === 0 && /^word\s*,/i.test(line)) continue;
    const comma = line.indexOf(',');
    const raw = comma === -1 ? line : line.slice(0, comma);
    const word = raw.trim().replace(/^"|"$/g, '');
    if (word) words.push(word);
  }
  return words;
}

function normalizeWords(rawWords, locale) {
  const out = [];
  for (const raw of rawWords) {
    const gs = splitGraphemes(raw, locale).map((g) => g.toLocaleLowerCase(locale));
    if (gs.length < 2) continue;
    if (!gs.every(isLetterGrapheme)) continue;
    out.push(gs);
  }
  return out;
}

function bump(row, key) {
  row[key] = (row[key] || 0) + 1;
}

function cacheLooksValid(cached) {
  return Boolean(
    cached
    && cached.transitions
    && typeof cached.transitions === 'object'
    && Array.isArray(cached.starts)
    && Array.isArray(cached.startWeights)
    && cached.starts.length === cached.startWeights.length
    && Array.isArray(cached.knownWords),
  );
}

export class MarkovGenerator {
  constructor(nGram = 3) {
    this.nGram = nGram;
    this.loadToken = 0;
    this.lang = null;
    this.locale = 'en';
    this.transitions = {};
    this.starts = [];
    this.startWeights = [];
    this.knownWords = new Set();
  }

  cacheKey(code) {
    return `markov_model_${MODEL_VERSION}_${code}`;
  }

  applyCache(cached) {
    this.transitions = cached.transitions || {};
    this.starts = cached.starts || [];
    this.startWeights = cached.startWeights || [];
    this.knownWords = new Set(cached.knownWords || []);
  }

  toCache() {
    return {
      transitions: this.transitions,
      starts: this.starts,
      startWeights: this.startWeights,
      knownWords: Array.from(this.knownWords),
    };
  }

  async load(code, log) {
    const spec = languageByCode(code);
    const token = ++this.loadToken;
    this.lang = null;
    this.locale = localeForLanguage(spec.code);
    const still = () => token === this.loadToken;

    const cacheKey = this.cacheKey(spec.code);
    let cached = null;
    try {
      cached = await getCache(cacheKey);
    } catch {
      cached = null;
    }
    if (!still()) return;
    if (cacheLooksValid(cached)) {
      this.applyCache(cached);
      this.lang = spec.code;
      return;
    }

    log(`Loading common ${spec.name} words…`);
    const res = await fetch(spec.path);
    if (!still()) return;
    if (!res.ok) throw new Error('Could not download the word list.');
    const text = await res.text();
    if (!still()) return;
    const words = normalizeWords(parseWordCsv(text), this.locale);
    if (words.length < 50) throw new Error('Not enough usable words.');

    log(`Learning how ${spec.name} names sound…`);
    this.buildModel(words);
    if (!still()) return;
    this.lang = spec.code;
    const payload = this.toCache();
    try {
      await setCache(cacheKey, payload);
      log('Ready to invent names.', 'success');
    } catch {
      log("Ready to invent names. Couldn't save them for next time.", 'error');
    }
  }

  buildModel(words) {
    this.transitions = {};
    const startCounts = {};
    this.knownWords = new Set(words.map((gs) => gs.join('')));
    const n = this.nGram;

    for (const gs of words) {
      if (gs.length <= n) continue;
      const start = gs.slice(0, n).join('');
      bump(startCounts, start);
      for (let i = 0; i < gs.length - n; i++) {
        const state = gs.slice(i, i + n).join('');
        if (!this.transitions[state]) this.transitions[state] = {};
        bump(this.transitions[state], gs[i + n]);
      }
      const endState = gs.slice(-n).join('');
      if (!this.transitions[endState]) this.transitions[endState] = {};
      bump(this.transitions[endState], '');
    }

    this.starts = Object.keys(startCounts);
    this.startWeights = this.starts.map((s) => startCounts[s]);
  }

  generate(minLen, maxLen, shortBias) {
    const bias = Number(shortBias);
    const biasWeight = Number.isFinite(bias) && bias > 0 ? bias : 1;
    const locale = this.locale;

    for (let attempt = 0; attempt < 400; attempt++) {
      if (!this.starts.length) return null;
      const start = pickWeighted(this.starts, this.startWeights);
      const parts = splitGraphemes(start, locale);

      while (parts.length < maxLen) {
        const next = this.pickNext(parts, minLen, biasWeight);
        if (next === null) break;
        parts.push(next);
      }

      const word = parts.join('');
      if (parts.length >= minLen && parts.length <= maxLen && !this.knownWords.has(word)) {
        return word;
      }
    }
    return null;
  }

  pickNext(parts, minLen, biasWeight) {
    const state = parts.slice(-this.nGram).join('');
    const row = this.transitions[state];
    if (!row) return null;

    const nEos = row[''] || 0;
    const letters = [];
    const letterWeights = [];
    for (const [g, n] of Object.entries(row)) {
      if (g === '') continue;
      letters.push(g);
      letterWeights.push(n);
    }

    const word = parts.join('');

    if (parts.length < minLen) {
      if (!letters.length) return null;
      return pickWeighted(letters, letterWeights);
    }

    let eosWeight = nEos * biasWeight;
    if (nEos === 0 && biasWeight > 1) eosWeight = biasWeight;
    if (this.knownWords.has(word)) eosWeight = 0;

    const population = letters.slice();
    const weights = letterWeights.slice();
    if (eosWeight > 0) {
      population.push(null);
      weights.push(eosWeight);
    }
    if (!population.length) return null;
    return pickWeighted(population, weights);
  }
}

function pickWeighted(population, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < population.length; i++) {
    r -= weights[i];
    if (r <= 0) return population[i];
  }
  return population[population.length - 1];
}
