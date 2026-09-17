import { useEffect, useState } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { api, ApiError } from "./api";
const actions = { election_deleted: "Election permanently deleted", party_registration_deleted: "Party registration deleted", election_removed: "Election removed", election_restored: "Election restored", voter_registered_by_admin: "Voter enrolled by commission", voter_activation_reissued: "Activation link replaced", voter_activated: "Voter activated account", party_registered: "Party and account registered", party_registration_updated: "Party registration updated", candidate_role_created: "Candidate role created", candidate_role_updated: "Candidate role updated", candidate_registered: "Candidate nominated", registered_candidate_updated: "Nomination updated", registered_candidate_removed: "Nomination removed", party_roster_submitted: "Party roster submitted", election_banner_updated: "Election banner updated", election_banner_removed: "Election banner removed", election_created: "Election created", election_updated: "Election updated", candidate_added: "Party registered", candidate_updated: "Party updated", candidate_removed: "Party removed", voter_assigned: "Voter assigned", voter_unassigned: "Voter assignment removed", voter_approved: "Voter approved", voter_revoked: "Voter approval revoked" };
export function AuditLog({ token, onSessionEnd }) {
    const [data, setData] = useState(null);
    const [cursor, setCursor] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");
    const [busy, setBusy] = useState(false);
    const [removing, setRemoving] = useState(null);
    const [revision, setRevision] = useState(0);
    useEffect(() => {
        let mounted = true;
        api(`/admin/audit${cursor ? `?before=${cursor}` : ""}`, {}, token).then(page => { if (mounted) {
            setData(page);
            setError("");
        } })
            .catch(err => { if (!mounted)
            return; setData(null); if (err instanceof ApiError && (err.status === 401 || err.status === 403))
            onSessionEnd(err.message);
        else
            setError(err.message); })
            .finally(() => { if (mounted)
            setLoading(false); });
        return () => { mounted = false; };
    }, [cursor, revision, token, onSessionEnd]);
    function refresh() { setLoading(true); setCursor(""); setRevision(value => value + 1); }
    async function remove() {
        if (!removing)
            return;
        setBusy(true);
        setError("");
        setMessage("");
        try {
            const result = await api(`/admin/audit${removing.entry ? `/${removing.entry.id}` : ""}`, { method: "DELETE", body: JSON.stringify({ confirmation: "DELETE", throughId: removing.throughId }) }, token);
            setRemoving(null);
            setMessage(`${result.deleted} audit ${result.deleted === 1 ? "entry" : "entries"} deleted.`);
            refresh();
        }
        catch (err) {
            if (err instanceof ApiError && (err.status === 401 || err.status === 403))
                onSessionEnd(err.message);
            else
                setError(err instanceof Error ? err.message : "Audit deletion failed.");
        }
        finally {
            setBusy(false);
        }
    }
    return <div className="election-workspace">
    {removing && <ConfirmDialog title={removing.entry ? "Delete audit entry?" : "Clear audit history?"} permanent busy={busy} action={removing.entry ? "Delete entry" : "Clear history"} onCancel={() => { setRemoving(null); setError(""); }} onConfirm={() => { void remove(); }}>
      <p>{removing.entry ? `Permanently delete "${actions[removing.entry.action] ?? removing.entry.action}" from ${new Date(removing.entry.createdAt).toLocaleString()}?` : "Permanently delete all audit entries recorded up to your last refresh, including entries on other pages? Newer activity will be kept."}</p><p>This cannot be undone. Election results and blockchain records are unaffected.</p>{error && <p className="notice error" role="alert">{error}</p>}
    </ConfirmDialog>}
    <section className="panel"><div className="section-heading"><h2>Audit log</h2><div className="button-row"><button className="secondary-button" disabled={loading || busy} onClick={refresh}>Latest activity</button><button className="text-button danger" disabled={loading || busy || !data?.latestId} onClick={() => { setError(""); setRemoving({ throughId: data.latestId }); }}>Clear audit history</button></div></div>
      <p className="muted">Times are shown in your local time zone. Ballot receipts and result verification are available within each ended election.</p>
      {error && !removing && <p className="notice error" role="alert">{error}</p>}{message && <p className="notice success" role="status">{message}</p>}
      {loading ? <p role="status">Loading activity...</p> : data?.entries.length ? <><div className="table-scroll" tabIndex={0} role="region" aria-label="Audit entries"><table><thead><tr><th scope="col">When</th><th scope="col">Action</th><th scope="col">Account</th><th scope="col">Election / reference</th><th scope="col">Manage</th></tr></thead><tbody>{data.entries.map(entry => <tr key={entry.id}><td>{new Date(entry.createdAt).toLocaleString()}</td><td>{actions[entry.action] ?? entry.action}</td><td>{entry.actorName}</td><td><strong>{entry.electionTitle ?? "Registry / account"}</strong><span className="voter-email">{entry.targetId}</span></td><td><button className="text-button danger" disabled={busy} aria-label={`Delete audit entry ${entry.id}`} onClick={() => { setError(""); setRemoving({ entry }); }}>Delete</button></td></tr>)}</tbody></table></div>{data.nextCursor && <button className="secondary-button" disabled={busy} onClick={() => { setLoading(true); setCursor(data.nextCursor); }}>Older activity</button>}</> : !error && <p className="empty-state">No audit entries to display. New activity will appear here.</p>}
    </section></div>;
}
