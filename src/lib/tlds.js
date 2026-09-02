import { getCache, setCache } from './cache.js';

export async function loadValidTlds(log) {
  const cacheKey = 'iana_tlds_v1';
  const cached = await getCache(cacheKey);
  if (cached) return new Set(cached);

  log('Getting the list of domain endings…');
  try {
    const res = await fetch('https://data.iana.org/TLD/tlds-alpha-by-domain.txt');
    const text = await res.text();
    const tlds = text
      .split('\n')
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => l.trim().toLowerCase());
    await setCache(cacheKey, tlds);
    log('Domain endings are ready.', 'success');
    return new Set(tlds);
  } catch {
    log("Couldn't download the list of domain endings. Custom ones may not be checked.", 'error');
    return new Set();
  }
}
