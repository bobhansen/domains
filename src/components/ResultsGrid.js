import { useEffect, useRef } from 'react';
import { html } from '../html.js';
import DomainCard from './DomainCard.js';
import { countGridCapacity, visibleResults } from '../lib/gridCapacity.js';
import { LIMITS } from '../lib/limits.js';

export default function ResultsGrid({ results, capacity, onCapacity }) {
  const gridRef = useRef(null);

  useEffect(() => {
    const el = gridRef.current;
    if (!el || !onCapacity) return undefined;
    const slot = el.closest('.stage-slot');

    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        onCapacity(countGridCapacity(el, LIMITS.target.max));
      });
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (slot) ro.observe(slot);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [onCapacity]);

  const shown = visibleResults(results, capacity);

  return html`
    <div className="results-grid" ref=${gridRef}>
      ${shown.map((item) => html`<${DomainCard} key=${item.id} item=${item} />`)}
    </div>
  `;
}
