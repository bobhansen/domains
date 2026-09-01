import { useCallback, useEffect, useRef, useState } from 'react';
import { MarkovGenerator } from '../lib/markov.js';
import { loadValidTlds } from '../lib/tlds.js';
import { expectedHitRate } from '../lib/hitRates.js';
import { LIMITS, clampInt, clampSettings, snapShortBias } from '../lib/limits.js';
import {
  DNS_CONCURRENCY,
  RDAP_CONCURRENCY,
  abortInFlightRequests,
  dnsLooksUndelegated,
  initRdapBootstrap,
  rdapIsUnregistered,
  tldHasRdap,
} from '../lib/availability.js';
import { isAbortError, sleep } from '../lib/pool.js';

const LOG_CAP = 220;
const CUSTOM_TLD_DEBOUNCE_MS = 400;

function resolvedTld(choice, custom) {
  return (choice === 'custom' ? custom : choice).trim().toLowerCase().replace(/^\./, '');
}

export const TLD_CHIPS = ['com', 'org', 'net', 'me', 'io', 'co', 'ai', 'app', 'custom'];

export function useDomainFinder() {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Loading word model…');
  const [logs, setLogs] = useState([{ id: 0, msg: 'Initializing system...', type: 'normal' }]);
  const [results, setResults] = useState([]);
  const [found, setFound] = useState(0);
  const [checked, setChecked] = useState(0);

  const [tldChoice, setTldChoice] = useState('org');
  const [customTld, setCustomTld] = useState('');
  const [targetCount, setTargetCount] = useState(LIMITS.target.fallback);
  const [minLen, setMinLen] = useState(LIMITS.length.minFallback);
  const [maxLen, setMaxLen] = useState(LIMITS.length.maxFallback);
  const [shortBias, setShortBias] = useState(LIMITS.shortBias.fallback);

  const generatorRef = useRef(null);
  const validTldsRef = useRef(new Set());
  const runningRef = useRef(false);
  const abortRef = useRef(null);
  const runIdRef = useRef(0);
  const logIdRef = useRef(0);
  const logFnRef = useRef(() => {});
  const settingsRef = useRef({});
  const customTldRef = useRef(customTld);

  const log = useCallback((msg, type = 'normal') => {
    const id = ++logIdRef.current;
    setLogs((prev) => {
      const next = [...prev, { id, msg, type }];
      return next.length > LOG_CAP ? next.slice(next.length - LOG_CAP) : next;
    });
  }, []);

  logFnRef.current = log;
  settingsRef.current = { tldChoice, customTld, targetCount, minLen, maxLen, shortBias };

  useEffect(() => {
    let cancelled = false;
    const generator = new MarkovGenerator();
    generatorRef.current = generator;

    (async () => {
      try {
        validTldsRef.current = await loadValidTlds((msg, type) => logFnRef.current(msg, type));
        await initRdapBootstrap((msg, type) => logFnRef.current(msg, type));
        await generator.init((msg, type) => logFnRef.current(msg, type));
        if (cancelled) return;
        setReady(true);
        setStatus('Ready — searching automatically.');
      } catch (e) {
        if (!cancelled) setStatus(`Startup failed: ${e.message}`);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const abortCurrent = useCallback(() => {
    abortRef.current?.abort();
    abortInFlightRequests();
  }, []);

  const preemptRun = useCallback(() => {
    if (!runningRef.current) return;
    runIdRef.current += 1;
    abortCurrent();
    runningRef.current = false;
    abortRef.current = null;
  }, [abortCurrent]);

  const runSearch = useCallback(async () => {
    if (!generatorRef.current) return;

    const {
      tldChoice: choice,
      customTld: custom,
      targetCount: target,
      minLen: min,
      maxLen: max,
      shortBias: bias,
    } = settingsRef.current;

    const tld = resolvedTld(choice, custom);
    if (!tld) {
      preemptRun();
      setBusy(false);
      log('Please enter a TLD.', 'error');
      return;
    }
    if (validTldsRef.current.size > 0 && !validTldsRef.current.has(tld)) {
      preemptRun();
      setBusy(false);
      log(`Warning: ".${tld}" does not appear to be a valid IANA TLD.`, 'error');
      return;
    }

    preemptRun();

    const {
      targetCount: targetN,
      minLen: minL,
      maxLen: maxL,
      shortBias: biasN,
    } = clampSettings({ targetCount: target, minLen: min, maxLen: max, shortBias: bias });
    const generator = generatorRef.current;
    const useRdap = tldHasRdap(tld);

    const abort = new AbortController();
    const runId = ++runIdRef.current;
    abortRef.current = abort;
    runningRef.current = true;
    setBusy(true);
    setFound(0);
    setChecked(0);
    setStatus(`Searching .${tld} · ${minL}–${maxL} letters`);

    const priorRate = expectedHitRate(generator, tld, minL, maxL, biasN);
    const allAvailable = [];
    const checkedHistory = new Set();
    let totalChecked = 0;
    let finished = false;
    const fadeMs = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 320;

    log(`Starting search for ${targetN} .${tld} domains...`);
    log(`Expected hit rate ${(priorRate * 100).toFixed(1)}% from length mix ${minL}–${maxL}.`);
    if (useRdap) {
      log('Using registry RDAP to confirm names that DNS says are undelegated.');
    } else {
      log(`No RDAP for .${tld}; treating authoritative DNS NXDOMAIN as available.`);
    }

    const stillThisRun = () => runIdRef.current === runId;

    const emitStats = () => {
      if (!stillThisRun()) return;
      setFound(allAvailable.length);
      setChecked(totalChecked);
    };

    const hitTarget = () => allAvailable.length >= targetN;

    const finishIfFull = () => {
      if (!hitTarget() || finished) return;
      finished = true;
      abort.abort();
      abortInFlightRequests();
      if (abortRef.current === abort) abortRef.current = null;
      runningRef.current = false;
      setBusy(false);
      hidePlaceholder();
    };

    let nextSlotId = 0;
    const makePlaceholder = (phase = 'in') => ({
      id: nextSlotId,
      tld,
      word: '',
      domain: '',
      status: 'placeholder',
      phase,
    });

    const dropPlaceholder = (rows) => rows.filter((r) => r.status !== 'placeholder');
    const namedCount = (rows) => dropPlaceholder(rows).length;

    const hidePlaceholder = () => {
      if (!stillThisRun()) return;
      setResults((prev) => dropPlaceholder(prev));
    };

    setResults([makePlaceholder()]);

    const setSlot = (id, patch) => {
      if (!stillThisRun()) return;
      setResults((prev) => {
        const prevRow = prev.find((r) => r.id === id) || {};
        const fillingPlaceholder = prevRow.status === 'placeholder';
        const word = patch.word ?? prevRow.word;
        const row = {
          ...prevRow,
          id,
          tld,
          ...patch,
          word,
          domain: word ? `${word}.${tld}` : '',
        };
        const i = prev.findIndex((r) => r.id === id);
        if (i === -1) {
          const ph = prev.findIndex((r) => r.status === 'placeholder');
          const copy = prev.slice();
          if (ph !== -1) copy[ph] = row;
          else copy.push(row);
          if (fillingPlaceholder || ph !== -1) nextSlotId = Math.max(nextSlotId, Number(id) + 1);
          if (!hitTarget() && namedCount(copy) < targetN) copy.push(makePlaceholder());
          return copy;
        }
        const copy = prev.slice();
        copy[i] = row;
        if (fillingPlaceholder) {
          nextSlotId = Math.max(nextSlotId, Number(id) + 1);
          if (!hitTarget() && namedCount(copy) < targetN) copy.push(makePlaceholder());
        }
        return copy;
      });
    };

    const nextCandidate = () => {
      for (let i = 0; i < 80; i++) {
        const w = generator.generate(minL, maxL, biasN);
        if (w && !checkedHistory.has(w)) {
          checkedHistory.add(w);
          return w;
        }
      }
      return null;
    };

    const MAX_HIT_QUEUE = Math.max(4, DNS_CONCURRENCY);
    const hitQueue = [];
    const replaceWaiters = [];
    const appendWaiters = [];
    let hitsExhausted = false;
    let wakeHitPump = () => {};

    const takeHit = (kind) => {
      if (hitQueue.length) {
        const word = hitQueue.shift();
        wakeHitPump();
        return Promise.resolve(word);
      }
      if (hitsExhausted || abort.signal.aborted || hitTarget()) return Promise.resolve(null);
      return new Promise((resolve) => {
        (kind === 'replace' ? replaceWaiters : appendWaiters).push(resolve);
        wakeHitPump();
      });
    };

    const settleHitWaiters = () => {
      hitsExhausted = true;
      for (const resolve of replaceWaiters.splice(0)) resolve(null);
      for (const resolve of appendWaiters.splice(0)) resolve(null);
    };

    const offerHit = (word) => {
      if (abort.signal.aborted || hitTarget()) return;
      if (replaceWaiters.length) replaceWaiters.shift()(word);
      else if (appendWaiters.length) appendWaiters.shift()(word);
      else hitQueue.push(word);
    };

    const pumpDnsHits = async () => {
      const inflight = new Set();
      const launch = (word) => {
        const task = (async () => {
          try {
            const ok = await dnsLooksUndelegated(`${word}.${tld}`, log, abort.signal);
            totalChecked += 1;
            emitStats();
            if (ok) offerHit(word);
          } catch (e) {
            if (!isAbortError(e)) {
              totalChecked += 1;
              emitStats();
            }
          }
        })().finally(() => inflight.delete(task));
        inflight.add(task);
      };

      try {
        while (!abort.signal.aborted && !hitTarget()) {
          if (hitQueue.length >= MAX_HIT_QUEUE) {
            await Promise.race([
              new Promise((resolve) => {
                wakeHitPump = resolve;
              }),
              sleep(250, abort.signal).catch(() => {}),
            ]);
            continue;
          }
          const word = nextCandidate();
          if (!word) {
            if (inflight.size === 0) break;
            await Promise.race(inflight);
            continue;
          }
          launch(word);
          if (inflight.size >= DNS_CONCURRENCY) await Promise.race(inflight);
        }
        if (inflight.size) await Promise.allSettled([...inflight]);
      } catch (e) {
        if (!isAbortError(e)) throw e;
      } finally {
        settleHitWaiters();
      }
    };

    const confirmSlot = (id, word) => {
      if (hitTarget()) return false;
      allAvailable.push(`${word}.${tld}`);
      setSlot(id, { word, status: 'available', phase: 'shown' });
      emitStats();
      finishIfFull();
      return true;
    };

    const runSlot = async (id, firstWord) => {
      let word = firstWord;
      let rdapPromise = useRdap
        ? rdapIsUnregistered(`${word}.${tld}`, tld, log, abort.signal)
        : Promise.resolve(true);
      setSlot(id, { word, status: 'pending', phase: 'populate' });
      if (!useRdap) {
        confirmSlot(id, word);
        return;
      }

      while (!abort.signal.aborted && !hitTarget()) {
        let available = false;
        try {
          available = await rdapPromise;
        } catch (e) {
          if (isAbortError(e)) return;
          log(`RDAP still unresolved for ${word}.${tld}: ${e.message}`, 'error');
          available = false;
        }
        rdapPromise = null;
        if (abort.signal.aborted || hitTarget()) return;
        if (available) {
          confirmSlot(id, word);
          return;
        }

        setSlot(id, { word, status: 'taken', phase: 'shown' });
        const failedWord = word;
        word = await takeHit('replace');
        if (!word || abort.signal.aborted || hitTarget()) return;
        rdapPromise = rdapIsUnregistered(`${word}.${tld}`, tld, log, abort.signal);
        setSlot(id, { word: failedWord, status: 'taken', phase: 'out' });
        await sleep(fadeMs, abort.signal).catch(() => {});
        if (abort.signal.aborted || hitTarget()) return;
        setSlot(id, { word, status: 'pending', phase: 'in' });
      }
    };

    try {
      log(
        useRdap
          ? `Filling ${targetN} names: DNS×${DNS_CONCURRENCY} pipelined into RDAP×${RDAP_CONCURRENCY}...`
          : `Filling ${targetN} names against Cloudflare DoH...`,
      );
      const pumping = pumpDnsHits();
      const workers = [];
      for (let id = 0; id < targetN; id++) {
        if (abort.signal.aborted || hitTarget()) break;
        const word = await takeHit('append');
        if (!word) break;
        workers.push(runSlot(id, word));
      }
      await Promise.all(workers);
      await pumping.catch(() => {});
      if (!stillThisRun()) return;
      if (finished || hitTarget()) {
        setResults((prev) => prev.filter((r) => r.status === 'available').slice(0, targetN));
        log(`Done! Checked ${totalChecked} domains. Found ${allAvailable.length}.`, 'success');
        setStatus(`Done · ${allAvailable.length} of ${targetN} · ${totalChecked} checked`);
      } else if (abort.signal.aborted) {
        log('Search cancelled.');
        setStatus('Cancelled — change settings and start again.');
      } else {
        log('Could not generate enough unique candidates matching constraints.', 'error');
        setStatus('Search stopped.');
      }
    } catch (e) {
      if (!stillThisRun()) return;
      if (finished || hitTarget()) {
        setResults((prev) => prev.filter((r) => r.status === 'available').slice(0, targetN));
        log(`Done! Checked ${totalChecked} domains. Found ${allAvailable.length}.`, 'success');
      } else if (isAbortError(e) || abort.signal.aborted) {
        log('Search cancelled.');
        setStatus('Search stopped.');
      } else {
        log(`Error during search: ${e.message}`, 'error');
        setStatus('Search stopped on an error.');
      }
    } finally {
      if (!stillThisRun()) return;
      if (abortRef.current === abort) abortRef.current = null;
      runningRef.current = false;
      setBusy(false);
      hidePlaceholder();
    }
  }, [log, preemptRun]);

  const cancelSearch = useCallback(() => {
    if (!runningRef.current) return;
    abortCurrent();
  }, [abortCurrent]);

  useEffect(() => {
    if (!ready) return undefined;

    const tld = resolvedTld(tldChoice, customTld);
    const customTldChanged = customTldRef.current !== customTld;
    customTldRef.current = customTld;

    if (!tld) {
      preemptRun();
      setBusy(false);
      return undefined;
    }

    if (tldChoice === 'custom' && customTldChanged) {
      preemptRun();
      setBusy(false);
      const timer = setTimeout(() => runSearch(), CUSTOM_TLD_DEBOUNCE_MS);
      return () => clearTimeout(timer);
    }

    runSearch();
    return undefined;
  }, [ready, tldChoice, customTld, targetCount, minLen, maxLen, shortBias, runSearch, preemptRun]);

  function commitTargetCount(raw) {
    setTargetCount(clampInt(raw, LIMITS.target.min, LIMITS.target.max, LIMITS.target.fallback));
  }

  function commitMinLen(raw) {
    const minL = clampInt(raw, LIMITS.length.min, LIMITS.length.max, LIMITS.length.minFallback);
    setMinLen(minL);
    setMaxLen((maxL) => Math.max(minL, clampInt(maxL, LIMITS.length.min, LIMITS.length.max, LIMITS.length.maxFallback)));
  }

  function commitMaxLen(raw) {
    const maxL = clampInt(raw, LIMITS.length.min, LIMITS.length.max, LIMITS.length.maxFallback);
    setMaxLen(maxL);
    setMinLen((minL) => Math.min(maxL, clampInt(minL, LIMITS.length.min, LIMITS.length.max, LIMITS.length.minFallback)));
  }

  function commitShortBias(raw) {
    setShortBias(snapShortBias(raw));
  }

  return {
    ready,
    busy,
    status,
    logs,
    results,
    found,
    checked,
    tldChoice,
    setTldChoice,
    customTld,
    setCustomTld,
    targetCount,
    setTargetCount: commitTargetCount,
    minLen,
    setMinLen: commitMinLen,
    maxLen,
    setMaxLen: commitMaxLen,
    shortBias,
    setShortBias: commitShortBias,
    runSearch,
    cancelSearch,
  };
}
