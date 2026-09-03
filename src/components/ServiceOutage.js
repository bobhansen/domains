import { useEffect, useState } from 'react';
import { html } from '../html.js';
import { subscribeServiceOutage } from '../lib/availability.js';
import CornerNotice from './CornerNotice.js';

export default function ServiceOutage() {
  const [active, setActive] = useState(false);

  useEffect(() => subscribeServiceOutage(({ active: next }) => {
    setActive(next);
  }), []);

  return html`
    <${CornerNotice}
      active=${active}
      className="service-outage"
      icon="./sad.png"
      label="Required websites appear blocked or unavailable"
      tipId="service-outage-tip"
      title="Can't reach a required site"
    >
      <p>
        It looks like a website we need is blocked or unavailable. That can
        happen with a privacy blocker, firewall, or outage. We'll try again
        in a few seconds.
      </p>
    </${CornerNotice}>
  `;
}
