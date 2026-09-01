import { html } from '../html.js';
import { TLD_CHIPS } from '../hooks/useDomainFinder.js';

export default function Controls({
  tldChoice,
  onTldChange,
  customTld,
  onCustomTldChange,
  targetCount,
  onTargetCountChange,
  minLen,
  onMinLenChange,
  maxLen,
  onMaxLenChange,
  shortBias,
  onShortBiasChange,
  ready,
  busy,
  onStart,
}) {
  return html`
    <form className="panel controls" onSubmit=${(e) => e.preventDefault()}>
      <fieldset>
        <legend>TLD</legend>
        <div className="chip-row" role="radiogroup" aria-label="TLD">
          ${TLD_CHIPS.map((tld) => html`
            <button
              key=${tld}
              type="button"
              role="radio"
              aria-checked=${tldChoice === tld}
              className=${`tld-chip${tldChoice === tld ? ' is-active' : ''}`}
              onClick=${() => onTldChange(tld)}
            >
              ${tld === 'custom' ? 'Custom' : `.${tld}`}
            </button>
          `)}
        </div>
        ${tldChoice === 'custom' && html`
          <div className="custom-tld">
            <label htmlFor="tld-custom">Custom TLD</label>
            <input
              id="tld-custom"
              type="text"
              inputMode="url"
              autoComplete="off"
              spellCheck=${false}
              placeholder="tech"
              value=${customTld}
              onChange=${(e) => onCustomTldChange(e.target.value)}
            />
          </div>
        `}
      </fieldset>

      <div>
        <label htmlFor="batch-size">Target available</label>
        <input
          id="batch-size"
          type="number"
          inputMode="numeric"
          min=${1}
          max=${100}
          value=${targetCount}
          onChange=${(e) => onTargetCountChange(e.target.value)}
        />
      </div>

      <div className="pair">
        <div>
          <label htmlFor="min-len">Min length</label>
          <input
            id="min-len"
            type="number"
            inputMode="numeric"
            min=${2}
            max=${20}
            value=${minLen}
            onChange=${(e) => onMinLenChange(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="max-len">Max length</label>
          <input
            id="max-len"
            type="number"
            inputMode="numeric"
            min=${2}
            max=${20}
            value=${maxLen}
            onChange=${(e) => onMaxLenChange(e.target.value)}
          />
        </div>
      </div>

      <div>
        <label htmlFor="short-bias">Short bias</label>
        <input
          id="short-bias"
          type="number"
          inputMode="decimal"
          step=${0.1}
          min=${0.1}
          value=${shortBias}
          onChange=${(e) => onShortBiasChange(e.target.value)}
        />
        <p className="hint">Higher values prefer shorter invented words.</p>
      </div>

      <button className="start-btn" type="button" disabled=${!ready || busy} onClick=${onStart}>
        ${(busy || !ready) && html`<span className="loader" aria-hidden="true" />`}
        ${!ready ? 'Loading…' : busy ? 'Searching…' : 'Start generating'}
      </button>
    </form>
  `;
}
