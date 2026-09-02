import { useEffect, useId, useRef, useState } from 'react';
import { html } from '../html.js';
import { filterLanguages, languageByCode } from '../lib/languages.js';

export default function LanguageSelect({ value, onChange }) {
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const selected = languageByCode(value);
  const options = filterLanguages(open ? query : '');

  useEffect(() => {
    if (!open) return undefined;
    function onDoc(e) {
      if (!rootRef.current?.contains(e.target)) close();
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector('[aria-selected="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, open, options]);

  function close() {
    setOpen(false);
    setQuery('');
    setActive(0);
  }

  function openList() {
    if (open) return;
    const idx = Math.max(0, options.findIndex((lang) => lang.code === selected.code));
    setOpen(true);
    setQuery('');
    setActive(idx);
    queueMicrotask(() => inputRef.current?.focus());
  }

  function pick(code) {
    onChange(code);
    close();
  }

  function onKeyDown(e) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      openList();
      return;
    }
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const lang = options[active] || options[0];
      if (lang) pick(lang.code);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }

  const display = open ? query : selected.name;
  const activeId = options[active] ? `${listId}-${options[active].code}` : undefined;

  return html`
    <div className="lang-field" ref=${rootRef}>
      <label htmlFor="language-search">Language</label>
      <div className=${`lang-combo${open ? ' is-open' : ''}`}>
        <input
          ref=${inputRef}
          id="language-search"
          type="text"
          role="combobox"
          aria-expanded=${open}
          aria-controls=${listId}
          aria-activedescendant=${open ? activeId : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck=${false}
          placeholder="Search languages"
          value=${display}
          onFocus=${openList}
          onClick=${openList}
          onChange=${(e) => {
            setQuery(e.target.value);
            setActive(0);
            if (!open) setOpen(true);
          }}
          onKeyDown=${onKeyDown}
        />
        <ul
          ref=${listRef}
          id=${listId}
          className="lang-list"
          role="listbox"
          hidden=${!open}
        >
          ${options.length
            ? options.map((lang, i) => html`
              <li key=${lang.code} role="presentation">
                <button
                  type="button"
                  id=${`${listId}-${lang.code}`}
                  role="option"
                  lang=${lang.code.replace('_', '-')}
                  aria-selected=${i === active}
                  className=${[i === active ? 'is-active' : '', lang.code === selected.code ? 'is-current' : ''].filter(Boolean).join(' ')}
                  onMouseEnter=${() => setActive(i)}
                  onClick=${() => pick(lang.code)}
                >
                  <span className="lang-name">${lang.name}</span>
                  <span className="lang-code">${lang.code}</span>
                </button>
              </li>
            `)
            : html`<li className="lang-empty">No matching language</li>`}
        </ul>
      </div>
    </div>
  `;
}
