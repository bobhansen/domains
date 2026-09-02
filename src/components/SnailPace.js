import { useEffect, useRef, useState } from 'react';
import { html } from '../html.js';
import { subscribeRdapPushback } from '../lib/availability.js';

export default function SnailPace({ compact }) {
  const wrapRef = useRef(null);
  const [active, setActive] = useState(false);
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);

  useEffect(() => subscribeRdapPushback(({ active: next, until: nextUntil }) => {
    setActive(next);
    setUntil(nextUntil);
    if (!next) setPinned(false);
  }), []);

  const secs = Math.ceil((until - now) / 1000);
  const counting = active && secs >= 0;
  const open = active && (hover || pinned);

  useEffect(() => {
    if (!active) return undefined;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      return t;
    };
    tick();
    const id = setInterval(() => {
      if (tick() - until >= 1000) clearInterval(id);
    }, 250);
    return () => clearInterval(id);
  }, [active, until]);

  useEffect(() => {
    if (!pinned) return undefined;
    function onDoc(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setPinned(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') setPinned(false);
    }
    document.addEventListener('pointerdown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [pinned]);

  if (!active) return null;

  return html`
    <div
      className=${`snail-pace${compact ? ' is-compact' : ''}${open ? ' is-open' : ''}${pinned ? ' is-pinned' : ''}`}
      ref=${wrapRef}
      onMouseEnter=${() => setHover(true)}
      onMouseLeave=${() => setHover(false)}
    >
      <button
        type="button"
        className="snail-pace-btn"
        aria-expanded=${open}
        aria-controls="snail-pace-tip"
        aria-label="Search is slowed because the registry asked us to wait"
        onClick=${() => setPinned((on) => !on)}
      >
        <img src="./snail.png" alt="" height="88" width="88" />
      </button>
      ${open && html`
        <div className="snail-pace-tip" id="snail-pace-tip" role="tooltip">
          <p className="snail-pace-title">Going slowly</p>
          <p>
            The registry is asking us to wait. We were checking names faster than
            it allows, so extra confirmations are paused. We'll keep going once
            it answers normally again.
          </p>
          ${counting
            ? html`<p className="snail-pace-wait">About ${secs} ${secs === 1 ? 'second' : 'seconds'} left.</p>`
            : html`<p className="snail-pace-wait">Still waiting on the registry.</p>`}
        </div>
      `}
    </div>
  `;
}
