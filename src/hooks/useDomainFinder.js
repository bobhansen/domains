import { useCallback, useEffect, useRef, useState } from 'react';
import { MarkovGenerator } from '../lib/markov.js';
import { loadValidTlds } from '../lib/tlds.js';
import { calculateRequiredBatchSize, expectedHitRate } from '../lib/hitRates.js';
import {
  DNS_CONCURRENCY,
  RDAP_CONCURRENCY,
  initRdapBootstrap,
  scanNames,
  tldHasRdap,
} from '../lib/availability.js';

const LOG_CAP = 220;
let autoStarted = false;

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
  const [targetCount, setTargetCount] = useState(20);
  const [minLen, setMinLen] = useState(4);
  const [maxLen, setMaxLen] = useState(8);
  const [shortBias, setShortBias] = useState(10);

  const generatorRef = useRef(null);
  const validTldsRef = useRef(new Set());
  const runningRef = useRef(false);
  const logIdRef = useRef(0);
  const logFnRef = useRef(() => {});
  const settingsRef = useRef({});

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

  const upsertChit = useCallback((word, tld, statusName) => {
    const domain = `${word}.${tld}`;
    setResults((prev) => {
      const i = prev.findIndex((r) => r.domain === domain);
      const next = { domain, word, tld, status: statusName };
      if (i === -1) return [...prev, next];
      const copy = prev.slice();
      copy[i] = next;
      return copy;
    });
  }, []);

  const runSearch = useCallback(async () => {
    if (runningRef.current || !generatorRef.current) return;

    const {
      tldChoice: choice,
      customTld: custom,
      targetCount: target,
      minLen: min,
      maxLen: max,
      shortBias: bias,
    } = settingsRef.current;

    let tld = (choice === 'custom' ? custom : choice).trim().toLowerCase().replace(/^\./, '');
    if (!tld) {
      log('Please enter a custom TLD.', 'error');
      return;
    }
    if (validTldsRef.current.size > 0 && !validTldsRef.current.has(tld)) {
      log(`Warning: ".${tld}" does not appear to be a valid IANA TLD.`, 'error');
      return;
    }

    const targetN = Number.parseInt(target, 10) || 20;
    const minL = Number.parseInt(min, 10) || 4;
    const maxL = Number.parseInt(max, 10) || 8;
    const biasN = Number.parseFloat(bias) || 1.0;
    const generator = generatorRef.current;
    const useRdap = tldHasRdap(tld);

    runningRef.current = true;
    setBusy(true);
    setResults([]);
    setFound(0);
    setChecked(0);
    setStatus(`Searching .${tld} · ${minL}–${maxL} letters`);

    const priorRate = expectedHitRate(generator, tld, minL, maxL, biasN);
    const allAvailable = [];
    const checkedHistory = new Set();
    let currentRate = priorRate;
    let totalChecked = 0;
    let round = 1;

    log(`Starting search for ${targetN} .${tld} domains...`);
    log(`Expected hit rate ${(priorRate * 100).toFixed(1)}% from length mix ${minL}–${maxL}.`);
    if (useRdap) {
      log('Using registry RDAP to confirm names that DNS says are undelegated.');
    } else {
      log(`No RDAP for .${tld}; treating authoritative DNS NXDOMAIN as available.`);
    }

    const emitStats = (foundCount, checkedCount) => {
      setFound(foundCount);
      setChecked(checkedCount);
    };

    try {
      while (allAvailable.length < targetN) {
        let remaining = targetN - allAvailable.length;
        let queriesNeeded = calculateRequiredBatchSize(remaining, currentRate, 0.95);
        if (queriesNeeded < 5) queriesNeeded = 5;

        log(`--- Round ${round} ---`);
        log(`Calculated ${queriesNeeded} queries needed (Rate est: ${(currentRate * 100).toFixed(1)}%)`);
        setStatus(`Searching .${tld} · round ${round}`);

        const candidates = [];
        let attempts = 0;
        while (candidates.length < queriesNeeded && attempts < queriesNeeded * 20) {
          const w = generator.generate(minL, maxL, biasN);
          if (w && !checkedHistory.has(w) && !candidates.includes(w)) {
            candidates.push(w);
          }
          attempts++;
        }

        if (candidates.length === 0) {
          log('Could not generate enough unique candidates matching constraints.', 'error');
          break;
        }

        candidates.forEach((c) => checkedHistory.add(c));
        log(
          useRdap
            ? `Checking ${candidates.length} names: DNS×${DNS_CONCURRENCY} pipelined into RDAP×${RDAP_CONCURRENCY}...`
            : `Checking ${candidates.length} names against Cloudflare DoH...`,
        );

        const roundAvailable = [];
        await scanNames(candidates, tld, {
          log: (msg, type) => log(msg, type),
          onDnsHit(word) {
            upsertChit(word, tld, useRdap ? 'pending' : 'available');
            if (!useRdap) {
              roundAvailable.push(`${word}.${tld}`);
              allAvailable.push(`${word}.${tld}`);
            }
            emitStats(allAvailable.length, totalChecked + candidates.length);
          },
          onRdap(word, ok) {
            upsertChit(word, tld, ok ? 'available' : 'taken');
            if (ok) {
              roundAvailable.push(`${word}.${tld}`);
              allAvailable.push(`${word}.${tld}`);
            }
            emitStats(allAvailable.length, totalChecked + candidates.length);
          },
        });

        totalChecked += candidates.length;
        emitStats(allAvailable.length, totalChecked);

        if (roundAvailable.length > 0) {
          log(`Found ${roundAvailable.length} this round!`, 'success');
        } else {
          log('None found this round.');
        }

        if (totalChecked > 0) {
          currentRate = Math.max(0.01, allAvailable.length / totalChecked);
        }
        round++;
      }

      setStatus(`Done · ${allAvailable.length} of ${targetN} · ${totalChecked} checked`);
      log(`Done! Checked ${totalChecked} domains. Found ${allAvailable.length}.`, 'success');
    } catch (e) {
      log(`Error during search: ${e.message}`, 'error');
      setStatus('Search stopped on an error.');
    } finally {
      runningRef.current = false;
      setBusy(false);
    }
  }, [log, upsertChit]);

  useEffect(() => {
    if (!ready || autoStarted) return;
    autoStarted = true;
    runSearch();
  }, [ready, runSearch]);

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
    setTargetCount,
    minLen,
    setMinLen,
    maxLen,
    setMaxLen,
    shortBias,
    setShortBias,
    runSearch,
  };
}
