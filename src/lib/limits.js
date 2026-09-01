export const LIMITS = {
  target: { min: 1, max: 250, fallback: 20 },
  length: { min: 3, max: 20, minFallback: 4, maxFallback: 8 },
  shortBias: { min: 0.1, max: 1_000_000, fallback: 10 },
};

export function clampInt(value, min, max, fallback) {
  const n = typeof value === 'number' ? value : Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function clampFloat(value, min, max, fallback) {
  const n = typeof value === 'number' ? value : Number.parseFloat(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function stepShortBias(value, direction) {
  const { min, max, fallback } = LIMITS.shortBias;
  const n = clampFloat(value, min, max, fallback);
  const next = direction < 0 ? n / 10 : n * 10;
  if (direction < 0 && next < min) return min;
  if (direction > 0 && next > max) return max;
  return Number(next.toPrecision(12));
}

export function clampSettings({ targetCount, minLen, maxLen, shortBias }) {
  const { target, length, shortBias: bias } = LIMITS;
  let minL = clampInt(minLen, length.min, length.max, length.minFallback);
  let maxL = clampInt(maxLen, length.min, length.max, length.maxFallback);
  if (maxL < minL) maxL = minL;
  return {
    targetCount: clampInt(targetCount, target.min, target.max, target.fallback),
    minLen: minL,
    maxLen: maxL,
    shortBias: clampFloat(shortBias, bias.min, bias.max, bias.fallback),
  };
}
