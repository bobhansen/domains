import { DEFAULT_LANGUAGE, isKnownLanguage } from './languages.js';
import { LIMITS, clampSettings } from './limits.js';
import { TLD_CHIPS, validateTld } from './tld.js';

export const SETTINGS_KEY = 'vanity_settings';
const LEGACY_LANGUAGE_KEY = 'vanity_language';

export const DEFAULT_SETTINGS = {
  language: DEFAULT_LANGUAGE,
  tldChoice: 'org',
  customTld: '',
  minLen: LIMITS.length.minFallback,
  maxLen: LIMITS.length.maxFallback,
  shortBias: LIMITS.shortBias.fallback,
};

export function sanitizeSettings(raw = {}) {
  const language = isKnownLanguage(raw.language) ? raw.language : DEFAULT_SETTINGS.language;
  const tldChoice = TLD_CHIPS.includes(raw.tldChoice) ? raw.tldChoice : DEFAULT_SETTINGS.tldChoice;
  const customCheck = validateTld(raw.customTld, new Set());
  const customTld = customCheck.ok ? customCheck.tld : '';
  const lengths = clampSettings({
    minLen: raw.minLen,
    maxLen: raw.maxLen,
    shortBias: raw.shortBias,
  });
  return {
    language,
    tldChoice,
    customTld,
    ...lengths,
  };
}

export function readStoredSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return sanitizeSettings(JSON.parse(raw));
    const language = localStorage.getItem(LEGACY_LANGUAGE_KEY);
    if (isKnownLanguage(language)) return sanitizeSettings({ ...DEFAULT_SETTINGS, language });
  } catch {
    /* private mode or bad JSON */
  }
  return { ...DEFAULT_SETTINGS };
}

export function storeSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(sanitizeSettings(settings)));
    localStorage.removeItem(LEGACY_LANGUAGE_KEY);
  } catch {
    /* quota or private mode */
  }
}
