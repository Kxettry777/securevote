import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faFileLines,
  faFlag,
  faUsers,
  faListOl,
  faPlus,
  faPersonBooth,
  faRightFromBracket,
  faUserCheck,
  faUserPlus,
  faVoteYea,
  faEye,
  faEyeSlash,
} from "@fortawesome/free-solid-svg-icons";
import { api, ApiError } from "./api";
import type { User, Voter } from "./api";
import "./App.css";
import { Elections } from "./Elections";
import { VoterRegistration } from "./VoterRegistration";
import { Registry } from "./Registry";
import { AuditLog } from "./AuditLog";

const sessionKey = "securevote.token";

function Brand() {
  return (
    <div className="brand-lockup">
      <div className="brand-mark" aria-hidden="true">
        SV
      </div>
      <div>
        <strong>SecureVote</strong>
        <span>Institutional elections</span>
      </div>
    </div>
  );
}

function AuthForm({
  onLogin,
  notice,
}: {
  onLogin: (token: string, user: User) => void;
  notice: string;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setShowPassword(false);
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const body = JSON.stringify(Object.fromEntries(values));
      if (mode === "register") {
        await api("/auth/register", { method: "POST", body });
        form.reset();
        setMode("login");
        setSuccess(
          "Registration submitted. An administrator must approve your account before you can sign in.",
        );
      } else {
        const result = await api<{ token: string; user: User }>("/auth/login", {
          method: "POST",
          body,
        });
        onLogin(result.token, result.user);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function changeMode(nextMode: "login" | "register") {
    setMode(nextMode);
    setShowPassword(false);
    setError("");
    setSuccess("");
  }

  return (
    <main className="auth-shell">
      <header className="auth-header">
        <Brand />
        <span className="auth-header-label">Election access portal</span>
      </header>
      <section className="auth-content" aria-labelledby="auth-heading">
        <div className="auth-card">
          <div className="auth-card-heading">
            <div className="auth-symbol" aria-hidden="true">
              <FontAwesomeIcon
                icon={faPersonBooth}
                className="auth-account-icon"
              />
            </div>
            <span className="eyebrow">Your election workspace</span>
            <h1 id="auth-heading">
              {mode === "login" ? "Welcome back" : "Create your account"}
            </h1>
            <p className="form-description">
              {mode === "login"
                ? "Sign in to access your institution's elections."
                : "Voters can register here. Political party accounts are created by an administrator."}
            </p>
          </div>
          <div
            className="auth-mode-switch"
            role="group"
            aria-label="Account access"
          >
            <button
              type="button"
              aria-pressed={mode === "login"}
              disabled={busy}
              onClick={() => changeMode("login")}
            >
              Sign in
            </button>
            <button
              type="button"
              aria-pressed={mode === "register"}
              disabled={busy}
              onClick={() => changeMode("register")}
            >
              Register
            </button>
          </div>
          {notice && (
            <p className="notice" role="status">
              {notice}
            </p>
          )}
          {success && (
            <p className="notice success" role="status">
              {success}
            </p>
          )}
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          <form
            key={mode}
            onSubmit={submit}
            className="auth-form"
            aria-label={mode === "login" ? "Sign in" : "Voter registration"}
            aria-busy={busy}
          >
            <fieldset disabled={busy}>
              {mode === "register" && (
                <label>
                  Full name
                  <input
                    name="fullName"
                    placeholder="Your full name"
                    autoComplete="name"
                    minLength={2}
                    maxLength={80}
                    required
                  />
                </label>
              )}
              <label>
                Email address
                <input
                  name="email"
                  type="email"
                  placeholder="you@institution.edu"
                  autoComplete="email"
                  maxLength={254}
                  required
                />
              </label>
              <div className="password-field">
                <label htmlFor="auth-password">Password</label>
                <div className="password-input">
                  <input
                    id="auth-password"
                    name="password"
                    placeholder={
                      mode === "login"
                        ? "Enter your password"
                        : "Create a password"
                    }
                    type={showPassword ? "text" : "password"}
                    autoComplete={
                      mode === "login" ? "current-password" : "new-password"
                    }
                    minLength={mode === "register" ? 8 : undefined}
                    maxLength={72}
                    required
                    aria-describedby={
                      mode === "register" ? "password-help" : undefined
                    }
                  />
                  <button
                    className="password-toggle"
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={
                      showPassword ? "Hide password" : "Show password"
                    }
                    aria-controls="auth-password"
                    title={showPassword ? "Hide password" : "Show password"}
                  >
                    <FontAwesomeIcon
                      icon={showPassword ? faEyeSlash : faEye}
                      aria-hidden="true"
                    />
                  </button>
                </div>
              </div>
              {mode === "register" && (
                <small id="password-help">
                  Use at least 8 characters. Very long passwords may exceed the
                  supported length.
                </small>
              )}
              <button className="primary-button" type="submit">
                {busy
                  ? "Please wait..."
                  : mode === "login"
                    ? "Sign in"
                    : "Submit registration"}
              </button>
            </fieldset>
          </form>
        </div>
      </section>
    </main>
  );
}

function VoterManagement({
  token,
  onSessionEnd,
}: {
  token: string;
  onSessionEnd: (message: string) => void;
}) {
  const [voters, setVoters] = useState<Voter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [updating, setUpdating] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    api<{ voters: Voter[] }>("/admin/voters", {}, token)
      .then((result) => {
        if (active) {
          setVoters(result.voters);
          setError("");
        }
      })
      .catch((err) => {
        if (!active) return;
        if (
          err instanceof ApiError &&
          (err.status === 401 || err.status === 403)
        )
          onSessionEnd(err.message);
        else setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token, revision, onSessionEnd]);

  async function updateApproval(voter: Voter) {
    setUpdating(voter.id);
    setError("");
    setMessage("");
    try {
      const result = await api<{ voter: Voter; message: string }>(
        `/admin/voters/${voter.id}/approval`,
        {
          method: "PATCH",
          body: JSON.stringify({ isApproved: !voter.isApproved }),
        },
        token,
      );
      setVoters((current) =>
        current.map((item) =>
          item.id === result.voter.id ? result.voter : item,
        ),
      );
      setMessage(`${voter.fullName}: ${result.message.toLowerCase()}.`);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403))
        onSessionEnd(err.message);
      else
        setError(
          err instanceof Error ? err.message : "Approval could not be updated.",
        );
    } finally {
      setUpdating(null);
    }
  }

  const approved = voters.filter((voter) => voter.isApproved).length;
  const visible = voters.filter(
    (voter) =>
      (filter === "all" || voter.isApproved === (filter === "approved")) &&
      `${voter.fullName} ${voter.email}`
        .toLowerCase()
        .includes(search.toLowerCase().trim()),
  );

  return (
    <div className="content-grid">
      <section className="welcome-panel">
        <div>
          <span className="panel-kicker">Voter access</span>
          <h2>Every election starts with eligible voters.</h2>
          <p>
            Review registrations and approve access. You can revoke approval
            when a voter is no longer eligible.
          </p>
        </div>
      </section>
      <section className="metric-row" aria-label="Voter metrics">
        {[
          ["Registered voters", voters.length],
          ["Awaiting approval", voters.length - approved],
          ["Approved voters", approved],
        ].map(([label, count]) => (
          <article className="metric-card" key={label}>
            <span className="metric-label">{label}</span>
            <strong>{loading || error ? "—" : count}</strong>
          </article>
        ))}
      </section>
      <section className="panel voter-panel" aria-labelledby="voters-heading">
        <div className="section-heading">
          <div>
            <span className="panel-kicker">Account review</span>
            <h2 id="voters-heading">Voter registrations</h2>
          </div>
          <button
            className="secondary-button"
            disabled={loading || updating !== null}
            onClick={() => {
              setLoading(true);
              setRevision((value) => value + 1);
            }}
          >
            Refresh
          </button>
        </div>
        <div className="voter-toolbar">
          <label>
            Search voters
            <input
              type="search"
              placeholder="Name or email"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label>
            Approval status
            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            >
              <option value="all">All voters</option>
              <option value="pending">Awaiting approval</option>
              <option value="approved">Approved</option>
            </select>
          </label>
        </div>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="notice success" role="status">
            {message}
          </p>
        )}
        {loading ? (
          <p className="empty-state" role="status">
            Loading voter registrations…
          </p>
        ) : visible.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Voter</th>
                  <th scope="col">Registered</th>
                  <th scope="col">Status</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((voter) => (
                  <tr key={voter.id}>
                    <td>
                      <strong>{voter.fullName}</strong>
                      <span className="voter-email">{voter.email}</span>
                    </td>
                    <td>{new Date(voter.createdAt).toLocaleDateString()}</td>
                    <td>
                      <span
                        className={`status-badge ${voter.isApproved ? "approved" : "awaiting"}`}
                      >
                        {voter.isApproved ? "Approved" : "Awaiting approval"}
                      </span>
                    </td>
                    <td>
                      <button
                        className="secondary-button"
                        disabled={updating !== null}
                        onClick={() => updateApproval(voter)}
                        aria-label={`${voter.isApproved ? "Revoke approval for" : "Approve"} ${voter.fullName}`}
                      >
                        {updating === voter.id
                          ? "Saving…"
                          : voter.isApproved
                            ? "Revoke approval"
                            : "Approve voter"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          !error && (
            <div className="empty-state">
              <h3>
                {voters.length ? "No matching voters" : "No registrations yet"}
              </h3>
              <p>
                {voters.length
                  ? "Try another name or approval status."
                  : "Voters will appear here after submitting the registration form."}
              </p>
            </div>
          )
        )}
      </section>
    </div>
  );
}

