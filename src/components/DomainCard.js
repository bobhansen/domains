import { html } from '../html.js';
import { VERDICT } from '../lib/availability.js';

function VerdictMark({ status }) {
  if (status === 'placeholder') {
    return html`<span className="verdict-spin" />`;
  }
  if (status === 'pending') {
    return html`<span className="verdict-ask">?</span>`;
  }
  return html`
    <span className=${status === 'available' ? 'verdict-ok' : 'verdict-no'}>
      ${status === 'available' ? '✓' : '✕'}
    </span>
  `;
}

export default function DomainCard({ item }) {
  const spec = VERDICT[item.status] || VERDICT.pending;
  const phase =
    item.phase === 'out' ? ' is-leaving'
    : item.phase === 'in' ? ' is-entering'
    : item.phase === 'populate' ? ' is-populating'
    : '';
  const isPlaceholder = item.status === 'placeholder';
  const className = `domain-card ${spec.cls}${phase}`;
  return html`
    <a
      className=${className}
      href=${isPlaceholder ? undefined : `https://www.namecheap.com/domains/registration/results/?domain=${encodeURIComponent(item.domain)}`}
      target=${isPlaceholder ? undefined : '_blank'}
      rel=${isPlaceholder ? undefined : 'noopener noreferrer'}
      title=${spec.title}
      aria-busy=${isPlaceholder || item.status === 'pending'}
      aria-label=${spec.title}
    >
      ${!isPlaceholder && html`<span className="stem">${item.word}</span>`}
      ${!isPlaceholder && html`<span className="suffix">.${item.tld}</span>`}
      ${!isPlaceholder && html`<span className="hint">Namecheap ↗</span>`}
      <span className="verdict">
        <${VerdictMark} status=${item.status} />
      </span>
    </a>
  `;
}
