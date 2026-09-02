import { getCache, setCache } from './cache.js';
import { abortError, asyncPool, isAbortError, throwIfAborted } from './pool.js';

export const DNS_RCODE_NXDOMAIN = 3;
export const DNS_TYPE_SOA = 6;
export const DNS_TYPE_NS = 2;
export const DNS_CONCURRENCY = 16;
export const RDAP_CONCURRENCY = 2;
export const RATE_WAIT_CAP_MS = 90_000;

export const VERDICT = {
  pending: { cls: 'is-pending', title: 'Confirming with the registry...' },
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

const DEFAULT_COOLDOWN_MS = 5_000;

function isBackoffStatus(status) {
  return status === 429 || status === 403 || status === 503;
}

function isDnsLookupHost(host) {
  return /(^|\.)cloudflare-dns\.com$/i.test(host);
}

function createServiceGate(initialConcurrency) {
  let cap = initialConcurrency;
  let active = 0;
  const q = [];
  let coolUntil = 0;
  let lastLogUntil = 0;
  let timer = null;

  function arm(ms) {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      pump();
    }, Math.max(0, ms));
  }

  function pump() {
    const now = Date.now();
    if (now < coolUntil) {
      cap = 0;
      arm(coolUntil - now);
      return;
    }
    cap = initialConcurrency;
    while (active < cap && q.length && Date.now() >= coolUntil) {
      const job = q.shift();
      active++;
      Promise.resolve()
        .then(job.fn)
        .then(job.resolve, job.reject)
        .finally(() => {
          active--;
          pump();
        });
    }
  }

  function cooldown(waitMs, log, host, status) {
    const wait = Math.max(250, Math.min(RATE_WAIT_CAP_MS, waitMs));
    const until = Date.now() + wait;
    const extended = until > coolUntil + 50;
    coolUntil = Math.max(coolUntil, until);
    cap = 0;
    if (isBackoffStatus(status) && extended && coolUntil > lastLogUntil + 250) {
      lastLogUntil = coolUntil;
      const secs = Math.max(1, Math.ceil((Math.max(0, coolUntil - Date.now())) / 1000));
      log(
        `We're pausing domain validations because we're sending too many requests and getting errors. Waiting for ${secs} seconds.`,
      );
    }
    if (!isDnsLookupHost(host) && (status === 429 || status === 403)) {
      noteRdapPushback(host, coolUntil);
    }
    pump();
  }

  return {
    schedule(fn) {
      return new Promise((resolve, reject) => {
        q.push({ fn, resolve, reject });
        pump();
      });
    },
    cooldown,
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

const rdapPushback = {
  hosts: new Set(),
  until: 0,
  tickTimer: null,
  listeners: new Set(),
};

function emitRdapPushback() {
  const until = rdapPushback.until;
  const active = rdapPushback.hosts.size > 0;
  for (const fn of rdapPushback.listeners) {
    try {
      fn({ active, until });
    } catch {
      /* listener errors should not break backoff */
    }
  }
}

function armPushbackTick(until) {
  if (rdapPushback.tickTimer) {
    clearTimeout(rdapPushback.tickTimer);
    rdapPushback.tickTimer = null;
  }
  const wait = until - Date.now();
  if (wait <= 0) return;
  rdapPushback.tickTimer = setTimeout(() => {
    rdapPushback.tickTimer = null;
    emitRdapPushback();
  }, wait);
}

function noteRdapPushback(host, until) {
  rdapPushback.hosts.add(host);
  rdapPushback.until = Math.max(rdapPushback.until, until);
  armPushbackTick(rdapPushback.until);
  emitRdapPushback();
}

function noteRdapRecovered(host) {
  if (!rdapPushback.hosts.size) return;
  rdapPushback.hosts.delete(host);
  if (!rdapPushback.hosts.size) {
    rdapPushback.until = 0;
    if (rdapPushback.tickTimer) {
      clearTimeout(rdapPushback.tickTimer);
      rdapPushback.tickTimer = null;
    }
  }
  emitRdapPushback();
}

export function clearRdapPushback() {
  if (!rdapPushback.hosts.size && !rdapPushback.until) return;
  rdapPushback.hosts.clear();
  rdapPushback.until = 0;
  if (rdapPushback.tickTimer) {
    clearTimeout(rdapPushback.tickTimer);
    rdapPushback.tickTimer = null;
  }
  emitRdapPushback();
}

export function subscribeRdapPushback(fn) {
  rdapPushback.listeners.add(fn);
  fn({ active: rdapPushback.hosts.size > 0, until: rdapPushback.until });
  return () => rdapPushback.listeners.delete(fn);
}

export function dropQueuedDns() {
  dropQueued(isDnsLookupHost);
}

export function dropQueuedRdap() {
  dropQueued((host) => !isDnsLookupHost(host));
}

function dropQueued(pred) {
  const err = abortError();
  for (const [host, gate] of hostGates) {
    if (pred(host)) gate.clear(err);
  }
}

export function abortInFlightRequests() {
  dropQueued(() => true);
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
  let last = null;

  for (let attempt = 0; attempt < 8; attempt++) {
    throwIfAborted(signal);
    const outcome = await gate.schedule(async () => {
      throwIfAborted(signal);
      try {
        const res = await fetch(url, { ...options, signal });
        if (isBackoffStatus(res.status)) {
          const hinted = parseRetryAfterMs(res);
          gate.cooldown(hinted != null ? hinted : DEFAULT_COOLDOWN_MS, log, host, res.status);
          return { ok: false, res };
        }
        if (!isDnsLookupHost(host) && (res.status === 200 || res.status === 404)) {
          noteRdapRecovered(host);
        }
        return { ok: true, res };
      } catch (e) {
        if (isAbortError(e) || signal?.aborted) throw abortError();
        // RDAP 403/429 often omit CORS headers, so fetch() throws and JS
        // never sees the status. Treat that like a 403 with no Retry-After.
        const hidden = isDnsLookupHost(host) ? 0 : 403;
        gate.cooldown(DEFAULT_COOLDOWN_MS, log, host, hidden);
        return { ok: false, error: e };
      }
    });

    if (outcome.ok) return outcome.res;
    last = outcome.res;
  }
  throw new Error('rate-limited');
}

export async function initRdapBootstrap(log) {
  const cacheKey = 'iana_rdap_dns_v2';
  const cached = await getCache(cacheKey);
  if (cached && cached.tlds && cached.bases) {
    rdapBases = new Map(Object.entries(cached.bases));
    return;
  }
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
  } catch {
    log("Couldn't reach the registry list. We'll still check names.", 'error');
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
  throw new Error('registry-error');
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
          log(`Couldn't confirm ${fqdn} with the registry.`, 'error');
        }
      })());
    });

    await Promise.all(rdapTasks);
  } catch (e) {
    await Promise.allSettled(rdapTasks);
    throw e;
  }
}
