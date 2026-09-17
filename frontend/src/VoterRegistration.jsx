import { useState } from "react";
import { api, ApiError } from "./api";
import { ActivationLink } from "./ActivationLink";
export function VoterRegistration({ token, onSessionEnd, onViewVoters }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [registered, setRegistered] = useState(null);
    const [message, setMessage] = useState("");
    return <div className="election-workspace">
    <section className="panel"><div className="section-heading"><h2>Voter registration</h2><button className="secondary-button" disabled={busy} onClick={onViewVoters}>View voters</button></div>
      {error && <p className="notice error" role="alert">{error}</p>}
      {message && <p className="notice success" role="status">{message}</p>}
      {registered && <ActivationLink key={registered.activation.token} activation={registered.activation} name={registered.voter.fullName} onDismiss={() => setRegistered(null)}/>}
      <form className="election-form" aria-busy={busy} onSubmit={async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const values = new FormData(form);
            setBusy(true);
            setError("");
            setMessage("");
            try {
                const result = await api("/admin/voters", { method: "POST", body: JSON.stringify({ fullName: values.get("fullName"), email: values.get("email"), institutionalId: values.get("institutionalId"), isApproved: values.get("approval") === "approved" }) }, token);
                setRegistered(result);
                form.reset();
                setMessage(`${result.voter.fullName} enrolled${result.voter.isApproved ? " and approved" : ", pending approval"}. Share their activation link below.`);
            }
            catch (err) {
                if (err instanceof ApiError && (err.status === 401 || err.status === 403))
                    onSessionEnd(err.message);
                else
                    setError(err instanceof Error ? err.message : "The voter could not be enrolled.");
            }
            finally {
                setBusy(false);
            }
        }}><fieldset disabled={busy}>
        <div className="form-columns"><label>Full name<input name="fullName" placeholder="Name on the official roster" required minLength={2} maxLength={80} autoComplete="off"/></label><label>Institutional ID<input name="institutionalId" placeholder="e.g. STU-2026-001" required minLength={2} maxLength={64} autoComplete="off" aria-describedby="institutional-id-help"/></label></div>
        <p id="institutional-id-help" className="muted">Use the unique student, staff, or member ID from the official roster. Each ID can be enrolled once.</p>
        <div className="form-columns"><label>Email address<input name="email" type="email" placeholder="voter@institution.edu" required maxLength={254} autoComplete="off"/></label><label>Approval status<select name="approval" defaultValue="approved"><option value="approved">Approve immediately</option><option value="pending">Awaiting approval</option></select></label></div>
        <label className="verification-check"><input name="verified" type="checkbox" required/>I checked this voter’s identity and institutional ID against the official roster.</label>
        <p className="muted">Activation links expire after 24 hours. Account activation, approval, and election assignments are separate steps.</p>
        <button className="primary-button" type="submit">{busy ? "Enrolling…" : "Enroll and create activation link"}</button>
      </fieldset></form>
    </section>
  </div>;
}
