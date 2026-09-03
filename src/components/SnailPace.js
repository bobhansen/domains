import { useEffect, useState } from 'react';
import { html } from '../html.js';
import { subscribeRdapPushback } from '../lib/availability.js';
import CornerNotice from './CornerNotice.js';

export default function SnailPace() {
  const [active, setActive] = useState(false);
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => subscribeRdapPushback(({ active: next, until: nextUntil }) => {
    setActive(next);
    setUntil(nextUntil);
  }), []);

  const secs = Math.ceil((until - now) / 1000);
  const counting = active && secs >= 0;

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

  return html`
    <${CornerNotice}
      active=${active}
      className="snail-pace"
      icon="./snail.png"
      label="Search is slowed because the registry asked us to wait"
      tipId="snail-pace-tip"
      title="Going slowly"
    >
      <p>
        The registry is asking us to wait. We were checking names faster than
        it allows, so extra confirmations are paused. We'll keep going once
        it answers normally again.
      </p>
      ${counting
        ? html`<p className="status-glyph-wait">About ${secs} ${secs === 1 ? 'second' : 'seconds'} left.</p>`
        : html`<p className="status-glyph-wait">Still waiting on the registry.</p>`}
    </${CornerNotice}>
  `;
}
