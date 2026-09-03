import { useCallback, useEffect, useRef, useState } from 'react';
import { MarkovGenerator } from '../lib/markov.js';
import { loadValidTlds } from '../lib/tlds.js';
import { expectedHitRate } from '../lib/hitRates.js';
import { LIMITS, clampInt, clampSettings, lengthPresetFor, snapShortBias } from '../lib/limits.js';
import { TLD_CHIPS, resolvedTld, validateTld } from '../lib/tld.js';
import { canonicalizeLanguage, languageByCode } from '../lib/languages.js';
import { readInitialSettings, storeSettings, writeSettingsParam, writeTldParam } from '../lib/settings.js';
import {
  DNS_CONCURRENCY,
  dropQueuedDns,
  dropQueuedRdap,
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

function isFilledStatus(status) {
  return status === 'pending' || status === 'available';
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

  const [initial] = useState(readInitialSettings);
  const [language, setLanguageState] = useState(initial.language);
  const [modelLang, setModelLang] = useState(null);
  const [bootReady, setBootReady] = useState(false);
  const [tldChoice, setTldChoiceState] = useState(initial.tldChoice);
  const [customTld, setCustomTldState] = useState(initial.customTld);
  const [minLen, setMinLen] = useState(initial.minLen);
  const [maxLen, setMaxLen] = useState(initial.maxLen);
  const [shortBias, setShortBias] = useState(initial.shortBias);

  const generatorRef = useRef(null);
  const validTldsRef = useRef(new Set());
  const fillingRef = useRef(false);
  const runningRef = useRef(false);
  const abortRef = useRef(null);
  const runIdRef = useRef(0);
  const logIdRef = useRef(0);
  const logFnRef = useRef(() => {});
  const settingsRef = useRef({});
  const customTldRef = useRef(customTld);
  const capacityRef = useRef(0);
  const boardRef = useRef([]);
  const checkedHistoryRef = useRef(new Set());
  const nextIdRef = useRef(0);
  const checkedCountRef = useRef(0);
  const slotTokenRef = useRef(new Map());

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

  const abortDnsFill = useCallback(() => {
    abortRef.current?.abort();
    dropQueuedDns();
    fillingRef.current = false;
    setBusy(false);
  }, []);

  const beginNewSearch = useCallback(() => {
    runIdRef.current += 1;
    abortDnsFill();
    dropQueuedRdap();
    runningRef.current = false;
    abortRef.current = null;
  }, [abortDnsFill]);

  useEffect(() => {
    if (!bootReady || !generatorRef.current) return undefined;
    let cancelled = false;
    const spec = languageByCode(language);
    setModelLang(null);
    setStatus(`Loading ${spec.name}…`);
    beginNewSearch();

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
  }, [bootReady, language, beginNewSearch]);

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
      beginNewSearch();
      log(check.error, 'error');
      return;
    }
    const tld = check.tld;

    if (!reset) {
      if (runningRef.current) return;
      if (boardRef.current.length >= capacityRef.current) return;
    } else {
      beginNewSearch();
      boardRef.current = [];
      checkedHistoryRef.current = new Set();
      nextIdRef.current = 0;
      checkedCountRef.current = 0;
      slotTokenRef.current = new Map();
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
    fillingRef.current = true;
    setBusy(true);
    if (reset) {
      setFound(0);
      setChecked(0);
    }
    setStatus(`Searching .${tld} · ${minL}–${maxL} letters`);

    const priorRate = expectedHitRate(generator, tld, minL, maxL, biasN);
    let totalChecked = checkedCountRef.current;
    let searchSettled = false;
    let wakeHitPump = () => {};
    const fadeMs = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 320;
    const target = () => Math.max(1, capacityRef.current);
    const boardCount = () => boardRef.current.length;
    const boardFull = () => boardCount() >= target();

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
      setFound(boardCount());
      setChecked(totalChecked);
    };

    const hidePlaceholder = () => {
      if (!stillThisRun()) return;
      setResults((prev) => prev.filter((r) => r.status !== 'placeholder'));
    };

    const markSearchSettled = () => {
      if (searchSettled || !stillThisRun()) return;
      searchSettled = true;
      fillingRef.current = false;
      setBusy(false);
      hidePlaceholder();
      const n = boardCount();
      log(`Search complete. Checked ${totalChecked} domains and found ${n}.`, 'success');
      setStatus(`Found ${n} · checked ${totalChecked}`);
    };

    const resumeFilling = () => {
      if (!stillThisRun() || abort.signal.aborted) return;
      if (fillingRef.current) return;
      fillingRef.current = true;
      searchSettled = false;
      setBusy(true);
      setStatus(`Searching .${tld} · ${minL}–${maxL} letters`);
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
        const keep = prev.filter((r) => isFilledStatus(r.status));
        if (keep.length >= target()) return keep;
        if (prev.some((r) => r.status === 'placeholder')) return prev;
        return [...keep, makePlaceholder()];
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
        const copy = prev.slice();
        if (i === -1) {
          const ph = copy.findIndex((r) => r.status === 'placeholder');
          if (ph !== -1) copy[ph] = row;
          else if (namedCount(copy) < target()) copy.push(row);
          if (fillingPlaceholder || ph !== -1) nextIdRef.current = Math.max(nextIdRef.current, Number(id) + 1);
        } else {
          copy[i] = row;
          if (fillingPlaceholder) {
            nextIdRef.current = Math.max(nextIdRef.current, Number(id) + 1);
          }
        }
        if (
          fillingRef.current
          && !abort.signal.aborted
          && !boardFull()
          && namedCount(copy) < target()
          && !copy.some((r) => r.status === 'placeholder')
        ) {
          copy.push(makePlaceholder());
        }
        return copy;
      });
    };

    const putOnBoard = (id, word, status) => {
      const item = { id, tld, word, domain: `${word}.${tld}`, status };
      const i = boardRef.current.findIndex((row) => row.id === id);
      if (i === -1) boardRef.current = [...boardRef.current, item];
      else {
        const copy = boardRef.current.slice();
        copy[i] = item;
        boardRef.current = copy;
      }
      emitStats();
      if (boardFull()) markSearchSettled();
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
      if (hitsExhausted || abort.signal.aborted) return 0;
      const demand = replaceWaiters.length + appendWaiters.length;
      if (demand === 0) return boardFull() ? hitQueue.length : MAX_PREFETCH;
      return Math.min(DNS_CONCURRENCY, Math.max(demand, MAX_PREFETCH));
    };

    const takeHit = (kind) => {
      if (hitsExhausted || abort.signal.aborted) return Promise.resolve(null);
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
      if (abort.signal.aborted) return;
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
        while (!abort.signal.aborted) {
          const demand = replaceWaiters.length + appendWaiters.length;
          const needMore = boardCount() < target();
          if (demand === 0 && !needMore) {
            await Promise.race([
              new Promise((resolve) => {
                wakeHitPump = resolve;
              }),
              sleep(250, abort.signal).catch(() => {}),
            ]);
            continue;
          }
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
            if (inflight.size > 0) {
              await Promise.race(inflight);
              continue;
            }
            if (needMore || demand > 0) break;
            await sleep(250, abort.signal).catch(() => {});
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

    const occupySlot = (id, word, phase = 'populate') => {
      const token = (slotTokenRef.current.get(id) || 0) + 1;
      slotTokenRef.current.set(id, token);
      const status = useRdap ? 'pending' : 'available';
      setSlot(id, { word, status, phase });
      putOnBoard(id, word, status);
      return token;
    };

    const tokenMatches = (id, token) => stillThisRun() && slotTokenRef.current.get(id) === token;

    const confirmAvailable = (id, word) => {
      if (!stillThisRun()) return;
      setSlot(id, { word, status: 'available', phase: 'shown' });
      putOnBoard(id, word, 'available');
      wakeHitPump();
    };

    const verifySlot = async (id, word, token) => {
      if (!useRdap) {
        confirmAvailable(id, word);
        return;
      }

      let currentWord = word;
      let currentToken = token;

      while (tokenMatches(id, currentToken)) {
        let available = false;
        try {
          available = await rdapIsUnregistered(`${currentWord}.${tld}`, tld, log);
        } catch (e) {
          if (isAbortError(e)) return;
          if (!tokenMatches(id, currentToken)) return;
          log(`Couldn't confirm ${currentWord}.${tld} with the registry.`, 'error');
          available = false;
        }
        if (!tokenMatches(id, currentToken)) return;
        if (available) {
          confirmAvailable(id, currentWord);
          return;
        }

        setSlot(id, { word: currentWord, status: 'taken', phase: 'shown' });
        if (abort.signal.aborted) {
          boardRef.current = boardRef.current.filter((row) => row.id !== id);
          emitStats();
          return;
        }

        const nextWord = await takeHit('replace');
        if (!nextWord || !tokenMatches(id, currentToken)) return;
        if (abort.signal.aborted) return;

        setSlot(id, { word: currentWord, status: 'taken', phase: 'out' });
        await sleep(fadeMs).catch(() => {});
        if (!tokenMatches(id, currentToken) || abort.signal.aborted) return;

        currentWord = nextWord;
        currentToken = occupySlot(id, currentWord, 'in');
      }
    };

    const runSlot = async (id, firstWord) => {
      const token = occupySlot(id, firstWord);
      await verifySlot(id, firstWord, token);
    };

    try {
      const pumping = pumpDnsHits();
      const workers = [];
      let launchId = nextIdRef.current;
      let liveSlots = reset ? 0 : boardCount();

      while (!abort.signal.aborted && stillThisRun()) {
        const want = Math.max(0, target() - liveSlots);
        if (want <= 0) {
          if (boardFull()) markSearchSettled();
          else resumeFilling();
          await sleep(120, abort.signal).catch(() => {});
          continue;
        }
        if (!fillingRef.current) resumeFilling();
        const word = await takeHit('append');
        if (!word) break;
        const id = launchId;
        launchId += 1;
        nextIdRef.current = Math.max(nextIdRef.current, launchId);
        liveSlots += 1;
        workers.push(runSlot(id, word));
      }

      if (stillThisRun()) {
        if (searchSettled) {
          /* already logged when the board filled */
        } else if (abort.signal.aborted) {
          hidePlaceholder();
        } else if (!boardFull()) {
          hidePlaceholder();
          log('Couldn’t find enough unused names at this length. Try a wider range.', 'error');
          setStatus('Search stopped.');
          fillingRef.current = false;
          setBusy(false);
        }
      }

      await Promise.all(workers);
      await pumping.catch(() => {});
    } catch (e) {
      if (!stillThisRun()) return;
      hidePlaceholder();
      if (searchSettled) {
        /* already logged when the board filled */
      } else if (isAbortError(e) || abort.signal.aborted) {
        hidePlaceholder();
      } else {
        log(describeSearchError(e), 'error');
        setStatus('Search stopped on an error.');
        fillingRef.current = false;
        setBusy(false);
      }
    } finally {
      if (!stillThisRun()) return;
      if (abortRef.current === abort) abortRef.current = null;
      runningRef.current = false;
      fillingRef.current = false;
      setBusy(false);
      hidePlaceholder();
    }
  }, [log, beginNewSearch]);

  const cancelSearch = useCallback(() => {
    if (!fillingRef.current) return;
    abortDnsFill();
    setResults((prev) => prev.filter((r) => r.status !== 'placeholder'));
    log('Search stopped.');
    setStatus('Search stopped.');
  }, [abortDnsFill, log]);

  const layoutReady = capacity >= 1;

  useEffect(() => {
    if (!ready) return undefined;

    const tld = resolvedTld(tldChoice, customTld);
    const customTldChanged = customTldRef.current !== customTld;
    customTldRef.current = customTld;

    if (!tld) {
      beginNewSearch();
      return undefined;
    }

    if (!layoutReady) return undefined;

    if (tldChoice === 'custom' && customTldChanged) {
      beginNewSearch();
      const timer = setTimeout(() => runSearch({ reset: true }), CUSTOM_TLD_DEBOUNCE_MS);
      return () => clearTimeout(timer);
    }

    runSearch({ reset: true });
    return undefined;
  }, [ready, layoutReady, tldChoice, customTld, minLen, maxLen, shortBias, language, runSearch, beginNewSearch]);

  useEffect(() => {
    if (!ready || !layoutReady) return undefined;

    setResults((prev) => {
      const have = new Set(prev.map((row) => row.id));
      const missing = boardRef.current.filter((row) => !have.has(row.id));
      if (!missing.length) return prev;
      const filled = prev.filter((row) => isFilledStatus(row.status));
      const rest = prev.filter((row) => !isFilledStatus(row.status));
      return filled.concat(missing, rest);
    });

    if (boardRef.current.length >= capacity) return undefined;
    if (runningRef.current) return undefined;
    runSearch({ reset: false });
    return undefined;
  }, [capacity, ready, layoutReady, runSearch]);

  function commitMinLen(raw) {
    const minL = clampInt(raw, LIMITS.length.min, LIMITS.length.max, LIMITS.length.minFallback);
    if (minL !== minLen) writeSettingsParam('min', minL);
    setMinLen(minL);
    setMaxLen((maxL) => Math.max(minL, clampInt(maxL, LIMITS.length.min, LIMITS.length.max, LIMITS.length.maxFallback)));
  }

  function commitMaxLen(raw) {
    const maxL = clampInt(raw, LIMITS.length.min, LIMITS.length.max, LIMITS.length.maxFallback);
    if (maxL !== maxLen) writeSettingsParam('max', maxL);
    setMaxLen(maxL);
    setMinLen((minL) => Math.min(maxL, clampInt(minL, LIMITS.length.min, LIMITS.length.max, LIMITS.length.minFallback)));
  }

  function commitShortBias(raw) {
    const bias = snapShortBias(raw);
    if (bias !== shortBias) writeSettingsParam('mix', lengthPresetFor(bias).id);
    setShortBias(bias);
  }

  function setLanguage(code) {
    const resolved = canonicalizeLanguage(code);
    if (!resolved || resolved === language) return;
    writeSettingsParam('lang', resolved);
    setLanguageState(resolved);
  }

  function setTldChoice(choice) {
    if (!TLD_CHIPS.includes(choice) || choice === tldChoice) return;
    writeTldParam(choice, customTld);
    setTldChoiceState(choice);
  }

  function setCustomTld(value) {
    writeTldParam('custom', value);
    setCustomTldState(value);
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
