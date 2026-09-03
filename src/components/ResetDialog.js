import { useEffect, useRef, useState } from 'react';
import { html } from '../html.js';
import { clearAllLocalData } from '../lib/storage.js';

export default function ResetDialog({ open, onClose }) {
  const dialogRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open) {
      setBusy(false);
      setError('');
      if (!el.open) el.showModal();
    } else if (el.open) {
      el.close();
    }
  }, [open]);

  function onDialogClick(e) {
    if (busy) return;
    if (e.target === dialogRef.current) onClose();
  }

  async function onClear() {
    setBusy(true);
    setError('');
    try {
      await clearAllLocalData();
    } catch (err) {
      setBusy(false);
      setError(String(err && err.message ? err.message : 'Could not clear local data.'));
    }
  }

  return html`
    <dialog
      className="about-dialog reset-dialog"
      ref=${dialogRef}
      onCancel=${(e) => {
        if (busy) e.preventDefault();
        else onClose();
      }}
      onClick=${onDialogClick}
    >
      <h3>Clear local data</h3>
      <p>This removes saved settings, cached word lists, registry lists, and anything else this page stored on the device. The address bar is cleared, then the page reloads as if you had never been here.</p>
      ${error ? html`<p className="tld-dialog-error">${error}</p>` : null}
      <div className="tld-dialog-actions">
        <button type="button" className="about-dialog-close" disabled=${busy} onClick=${onClose}>
          Cancel
        </button>
        <button type="button" className="reset-dialog-clear" disabled=${busy} onClick=${onClear}>
          ${busy ? 'Clearing…' : 'Clear everything'}
        </button>
      </div>
    </dialog>
  `;
}
