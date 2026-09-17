import { useState } from "react";
export function ActivationLink({ activation, name, onDismiss }) {
    const [message, setMessage] = useState("");
    const url = new URL(window.location.pathname, window.location.origin);
    url.hash = `activate=${activation.token}`;
    return <section className="activation-link" aria-label="Voter activation link">
    <div className="section-heading"><div><h3>Activation link for {name}</h3><p>Share privately using the voter’s verified contact details. This link works once and expires {new Date(activation.expiresAt).toLocaleString()}.</p></div><button className="text-button" type="button" onClick={onDismiss}>Dismiss</button></div>
    <label>Private activation link<input readOnly value={url.href} onFocus={event => event.currentTarget.select()}/></label>
    <div className="button-row"><button className="secondary-button" type="button" onClick={async () => {
            try {
                await navigator.clipboard.writeText(url.href);
                setMessage("Activation link copied.");
            }
            catch {
                setMessage("Select the link above and copy it manually.");
            }
        }}>Copy activation link</button><span className="muted" role="status">{message}</span></div>
    <p className="muted">No email has been sent. You can replace this link from Voter list if needed.</p>
  </section>;
}
