export const LANGUAGES = [
  { code: 'af', name: 'Afrikaans', path: 'dicts/af.csv' },
  { code: 'bg', name: 'Български', path: 'dicts/bg.csv' },
  { code: 'br', name: 'Brezhoneg', path: 'dicts/br.csv' },
  { code: 'bs', name: 'Bosanski', path: 'dicts/bs.csv' },
  { code: 'ca', name: 'Català', path: 'dicts/ca.csv' },
  { code: 'cs', name: 'Čeština', path: 'dicts/cs.csv' },
  { code: 'da', name: 'Dansk', path: 'dicts/da.csv' },
  { code: 'de', name: 'Deutsch', path: 'dicts/de.csv' },
  { code: 'el', name: 'Ελληνικά', path: 'dicts/el.csv' },
  { code: 'en', name: 'English', path: 'dicts/en.csv' },
  { code: 'eo', name: 'Esperanto', path: 'dicts/eo.csv' },
  { code: 'es', name: 'Español', path: 'dicts/es.csv' },
  { code: 'et', name: 'Eesti', path: 'dicts/et.csv' },
  { code: 'eu', name: 'Euskara', path: 'dicts/eu.csv' },
  { code: 'fi', name: 'Suomi', path: 'dicts/fi.csv' },
  { code: 'fr', name: 'Français', path: 'dicts/fr.csv' },
  { code: 'gl', name: 'Galego', path: 'dicts/gl.csv' },
  { code: 'hr', name: 'Hrvatski', path: 'dicts/hr.csv' },
  { code: 'hu', name: 'Magyar', path: 'dicts/hu.csv' },
  { code: 'hy', name: 'Հայերեն', path: 'dicts/hy.csv' },
  { code: 'id', name: 'Bahasa Indonesia', path: 'dicts/id.csv' },
  { code: 'is', name: 'Íslenska', path: 'dicts/is.csv' },
  { code: 'it', name: 'Italiano', path: 'dicts/it.csv' },
  { code: 'ka', name: 'ქართული', path: 'dicts/ka.csv' },
  { code: 'kk', name: 'Қазақша', path: 'dicts/kk.csv' },
  { code: 'lt', name: 'Lietuvių', path: 'dicts/lt.csv' },
  { code: 'lv', name: 'Latviešu', path: 'dicts/lv.csv' },
  { code: 'mk', name: 'Македонски', path: 'dicts/mk.csv' },
  { code: 'ms', name: 'Bahasa Melayu', path: 'dicts/ms.csv' },
  { code: 'nl', name: 'Nederlands', path: 'dicts/nl.csv' },
  { code: 'no', name: 'Norsk', path: 'dicts/no.csv' },
  { code: 'pl', name: 'Polski', path: 'dicts/pl.csv' },
  { code: 'pt', name: 'Português', path: 'dicts/pt.csv' },
  { code: 'pt_br', name: 'Português (Brasil)', path: 'dicts/pt_br.csv' },
  { code: 'ro', name: 'Română', path: 'dicts/ro.csv' },
  { code: 'ru', name: 'Русский', path: 'dicts/ru.csv' },
  { code: 'sk', name: 'Slovenčina', path: 'dicts/sk.csv' },
  { code: 'sl', name: 'Slovenščina', path: 'dicts/sl.csv' },
  { code: 'sq', name: 'Shqip', path: 'dicts/sq.csv' },
  { code: 'sr', name: 'Srpski', path: 'dicts/sr.csv' },
  { code: 'sv', name: 'Svenska', path: 'dicts/sv.csv' },
  { code: 'tl', name: 'Tagalog', path: 'dicts/tl.csv' },
  { code: 'tr', name: 'Türkçe', path: 'dicts/tr.csv' },
  { code: 'uk', name: 'Українська', path: 'dicts/uk.csv' },
  { code: 'vi', name: 'Tiếng Việt', path: 'dicts/vi.csv' },
];

export const DEFAULT_LANGUAGE = 'en';
export const LANGUAGE_STORAGE_KEY = 'vanity_language';

const byCode = new Map(LANGUAGES.map((lang) => [lang.code, lang]));

export function isKnownLanguage(code) {
  return byCode.has(code);
}

export function languageByCode(code) {
  return byCode.get(code) || byCode.get(DEFAULT_LANGUAGE);
}

export function localeForLanguage(code) {
  if (code === 'pt_br') return 'pt-BR';
  return code || 'en';
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
  return LANGUAGES.filter((lang) => fold(lang.name).includes(q) || lang.code.toLowerCase().includes(q));
}

export function readStoredLanguage() {
  try {
    const code = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (isKnownLanguage(code)) return code;
  } catch {
    /* private mode */
  }
  return DEFAULT_LANGUAGE;
}

export function storeLanguage(code) {
  if (!isKnownLanguage(code)) return;
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, code);
  } catch {
    /* quota or private mode */
  }
}
