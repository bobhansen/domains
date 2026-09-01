import { html } from '../html.js';

export default function Stats({ found, checked }) {
  const rate = checked ? `${((found / checked) * 100).toFixed(1)}%` : '—';
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
      <div>
        <dt>Hit rate</dt>
        <dd>${rate}</dd>
      </div>
    </dl>
  `;
}
