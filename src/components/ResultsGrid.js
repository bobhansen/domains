import { html } from '../html.js';
import DomainCard from './DomainCard.js';

export default function ResultsGrid({ results, busy, ready }) {
  if (results.length === 0) {
    return html`
      <p className="empty">
        ${busy || !ready
          ? 'Working on finding domain names for you…'
          : 'No names yet. Start a search to fill this board.'}
      </p>
    `;
  }

  return html`
    <div className="results-grid">
      ${results.map((item) => html`<${DomainCard} key=${item.domain} item=${item} />`)}
    </div>
  `;
}
