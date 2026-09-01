import { getCache, setCache } from './cache.js';

export class MarkovGenerator {
  constructor(nGram = 3) {
    this.nGram = nGram;
    this.transitions = {};
    this.starts = [];
    this.knownWords = new Set();
  }

  async init(log) {
    const cacheKey = `markov_model_n${this.nGram}_v1`;
    const cached = await getCache(cacheKey);
    if (cached) {
      this.transitions = cached.transitions;
      this.starts = cached.starts;
      this.knownWords = new Set(cached.knownWords);
      log('Markov model loaded from local browser cache.', 'success');
      return;
    }

    log('Downloading 10k English word list for training...');
    let words = [];
    try {
      const res = await fetch('https://raw.githubusercontent.com/first20hours/google-10000-english/master/google-10000-english-no-swears.txt');
      const text = await res.text();
      words = text
        .split('\n')
        .map((w) => w.trim().toLowerCase())
        .filter((w) => w && /^[a-z]+$/.test(w));
    } catch {
      log('Fetch failed. Using hardcoded fallback words.', 'error');
      words = [
        'action', 'animal', 'beauty', 'camera', 'danger', 'energy', 'family',
        'garden', 'health', 'jungle', 'living', 'memory', 'nature', 'orange',
        'picture', 'reason', 'secret', 'travel', 'window',
      ];
    }

    log(`Training generator on ${words.length} words...`);
    this.buildModel(words);
    await setCache(cacheKey, {
      transitions: this.transitions,
      starts: this.starts,
      knownWords: Array.from(this.knownWords),
    });
    log('Training complete and cached.', 'success');
  }

  buildModel(words) {
    this.transitions = {};
    this.starts = [];
    this.knownWords = new Set(words);

    for (const word of words) {
      if (word.length <= this.nGram) continue;
      this.starts.push(word.slice(0, this.nGram));
      for (let i = 0; i < word.length - this.nGram; i++) {
        const state = word.slice(i, i + this.nGram);
        const nextChar = word[i + this.nGram];
        if (!this.transitions[state]) this.transitions[state] = [];
        this.transitions[state].push(nextChar);
      }
      const endState = word.slice(-this.nGram);
      if (!this.transitions[endState]) this.transitions[endState] = [];
      this.transitions[endState].push(null);
    }
  }

  generate(minLen, maxLen, shortBias) {
    const bias = Number(shortBias);
    const biasWeight = Number.isFinite(bias) && bias > 0 ? bias : 1;

    for (let attempt = 0; attempt < 400; attempt++) {
      if (!this.starts.length) return null;
      let word = this.starts[Math.floor(Math.random() * this.starts.length)];

      while (word.length < maxLen) {
        const nextChar = this.pickNext(word, minLen, biasWeight);
        if (nextChar === null) break;
        word += nextChar;
      }

      if (word.length >= minLen && word.length <= maxLen && !this.knownWords.has(word)) {
        return word;
      }
    }
    return null;
  }

  pickNext(word, minLen, biasWeight) {
    const state = word.slice(-this.nGram);
    const choices = this.transitions[state];
    if (!choices || choices.length === 0) return null;

    const counts = new Map();
    for (const c of choices) counts.set(c, (counts.get(c) || 0) + 1);
    const nEos = counts.get(null) || 0;
    counts.delete(null);

    const letters = Array.from(counts.keys());
    const letterWeights = letters.map((c) => counts.get(c));

    if (word.length < minLen) {
      if (!letters.length) return null;
      return pickWeighted(letters, letterWeights);
    }

    // Stop is always a legal transition once we are in range. Bias multiplies
    // trained end-mass, and injects a unit of end-mass when this trigram never
    // ended a training word (otherwise high bias cannot stop until "ing"/"ion").
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
