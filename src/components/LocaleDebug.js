import { useEffect, useRef, useState } from 'react';
import { html } from '../html.js';
import { formatLanguageDetectionReport, inspectLanguageDetection } from '../lib/languages.js';
import { SETTINGS_KEY } from '../lib/settings.js';

async function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.left = '-9999px';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

function storedSnapshot() {
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

export default function LocaleDebug({ open, onClose, currentLanguage }) {
  const dialogRef = useRef(null);
  const [report, setReport] = useState('');
  const [copyState, setCopyState] = useState('');

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open) {
      if (!el.open) el.showModal();
    } else if (el.open) {
      el.close();
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      setReport('');
      setCopyState('');
      return undefined;
    }
    const inspect = inspectLanguageDetection();
    const stored = storedSnapshot();
    const text = formatLanguageDetectionReport(inspect, {
      currentLanguage,
      storedLanguage: stored.storedLanguage,
      storedJson: stored.storedJson,
    });
    setReport(text);
    let cancelled = false;
    copyText(text).then((ok) => {
      if (!cancelled) setCopyState(ok ? 'copied' : 'failed');
    });
    return () => {
      cancelled = true;
    };
  }, [open, currentLanguage]);

  function onDialogClick(e) {
    if (e.target === dialogRef.current) onClose();
  }

  async function onCopy() {
    const ok = await copyText(report);
    setCopyState(ok ? 'copied' : 'failed');
  }

  return html`
    <dialog
      className="about-dialog locale-debug-dialog"
      ref=${dialogRef}
      onCancel=${onClose}
      onClick=${onDialogClick}
    >
      <h3>Language signals</h3>
      <p className="locale-debug-status">
        ${copyState === 'copied' ? 'Copied to the clipboard.'
          : copyState === 'failed' ? 'Could not copy automatically — use the button.'
          : 'Collecting…'}
      </p>
      <pre className="locale-debug-pre">${report || '…'}</pre>
      <div className="locale-debug-actions">
        <button type="button" className="tld-dialog-apply" onClick=${onCopy}>
          Copy again
        </button>
        <button type="button" className="about-dialog-close" onClick=${onClose}>
          Close
        </button>
      </div>
    </dialog>
  `;
}
