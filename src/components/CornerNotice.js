import { useEffect, useRef, useState } from 'react';
import { html } from '../html.js';

export default function CornerNotice({
  active,
  className,
  icon,
  label,
  tipId,
  title,
  children,
}) {
  const wrapRef = useRef(null);
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    if (!active) setPinned(false);
  }, [active]);

  const open = active && (hover || pinned);

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

  const extra = className ? ` ${className}` : '';
  return html`
    <div
      className=${`status-glyph${extra}${open ? ' is-open' : ''}${pinned ? ' is-pinned' : ''}`}
      ref=${wrapRef}
      onMouseEnter=${() => setHover(true)}
      onMouseLeave=${() => setHover(false)}
    >
      <button
        type="button"
        className="status-glyph-btn"
        aria-expanded=${open}
        aria-controls=${tipId}
        aria-label=${label}
        onClick=${() => setPinned((on) => !on)}
      >
        <img src=${icon} alt="" height="88" width="88" />
      </button>
      ${open && html`
        <div className="status-glyph-tip" id=${tipId} role="tooltip">
          <p className="status-glyph-title">${title}</p>
          ${children}
        </div>
      `}
    </div>
  `;
}
