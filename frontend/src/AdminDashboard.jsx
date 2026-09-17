import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faUsers, faFlag, faVoteYea, faCalendarDays, faArrowRight } from "@fortawesome/free-solid-svg-icons";
import { api, ApiError } from "./api";

export function AdminDashboard({ token, onSessionEnd, onNavigate }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api("/admin/dashboard", { signal: controller.signal }, token)
      .then(result => { if (!controller.signal.aborted) { setData(result); setError(""); } })
      .catch(err => {
        if (controller.signal.aborted) return;
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) onSessionEnd(err.message);
        else setError(err instanceof Error ? err.message : "The dashboard could not be loaded.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [token, onSessionEnd, revision]);

  const metrics = [
    ["Registered voters", data?.voters.total, faUsers, "voters"],
    ["Registered parties", data?.parties.total, faFlag, "parties"],
    ["Active elections", data?.elections.active, faVoteYea, "elections"],
    ["Upcoming elections", data?.elections.upcoming, faCalendarDays, "elections"],
  ];
  return <div className="admin-dashboard" aria-busy={loading}>
    <div className="section-heading">
      <div><span className="panel-kicker">Election administration</span><h2>Overview</h2></div>
      <button className="secondary-button" disabled={loading} onClick={() => { setLoading(true); setRevision(value => value + 1); }}>Refresh</button>
    </div>
    {error && <p className="notice error" role="alert">{error}</p>}
    {loading && <p className="muted" role="status">Loading dashboard…</p>}
    <section className="dashboard-metrics" aria-label="Election overview">
      {metrics.map(([label, value, icon, page]) => <button className="metric-card dashboard-metric" key={label} onClick={() => onNavigate(page)}>
        <span className="dashboard-metric-heading"><span className="metric-label">{label}</span><FontAwesomeIcon icon={icon} aria-hidden="true" /></span>
        <strong>{loading || error ? "—" : value}</strong>
        <span className="dashboard-metric-link">View {page === "voters" ? "voter list" : page}<FontAwesomeIcon icon={faArrowRight} aria-hidden="true" /></span>
      </button>)}
    </section>
    <div className="dashboard-panels">
      <section className="panel" aria-labelledby="review-heading">
        <h2 id="review-heading">Registration overview</h2>
        <dl className="dashboard-review">
          {[
            ["Voters awaiting approval", data?.voters.pendingApproval],
            ["Voters awaiting activation", data?.voters.pendingActivation],
            ["Approved voters", data?.voters.approved],
            ["Submitted party rosters", data?.parties.submitted],
            ["Completed elections", data?.elections.ended],
          ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{loading || error ? "—" : value}</dd></div>)}
        </dl>
        <button className="secondary-button" onClick={() => onNavigate("voters")}>Open voter list</button>
      </section>
      <section className="panel" aria-labelledby="actions-heading">
        <h2 id="actions-heading">Quick actions</h2>
        <div className="dashboard-actions">
          {[
            ["registerVoter", "Register voter", "Enroll a voter and issue an activation link."],
            ["parties", "Manage parties", "Register, edit, or delete a political party."],
            ["create", "Create election", "Prepare a ballot from submitted party rosters."],
            ["audit", "View audit log", "Review administrative activity."],
          ].map(([page, label, description]) => <button key={page} className="dashboard-action" onClick={() => onNavigate(page)}>
            <span><strong>{label}</strong><small>{description}</small></span><FontAwesomeIcon icon={faArrowRight} aria-hidden="true" />
          </button>)}
        </div>
      </section>
    </div>
  </div>;
}
