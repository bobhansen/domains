export function normalizeTld(raw) {
  return String(raw || '').trim().toLowerCase().replace(/^\.+/, '').replace(/\.+$/, '');
}

export function resolvedTld(choice, custom) {
  return normalizeTld(choice === 'custom' ? custom : choice);
}

export function validateTld(raw, validSet = new Set()) {
  const tld = normalizeTld(raw);
  if (!tld) return { ok: false, error: 'Enter a TLD.', tld: '' };
  if (tld.length < 2 || tld.length > 63) {
    return { ok: false, error: 'Use a TLD between 2 and 63 characters.', tld };
  }
  if (!/^[a-z0-9]+(?:-+[a-z0-9]+)*$/.test(tld)) {
    return { ok: false, error: 'Use letters, numbers, and hyphens only.', tld };
  }
  if (validSet instanceof Set && validSet.size > 0 && !validSet.has(tld)) {
    return { ok: false, error: `".${tld}" is not a registered IANA TLD.`, tld };
  }
  return { ok: true, tld };
}
