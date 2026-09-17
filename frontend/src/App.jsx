import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFileLines, faFlag, faUsers, faListOl, faPlus, faRightFromBracket, faUserCheck, faUserPlus, faVoteYea, faGaugeHigh } from "@fortawesome/free-solid-svg-icons";
import { api, ApiError } from "./api";
import "./App.css";
import { Elections } from "./Elections";
import { VoterRegistration } from "./VoterRegistration";
import { Registry } from "./Registry";
import { AuditLog } from "./AuditLog";
import { AuthForm } from "./AuthForm";
import { ActivationLink } from "./ActivationLink";
import { AdminDashboard } from "./AdminDashboard";
import { ProfileImage } from "./ProfileImage";
const sessionKey = "securevote.token";
function VoterList({ token, onSessionEnd, }) {
    const [voters, setVoters] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");
    const [updating, setUpdating] = useState(null);
    const [filter, setFilter] = useState("all");
    const [search, setSearch] = useState("");
    const [revision, setRevision] = useState(0);
    const [invitation, setInvitation] = useState(null);
    useEffect(() => {
        let active = true;
        api("/admin/voters", {}, token)
            .then((result) => {
            if (active) {
                setVoters(result.voters);
                setError("");
            }
        })
            .catch((err) => {
            if (!active)
                return;
            if (err instanceof ApiError &&
                (err.status === 401 || err.status === 403))
                onSessionEnd(err.message);
            else
                setError(err.message);
        })
            .finally(() => {
            if (active)
                setLoading(false);
        });
        return () => {
            active = false;
        };
    }, [token, revision, onSessionEnd]);
    async function updateApproval(voter) {
        setUpdating(voter.id);
        setError("");
        setMessage("");
        try {
            const result = await api(`/admin/voters/${voter.id}/approval`, {
                method: "PATCH",
                body: JSON.stringify({ isApproved: !voter.isApproved }),
            }, token);
            setVoters((current) => current.map((item) => item.id === result.voter.id ? result.voter : item));
            setMessage(`${voter.fullName}: ${result.message.toLowerCase()}.`);
        }
        catch (err) {
            if (err instanceof ApiError && (err.status === 401 || err.status === 403))
                onSessionEnd(err.message);
            else
                setError(err instanceof Error ? err.message : "Approval could not be updated.");
        }
        finally {
            setUpdating(null);
        }
    }
    const approved = voters.filter((voter) => voter.isApproved).length;
    async function reissueActivation(voter) {
        setUpdating(voter.id);
        setError("");
        setMessage("");
        try {
            const result = await api(`/admin/voters/${voter.id}/activation`, { method: "POST" }, token);
            setInvitation({ name: voter.fullName, activation: result.activation });
            setMessage(result.message);
        }
        catch (err) {
            if (err instanceof ApiError && (err.status === 401 || err.status === 403))
                onSessionEnd(err.message);
            else
                setError(err instanceof Error ? err.message : "The activation link could not be created.");
        }
        finally {
            setUpdating(null);
        }
    }
    const visible = voters.filter((voter) => (filter === "all" || voter.isApproved === (filter === "approved")) &&
        `${voter.fullName} ${voter.email} ${voter.institutionalId ?? ""}`
            .toLowerCase()
            .includes(search.toLowerCase().trim()));
    return (<div className="content-grid">
      <section className="metric-row" aria-label="Voter metrics">
        {[
            ["Registered voters", voters.length],
            ["Awaiting approval", voters.length - approved],
            ["Approved voters", approved],
        ].map(([label, count]) => (<article className="metric-card" key={label}>
            <span className="metric-label">{label}</span>
            <strong>{loading || error ? "—" : count}</strong>
          </article>))}
      </section>
      <section className="panel voter-panel" aria-labelledby="voters-heading">
        <div className="section-heading">
          <div>
            <span className="panel-kicker">Account review</span>
            <h2 id="voters-heading">Voter list</h2>
          </div>
          <button className="secondary-button" disabled={loading || updating !== null} onClick={() => {
            setLoading(true);
            setRevision((value) => value + 1);
        }}>
            Refresh
          </button>
        </div>
        <div className="voter-toolbar">
          <label>
            Search voters
            <input type="search" placeholder="Name, email, or institutional ID" value={search} onChange={(event) => setSearch(event.target.value)}/>
          </label>
          <label>
            Approval status
            <select value={filter} onChange={(event) => setFilter(event.target.value)}>
              <option value="all">All voters</option>
              <option value="pending">Awaiting approval</option>
              <option value="approved">Approved</option>
            </select>
          </label>
        </div>
        {error && (<p className="notice error" role="alert">
            {error}
          </p>)}
        {message && (<p className="notice success" role="status">
            {message}
          </p>)}
        {invitation && <ActivationLink key={invitation.activation.token} activation={invitation.activation} name={invitation.name} onDismiss={() => setInvitation(null)}/>}
        {loading ? (<p className="empty-state" role="status">
            Loading voter registrations…
          </p>) : visible.length ? (<div className="table-scroll" tabIndex={0} role="region" aria-label="Voter registrations">
            <table>
              <thead>
                <tr>
                  <th scope="col">Voter</th>
                  <th scope="col">Registered</th>
                  <th scope="col">Status</th>
                  <th scope="col">Activation</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((voter) => (<tr key={voter.id}>
                    <td>
                      <strong>{voter.fullName}</strong>
                      <span className="voter-email">{voter.email}</span>
                      <span className="voter-email">{voter.institutionalId ?? "Existing account · ID not recorded"}</span>
                    </td>
                    <td>{new Date(voter.createdAt).toLocaleDateString()}</td>
                    <td>
                      <span className={`status-badge ${voter.isApproved ? "approved" : "awaiting"}`}>
                        {voter.isApproved ? "Approved" : "Awaiting approval"}
                      </span>
                    </td>
                    <td><span className={`status-badge ${voter.activationPending ? "awaiting" : "approved"}`}>{voter.activationPending ? "Not activated" : "Active account"}</span></td>
                    <td>
                      <div className="button-row">
                      <button className="secondary-button" disabled={updating !== null} onClick={() => updateApproval(voter)} aria-label={`${voter.isApproved ? "Revoke approval for" : "Approve"} ${voter.fullName}`}>
                        {updating === voter.id
                    ? "Saving…"
                    : voter.isApproved
                        ? "Revoke approval"
                        : "Approve voter"}
                      </button>
                      {voter.activationPending && <button className="secondary-button" disabled={updating !== null} onClick={() => reissueActivation(voter)} aria-label={`Create new activation link for ${voter.fullName}`}>New activation link</button>}
                      </div>
                    </td>
                  </tr>))}
              </tbody>
            </table>
          </div>) : (!error && (<div className="empty-state">
              <h3>
                {voters.length ? "No matching voters" : "No registrations yet"}
              </h3>
              <p>
                {voters.length
                ? "Try another name or approval status."
                : "Use Register voter to enroll a voter and create their activation link."}
              </p>
            </div>))}
      </section>
    </div>);
}
function App() {
    const [activationToken, setActivationToken] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get("activate"));
    useEffect(() => {
        function captureActivation() {
            const params = new URLSearchParams(window.location.hash.slice(1));
            if (params.has("activate")) {
                setActivationToken(params.get("activate"));
                window.history.replaceState(null, "", window.location.pathname + window.location.search);
            }
        }
        captureActivation();
        window.addEventListener("hashchange", captureActivation);
        return () => window.removeEventListener("hashchange", captureActivation);
    }, []);
    const [createdElectionId, setCreatedElectionId] = useState("");
    const [electionsVisit, setElectionsVisit] = useState(0);
    const [page, setPage] = useState("elections");
    const [token, setToken] = useState(() => sessionStorage.getItem(sessionKey) ?? "");
    const [user, setUser] = useState(null);
    const [checking, setChecking] = useState(Boolean(token));
    const [notice, setNotice] = useState("");
    const [endSession] = useState(() => (message) => {
        sessionStorage.removeItem(sessionKey);
        setToken("");
        setUser(null);
        setNotice(message);
        setChecking(false);
        setPage("elections");
        setCreatedElectionId("");
    });
    useEffect(() => {
        if (!token)
            return;
        let active = true;
        api("/auth/me", {}, token)
            .then((result) => {
            if (active) {
                setUser(result.user);
                if (result.user.role === "party")
                    setPage("candidates");
                else if (result.user.role === "admin")
                    setPage("dashboard");
            }
        })
            .catch((err) => {
            if (active)
                endSession(err.message);
        })
            .finally(() => {
            if (active)
                setChecking(false);
        });
        return () => {
            active = false;
        };
    }, [token, endSession]);
    if (checking && activationToken === null)
        return (<main className="session-loading" role="status">
        Checking your session…
      </main>);
    if (!user || !token || activationToken !== null)
        return (<AuthForm key={activationToken ?? "login"} activationToken={activationToken} onActivationComplete={message => { setActivationToken(null); endSession(message); }} notice={activationToken === null ? notice : ""} onLogin={(nextToken, nextUser) => {
                sessionStorage.setItem(sessionKey, nextToken);
                setToken(nextToken);
                setUser(nextUser);
                setPage(nextUser.role === "party" ? "candidates" : nextUser.role === "admin" ? "dashboard" : "elections");
                setNotice("");
            }}/>);
    const title = { dashboard: "Dashboard", elections: "Elections", voters: "Voter list", audit: "Audit log", parties: user.role === "party" ? "My party" : "Registered parties", roles: "Candidate roles", candidates: user.role === "party" ? "My candidates" : "Candidate rosters", create: "Create election", registerVoter: "Register voter" }[page];
    return (<main className="app-shell">
      <a className="skip-link" href="#workspace">Skip to page content</a>
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
          {user.role === "admin" && <>
            <span className="nav-group-label">Overview</span>
            <button className={`nav-item ${page === "dashboard" ? "active" : ""}`} aria-current={page === "dashboard" ? "page" : undefined} onClick={() => setPage("dashboard")}><FontAwesomeIcon icon={faGaugeHigh} aria-hidden="true" />Dashboard</button>
            <button className={`nav-item ${page === "voters" ? "active" : ""}`} aria-current={page === "voters" ? "page" : undefined} onClick={() => setPage("voters")}><FontAwesomeIcon icon={faUserCheck} aria-hidden="true" />Voter list</button>
          </>}
          {(user.role === "admin" || user.role === "party") && <>
            <span className="nav-group-label">{user.role === "admin" ? "Preparation" : "Party management"}</span>
            {[
                ["parties", user.role === "party" ? "My party" : "Registered parties", faFlag],
                ["roles", "Candidate roles", faListOl],
                ["candidates", user.role === "party" ? "My candidates" : "Candidate rosters", faUsers],
            ].map(([key, label, icon]) => <button key={key} className={`nav-item ${page === key ? "active" : ""}`} aria-current={page === key ? "page" : undefined} onClick={() => setPage(key)}><FontAwesomeIcon icon={icon} aria-hidden="true"/>{label}</button>)}
            <span className="nav-group-label">Elections</span>
            {user.role === "admin" && <button className={`nav-item ${page === "create" ? "active" : ""}`} aria-current={page === "create" ? "page" : undefined} onClick={() => setPage("create")}><FontAwesomeIcon icon={faPlus} aria-hidden="true"/>Create election</button>}
          </>}
          <button className={`nav-item ${page === "elections" ? "active" : ""}`} onClick={() => { setCreatedElectionId(""); setElectionsVisit(value => value + 1); setPage("elections"); }} aria-current={page === "elections" ? "page" : undefined}>
            <FontAwesomeIcon icon={faVoteYea} aria-hidden="true"/>
            Elections
          </button>
          {user.role === "admin" && <button className={`nav-item ${page === "registerVoter" ? "active" : ""}`} onClick={() => setPage("registerVoter")} aria-current={page === "registerVoter" ? "page" : undefined}><FontAwesomeIcon icon={faUserPlus} aria-hidden="true"/>Register voter</button>}
          {user.role === "admin" && (<button className={`nav-item ${page === "audit" ? "active" : ""}`} onClick={() => setPage("audit")} aria-current={page === "audit" ? "page" : undefined}>
              <FontAwesomeIcon icon={faFileLines} aria-hidden="true"/>
              Audit log
            </button>)}
        </nav>
        <div className="sidebar-footer">
          <button className="sidebar-signout" onClick={() => endSession("")}>
            <FontAwesomeIcon icon={faRightFromBracket} aria-hidden="true"/>
            Sign out
          </button>
        </div>
      </aside>
      <section className="workspace" id="workspace" tabIndex={-1} aria-labelledby="page-title">
        <header className="topbar">
          <div>
            <h1 id="page-title">{title}</h1>
          </div>
          <div className="account-profile"><ProfileImage /><div className="profile-copy"><strong>{user.fullName}</strong><small>{user.role === "admin" ? "Administrator" : user.role}</small></div></div>
        </header>
        {user.role === "admin" && page === "dashboard" ? <AdminDashboard token={token} onSessionEnd={endSession} onNavigate={setPage} /> : (user.role === "admin" || user.role === "party") && (page === "parties" || page === "roles" || page === "candidates") ? (<Registry key={page} page={page} token={token} admin={user.role === "admin"} onSessionEnd={endSession}/>) : user.role === "admin" && page === "registerVoter" ? (<VoterRegistration token={token} onSessionEnd={endSession} onViewVoters={() => setPage("voters")}/>) : user.role === "admin" && page === "voters" ? (<VoterList token={token} onSessionEnd={endSession}/>) : user.role === "admin" && page === "audit" ? (<AuditLog token={token} onSessionEnd={endSession}/>) : (<Elections key={`${page}:${electionsVisit}`} createMode={page === "create"} onCreate={() => setPage("create")} onList={() => { setCreatedElectionId(""); setPage("elections"); }} initialElectionId={page === "elections" ? createdElectionId : undefined} onCreated={id => { setCreatedElectionId(id); setPage("elections"); }} token={token} admin={user.role === "admin"} voter={user.role === "voter"} onSessionEnd={endSession}/>)}
      </section>
    </main>);
}
export default App;
