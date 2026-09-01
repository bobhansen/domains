#!/usr/bin/env python3
"""Estimate P(listed as available) by TLD and invented-word length.

Mirrors domains.html:
  1. Cloudflare DoH NS lookup. Free candidates need NXDOMAIN plus an SOA
     in Authority, and must not have NS/CNAME answers.
  2. If the TLD is in the IANA RDAP bootstrap, confirm with rdap.org 404.
     Otherwise DNS is the last word.

All TLD×length explorations share one job queue and run in parallel,
paced by separate DoH and RDAP limiters so we do not trip Cloudflare or
registry DDOS protection.

Usage:
  python3 measure_hit_rates.py
  python3 measure_hit_rates.py --samples 64 --doh-qps 8 --rdap-qps 3
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import threading
import time
import urllib.error
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

DEFAULT_TLDS = ["com", "org", "net", "me", "io", "co", "ai", "app"]
WORD_LIST_URL = (
    "https://raw.githubusercontent.com/first20hours/google-10000-english/"
    "master/google-10000-english-no-swears.txt"
)
FALLBACK_WORDS = [
    "action", "animal", "beauty", "camera", "danger", "energy", "family",
    "garden", "health", "jungle", "living", "memory", "nature", "orange",
    "picture", "reason", "secret", "travel", "window",
]
DOH_URL = "https://cloudflare-dns.com/dns-query"
RDAP_URL = "https://rdap.org/domain/"
IANA_RDAP = "https://data.iana.org/rdap/dns.json"
DNS_RCODE_NXDOMAIN = 3
DNS_TYPE_SOA = 6
DNS_TYPE_NS = 2
DNS_TYPE_CNAME = 5
NGRAM = 3
UA = "domains-hit-rate/1.0 (polite research probe)"


class PoliteLimiter:
    """Global pacing: max in-flight requests and sustained QPS, with 429 backoff."""

    def __init__(self, qps: float, max_inflight: int):
        self.min_interval = 1.0 / max(qps, 0.1)
        self.sema = threading.Semaphore(max_inflight)
        self.lock = threading.Lock()
        self.next_ok = 0.0
        self.cooldown = 0.0

    def acquire(self) -> None:
        self.sema.acquire()
        while True:
            with self.lock:
                now = time.monotonic()
                wait = max(self.next_ok, self.cooldown) - now
                if wait <= 0:
                    self.next_ok = now + self.min_interval
                    return
            time.sleep(min(wait, 0.25))

    def release(self) -> None:
        self.sema.release()

    def punish(self, seconds: float) -> None:
        with self.lock:
            wait = max(0.0, min(float(seconds), 120.0))
            self.cooldown = max(self.cooldown, time.monotonic() + wait)
            self.min_interval = min(max(self.min_interval, wait / 3.0), 2.5)


class MarkovGenerator:
    def __init__(self, ngram: int = NGRAM):
        self.ngram = ngram
        self.transitions: dict[str, list[str | None]] = {}
        self.starts: list[str] = []
        self.known_words: set[str] = set()

    def train(self, words: list[str]) -> None:
        self.known_words = set(words)
        for word in words:
            if len(word) <= self.ngram:
                continue
            self.starts.append(word[: self.ngram])
            for i in range(len(word) - self.ngram):
                state = word[i : i + self.ngram]
                self.transitions.setdefault(state, []).append(word[i + self.ngram])
            end_state = word[-self.ngram :]
            self.transitions.setdefault(end_state, []).append(None)

    def generate(self, min_len: int, max_len: int, short_bias: float = 1.0) -> str | None:
        if not self.starts:
            return None
        for _ in range(200):
            word = random.choice(self.starts)
            while len(word) < 50:
                state = word[-self.ngram :]
                choices = self.transitions.get(state)
                if not choices:
                    break
                if short_bias != 1.0 and None in choices:
                    counts: dict[str | None, int] = {}
                    for c in choices:
                        counts[c] = counts.get(c, 0) + 1
                    population = list(counts)
                    weights = [
                        counts[c] * short_bias if c is None else counts[c]
                        for c in population
                    ]
                    total = sum(weights)
                    r = random.random() * total
                    next_char: str | None = population[-1]
                    for c, w in zip(population, weights):
                        r -= w
                        if r <= 0:
                            next_char = c
                            break
                else:
                    next_char = random.choice(choices)
                if next_char is None:
                    break
                word += next_char
            if min_len <= len(word) <= max_len and word not in self.known_words:
                return word
        return None

    def generate_exact(self, length: int) -> str | None:
        word = self.generate(length, length, short_bias=1.0)
        if word:
            return word
        if not self.starts:
            return None
        for _ in range(400):
            word = random.choice(self.starts)
            while len(word) < length:
                state = word[-self.ngram :]
                choices = [c for c in self.transitions.get(state, []) if c is not None]
                if not choices:
                    break
                word += random.choice(choices)
            if len(word) == length and word.isalpha() and word not in self.known_words:
                return word
        return None


def load_words(cache_path: str) -> list[str]:
    if os.path.exists(cache_path):
        with open(cache_path, encoding="utf-8") as f:
            words = [w.strip().lower() for w in f if w.strip()]
        if words:
            return [w for w in words if w.isalpha()]
    req = urllib.request.Request(WORD_LIST_URL, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            text = resp.read().decode("utf-8")
        os.makedirs(os.path.dirname(cache_path) or ".", exist_ok=True)
        with open(cache_path, "w", encoding="utf-8") as f:
            f.write(text)
        return [w.strip().lower() for w in text.splitlines() if w.strip().isalpha()]
    except urllib.error.URLError:
        print("Word list download failed; using fallback words.", file=sys.stderr)
        return list(FALLBACK_WORDS)


def load_rdap_tlds() -> set[str]:
    req = urllib.request.Request(IANA_RDAP, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    out: set[str] = set()
    for svc in data.get("services") or []:
        for name in svc[0]:
            out.add(str(name).lower())
    return out


def tld_has_rdap(tld: str, rdap_tlds: set[str]) -> bool:
    labels = [p for p in tld.lower().split(".") if p]
    for i in range(len(labels)):
        if ".".join(labels[i:]) in rdap_tlds:
            return True
    return False


def dns_looks_undelegated(data: dict) -> bool:
    answers = data.get("Answer") or []
    if any(rr.get("type") in (DNS_TYPE_NS, DNS_TYPE_CNAME) for rr in answers):
        return False
    if data.get("Status") != DNS_RCODE_NXDOMAIN:
        return False
    authority = data.get("Authority") or []
    return any(rr.get("type") == DNS_TYPE_SOA for rr in authority)


def retry_after_seconds(headers, fallback: float) -> float:
    if not headers:
        return fallback
    raw = headers.get("Retry-After")
    if not raw:
        reset = headers.get("RateLimit-Reset") or headers.get("X-RateLimit-Reset")
        if reset and str(reset).strip().replace(".", "", 1).isdigit():
            n = float(reset)
            if n > 1e10:
                return min(120.0, max(fallback, (n - time.time() * 1000) / 1000.0))
            if n > 1e9:
                return min(120.0, max(fallback, n - time.time()))
            return min(120.0, max(fallback, n))
        return fallback
    raw = str(raw).strip()
    if raw.replace(".", "", 1).isdigit():
        return min(120.0, float(raw))
    try:
        dt = parsedate_to_datetime(raw)
        return min(120.0, max(0.0, dt.timestamp() - time.time()))
    except Exception:
        return fallback


def http_json(url: str, headers: dict, limiter: PoliteLimiter, timeout: float = 15.0):
    last_err = None
    for attempt in range(6):
        limiter.acquire()
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                if resp.status == 429:
                    wait = retry_after_seconds(resp.headers, 2.0 * (attempt + 1))
                    limiter.punish(wait)
                    last_err = "429"
                    continue
                body = resp.read().decode("utf-8")
                return resp.status, json.loads(body) if body else {}
        except urllib.error.HTTPError as e:
            last_err = str(e.code)
            raw = e.read()
            if e.code in (429, 502, 503, 504):
                wait = retry_after_seconds(e.headers, 2.0 * (attempt + 1))
                print(f"  HTTP {e.code} {url.split('/')[2]} Retry-After wait {wait:.1f}s", file=sys.stderr)
                limiter.punish(wait)
                continue
            payload = {}
            try:
                payload = json.loads(raw.decode("utf-8")) if raw else {}
            except Exception:
                pass
            return e.code, payload
        except Exception as e:
            last_err = type(e).__name__
            time.sleep(0.4 * (attempt + 1))
        finally:
            limiter.release()
    print(f"  giving up on {url}: {last_err}", file=sys.stderr)
    return None, None


def check_available(name: str, tld: str, doh: PoliteLimiter, rdap: PoliteLimiter, use_rdap: bool) -> bool | None:
    """True=would be listed, False=not listed, None=error (excluded)."""
    status, payload = http_json(
        f"{DOH_URL}?name={urllib.request.quote(name)}&type=NS",
        {"Accept": "application/dns-json", "User-Agent": UA},
        doh,
        timeout=12.0,
    )
    if status is None:
        return None
    if status != 200 or not isinstance(payload, dict):
        return False
    if not dns_looks_undelegated(payload):
        return False
    if not use_rdap:
        return True
    rstatus, _ = http_json(
        f"{RDAP_URL}{urllib.request.quote(name)}",
        {"Accept": "application/rdap+json", "User-Agent": UA},
        rdap,
        timeout=20.0,
    )
    if rstatus is None:
        return None
    if rstatus == 404:
        return True
    return False


def wilson_low(hits: int, n: int, z: float = 1.96) -> float:
    if n <= 0:
        return 0.0
    phat = hits / n
    denom = 1 + z * z / n
    centre = phat + z * z / (2 * n)
    spread = z * ((phat * (1 - phat) / n + z * z / (4 * n * n)) ** 0.5)
    return max(0.0, (centre - spread) / denom)


def format_js(rates: dict[str, dict[int, float]], meta: dict) -> str:
    tld_lines = []
    for tld in meta["tlds"]:
        cells = rates.get(tld, {})
        parts = [f"{length}: {cells[length]:.4f}" for length in meta["lengths"] if length in cells]
        tld_lines.append(f"        {tld}: {{{', '.join(parts)}}}")
    body = ",\n".join(tld_lines)
    rdap = ",".join(meta["rdap_tlds"])
    return f"""    // Mean P(listed as available) for Markov-generated labels.
    // DNS NXDOMAIN+SOA, then RDAP 404 when the TLD is in IANA's bootstrap.
    // Built by measure_hit_rates.py at {meta['generated_at']}.
    // samples≈{meta['samples']} per cell, lengths {meta['lengths'][0]}–{meta['lengths'][-1]}.
    // RDAP TLDs in this run: {rdap}
    const HIT_RATES = {{
{body}
    }};
