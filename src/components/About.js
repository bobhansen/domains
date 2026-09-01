import { Fragment, useEffect, useRef, useState } from 'react';
import { html } from '../html.js';

export default function About({ tagline }) {
  const dialogRef = useRef(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open) {
      if (!el.open) el.showModal();
    } else if (el.open) {
      el.close();
    }
  }, [open]);

  function onDialogClick(e) {
    if (e.target === dialogRef.current) setOpen(false);
  }

  const button = html`
    <button type="button" className="about-btn" onClick=${() => setOpen(true)}>
      About
    </button>
  `;

  return html`
    <${Fragment}>
      ${tagline
        ? html`<p className="lede">${tagline}${' '}${button}</p>`
        : button}
      <dialog
        className="about-dialog"
        ref=${dialogRef}
        onCancel=${() => setOpen(false)}
        onClick=${onDialogClick}
      >
        <h3>Vanity Domain</h3>
        <p>Why have a vanity domain? So you can control your own online identity. If you own the domain, you can control who hosts it, what it serves, and who can take it down.</p>
        <p>For example, you can give a different email to anybody who asks, like amazon@yourdomain.com, paypal@yourdomain.com, or spammy_looking_list@yourdomain.com.  Then you can know who is selling your email address, and black-hole any email address that is all spam.</p>
        <p>There are three easy steps: <a href="https://namecheap.com">register your domain</a>, <a href="https://www.knownhost.com/web-hosting/">get a hosting provider</a> (preferably different from your domain registrar), and <a href="https://websitesetup.org/beginners-guide-to-cpanel/">point your domain to your hosting provider</a>.</p>
        <p><a href="https://websitesetup.org/beginners-guide-to-cpanel/">This is a pretty good guide to getting started.</a></p>
        <p/>
        <h4>Some technical bits</h4>
        <p>To find a good vanity domain, we want it to be easy to say, remember, and type.</p>
        <p>To do that, we analyze the 10,000 most common English words and build a Markov trigram model from them.</p>
        <p>We then generate random names by sampling the markov model, check them against Cloudflare DoH, and then against the registry RDAP if the TLD supports it.</p>
        <p>The links go to namecheap because they've been a good host for me for a long time.</p>
        <button type="button" className="about-dialog-close" onClick=${() => setOpen(false)}>
          Close
        </button>
      </dialog>
    </${Fragment}>
  `;
}
