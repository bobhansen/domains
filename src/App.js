import { useEffect, useState, Fragment } from 'react';
import { html } from './html.js';
import { useDomainFinder } from './hooks/useDomainFinder.js';
import Controls from './components/Controls.js';
import ActivityLog from './components/ActivityLog.js';
import ResultsGrid from './components/ResultsGrid.js';

export default function App() {
  const finder = useDomainFinder();
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    document.body.style.overflow = sheetOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [sheetOpen]);

  useEffect(() => {
    if (!sheetOpen) return undefined;
    function onKey(e) {
      if (e.key === 'Escape') setSheetOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheetOpen]);

  function startSearch() {
    if (finder.busy) {
      finder.cancelSearch();
      return;
    }
    setSheetOpen(false);
    finder.runSearch();
  }

  const classes = [
    'app',
    sheetOpen ? 'sheet-open' : '',
  ].filter(Boolean).join(' ');

  return html`
    <${Fragment}>
      <div className="atmosphere" aria-hidden="true" />

      <div className=${classes}>
        <header className="mobile-bar">
          <div className="mobile-brand">
            <h1>Domain Spring</h1>
          </div>
        </header>

        ${sheetOpen && html`
          <button
            type="button"
            className="scrim"
            aria-label="Close search settings"
            onClick=${() => setSheetOpen(false)}
          />
        `}

        <aside className="rail" id="search-settings">
          <div className="sheet-handle" aria-hidden="true" />
          <div className="sheet-bar">
            <p className="sheet-title">Search settings</p>
            <button type="button" className="sheet-close" onClick=${() => setSheetOpen(false)}>
              Done
            </button>
          </div>
          <header className="brand">
            <h1>Domain Spring</h1>
            <p className="lede">Bubbling up open domain names that are easy to say, remember, and type.</p>
          </header>

          <${Controls}
            tldChoice=${finder.tldChoice}
            onTldChange=${finder.setTldChoice}
            customTld=${finder.customTld}
            onCustomTldChange=${finder.setCustomTld}
            targetCount=${finder.targetCount}
            onTargetCountChange=${finder.setTargetCount}
            minLen=${finder.minLen}
            onMinLenChange=${finder.setMinLen}
            maxLen=${finder.maxLen}
            onMaxLenChange=${finder.setMaxLen}
            shortBias=${finder.shortBias}
            onShortBiasChange=${finder.setShortBias}
            ready=${finder.ready}
            busy=${finder.busy}
            onStart=${startSearch}
          />

          <${ActivityLog} logs=${finder.logs} found=${finder.found} checked=${finder.checked} />
        </aside>

        <main className="panel stage">
          <header className="stage-head">
            <h2>Available names</h2>
          </header>
          <${ResultsGrid} results=${finder.results} />
        </main>

        <div className="sheet-dock">
          <button
            type="button"
            className="sheet-toggle"
            aria-expanded=${sheetOpen}
            aria-controls="search-settings"
            onClick=${() => setSheetOpen((open) => !open)}
          >
            ${sheetOpen ? 'Close' : 'Tune search'}
          </button>
          <button
            type="button"
            className=${`dock-start start-btn${finder.busy ? ' is-stop' : ''}`}
            disabled=${!finder.ready}
            onClick=${startSearch}
          >
            ${!finder.ready ? 'Loading…' : finder.busy ? 'Stop' : 'Generate'}
          </button>
        </div>
      </div>
    </${Fragment}>
  `;
}