"""


def load_checkpoint(path: str) -> dict:
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_checkpoint(path: str, data: dict) -> None:
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, sort_keys=True)
    os.replace(tmp, path)


def ensure_cell(checkpoint: dict, tld: str, length: int) -> dict:
    tld_map = checkpoint.setdefault(tld, {})
    key = str(length)
    cell = tld_map.get(key)
    if not isinstance(cell, dict):
        cell = {"hits": 0, "n": 0, "errors": 0, "seen": []}
        tld_map[key] = cell
    cell.setdefault("hits", 0)
    cell.setdefault("n", 0)
    cell.setdefault("errors", 0)
    cell.setdefault("seen", [])
    return cell


def print_progress(checkpoint: dict, tlds: list[str], lengths: list[int], samples: int) -> None:
    done = 0
    total = len(tlds) * len(lengths) * samples
    hits = 0
    for tld in tlds:
        for length in lengths:
            cell = checkpoint.get(tld, {}).get(str(length), {})
            done += int(cell.get("n", 0))
            hits += int(cell.get("hits", 0))
    rate = f"{hits / done:.3f}" if done else "—"
    print(f"  progress {done}/{total} verdicts  overall_hit={rate}", flush=True)


def build_jobs(
    generator: MarkovGenerator,
    checkpoint: dict,
    tlds: list[str],
    lengths: list[int],
    samples: int,
) -> list[tuple[int, str, str]]:
    jobs: list[tuple[int, str, str]] = []
    for length in lengths:
        used: set[str] = set()
        needed = 0
        for tld in tlds:
            cell = ensure_cell(checkpoint, tld, length)
            used.update(cell["seen"])
            needed = max(needed, max(0, samples - cell["n"]))
        words: list[str] = []
        attempts = 0
        while len(words) < needed and attempts < needed * 80:
            attempts += 1
            w = generator.generate_exact(length)
            if w and w not in used:
                used.add(w)
                words.append(w)
        if len(words) < needed:
            print(f"  length {length}: only generated {len(words)}/{needed} unique labels", file=sys.stderr)
        buckets: dict[str, list[str]] = defaultdict(list)
        for tld in tlds:
            take = max(0, samples - ensure_cell(checkpoint, tld, length)["n"])
            seen = set(ensure_cell(checkpoint, tld, length)["seen"])
            for word in words[:take]:
                if word not in seen:
                    buckets[tld].append(word)
        while any(buckets.values()):
            for tld in tlds:
                if buckets[tld]:
                    jobs.append((length, buckets[tld].pop(0), tld))
    return jobs


def rates_from_checkpoint(checkpoint: dict, tlds: list[str], lengths: list[int]) -> dict[str, dict[int, float]]:
    out: dict[str, dict[int, float]] = {}
    for tld in tlds:
        out[tld] = {}
        for length in lengths:
            cell = checkpoint.get(tld, {}).get(str(length), {})
            n = int(cell.get("n", 0))
            hits = int(cell.get("hits", 0))
            if n > 0:
                out[tld][length] = hits / n
    return out


def print_table(checkpoint: dict, tlds: list[str], lengths: list[int]) -> None:
    header = f"{'len':>4} " + " ".join(f"{t:>7}" for t in tlds)
    print(header)
    print("-" * len(header))
    for length in lengths:
        cells = []
        for tld in tlds:
            cell = checkpoint.get(tld, {}).get(str(length), {})
            n = int(cell.get("n", 0))
            hits = int(cell.get("hits", 0))
            cells.append(f"{hits / n:7.3f}" if n else f"{'—':>7}")
        print(f"{length:>4} " + " ".join(cells))
    print()
    print("Wilson 95% lower bound (scarcest cells):")
    scarce = []
    for tld in tlds:
        for length in lengths:
            cell = checkpoint.get(tld, {}).get(str(length), {})
            n = int(cell.get("n", 0))
            hits = int(cell.get("hits", 0))
            if n:
                scarce.append((wilson_low(hits, n), tld, length, hits, n))
    scarce.sort()
    for lo, tld, length, hits, n in scarce[:8]:
        print(f"  .{tld} len={length}: {hits}/{n}  mean={hits / n:.3f}  wilson_lo={lo:.3f}")


def main() -> int:
    here = os.path.dirname(os.path.abspath(__file__))
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tlds", nargs="+", default=DEFAULT_TLDS)
    parser.add_argument("--min-len", type=int, default=3)
    parser.add_argument("--max-len", type=int, default=16)
    parser.add_argument("--samples", type=int, default=64, help="Verdicts per TLD×length cell")
    parser.add_argument("--doh-qps", type=float, default=8.0)
    parser.add_argument("--doh-workers", type=int, default=6)
    parser.add_argument("--rdap-qps", type=float, default=3.0)
    parser.add_argument("--rdap-workers", type=int, default=4)
    parser.add_argument("--workers", type=int, default=8, help="Parallel exploration threads")
    parser.add_argument("--checkpoint", default=os.path.join(here, "hit_rates_checkpoint.json"))
    parser.add_argument("--snippet", default=os.path.join(here, "hit_rates.snippet.js"))
    parser.add_argument("--word-cache", default=os.path.join(here, ".wordlist-10k.txt"))
    parser.add_argument("--seed", type=int, default=20260901)
    args = parser.parse_args()

    random.seed(args.seed)
    lengths = list(range(args.min_len, args.max_len + 1))
    tlds = [t.lower().lstrip(".") for t in args.tlds]

    print("Training Markov model…", flush=True)
    gen = MarkovGenerator()
    gen.train(load_words(args.word_cache))
    print(f"  {len(gen.known_words)} words, {len(gen.starts)} starts", flush=True)

    print("Loading IANA RDAP bootstrap…", flush=True)
    rdap_all = load_rdap_tlds()
    rdap_used = [t for t in tlds if tld_has_rdap(t, rdap_all)]
    print(f"  RDAP confirm for: {', '.join(rdap_used) or '(none)'}", flush=True)
    print(f"  DNS-only for: {', '.join(t for t in tlds if t not in rdap_used) or '(none)'}", flush=True)

    doh = PoliteLimiter(qps=args.doh_qps, max_inflight=args.doh_workers)
    rdap = PoliteLimiter(qps=args.rdap_qps, max_inflight=args.rdap_workers)
    checkpoint = load_checkpoint(args.checkpoint)
    lock = threading.Lock()

    jobs = build_jobs(gen, checkpoint, tlds, lengths, args.samples)
    print(
        f"Probing {len(jobs)} remaining (TLD,length,word) cells in parallel "
        f"({args.workers} threads; DoH ≤{args.doh_workers}@{args.doh_qps:g}/s; "
        f"RDAP ≤{args.rdap_workers}@{args.rdap_qps:g}/s)",
        flush=True,
    )

    def one(job: tuple[int, str, str]) -> tuple[int, str, str, bool | None]:
        length, word, tld = job
        use_rdap = tld_has_rdap(tld, rdap_all)
        verdict = check_available(f"{word}.{tld}", tld, doh, rdap, use_rdap)
        return length, word, tld, verdict

    completed = 0
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(one, job) for job in jobs]
        for fut in as_completed(futures):
            length, word, tld, verdict = fut.result()
            with lock:
                cell = ensure_cell(checkpoint, tld, length)
                if word not in cell["seen"]:
                    cell["seen"].append(word)
                if verdict is None:
                    cell["errors"] += 1
                else:
                    cell["n"] += 1
                    if verdict:
                        cell["hits"] += 1
                completed += 1
                if completed % 25 == 0:
                    save_checkpoint(args.checkpoint, checkpoint)
                    print_progress(checkpoint, tlds, lengths, args.samples)
    save_checkpoint(args.checkpoint, checkpoint)

    rates = rates_from_checkpoint(checkpoint, tlds, lengths)
    meta = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "samples": args.samples,
        "tlds": tlds,
        "lengths": lengths,
        "rdap_tlds": rdap_used,
    }
    snippet = format_js(rates, meta)
    with open(args.snippet, "w", encoding="utf-8") as f:
        f.write(snippet)

    print("\nHit-rate matrix (mean P(listed as available)):\n")
    print_table(checkpoint, tlds, lengths)
    print("Copy-pastable JS:\n")
    print(snippet)
    print(f"Wrote {args.snippet}", flush=True)
    print("DONE", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
