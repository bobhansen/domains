import { getCache, setCache } from './cache.js';

export async function loadValidTlds(log) {
  const cacheKey = 'iana_tlds_v1';
  const cached = await getCache(cacheKey);
  if (cached) return new Set(cached);

  log('Fetching canonical IANA TLD list...');
  try {
    const res = await fetch('https://data.iana.org/TLD/tlds-alpha-by-domain.txt');
    const text = await res.text();
    const tlds = text
      .split('\n')
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => l.trim().toLowerCase());
    await setCache(cacheKey, tlds);
    log(`Loaded ${tlds.length} top-level domains.`, 'success');
    return new Set(tlds);
  } catch {
    log('Failed to fetch IANA TLDs, relying on basic validation.', 'error');
    return new Set();
  }
}
