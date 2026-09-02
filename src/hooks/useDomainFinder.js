import { useCallback, useEffect, useRef, useState } from 'react';
import { MarkovGenerator } from '../lib/markov.js';
import { loadValidTlds } from '../lib/tlds.js';
import { expectedHitRate } from '../lib/hitRates.js';
import { LIMITS, clampInt, clampSettings, snapShortBias } from '../lib/limits.js';
import { TLD_CHIPS, resolvedTld, validateTld } from '../lib/tld.js';
import { isKnownLanguage, languageByCode } from '../lib/languages.js';
import { readStoredSettings, storeSettings } from '../lib/settings.js';
import {
  DNS_CONCURRENCY,
  abortInFlightRequests,
  clearRdapPushback,
  dnsLooksUndelegated,
  initRdapBootstrap,
  rdapIsUnregistered,
  tldHasRdap,
} from '../lib/availability.js';
import { isAbortError, sleep } from '../lib/pool.js';

const LOG_CAP = 220;
const CUSTOM_TLD_DEBOUNCE_MS = 400;

function describeSearchError(err) {
  const msg = String(err && err.message ? err.message : err);
  if (/rate-limited/i.test(msg)) return 'Had to stop — too many checks at once.';
  if (/registry-error/i.test(msg)) return "Couldn't confirm names with the registry.";
  return 'Search hit a problem.';
}

export { TLD_CHIPS };

