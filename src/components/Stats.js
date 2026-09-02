import { useRef } from 'react';
import { html } from '../html.js';

const HOLD_MS = 2000;

function useHold(onFire) {
  const timerRef = useRef(null);

  function clearHold() {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function startHold(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    clearHold();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      onFire();
    }, HOLD_MS);
  }

  return {
    onPointerDown: startHold,
    onPointerUp: clearHold,
    onPointerCancel: clearHold,
    onPointerLeave: clearHold,
    onContextMenu: (e) => e.preventDefault(),
  };
}

export default function Stats({ found, checked, onLocaleDebug, onLayoutDebug }) {
  const rate = checked ? `${((found / checked) * 100).toFixed(1)}%` : '—';
  const localeHold = useHold(onLocaleDebug);
  const layoutHold = useHold(onLayoutDebug);

  return html`
    <dl className="stats">
      <div>
        <dt>Found</dt>
        <dd className="found">${found}</dd>
      </div>
      <div className="stats-hit" ...${layoutHold}>
        <dt>Checked</dt>
        <dd>${checked}</dd>
      </div>
      <div className="stats-hit" ...${localeHold}>
        <dt>Hit rate</dt>
        <dd>${rate}</dd>
      </div>
    </dl>
  `;
}
