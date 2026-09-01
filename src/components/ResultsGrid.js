import { html } from '../html.js';
import DomainCard from './DomainCard.js';

export default function ResultsGrid({ results }) {
  if (results.length === 0) return null;

  return html`
    <div className="results-grid">
      ${results.map((item) => html`<${DomainCard} key=${item.id} item=${item} />`)}
    </div>
  `;
}
