export const LENGTH_PRESETS = [
  { id: 'shorter', label: 'Shorter', bias: 1000 },
  { id: 'short', label: 'Short', bias: 10 },
  { id: 'normal', label: 'Normal', bias: 1 },
  { id: 'long', label: 'Long', bias: 0.5 },
  { id: 'longer', label: 'Longer', bias: 0.1 },
];

const SHORT_PRESET = LENGTH_PRESETS.find((p) => p.id === 'short');

export const LIMITS = {
  target: { min: 1, max: 250, fallback: 20 },
  length: { min: 3, max: 20, minFallback: 4, maxFallback: 8 },
  shortBias: { min: 0.1, max: 1000, fallback: SHORT_PRESET.bias },
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

export function lengthPresetIndex(value) {
  const n = clampFloat(value, LIMITS.shortBias.min, LIMITS.shortBias.max, LIMITS.shortBias.fallback);
  let best = 0;
  let bestDist = Infinity;
  LENGTH_PRESETS.forEach((preset, i) => {
    const dist = Math.abs(Math.log(n) - Math.log(preset.bias));
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  });
  return best;
}

export function lengthPresetFor(value) {
  return LENGTH_PRESETS[lengthPresetIndex(value)];
}

export function snapShortBias(value) {
  return lengthPresetFor(value).bias;
}

export function stepLengthPreset(value, direction) {
  const next = lengthPresetIndex(value) + direction;
  const i = Math.min(LENGTH_PRESETS.length - 1, Math.max(0, next));
  return LENGTH_PRESETS[i].bias;
}

export function clampSettings({ minLen, maxLen, shortBias }) {
  const { length } = LIMITS;
  let minL = clampInt(minLen, length.min, length.max, length.minFallback);
  let maxL = clampInt(maxLen, length.min, length.max, length.maxFallback);
  if (maxL < minL) maxL = minL;
  return {
    minLen: minL,
    maxLen: maxL,
    shortBias: snapShortBias(shortBias),
  };
}
