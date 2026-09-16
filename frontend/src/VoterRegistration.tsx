import { useState } from "react";
import { api, ApiError } from "./api";
import type { Voter } from "./api";

export function VoterRegistration({ token, onSessionEnd, onViewVoters }: { token: string; onSessionEnd: (message: string) => void; onViewVoters: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [registered, setRegistered] = useState<Voter | null>(null);
  return <div className="election-workspace"><section className="welcome-panel"><div><span className="panel-kicker">Voter access</span><h2>Register a voter on their behalf.</h2><p>Create the account and choose its approval status. Approved voters can sign in, and you can assign them to an upcoming election.</p></div></section>
    <section className="panel"><div className="section-heading"><h2>Voter registration</h2><button className="secondary-button" disabled={busy} onClick={onViewVoters}>View voters</button></div>
      {error && <p className="notice error" role="alert">{error}</p>}
      {registered && <p className="notice success" role="status">{registered.fullName} registered {registered.isApproved ? "and approved. You can now assign this voter to an election." : "and is awaiting approval."}</p>}
      <form className="election-form" onSubmit={async event => {
        event.preventDefault(); const form = event.currentTarget; const values = new FormData(form);
        setBusy(true); setError(""); setRegistered(null);
        try {
          const result = await api<{ voter: Voter }>("/admin/voters", { method: "POST", body: JSON.stringify({ fullName: values.get("fullName"), email: values.get("email"), password: values.get("password"), isApproved: values.get("approval") === "approved" }) }, token);
          setRegistered(result.voter); form.reset();
        } catch (err) {
          if (err instanceof ApiError && (err.status === 401 || err.status === 403)) onSessionEnd(err.message);
          else setError(err instanceof Error ? err.message : "The voter could not be registered.");
        } finally { setBusy(false); }
      }}><fieldset disabled={busy}><label>Full name<input name="fullName" required minLength={2} maxLength={80} autoComplete="off" /></label><div className="form-columns"><label>Email address<input name="email" type="email" required maxLength={254} autoComplete="off" /></label><label>Initial password<input name="password" type="password" required minLength={8} maxLength={72} autoComplete="new-password" /></label></div><label>Approval status<select name="approval" defaultValue="approved"><option value="approved">Approve immediately</option><option value="pending">Awaiting approval</option></select></label><p className="muted">Share the sign-in details with the voter securely. Election access is assigned separately.</p><button className="primary-button" type="submit">{busy ? "Registering..." : "Register voter"}</button></fieldset></form>
    </section></div>;
}
