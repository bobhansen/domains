import { useEffect, useRef, useState, Fragment } from 'react';
import { html } from '../html.js';
import { TLD_CHIPS } from '../hooks/useDomainFinder.js';

export default function StageTld({
  tldChoice,
  customTld,
  onTldChange,
  onCustomTldChange,
  validateTld,
}) {
  const selectRef = useRef(null);
  const dialogRef = useRef(null);
  const inputRef = useRef(null);
  const [otherOpen, setOtherOpen] = useState(false);
  const [draft, setDraft] = useState(customTld);
  const [error, setError] = useState('');

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (otherOpen) {
      if (!el.open) el.showModal();
      queueMicrotask(() => inputRef.current?.focus());
    } else if (el.open) {
      el.close();
    }
  }, [otherOpen]);

  function openOther() {
    setDraft(customTld);
    setError('');
    setOtherOpen(true);
  }

  function closeOther() {
    setOtherOpen(false);
    setError('');
    if (selectRef.current) selectRef.current.value = tldChoice;
  }

  function onSelectChange(e) {
    const value = e.target.value;
    if (value === 'custom') {
      openOther();
      return;
    }
    onTldChange(value);
  }

  function applyOther(e) {
    e.preventDefault();
    const result = validateTld(draft);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onCustomTldChange(result.tld);
    onTldChange('custom');
    setOtherOpen(false);
  }

  function onDialogClick(e) {
    if (e.target === dialogRef.current) closeOther();
  }

  const otherLabel = customTld ? `.${customTld}` : 'Other';

  return html`
    <${Fragment}>
      <select
        ref=${selectRef}
        className="stage-tld"
        aria-label="TLD"
        value=${tldChoice}
        onChange=${onSelectChange}
      >
        ${TLD_CHIPS.map((tld) => html`
          <option key=${tld} value=${tld}>
            ${tld === 'custom' ? otherLabel : `.${tld}`}
          </option>
        `)}
      </select>
      <dialog
        className="tld-dialog"
        ref=${dialogRef}
        onCancel=${closeOther}
        onClick=${onDialogClick}
      >
        <form className="tld-dialog-form" onSubmit=${applyOther}>
          <h3>Other TLD</h3>
          <input
            ref=${inputRef}
            id="stage-tld-custom"
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck=${false}
            placeholder="tech"
            value=${draft}
            aria-invalid=${Boolean(error)}
            aria-describedby=${error ? 'stage-tld-error' : undefined}
            onChange=${(e) => {
              setDraft(e.target.value);
              if (error) setError('');
            }}
          />
          ${error && html`<p id="stage-tld-error" className="tld-dialog-error">${error}</p>`}
          <div className="tld-dialog-actions">
            <button type="button" className="about-dialog-close" onClick=${closeOther}>
              Cancel
            </button>
            <button type="submit" className="tld-dialog-apply">Use TLD</button>
          </div>
        </form>
      </dialog>
    </${Fragment}>
  `;
}