export function useDomainFinder() {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Getting ready…');
  const [logs, setLogs] = useState([{ id: 0, msg: 'Starting up…', type: 'normal' }]);
  const [results, setResults] = useState([]);
  const [found, setFound] = useState(0);
  const [checked, setChecked] = useState(0);
  const [capacity, setCapacityState] = useState(0);

  const [initial] = useState(readStoredSettings);
  const [language, setLanguageState] = useState(initial.language);
  const [modelLang, setModelLang] = useState(null);
  const [bootReady, setBootReady] = useState(false);
  const [tldChoice, setTldChoice] = useState(initial.tldChoice);
  const [customTld, setCustomTld] = useState(initial.customTld);
  const [minLen, setMinLen] = useState(initial.minLen);
  const [maxLen, setMaxLen] = useState(initial.maxLen);
  const [shortBias, setShortBias] = useState(initial.shortBias);

  const generatorRef = useRef(null);
  const validTldsRef = useRef(new Set());
  const runningRef = useRef(false);
  const abortRef = useRef(null);
  const runIdRef = useRef(0);
  const logIdRef = useRef(0);
  const logFnRef = useRef(() => {});
  const settingsRef = useRef({});
  const customTldRef = useRef(customTld);
  const capacityRef = useRef(0);
  const foundRef = useRef([]);
  const checkedHistoryRef = useRef(new Set());
  const nextIdRef = useRef(0);
  const checkedCountRef = useRef(0);

  const log = useCallback((msg, type = 'normal') => {
    const id = ++logIdRef.current;
    setLogs((prev) => {
      const next = [...prev, { id, msg, type }];
      return next.length > LOG_CAP ? next.slice(next.length - LOG_CAP) : next;
    });
  }, []);

  logFnRef.current = log;
  settingsRef.current = { tldChoice, customTld, minLen, maxLen, shortBias, language };
  const ready = bootReady && modelLang === language;

  useEffect(() => {
    storeSettings({ language, tldChoice, customTld, minLen, maxLen, shortBias });
  }, [language, tldChoice, customTld, minLen, maxLen, shortBias]);

  const setCapacity = useCallback((n) => {
    const cap = Math.max(0, Math.min(LIMITS.target.max, Math.round(Number(n) || 0)));
    if (cap < 1 || cap === capacityRef.current) return;
    capacityRef.current = cap;
    setCapacityState(cap);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const generator = new MarkovGenerator();
    generatorRef.current = generator;

    (async () => {
      try {
        validTldsRef.current = await loadValidTlds((msg, type) => logFnRef.current(msg, type));
        await initRdapBootstrap((msg, type) => logFnRef.current(msg, type));
        if (cancelled) return;
        setBootReady(true);
      } catch (e) {
        if (!cancelled) {
          logFnRef.current('Startup failed.', 'error');
          setStatus('Startup failed.');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const abortCurrent = useCallback(() => {
    abortRef.current?.abort();
    abortInFlightRequests();
    clearRdapPushback();
  }, []);

  const preemptRun = useCallback(() => {
    if (!runningRef.current) return;
    runIdRef.current += 1;
    abortCurrent();
    runningRef.current = false;
    abortRef.current = null;
  }, [abortCurrent]);

  useEffect(() => {
    if (!bootReady || !generatorRef.current) return undefined;
    let cancelled = false;
    const spec = languageByCode(language);
    setModelLang(null);
    setStatus(`Loading ${spec.name}…`);
    preemptRun();
    setBusy(false);

    (async () => {
      try {
        await generatorRef.current.load(spec.code, (msg, type) => logFnRef.current(msg, type));
        if (cancelled) return;
        setModelLang(spec.code);
        setStatus('Ready — searching automatically.');
      } catch (e) {
        if (!cancelled) {
          logFnRef.current(`Couldn't load ${spec.name}.`, 'error');
          setStatus(`Couldn't load ${spec.name}.`);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bootReady, language, preemptRun]);

  const runSearch = useCallback(async (opts = {}) => {
    const reset = opts.reset !== false;
    const generator = generatorRef.current;
    if (!generator || generator.lang !== settingsRef.current.language) return;
    if (capacityRef.current < 1) return;

    const {
      tldChoice: choice,
      customTld: custom,
      minLen: min,
      maxLen: max,
      shortBias: bias,
    } = settingsRef.current;

    const check = validateTld(choice === 'custom' ? custom : choice, validTldsRef.current);
    if (!check.ok) {
      preemptRun();
      setBusy(false);
      log(check.error, 'error');
      return;
    }
    const tld = check.tld;

    if (!reset) {
      if (runningRef.current) return;
      if (foundRef.current.length >= capacityRef.current) return;
    } else {
      preemptRun();
      clearRdapPushback();
      foundRef.current = [];
      checkedHistoryRef.current = new Set();
      nextIdRef.current = 0;
      checkedCountRef.current = 0;
    }

    const {
      minLen: minL,
      maxLen: maxL,
      shortBias: biasN,
    } = clampSettings({ minLen: min, maxLen: max, shortBias: bias });
    const useRdap = tldHasRdap(tld);
    const checkedHistory = checkedHistoryRef.current;

    const abort = new AbortController();
    const runId = ++runIdRef.current;
    abortRef.current = abort;
    runningRef.current = true;
    setBusy(true);
    if (reset) {
      setFound(0);
      setChecked(0);
    }
    setStatus(`Searching .${tld} · ${minL}–${maxL} letters`);

    const priorRate = expectedHitRate(generator, tld, minL, maxL, biasN);
    let totalChecked = checkedCountRef.current;
    let finished = false;
    let wakeHitPump = () => {};
    const fadeMs = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 320;
    const target = () => Math.max(1, capacityRef.current);
    const hitTarget = () => foundRef.current.length >= target();

    if (reset) {
      log(`Looking for .${tld} names (${minL}–${maxL} letters)…`);
      log(`Names this length are usually about ${(priorRate * 100).toFixed(0)}% free.`);
      if (useRdap) {
        log('Names that look free get a second check with the registry.');
      } else {
        log(`For .${tld}, one check is enough to tell if a name is free.`);
      }
    } else {
      log(`Finding more .${tld} names…`);
    }

    const stillThisRun = () => runIdRef.current === runId;

    const emitStats = () => {
      if (!stillThisRun()) return;
      checkedCountRef.current = totalChecked;
      setFound(foundRef.current.length);
      setChecked(totalChecked);
    };

    const hidePlaceholder = () => {
      if (!stillThisRun()) return;
      setResults((prev) => prev.filter((r) => r.status !== 'placeholder'));
    };

    const finishIfFull = () => {
      if (!hitTarget() || finished) return;
      finished = true;
      abort.abort();
      abortInFlightRequests();
      wakeHitPump();
      if (abortRef.current === abort) abortRef.current = null;
      runningRef.current = false;
      setBusy(false);
      hidePlaceholder();
    };

    const makePlaceholder = (phase = 'in') => ({
      id: nextIdRef.current,
      tld,
      word: '',
      domain: '',
      status: 'placeholder',
      phase,
    });

    const dropPlaceholder = (rows) => rows.filter((r) => r.status !== 'placeholder');
    const namedCount = (rows) => dropPlaceholder(rows).length;

    if (reset) {
      setResults([makePlaceholder()]);
    } else {
      setResults((prev) => {
        const available = prev.filter((r) => r.status === 'available');
        if (available.length >= target()) return available;
        if (prev.some((r) => r.status === 'placeholder')) return prev;
        return [...prev, makePlaceholder()];
      });
    }

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
          else if (namedCount(copy) < target()) copy.push(row);
          if (fillingPlaceholder || ph !== -1) nextIdRef.current = Math.max(nextIdRef.current, Number(id) + 1);
          if (!hitTarget() && namedCount(copy) < target()) copy.push(makePlaceholder());
          return copy;
        }
        const copy = prev.slice();
        copy[i] = row;
        if (fillingPlaceholder) {
          nextIdRef.current = Math.max(nextIdRef.current, Number(id) + 1);
          if (!hitTarget() && namedCount(copy) < target()) copy.push(makePlaceholder());
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

    const MAX_PREFETCH = 4;
    const hitQueue = [];
    const replaceWaiters = [];
    const appendWaiters = [];
    let hitsExhausted = false;

    const queueLimit = () => {
      if (hitsExhausted || abort.signal.aborted || hitTarget()) return 0;
      const demand = replaceWaiters.length + appendWaiters.length;
      if (demand === 0) return hitQueue.length;
      return Math.min(DNS_CONCURRENCY, Math.max(demand, MAX_PREFETCH));
    };

    const takeHit = (kind) => {
      if (hitsExhausted || abort.signal.aborted || hitTarget()) return Promise.resolve(null);
      if (hitQueue.length) {
        const word = hitQueue.shift();
        wakeHitPump();
        return Promise.resolve(word);
      }
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
        totalChecked += 1;
        emitStats();
        const task = (async () => {
          try {
            const ok = await dnsLooksUndelegated(`${word}.${tld}`, log, abort.signal);
            if (ok) offerHit(word);
          } catch (e) {
            if (isAbortError(e)) return;
          }
        })().finally(() => inflight.delete(task));
        inflight.add(task);
      };

      try {
        while (!abort.signal.aborted && !hitTarget()) {
          if (hitQueue.length >= queueLimit()) {
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
      const item = {
        id,
        tld,
        word,
        domain: `${word}.${tld}`,
        status: 'available',
        phase: 'shown',
      };
      if (!foundRef.current.some((row) => row.id === id || row.word === word)) {
        foundRef.current = [...foundRef.current, item];
      }
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
          log(`Couldn't confirm ${word}.${tld} with the registry.`, 'error');
          available = false;
        }
        rdapPromise = null;
        if (abort.signal.aborted) return;
        if (available) {
          confirmSlot(id, word);
          return;
        }
        if (hitTarget()) return;

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
      const pumping = pumpDnsHits();
      const workers = [];
      let launchId = nextIdRef.current;
      let pendingWorkers = 0;
      while (!abort.signal.aborted && !hitTarget()) {
        const want = Math.max(0, target() - foundRef.current.length);
        if (pendingWorkers >= want) {
          await sleep(120, abort.signal).catch(() => {});
          continue;
        }
        const word = await takeHit('append');
        if (!word) break;
        const id = launchId;
        launchId += 1;
        nextIdRef.current = Math.max(nextIdRef.current, launchId);
        pendingWorkers += 1;
        workers.push(runSlot(id, word).finally(() => {
          pendingWorkers -= 1;
        }));
      }
      await Promise.all(workers);
      await pumping.catch(() => {});
      if (!stillThisRun()) return;
      setResults((prev) => prev.filter((r) => r.status === 'available'));
      if (finished || hitTarget()) {
        const n = foundRef.current.length;
        log(`Search complete. Checked ${totalChecked} domains and found ${n}.`, 'success');
        setStatus(`Found ${n} · checked ${totalChecked}`);
      } else if (abort.signal.aborted) {
        log('Search stopped.');
        setStatus('Search stopped.');
      } else {
        log('Couldn’t find enough unused names at this length. Try a wider range.', 'error');
        setStatus('Search stopped.');
      }
    } catch (e) {
      if (!stillThisRun()) return;
      setResults((prev) => prev.filter((r) => r.status === 'available'));
      if (finished || hitTarget()) {
        log(
          `Search complete. Checked ${totalChecked} domains and found ${foundRef.current.length}.`,
          'success',
        );
      } else if (isAbortError(e) || abort.signal.aborted) {
        log('Search stopped.');
        setStatus('Search stopped.');
      } else {
        log(describeSearchError(e), 'error');
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

  const layoutReady = capacity >= 1;

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

    if (!layoutReady) return undefined;

    if (tldChoice === 'custom' && customTldChanged) {
      preemptRun();
      setBusy(false);
      const timer = setTimeout(() => runSearch({ reset: true }), CUSTOM_TLD_DEBOUNCE_MS);
      return () => clearTimeout(timer);
    }

    runSearch({ reset: true });
    return undefined;
  }, [ready, layoutReady, tldChoice, customTld, minLen, maxLen, shortBias, language, runSearch, preemptRun]);

  useEffect(() => {
    if (!ready || !layoutReady) return undefined;

    setResults((prev) => {
      const have = new Set(prev.map((row) => row.id));
      const missing = foundRef.current.filter((row) => !have.has(row.id));
      if (!missing.length) return prev;
      const available = prev.filter((row) => row.status === 'available');
      const inflight = prev.filter((row) => row.status !== 'available');
      return available.concat(missing, inflight);
    });

    if (foundRef.current.length >= capacity) {
      if (runningRef.current) {
        abortRef.current?.abort();
        abortInFlightRequests();
      }
      return undefined;
    }
    if (runningRef.current) return undefined;
    runSearch({ reset: false });
    return undefined;
  }, [capacity, ready, layoutReady, runSearch]);

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

  function setLanguage(code) {
    if (!isKnownLanguage(code) || code === language) return;
    setLanguageState(code);
  }

  const validateCustomTld = useCallback((raw) => validateTld(raw, validTldsRef.current), []);

  return {
    ready,
    busy,
    status,
    logs,
    results,
    found,
    checked,
    capacity,
    setCapacity,
    tldChoice,
    setTldChoice,
    customTld,
    setCustomTld,
    language,
    setLanguage,
    minLen,
    setMinLen: commitMinLen,
    maxLen,
    setMaxLen: commitMaxLen,
    shortBias,
    setShortBias: commitShortBias,
    runSearch,
    cancelSearch,
    validateCustomTld,
  };
}
