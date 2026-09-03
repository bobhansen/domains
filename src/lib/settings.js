import { DEFAULT_LANGUAGE, canonicalizeLanguage, isKnownLanguage, languageFromBrowser } from './languages.js';
import { LIMITS, LENGTH_PRESETS, clampSettings } from './limits.js';
import { TLD_CHIPS, normalizeTld, validateTld } from './tld.js';

export const SETTINGS_KEY = 'vanity_settings';
const LEGACY_LANGUAGE_KEY = 'vanity_language';

const URL_KEYS = ['lang', 'tld', 'min', 'max', 'mix'];

export const DEFAULT_SETTINGS = {
  language: DEFAULT_LANGUAGE,
  tldChoice: 'org',
  customTld: '',
  minLen: LIMITS.length.minFallback,
  maxLen: LIMITS.length.maxFallback,
  shortBias: LIMITS.shortBias.fallback,
};

export function sanitizeSettings(raw = {}) {
  const language = canonicalizeLanguage(raw.language) || languageFromBrowser();
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

function choiceFromTld(raw) {
  const tld = normalizeTld(raw);
  if (TLD_CHIPS.includes(tld) && tld !== 'custom') {
    return { tldChoice: tld, customTld: '' };
  }
  return { tldChoice: 'custom', customTld: tld === 'custom' ? '' : tld };
}

export function parseSettingsFromSearch(search) {
  const query = String(search || '').replace(/^\?/, '');
  const params = new URLSearchParams(query);
  if (!URL_KEYS.some((key) => params.has(key))) return null;

  const raw = {};
  if (params.has('lang')) {
    const language = canonicalizeLanguage(params.get('lang'));
    if (language) raw.language = language;
  }
  if (params.has('tld')) Object.assign(raw, choiceFromTld(params.get('tld')));
  if (params.has('min')) raw.minLen = params.get('min');
  if (params.has('max')) raw.maxLen = params.get('max');
  if (params.has('mix')) {
    const id = String(params.get('mix') || '').trim().toLowerCase();
    const preset = LENGTH_PRESETS.find((item) => item.id === id);
    if (preset) raw.shortBias = preset.bias;
  }
  return raw;
}

function tldParamValue(tldChoice, customTld) {
  if (tldChoice === 'custom') return normalizeTld(customTld) || 'custom';
  return tldChoice;
}

export function writeSettingsParam(key, value) {
  try {
    if (typeof window === 'undefined' || !window.history || !window.location) return;
    if (!URL_KEYS.includes(key)) return;
    const nextVal = String(value);
    const url = new URL(window.location.href);
    const params = new URLSearchParams(url.search);
    if (params.get(key) === nextVal) return;
    params.set(key, nextVal);
    const search = params.toString();
    const next = `${url.pathname}${search ? `?${search}` : ''}${url.hash}`;
    const current = `${url.pathname}${url.search}${url.hash}`;
    if (next !== current) history.replaceState(null, '', next);
  } catch {
    /* file:// or locked history */
  }
}

export function writeTldParam(tldChoice, customTld) {
  writeSettingsParam('tld', tldParamValue(tldChoice, customTld));
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
  return sanitizeSettings({ ...DEFAULT_SETTINGS });
}

export function readInitialSettings() {
  const stored = readStoredSettings();
  try {
    const fromUrl = parseSettingsFromSearch(window.location.search);
    if (fromUrl) return sanitizeSettings({ ...stored, ...fromUrl });
  } catch {
    /* no window or bad search */
  }
  return stored;
}

export function storeSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(sanitizeSettings(settings)));
    localStorage.removeItem(LEGACY_LANGUAGE_KEY);
  } catch {
    /* quota or private mode */
  }
}
