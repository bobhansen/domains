import { LANGUAGES } from './languageCatalog.js';

export { LANGUAGES };

export const DEFAULT_LANGUAGE = 'en';

const byCode = new Map(LANGUAGES.map((lang) => [lang.code, lang]));

const LANGUAGE_ALIASES = {
  no: 'nb',
  pt_br: 'pt',
  fil: 'tl',
  in: 'id',
};

export function canonicalizeLanguage(code) {
  const raw = String(code || '').trim().replace(/-/g, '_').toLowerCase();
  if (!raw) return null;
  if (byCode.has(raw)) return raw;
  const alias = LANGUAGE_ALIASES[raw];
  if (alias && byCode.has(alias)) return alias;
  return null;
}

export function isKnownLanguage(code) {
  return canonicalizeLanguage(code) != null;
}

export function languageByCode(code) {
  return byCode.get(canonicalizeLanguage(code) || DEFAULT_LANGUAGE);
}

export function localeForLanguage(code) {
  const spec = languageByCode(code);
  return spec.code.replace(/_/g, '-');
}

function interpretTag(tag) {
  const raw = tag;
  const bcp = String(tag ?? '').trim().replace(/_/g, '-').toLowerCase();
  if (!bcp) {
    return { raw, normalized: '', matched: null, via: null, attempts: [] };
  }
  const parts = bcp.split('-').filter(Boolean);
  const attempts = [];
  for (let n = parts.length; n >= 1; n--) {
    const code = parts.slice(0, n).join('_');
    const matched = canonicalizeLanguage(code);
    if (matched) {
      const via = matched === code ? 'exact' : `alias ${code} → ${matched}`;
      attempts.push({ tried: code, result: matched === code ? 'exact' : `alias:${matched}` });
      return { raw, normalized: bcp, matched, via, attempts };
    }
    attempts.push({ tried: code, result: 'miss' });
  }
  return { raw, normalized: bcp, matched: null, via: null, attempts };
}

function readNav(name) {
  try {
    if (typeof navigator === 'undefined' || !(name in navigator)) {
      return { present: false, value: undefined };
    }
    return { present: true, value: navigator[name] };
  } catch (err) {
    return { present: true, error: String(err && err.message ? err.message : err) };
  }
}

function collectRawSignals() {
  const languages = readNav('languages');
  if (languages.present && languages.value && typeof languages.value !== 'string') {
    try {
      languages.value = Array.from(languages.value);
    } catch {
      /* keep as-is */
    }
  }
  let intl = { present: false };
  try {
    const opts = Intl.DateTimeFormat().resolvedOptions();
    intl = { present: true, locale: opts.locale, resolvedOptions: opts };
  } catch (err) {
    intl = { present: false, error: String(err && err.message ? err.message : err) };
  }
  let documentLang = '(absent)';
  try {
    documentLang = document.documentElement && document.documentElement.lang;
  } catch {
    documentLang = '(error)';
  }
  return {
    'navigator.languages': languages,
    'navigator.language': readNav('language'),
    'navigator.userLanguage': readNav('userLanguage'),
    'navigator.browserLanguage': readNav('browserLanguage'),
    'navigator.systemLanguage': readNav('systemLanguage'),
    intl,
    documentElementLang: documentLang,
    userAgent: readNav('userAgent'),
    platform: readNav('platform'),
  };
}

function orderedTags(raw) {
  const rows = [];
  const langs = raw['navigator.languages'];
  if (langs.present && Array.isArray(langs.value)) {
    langs.value.forEach((tag, i) => {
      rows.push({ source: `navigator.languages[${i}]`, tag });
    });
  } else if (langs.present && langs.value != null && langs.value !== '') {
    rows.push({ source: 'navigator.languages', tag: langs.value });
  }
  for (const name of ['navigator.language', 'navigator.userLanguage', 'navigator.browserLanguage', 'navigator.systemLanguage']) {
    const slot = raw[name];
    if (slot.present && slot.value) rows.push({ source: name, tag: slot.value });
  }
  if (raw.intl.present && raw.intl.locale) {
    rows.push({ source: 'Intl.DateTimeFormat locale', tag: raw.intl.locale });
  }
  return rows;
}

export function inspectLanguageDetection() {
  const raw = collectRawSignals();
  const steps = orderedTags(raw).map((row) => ({ ...row, ...interpretTag(row.tag) }));
  const winner = steps.find((step) => step.matched);
  return {
    raw,
    steps,
    detected: winner ? winner.matched : DEFAULT_LANGUAGE,
    winner: winner || null,
    fallback: !winner,
  };
}

export function languageFromBrowser() {
  return canonicalizeLanguage(inspectLanguageDetection().detected) || DEFAULT_LANGUAGE;
}

