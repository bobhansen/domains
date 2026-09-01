import { html } from '../html.js';
import { TLD_CHIPS } from '../hooks/useDomainFinder.js';
import { LIMITS, stepShortBias } from '../lib/limits.js';

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
          min=${LIMITS.target.min}
          max=${LIMITS.target.max}
          step=${1}
          value=${targetCount}
          onChange=${(e) => onTargetCountChange(e.target.value)}
          onBlur=${(e) => onTargetCountChange(e.target.value)}
        />
      </div>

      <div className="pair">
        <div>
          <label htmlFor="min-len">Min length</label>
          <input
            id="min-len"
            type="number"
            inputMode="numeric"
            min=${LIMITS.length.min}
            max=${maxLen}
            step=${1}
            value=${minLen}
            onChange=${(e) => onMinLenChange(e.target.value)}
            onBlur=${(e) => onMinLenChange(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="max-len">Max length</label>
          <input
            id="max-len"
            type="number"
            inputMode="numeric"
            min=${minLen}
            max=${LIMITS.length.max}
            step=${1}
            value=${maxLen}
            onChange=${(e) => onMaxLenChange(e.target.value)}
            onBlur=${(e) => onMaxLenChange(e.target.value)}
          />
        </div>
      </div>

      <div>
        <label htmlFor="short-bias">Short bias</label>
        <div className="bias-field">
          <input
            id="short-bias"
            type="number"
            inputMode="decimal"
            step="any"
            min=${LIMITS.shortBias.min}
            max=${LIMITS.shortBias.max}
            value=${shortBias}
            onChange=${(e) => onShortBiasChange(e.target.value)}
            onBlur=${(e) => onShortBiasChange(e.target.value)}
            onKeyDown=${(e) => {
              if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
              e.preventDefault();
              onShortBiasChange(stepShortBias(shortBias, e.key === 'ArrowUp' ? 1 : -1));
            }}
          />
          <div className="bias-stepper">
            <button
              type="button"
              aria-label="Multiply short bias by 10"
              disabled=${Number(shortBias) >= LIMITS.shortBias.max}
              onClick=${() => onShortBiasChange(stepShortBias(shortBias, 1))}
            >×10</button>
            <button
              type="button"
              aria-label="Divide short bias by 10"
              disabled=${Number(shortBias) <= LIMITS.shortBias.min}
              onClick=${() => onShortBiasChange(stepShortBias(shortBias, -1))}
            >÷10</button>
          </div>
        </div>
        <p className="hint">Higher values prefer shorter invented words.</p>
      </div>

      <button className=${`start-btn${busy ? ' is-stop' : ''}`} type="button" disabled=${!ready} onClick=${onStart}>
        ${!ready && html`<span className="loader" aria-hidden="true" />`}
        ${!ready ? 'Loading…' : busy ? 'Stop searching' : 'Start generating'}
      </button>
    </form>
  `;
}
