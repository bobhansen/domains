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

    await setCache(cacheKey, {
      transitions: this.transitions,
      starts: this.starts,
      knownWords: Array.from(this.knownWords),
    });
    log('Training complete and cached.', 'success');
  }

  generate(minLen, maxLen, shortBias) {
    for (let attempt = 0; attempt < 100; attempt++) {
      let word = this.starts[Math.floor(Math.random() * this.starts.length)];

      while (word.length < 50) {
        const state = word.slice(-this.nGram);
        const choices = this.transitions[state];
        if (!choices || choices.length === 0) break;

        let nextChar;
        if (shortBias !== 1.0 && choices.includes(null)) {
          const counts = new Map();
          for (const c of choices) counts.set(c, (counts.get(c) || 0) + 1);

          const population = Array.from(counts.keys());
          const weights = population.map((c) => (c === null ? counts.get(c) * shortBias : counts.get(c)));
          const totalWeight = weights.reduce((a, b) => a + b, 0);

          let r = Math.random() * totalWeight;
          for (let i = 0; i < population.length; i++) {
            r -= weights[i];
            if (r <= 0) {
              nextChar = population[i];
              break;
            }
          }
        } else {
          nextChar = choices[Math.floor(Math.random() * choices.length)];
        }

        if (nextChar === null) break;
        word += nextChar;
      }

      if (word.length >= minLen && word.length <= maxLen && !this.knownWords.has(word)) {
        return word;
      }
    }
    return null;
  }
}