function dumpSlot(slot) {
  if (!slot || slot.present === false) return '(absent)';
  if (slot.error) return `(error: ${slot.error})`;
  if (slot.value === undefined) return '(undefined)';
  if (slot.value === null) return '(null)';
  if (slot.value === '') return '(empty string)';
  try {
    return JSON.stringify(slot.value);
  } catch {
    return String(slot.value);
  }
}

function describeLang(code) {
  const spec = languageByCode(code);
  return spec && spec.code === code ? `${code} (${spec.name})` : `${code}`;
}

export function formatLanguageDetectionReport(inspect, extras = {}) {
  const lines = [];
  const when = new Date().toISOString();
  lines.push('Vanity Domain — language detection');
  lines.push(when);
  lines.push('');
  lines.push('== Result ==');
  if (inspect.fallback) {
    lines.push(`Detected default: ${describeLang(inspect.detected)}  [no browser tag matched; fell back to en]`);
  } else {
    lines.push(`Detected default: ${describeLang(inspect.detected)}`);
    lines.push(`Won from: ${inspect.winner.source} ${JSON.stringify(inspect.winner.raw)} → ${inspect.winner.matched}${inspect.winner.via && inspect.winner.via !== 'exact' ? ` (${inspect.winner.via})` : ''}`);
  }
  if (extras.currentLanguage) {
    lines.push(`Currently selected: ${describeLang(extras.currentLanguage)}`);
  }
  if (extras.storedLanguage != null) {
    lines.push(`Stored setting: ${extras.storedLanguage === '' ? '(none)' : describeLang(extras.storedLanguage)}`);
  }
  lines.push('');
  lines.push('== Raw signals ==');
  lines.push(`navigator.languages: ${dumpSlot(inspect.raw['navigator.languages'])}`);
  lines.push(`navigator.language: ${dumpSlot(inspect.raw['navigator.language'])}`);
  lines.push(`navigator.userLanguage: ${dumpSlot(inspect.raw['navigator.userLanguage'])}`);
  lines.push(`navigator.browserLanguage: ${dumpSlot(inspect.raw['navigator.browserLanguage'])}`);
  lines.push(`navigator.systemLanguage: ${dumpSlot(inspect.raw['navigator.systemLanguage'])}`);
  if (inspect.raw.intl.present) {
    lines.push(`Intl.DateTimeFormat locale: ${JSON.stringify(inspect.raw.intl.locale)}`);
    try {
      lines.push(`Intl.DateTimeFormat resolvedOptions: ${JSON.stringify(inspect.raw.intl.resolvedOptions)}`);
    } catch {
      lines.push('Intl.DateTimeFormat resolvedOptions: (unserializable)');
    }
  } else {
    lines.push(`Intl.DateTimeFormat: ${inspect.raw.intl.error ? `(error: ${inspect.raw.intl.error})` : '(absent)'}`);
  }
  lines.push(`document.documentElement.lang: ${JSON.stringify(inspect.raw.documentElementLang)}`);
  lines.push(`navigator.userAgent: ${dumpSlot(inspect.raw.userAgent)}`);
  lines.push(`navigator.platform: ${dumpSlot(inspect.raw.platform)}`);
  if (extras.storedJson != null) {
    lines.push(`localStorage vanity_settings: ${extras.storedJson}`);
  }
  lines.push('');
  lines.push('== Interpretation ==');
  if (!inspect.steps.length) {
    lines.push('(no language tags found)');
  }
  inspect.steps.forEach((step, i) => {
    const attempts = step.attempts.map((a) => `${a.tried} ${a.result}`).join(', ') || '(none)';
    const mark = inspect.winner && inspect.winner.source === step.source && inspect.winner.raw === step.raw && step.matched
      ? '  ← winner'
      : '';
    const outcome = step.matched
      ? `matched ${step.matched}${step.via && step.via !== 'exact' ? ` via ${step.via}` : ''}`
      : 'no match';
    lines.push(`${i + 1}. ${step.source} ${JSON.stringify(step.raw)}`);
    lines.push(`   normalized ${JSON.stringify(step.normalized)} · tried ${attempts}`);
    lines.push(`   ${outcome}${mark}`);
  });
  if (inspect.fallback) {
    lines.push(`→ none matched our list; using ${DEFAULT_LANGUAGE}`);
  }
  lines.push('');
  return lines.join('\n');
}

export function buildLanguageDebugReport(currentLanguage, stored = {}) {
  return formatLanguageDetectionReport(inspectLanguageDetection(), {
    currentLanguage,
    storedLanguage: stored.storedLanguage,
    storedJson: stored.storedJson,
  });
}

function fold(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase();
}

export function filterLanguages(query) {
  const q = fold(query).trim();
  if (!q) return LANGUAGES;
  return LANGUAGES.filter((lang) => (
    fold(lang.name).includes(q)
    || fold(lang.english).includes(q)
    || lang.code.toLowerCase().includes(q)
  ));
}

