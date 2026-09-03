import { useEffect, useRef, useState, useCallback, Fragment } from 'react';
import { html } from './html.js';
import { useDomainFinder } from './hooks/useDomainFinder.js';
import { inspectLayout, formatLayoutReport, NARROW_PX, shouldUseCompactLayout } from './lib/layout.js';
import { buildLanguageDebugReport } from './lib/languages.js';
import { SETTINGS_KEY } from './lib/settings.js';
import Controls from './components/Controls.js';
import ActivityLog from './components/ActivityLog.js';
import About from './components/About.js';
import SignalDebug from './components/SignalDebug.js';
import ResultsGrid from './components/ResultsGrid.js';
import StageTld from './components/StageTld.js';
import SnailPace from './components/SnailPace.js';
import ResetDialog from './components/ResetDialog.js';

function storedLanguageSnapshot() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw == null) return { storedJson: '(absent)', storedLanguage: '' };
    let language = '';
    try {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.language) language = String(parsed.language);
    } catch {
      language = '';
    }
    return { storedJson: raw, storedLanguage: language };
  } catch {
    return { storedJson: '(error reading localStorage)', storedLanguage: '' };
  }
}

export default function App() {
  const finder = useDomainFinder();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [compact, setCompact] = useState(() => window.innerWidth <= NARROW_PX);
  const [localeDebugOpen, setLocaleDebugOpen] = useState(false);
  const [layoutDebugOpen, setLayoutDebugOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const appRef = useRef(null);
  const railRef = useRef(null);
  const layoutCacheRef = useRef({});

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

  useEffect(() => {
    const app = appRef.current;
    const rail = railRef.current;

    function update() {
      const next = shouldUseCompactLayout(rail, app, layoutCacheRef.current);
      layoutCacheRef.current = next.cache;
      setCompact(next.compact);
    }

    update();
    const ro = new ResizeObserver(update);
    if (app) ro.observe(app);
    if (rail) ro.observe(rail);
    const controls = rail && rail.querySelector('.controls');
    if (controls) ro.observe(controls);
    window.addEventListener('resize', update);
    const fonts = document.fonts;
    if (fonts && fonts.ready) fonts.ready.then(update).catch(() => {});
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  function startSearch() {
    if (finder.busy) {
      finder.cancelSearch();
      return;
    }
    setSheetOpen(false);
    finder.runSearch({ reset: true });
  }

  const buildLocaleReport = useCallback(
    () => buildLanguageDebugReport(finder.language, storedLanguageSnapshot()),
    [finder.language],
  );

  const buildLayoutReport = useCallback(
    () => formatLayoutReport(inspectLayout({
      rail: railRef.current,
      app: appRef.current,
      compact,
      cache: layoutCacheRef.current,
    })),
    [compact],
  );

  const classes = [
    'app',
    compact ? 'is-compact' : '',
    sheetOpen ? 'sheet-open' : '',
  ].filter(Boolean).join(' ');

  return html`
    <${Fragment}>
      <div className="atmosphere" aria-hidden="true" />

      <div className=${classes} ref=${appRef}>
        <header className="mobile-bar">
          <div className="mobile-brand">
            <h1>Vanity Domain</h1>
            <${About} />
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

        <aside className="rail" id="search-settings" ref=${railRef}>
          <div className="sheet-handle" aria-hidden="true" />
          <div className="sheet-bar">
            <p className="sheet-title">Search settings</p>
            <button type="button" className="sheet-close" onClick=${() => setSheetOpen(false)}>
              Done
            </button>
          </div>
          <header className="brand">
            <h1>Vanity Domain</h1>
            <${About} tagline="Discover your own domain that is easy to say, remember, and type." />
          </header>

          <${Controls}
            compact=${compact}
            language=${finder.language}
            onLanguageChange=${finder.setLanguage}
            tldChoice=${finder.tldChoice}
            onTldChange=${finder.setTldChoice}
            customTld=${finder.customTld}
            onCustomTldChange=${finder.setCustomTld}
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

          <${ActivityLog}
            logs=${finder.logs}
            found=${finder.found}
            checked=${finder.checked}
            onLocaleDebug=${() => setLocaleDebugOpen(true)}
            onLayoutDebug=${() => setLayoutDebugOpen(true)}
            onReset=${() => setResetOpen(true)}
          />
        </aside>

        <div className="stage-slot">
          <main className="panel stage">
            <header className="stage-head">
              <h2>Available names</h2>
              ${compact && html`
                <${StageTld}
                  tldChoice=${finder.tldChoice}
                  customTld=${finder.customTld}
                  onTldChange=${finder.setTldChoice}
                  onCustomTldChange=${finder.setCustomTld}
                  validateTld=${finder.validateCustomTld}
                />
              `}
            </header>
            <${ResultsGrid}
              results=${finder.results}
              capacity=${finder.capacity}
              onCapacity=${finder.setCapacity}
            />
          </main>
        </div>

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
            ${!finder.ready ? 'Loading…' : finder.busy ? 'Stop' : 'Refresh'}
          </button>
        </div>
      </div>
      <${SnailPace} compact=${compact} />
      <${ResetDialog}
        open=${resetOpen}
        onClose=${() => setResetOpen(false)}
      />
      <${SignalDebug}
        open=${localeDebugOpen}
        onClose=${() => setLocaleDebugOpen(false)}
        title="Language signals"
        buildReport=${buildLocaleReport}
      />
      <${SignalDebug}
        open=${layoutDebugOpen}
        onClose=${() => setLayoutDebugOpen(false)}
        title="Layout signals"
        buildReport=${buildLayoutReport}
      />
    </${Fragment}>
  `;
}
