import { useEffect, useRef, useState } from 'react';
import { html } from '../html.js';

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

export default function SignalDebug({ open, onClose, title, buildReport }) {
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
    let text = '';
    try {
      text = String(buildReport() || '');
    } catch (err) {
      text = `Failed to build report: ${err && err.message ? err.message : err}`;
    }
    setReport(text);
    let cancelled = false;
    copyText(text).then((ok) => {
      if (!cancelled) setCopyState(ok ? 'copied' : 'failed');
    });
    return () => {
      cancelled = true;
    };
  }, [open, buildReport]);

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
      <h3>${title}</h3>
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
