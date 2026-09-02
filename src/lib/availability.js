import { getCache, setCache } from './cache.js';
import { abortError, asyncPool, isAbortError, sleep, throwIfAborted } from './pool.js';

export const DNS_RCODE_NXDOMAIN = 3;
export const DNS_TYPE_SOA = 6;
export const DNS_TYPE_NS = 2;
export const DNS_CONCURRENCY = 16;
export const RDAP_CONCURRENCY = 2;
export const RATE_WAIT_CAP_MS = 90_000;

export const VERDICT = {
  pending: { cls: 'is-pending', title: 'Checking another source...' },
  available: { cls: 'is-available', title: "Looks like it's available" },
  taken: { cls: 'is-taken', title: "We thought it was available, but it wasn't." },
  placeholder: { cls: 'is-pending is-placeholder', title: 'Looking for the next name...' },
};

let rdapBases = new Map();

function parseRetryAfterMs(res) {
  const raw = res.headers.get('Retry-After');
  if (raw) {
    const trimmed = raw.trim();
    if (/^\d+(\.\d+)?$/.test(trimmed)) {
      return Math.min(RATE_WAIT_CAP_MS, Number(trimmed) * 1000);
    }
    const when = Date.parse(trimmed);
    if (!Number.isNaN(when)) {
      return Math.min(RATE_WAIT_CAP_MS, Math.max(0, when - Date.now()));
    }
  }
  const reset = res.headers.get('RateLimit-Reset') || res.headers.get('X-RateLimit-Reset');
  if (reset && /^\d+(\.\d+)?$/.test(reset.trim())) {
    const n = Number(reset);
    const ms = n > 1e10 ? n - Date.now() : n > 1e9 ? n * 1000 - Date.now() : n * 1000;
    if (ms > 0) return Math.min(RATE_WAIT_CAP_MS, ms);
  }
  return null;
}

function createServiceGate(initialConcurrency) {
  let cap = initialConcurrency;
  let active = 0;
  const q = [];
  let coolUntil = 0;
  let gapMs = 0;
  let lastStart = 0;
  let lastThrottleAt = 0;
  let timer = null;
  const QUIET_RESTORE_MS = 20_000;

  function arm(ms) {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      pump();
    }, Math.max(0, ms));
  }

  function restoreIfQuiet(now) {
    if (now < coolUntil) return;
    const quietFor = now - Math.max(lastThrottleAt, coolUntil);
    if (quietFor >= QUIET_RESTORE_MS) {
      cap = initialConcurrency;
      gapMs = 0;
    }
  }

  function pump() {
    const now = Date.now();
    restoreIfQuiet(now);
    if (now < coolUntil) {
      arm(coolUntil - now);
      return;
    }
    const gap = lastStart + gapMs - now;
    if (gap > 0) {
      arm(gap);
      return;
    }
    while (active < cap && q.length && Date.now() >= coolUntil && Date.now() >= lastStart + gapMs) {
      const job = q.shift();
      active++;
      lastStart = Date.now();
      Promise.resolve()
        .then(job.fn)
        .then(job.resolve, job.reject)
        .finally(() => {
          active--;
          pump();
        });
    }
  }

  return {
    schedule(fn) {
      return new Promise((resolve, reject) => {
        q.push({ fn, resolve, reject });
        pump();
      });
    },
    pause(ms) {
      const now = Date.now();
      lastThrottleAt = now;
      coolUntil = Math.max(coolUntil, now + ms);
      gapMs = Math.max(gapMs, Math.min(Math.floor(ms / 3), 2500));
      cap = Math.max(1, Math.ceil(cap / 2));
      pump();
    },
    succeed() {
      if (Date.now() < coolUntil) return;
      if (cap < initialConcurrency) cap = Math.min(initialConcurrency, cap + 1);
      gapMs = gapMs < 40 ? 0 : Math.floor(gapMs / 2);
    },
    clear(err) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      while (q.length) {
        q.shift().reject(err);
      }
    },
  };
}

const hostGates = new Map();

export function abortInFlightRequests() {
  const err = abortError();
  for (const gate of hostGates.values()) gate.clear(err);
}

function gateFor(url, concurrency) {
  const host = new URL(url).hostname;
  if (!hostGates.has(host)) hostGates.set(host, createServiceGate(concurrency));
  return hostGates.get(host);
}

async function fetchHonoringRateLimit(url, options, concurrency, log, signal) {
  throwIfAborted(signal);
  const gate = gateFor(url, concurrency);
  const host = new URL(url).hostname;
  let res;
  for (let attempt = 0; attempt < 8; attempt++) {
    throwIfAborted(signal);
    try {
      res = await gate.schedule(() => fetch(url, { ...options, signal }));
    } catch (e) {
      if (isAbortError(e) || signal?.aborted) throw abortError();
      const wait = Math.min(12_000, 800 * 2 ** attempt);
      log(`Request to ${host} blocked (often HTTP 429 without CORS headers); waiting ${(wait / 1000).toFixed(1)}s.`);
      gate.pause(wait);
      await sleep(wait, signal);
      continue;
    }
    if (res.status !== 429 && res.status !== 503) {
      gate.succeed();
      return res;
    }
    const hinted = parseRetryAfterMs(res);
    const wait = hinted != null ? Math.max(hinted, 250) : Math.min(10_000, 500 * 2 ** attempt);
    log(
      `HTTP ${res.status} from ${host}; waiting ${(wait / 1000).toFixed(1)}s` +
        (hinted != null ? ' (Retry-After).' : ' (backoff).'),
    );
    gate.pause(wait);
    await sleep(wait, signal);
  }
  throw new Error(`rate limited: HTTP ${res && res.status} for ${url}`);
}

