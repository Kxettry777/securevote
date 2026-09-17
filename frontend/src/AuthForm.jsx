import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faEye, faEyeSlash } from "@fortawesome/free-solid-svg-icons";
import { api } from "./api";
import { ProfileImage } from "./ProfileImage";
export function AuthForm({ onLogin, notice, activationToken, onActivationComplete }) {
    const activating = activationToken !== null;
    const validLink = !activating || /^[a-f0-9]{64}$/.test(activationToken);
    const [showPassword, setShowPassword] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    async function submit(event) {
        event.preventDefault();
        const values = new FormData(event.currentTarget);
        setError("");
        if (activating && values.get("password") !== values.get("confirmPassword")) {
            setError("The passwords do not match.");
            return;
        }
        setBusy(true);
        setShowPassword(false);
        try {
            if (activating) {
                const result = await api("/auth/activate", {
                    method: "POST", body: JSON.stringify({ token: activationToken, password: values.get("password") }),
                });
                onActivationComplete(result.message);
            }
            else {
                const result = await api("/auth/login", {
                    method: "POST", body: JSON.stringify({ email: values.get("email"), password: values.get("password") }),
                });
                onLogin(result.token, result.user);
            }
        }
        catch (err) {
            setError(err instanceof Error ? err.message : "Please try again.");
        }
        finally {
            setBusy(false);
        }
    }
    return <main className="auth-shell">
    <header className="auth-header">
      <div className="brand-lockup"><ProfileImage /><div><strong>SecureVote</strong><span>Institutional elections</span></div></div>
      <span className="auth-header-label">Election access portal</span>
    </header>
    <section className="auth-content" aria-labelledby="auth-heading">
      <div className="auth-card">
        <div className="auth-card-heading">
          <ProfileImage className="auth-profile-image" />
          <h1 id="auth-heading">{activating ? "Activate your account" : "Secure Vote"}</h1>
          {activating && <p className="form-description">Your election commission has enrolled you. Set your password to activate your account.</p>}
        </div>
        {notice && <p className="notice" role="status">{notice}</p>}
        {!validLink && <p className="notice error" role="alert">This activation link is incomplete. Ask the election commission for a new link.</p>}
        {error && <p className="notice error" role="alert">{error}</p>}
        <form onSubmit={submit} className="auth-form" aria-label={activating ? "Activate account" : "Sign in"} aria-busy={busy}>
          <fieldset disabled={busy || !validLink}>
            {!activating && <label>Email address<input name="email" type="email" placeholder="you@institution.edu" autoComplete="username" maxLength={254} required/></label>}
            <div className="password-field">
              <label htmlFor="auth-password">{activating ? "New password" : "Password"}</label>
              <div className="password-input">
                <input id="auth-password" name="password" type={showPassword ? "text" : "password"} placeholder={activating ? "Choose a password" : "Enter your password"} autoComplete={activating ? "new-password" : "current-password"} minLength={activating ? 8 : undefined} maxLength={72} required aria-describedby={activating ? "password-help" : undefined}/>
                <button className="password-toggle" type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? "Hide password" : "Show password"} aria-controls="auth-password"><FontAwesomeIcon icon={showPassword ? faEyeSlash : faEye} aria-hidden="true"/></button>
              </div>
            </div>
            {activating && <><small id="password-help">Use at least 8 characters, up to 72 UTF-8 bytes. Choose a password you do not use elsewhere.</small><label>Confirm password<input name="confirmPassword" type={showPassword ? "text" : "password"} autoComplete="new-password" maxLength={72} required/></label></>}
            <button className="primary-button" type="submit">{busy ? "Please wait…" : activating ? "Activate account" : "Sign in"}</button>
          </fieldset>
        </form>
        {activating && <div className="auth-help"><button type="button" className="text-button" disabled={busy} onClick={() => onActivationComplete("")}>Back to sign in</button></div>}
      </div>
    </section>
  </main>;
}
