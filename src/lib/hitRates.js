import { graphemeCount } from './markov.js';

// Mean P(listed as available) for Markov-generated labels.
// DNS NXDOMAIN+SOA, then RDAP 404 when the TLD is in IANA's bootstrap.
// Built by measure_hit_rates.py at 2026-09-01T19:13:45Z.
// samples≈64 per cell, lengths 3–16.
// RDAP TLDs in this run: com,org,net,ai,app
export const HIT_RATES = {
  com: {3: 0.0000, 4: 0.0000, 5: 0.0000, 6: 0.0938, 7: 0.2344, 8: 0.6719, 9: 0.7656, 10: 0.9062, 11: 0.9531, 12: 0.9688, 13: 1.0000, 14: 1.0000, 15: 1.0000, 16: 1.0000},
  org: {3: 0.0000, 4: 0.0000, 5: 0.2812, 6: 0.7188, 7: 0.7188, 8: 0.9531, 9: 0.9531, 10: 0.9688, 11: 0.9688, 12: 1.0000, 13: 1.0000, 14: 1.0000, 15: 1.0000, 16: 1.0000},
  net: {3: 0.0000, 4: 0.0000, 5: 0.2031, 6: 0.5938, 7: 0.7344, 8: 0.9531, 9: 0.9219, 10: 0.9531, 11: 0.9844, 12: 1.0000, 13: 1.0000, 14: 1.0000, 15: 1.0000, 16: 1.0000},
  me: {3: 0.0156, 4: 0.1250, 5: 0.5781, 6: 0.8906, 7: 0.8906, 8: 0.9844, 9: 1.0000, 10: 1.0000, 11: 1.0000, 12: 1.0000, 13: 1.0000, 14: 1.0000, 15: 1.0000, 16: 1.0000},
  io: {3: 0.0000, 4: 0.0312, 5: 0.4844, 6: 0.7969, 7: 0.8594, 8: 0.9688, 9: 0.9531, 10: 1.0000, 11: 1.0000, 12: 1.0000, 13: 1.0000, 14: 1.0000, 15: 1.0000, 16: 1.0000},
  co: {3: 0.0156, 4: 0.1875, 5: 0.5000, 6: 0.7031, 7: 0.8594, 8: 0.9375, 9: 0.9531, 10: 0.9844, 11: 1.0000, 12: 0.9844, 13: 1.0000, 14: 1.0000, 15: 1.0000, 16: 1.0000},
  ai: {3: 0.0000, 4: 0.0469, 5: 0.5156, 6: 0.7969, 7: 0.8438, 8: 0.9531, 9: 0.9531, 10: 1.0000, 11: 1.0000, 12: 1.0000, 13: 1.0000, 14: 1.0000, 15: 1.0000, 16: 1.0000},
  app: {3: 0.0000, 4: 0.1094, 5: 0.5000, 6: 0.7937, 7: 0.8906, 8: 0.9688, 9: 0.9531, 10: 0.9844, 11: 1.0000, 12: 1.0000, 13: 1.0000, 14: 1.0000, 15: 1.0000, 16: 1.0000},
};

function clampRate(p) {
  return Math.min(0.95, Math.max(0.005, p));
}

export function lookupHitRate(tld, length) {
  const row = HIT_RATES[tld];
  if (row && row[length] != null) return row[length];
  if (row) {
    const keys = Object.keys(row).map(Number).sort((a, b) => a - b);
    if (!keys.length) return null;
    if (length <= keys[0]) return row[keys[0]];
    if (length >= keys[keys.length - 1]) return row[keys[keys.length - 1]];
    for (let i = 0; i < keys.length - 1; i++) {
      if (length >= keys[i] && length <= keys[i + 1]) {
        const t = (length - keys[i]) / (keys[i + 1] - keys[i]);
        return row[keys[i]] * (1 - t) + row[keys[i + 1]] * t;
      }
    }
  }
  let sum = 0;
  let n = 0;
  for (const other of Object.values(HIT_RATES)) {
    if (other[length] != null) {
      sum += other[length];
      n++;
    }
  }
  return n ? sum / n : null;
}

export function expectedHitRate(generator, tld, minLen, maxLen, shortBias) {
  const acc = [];
  for (let i = 0; i < 500; i++) {
    const w = generator.generate(minLen, maxLen, shortBias);
    if (!w) continue;
    const p = lookupHitRate(tld, graphemeCount(w, generator.locale));
    if (p != null) acc.push(p);
  }
  if (acc.length) {
    return clampRate(acc.reduce((a, b) => a + b, 0) / acc.length);
  }
  let sum = 0;
  let n = 0;
  for (let len = minLen; len <= maxLen; len++) {
    const p = lookupHitRate(tld, len);
    if (p != null) {
      sum += p;
      n++;
    }
  }
  return n ? clampRate(sum / n) : 0.08;
}

function erf(x) {
  const sign = Math.sign(x);
  x = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * x);
  return sign * (1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x));
}

function binomCdfLt(n, k, p) {
  if (k <= 0) return 0;
  if (p <= 0) return 1;
  if (p >= 1) return n < k ? 1 : 0;
  const q = 1 - p;
  let term = Math.pow(q, n);
  if (term === 0) {
    const mean = n * p;
    const sd = Math.sqrt(Math.max(n * p * q, 1e-12));
    const z = (k - 0.5 - mean) / sd;
    return 0.5 * (1 + erf(z / Math.SQRT2));
  }
  let cdf = 0;
  for (let i = 0; i < k; i++) {
    cdf += term;
    term = (term * (n - i) / (i + 1)) * p / q;
  }
  return cdf;
}

export function calculateRequiredBatchSize(k, p, confidence = 0.95) {
  if (k <= 0) return 0;
  p = clampRate(p);
  let n = Math.max(k, Math.ceil(k / p));
  const maxN = 1200;
  while (n < maxN && binomCdfLt(n, k, p) > 1 - confidence) n++;
  return n;
}