export async function initRdapBootstrap(log) {
  const cacheKey = 'iana_rdap_dns_v2';
  const cached = await getCache(cacheKey);
  if (cached && cached.tlds && cached.bases) {
    rdapBases = new Map(Object.entries(cached.bases));
    return;
  }
  log('Fetching IANA RDAP bootstrap...');
  try {
    const res = await fetch('https://data.iana.org/rdap/dns.json');
    const data = await res.json();
    const tlds = [];
    const bases = {};
    for (const svc of data.services || []) {
      const urls = svc[1] || [];
      const base = String(urls[0] || '').replace(/\/?$/, '/');
      for (const name of svc[0] || []) {
        const t = String(name).toLowerCase();
        tlds.push(t);
        if (base) bases[t] = base;
      }
    }
    rdapBases = new Map(Object.entries(bases));
    await setCache(cacheKey, { tlds, bases });
    log(`Registry RDAP listed for ${tlds.length} TLDs.`, 'success');
  } catch {
    log('Failed to load RDAP bootstrap; falling back to DNS for all TLDs.', 'error');
  }
}

export function rdapBaseFor(tld) {
  const labels = tld.toLowerCase().split('.').filter(Boolean);
  for (let i = 0; i < labels.length; i++) {
    const suffix = labels.slice(i).join('.');
    if (rdapBases.has(suffix)) return rdapBases.get(suffix);
  }
  return null;
}

export function tldHasRdap(tld) {
  return !!rdapBaseFor(tld);
}

export function asciiDomain(domain) {
  try {
    return new URL(`https://${domain}`).hostname;
  } catch {
    return String(domain || '').toLowerCase();
  }
}

function rdapLookupUrl(domain, tld) {
  const host = asciiDomain(domain);
  const base = rdapBaseFor(tld);
  if (base) return `${base}domain/${encodeURIComponent(host)}`;
  return `https://rdap.org/domain/${encodeURIComponent(host)}`;
}

function isAuthoritativeNegative(data) {
  if (!data || data.Status !== DNS_RCODE_NXDOMAIN) return false;
  const authority = data.Authority || [];
  return authority.some((rr) => rr.type === DNS_TYPE_SOA);
}

function dnsIsDelegated(data) {
  const answer = (data && data.Answer) || [];
  return answer.some((rr) => rr.type === DNS_TYPE_NS || rr.type === 5);
}

export async function dnsLooksUndelegated(domain, log, signal) {
  const res = await fetchHonoringRateLimit(
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(asciiDomain(domain))}&type=NS`,
    { headers: { Accept: 'application/dns-json' } },
    DNS_CONCURRENCY,
    log,
    signal,
  );
  if (!res.ok) return false;
  const data = await res.json();
  if (dnsIsDelegated(data)) return false;
  return isAuthoritativeNegative(data);
}

export async function rdapIsUnregistered(domain, tld, log, signal) {
  const res = await fetchHonoringRateLimit(
    rdapLookupUrl(domain, tld),
    { headers: { Accept: 'application/rdap+json' } },
    RDAP_CONCURRENCY,
    log,
    signal,
  );
  if (res.status === 404) return true;
  if (res.status === 200) return false;
  throw new Error(`RDAP HTTP ${res.status}`);
}

export async function scanNames(words, tld, { onDnsHit, onRdap, log, signal }) {
  const useRdap = tldHasRdap(tld);
  const rdapTasks = [];

  try {
    await asyncPool(DNS_CONCURRENCY, words, async (word) => {
      throwIfAborted(signal);
      const fqdn = `${word}.${tld}`;
      let undelegated = false;
      try {
        undelegated = await dnsLooksUndelegated(fqdn, log, signal);
      } catch (e) {
        if (isAbortError(e)) throw e;
        return;
      }
      throwIfAborted(signal);
      if (!undelegated) return;
      onDnsHit(word);
      if (!useRdap) return;
      rdapTasks.push((async () => {
        try {
          onRdap(word, await rdapIsUnregistered(fqdn, tld, log, signal));
        } catch (e) {
          if (isAbortError(e)) throw e;
          log(`RDAP still unresolved for ${fqdn}: ${e.message}`, 'error');
        }
      })());
    });

    await Promise.all(rdapTasks);
  } catch (e) {
    await Promise.allSettled(rdapTasks);
    throw e;
  }
}