function App() {
  const [createdElectionId, setCreatedElectionId] = useState("");
  const [electionsVisit, setElectionsVisit] = useState(0);
  const [page, setPage] = useState<"elections" | "voters" | "audit" | "parties" | "roles" | "candidates" | "create" | "registerVoter">(
    "elections",
  );
  const [token, setToken] = useState(
    () => sessionStorage.getItem(sessionKey) ?? "",
  );
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(Boolean(token));
  const [notice, setNotice] = useState("");

  const [endSession] = useState(() => (message: string) => {
    sessionStorage.removeItem(sessionKey);
    setToken("");
    setUser(null);
    setNotice(message);
    setChecking(false);
    setPage("elections");
    setCreatedElectionId("");
  });

  useEffect(() => {
    if (!token) return;
    let active = true;
    api<{ user: User }>("/auth/me", {}, token)
      .then((result) => {
        if (active) { setUser(result.user); if (result.user.role === "party") setPage("candidates"); }
      })
      .catch((err) => {
        if (active) endSession(err.message);
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, [token, endSession]);

  if (checking)
    return (
      <main className="session-loading" role="status">
        Checking your session…
      </main>
    );
  if (!user || !token)
    return (
      <AuthForm
        notice={notice}
        onLogin={(nextToken, nextUser) => {
          sessionStorage.setItem(sessionKey, nextToken);
          setToken(nextToken);
          setUser(nextUser);
          setPage(nextUser.role === "party" ? "candidates" : nextUser.role === "admin" ? "parties" : "elections");
          setNotice("");
        }}
      />
    );

  const title = { elections: "Elections", voters: "Voter management", audit: "Audit log", parties: user.role === "party" ? "My party" : "Register political party", roles: "Candidate roles", candidates: user.role === "party" ? "My candidates" : "Candidate rosters", create: "Create election", registerVoter: "Register voter" }[page];
  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-identity">
          <div className="brand-mark" aria-hidden="true">
            SV
          </div>
          <div className="sidebar-account">
            <strong>SecureVote</strong>
            <span>{user.email}</span>
          </div>
        </div>
        <nav className="primary-nav" aria-label="Primary navigation">
          {(user.role === "admin" || user.role === "party") && <>
            <span className="nav-group-label">{user.role === "admin" ? "Preparation" : "Party management"}</span>
            {([
              ["parties", user.role === "party" ? "My party" : "Register political party", faFlag],
              ["roles", "Candidate roles", faListOl],
              ["candidates", user.role === "party" ? "My candidates" : "Candidate rosters", faUsers],
            ] as const).map(([key, label, icon]) => <button key={key} className={`nav-item ${page === key ? "active" : ""}`} aria-current={page === key ? "page" : undefined} onClick={() => setPage(key)}><FontAwesomeIcon icon={icon} aria-hidden="true" />{label}</button>)}
            <span className="nav-group-label">Elections</span>
            {user.role === "admin" && <button className={`nav-item ${page === "create" ? "active" : ""}`} aria-current={page === "create" ? "page" : undefined} onClick={() => setPage("create")}><FontAwesomeIcon icon={faPlus} aria-hidden="true" />Create election</button>}
          </>}
          <button
            className={`nav-item ${page === "elections" ? "active" : ""}`}
            onClick={() => { setCreatedElectionId(""); setElectionsVisit(value => value + 1); setPage("elections"); }}
            aria-current={page === "elections" ? "page" : undefined}
          >
            <FontAwesomeIcon icon={faVoteYea} aria-hidden="true" />
            Elections
          </button>
          {user.role === "admin" && <button className={`nav-item ${page === "registerVoter" ? "active" : ""}`} onClick={() => setPage("registerVoter")} aria-current={page === "registerVoter" ? "page" : undefined}><FontAwesomeIcon icon={faUserPlus} aria-hidden="true" />Register voter</button>}
          {user.role === "admin" && (
            <button
              className={`nav-item ${page === "voters" ? "active" : ""}`}
              onClick={() => setPage("voters")}
              aria-current={page === "voters" ? "page" : undefined}
            >
              <FontAwesomeIcon icon={faUserCheck} aria-hidden="true" />
              Voter management
            </button>
          )}
          {user.role === "admin" && (
            <button
              className={`nav-item ${page === "audit" ? "active" : ""}`}
              onClick={() => setPage("audit")}
              aria-current={page === "audit" ? "page" : undefined}
            >
              <FontAwesomeIcon icon={faFileLines} aria-hidden="true" />
              Audit log
            </button>
          )}
        </nav>
        <div className="sidebar-footer">
          <button
            className="sidebar-signout"
            onClick={() => endSession("You have signed out.")}
          >
            <FontAwesomeIcon icon={faRightFromBracket} aria-hidden="true" />
            Sign out
          </button>
        </div>
      </aside>
      <section className="workspace" id="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">{user.role} workspace</span>
            <h1>{title}</h1>
          </div>
        </header>
        {(user.role === "admin" || user.role === "party") && (page === "parties" || page === "roles" || page === "candidates") ? (
          <Registry key={page} page={page} token={token} admin={user.role === "admin"} onSessionEnd={endSession} />
        ) : user.role === "admin" && page === "registerVoter" ? (
          <VoterRegistration token={token} onSessionEnd={endSession} onViewVoters={() => setPage("voters")} />
        ) : user.role === "admin" && page === "voters" ? (
          <VoterManagement token={token} onSessionEnd={endSession} />
        ) : user.role === "admin" && page === "audit" ? (
          <AuditLog token={token} onSessionEnd={endSession} />
        ) : (
          <Elections
            key={`${page}:${electionsVisit}`}
            createMode={page === "create"}
            onCreate={() => setPage("create")}
            onList={() => { setCreatedElectionId(""); setPage("elections"); }}
            initialElectionId={page === "elections" ? createdElectionId : undefined}
            onCreated={id => { setCreatedElectionId(id); setPage("elections"); }}
            token={token}
            admin={user.role === "admin"}
            voter={user.role === "voter"}
            onSessionEnd={endSession}
          />
        )}
      </section>
    </main>
  );
}

export default App;
