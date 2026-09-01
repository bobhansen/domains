import { html } from '../html.js';
import { VERDICT } from '../lib/availability.js';

function VerdictMark({ status }) {
  if (status === 'pending') {
    return html`<span className="verdict-spin" />`;
  }
  return html`
    <span className=${status === 'available' ? 'verdict-ok' : 'verdict-no'}>
      ${status === 'available' ? '✓' : '✕'}
    </span>
  `;
}

export default function DomainCard({ item }) {
  const spec = VERDICT[item.status];
  return html`
    <a
      className=${`domain-card ${spec.cls}`}
      href=${`https://www.namecheap.com/domains/registration/results/?domain=${encodeURIComponent(item.domain)}`}
      target="_blank"
      rel="noopener noreferrer"
      title=${spec.title}
    >
      <span className="stem">${item.word}</span>
      <span className="suffix">.${item.tld}</span>
      <span className="hint">Namecheap ↗</span>
      <span className="verdict" aria-label=${spec.title}>
        <${VerdictMark} status=${item.status} />
      </span>
    </a>
  `;
}
