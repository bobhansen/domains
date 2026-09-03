import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { html } from '../html.js';
import { filterLanguages, languageByCode } from '../lib/languages.js';

function optionRows(list) {
  return [...list.querySelectorAll('li')].filter((li) => li.querySelector('[role="option"]'));
}

function contentBox(list) {
  const style = getComputedStyle(list);
  const rect = list.getBoundingClientRect();
  const borderTop = parseFloat(style.borderTopWidth) || 0;
  const borderBottom = parseFloat(style.borderBottomWidth) || 0;
  const padTop = parseFloat(style.paddingTop) || 0;
  const padBottom = parseFloat(style.paddingBottom) || 0;
  return {
    top: rect.top + borderTop + padTop,
    bottom: rect.bottom - borderBottom - padBottom,
  };
}

function scrollRowToTop(list, row) {
  const box = contentBox(list);
  list.scrollTop += row.getBoundingClientRect().top - box.top;
}

function fitListToWholeRows(list, rows) {
  if (!rows.length) return 1;
  const height = rows[0].getBoundingClientRect().height || 1;
  const style = getComputedStyle(list);
  const padY = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
  const borderY = (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
  if (!list.dataset.capHeight) {
    const cssMax = parseFloat(style.maxHeight);
    list.dataset.capHeight = String(Number.isFinite(cssMax) && cssMax > 0 ? cssMax : list.getBoundingClientRect().height);
  }
  const innerCap = Math.max(height, parseFloat(list.dataset.capHeight) - borderY - padY);
  const count = Math.max(1, Math.floor(innerCap / height + 1e-6));
  list.style.maxHeight = `${count * height + padY + borderY}px`;
  return Math.min(count, rows.length);
}

function firstIndexFor(index, count, total) {
  const maxFirst = Math.max(0, total - count);
  if (index <= 0) return 0;
  if (index >= total - 1) return maxFirst;
  const above = Math.floor((count - 1) / 2);
  return Math.max(0, Math.min(index - above, maxFirst));
}

function scrollIndexToMiddle(list, index) {
  const rows = optionRows(list);
  if (!rows.length) return;
  const count = fitListToWholeRows(list, rows);
  if (index <= 0) {
    list.scrollTop = 0;
    return;
  }
  scrollRowToTop(list, rows[firstIndexFor(index, count, rows.length)]);
}

function revealIndex(list, index) {
  const rows = optionRows(list);
  if (!rows[index]) return;
  const count = fitListToWholeRows(list, rows);
  if (index <= 0) {
    list.scrollTop = 0;
    return;
  }
  if (index >= rows.length - 1) {
    scrollRowToTop(list, rows[firstIndexFor(index, count, rows.length)]);
    return;
  }
  const box = contentBox(list);
  const rect = rows[index].getBoundingClientRect();
  if (rect.top >= box.top - 0.5 && rect.bottom <= box.bottom + 0.5) return;
  if (rect.top < box.top) {
    scrollRowToTop(list, rows[index]);
    return;
  }
  scrollRowToTop(list, rows[Math.max(0, index - count + 1)]);
}

export default function LanguageSelect({ value, onChange }) {
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const scrollModeRef = useRef(null);
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

  useLayoutEffect(() => {
    if (!open) return;
    const list = listRef.current;
    if (!list) return;
    const mode = scrollModeRef.current;
    scrollModeRef.current = null;
    if (mode === 'center') scrollIndexToMiddle(list, active);
    else if (mode === 'reveal') revealIndex(list, active);
    else if (mode === 'top') list.scrollTop = 0;
  }, [active, open, options]);

  function close() {
    setOpen(false);
    setQuery('');
    setActive(0);
  }

  function openList() {
    if (open) return;
    const idx = Math.max(0, options.findIndex((lang) => lang.code === selected.code));
    scrollModeRef.current = 'center';
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
      scrollModeRef.current = 'reveal';
      setActive((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      scrollModeRef.current = 'reveal';
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
            scrollModeRef.current = 'top';
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
