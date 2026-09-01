import { useEffect, useRef } from 'react';
import { html } from '../html.js';
import Stats from './Stats.js';

export default function ActivityLog({ logs, found, checked }) {
  const scroller = useRef(null);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs]);

  return html`
    <section className="panel log-panel">
      <h2>Activity</h2>
      <div className="log-window" ref=${scroller} aria-live="polite">
        ${logs.map((entry) => html`
          <div
            key=${entry.id}
            className=${`log-entry${entry.type === 'success' ? ' log-success' : ''}${entry.type === 'error' ? ' log-error' : ''}`}
          >
            ${entry.msg}
          </div>
        `)}
      </div>
      <${Stats} found=${found} checked=${checked} />
    </section>
  `;
}
