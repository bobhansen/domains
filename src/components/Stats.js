import { useRef } from 'react';
import { html } from '../html.js';

const HOLD_MS = 2000;

export default function Stats({ found, checked, onLocaleDebug }) {
  const rate = checked ? `${((found / checked) * 100).toFixed(1)}%` : '—';
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
      onLocaleDebug();
    }, HOLD_MS);
  }

  return html`
    <dl className="stats">
      <div>
        <dt>Found</dt>
        <dd className="found">${found}</dd>
      </div>
      <div>
        <dt>Checked</dt>
        <dd>${checked}</dd>
      </div>
      <div
        className="stats-hit"
        onPointerDown=${startHold}
        onPointerUp=${clearHold}
        onPointerCancel=${clearHold}
        onPointerLeave=${clearHold}
        onContextMenu=${(e) => e.preventDefault()}
      >
        <dt>Hit rate</dt>
        <dd>${rate}</dd>
      </div>
    </dl>
  `;
}
