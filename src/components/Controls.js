import { html } from '../html.js';
import { TLD_CHIPS } from '../hooks/useDomainFinder.js';
import { LIMITS, LENGTH_PRESETS, lengthPresetIndex, stepLengthPreset } from '../lib/limits.js';

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
  const presetIndex = lengthPresetIndex(shortBias);
  const preset = LENGTH_PRESETS[presetIndex];

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
              ${tld === 'custom' ? 'Other' : `.${tld}`}
            </button>
          `)}
        </div>
        ${tldChoice === 'custom' && html`
          <div className="custom-tld">
            <label htmlFor="tld-custom">Other TLD</label>
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
        <label id="length-mix-label">Random lengths</label>
        <div
          className="length-stepper"
          role="group"
          aria-labelledby="length-mix-label"
        >
          <button
            type="button"
            aria-label="Shorter names"
            disabled=${presetIndex <= 0}
            onClick=${() => onShortBiasChange(stepLengthPreset(shortBias, -1))}
          >←</button>
          <p className="length-stepper-value" aria-live="polite">${preset.label}</p>
          <button
            type="button"
            aria-label="Longer names"
            disabled=${presetIndex >= LENGTH_PRESETS.length - 1}
            onClick=${() => onShortBiasChange(stepLengthPreset(shortBias, 1))}
          >→</button>
        </div>
      </div>

      <button className=${`start-btn${busy ? ' is-stop' : ''}`} type="button" disabled=${!ready} onClick=${onStart}>
        ${!ready && html`<span className="loader" aria-hidden="true" />`}
        ${!ready ? 'Loading…' : busy ? 'Stop searching' : 'Refresh'}
      </button>
    </form>
  `;
}
