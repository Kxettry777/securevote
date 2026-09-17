import { useEffect, useState } from "react";
import { api, ApiError } from "./api";
import { PartyMark, PartyRoster } from "./ElectionPresentation";
import { RegisteredPartyCard } from "./RegisteredPartyCard";
import { ElectionSymbolPicker } from "./ElectionSymbolPicker";
import { ConfirmDialog } from "./ConfirmDialog";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFlag, faMagnifyingGlass, faPlus, faRotateRight } from "@fortawesome/free-solid-svg-icons";
function PartyForm({ party, busy, save, cancel, token, onSessionEnd }) {
    const [symbolChoice, setSymbolChoice] = useState(party?.symbolImage ? "current" : "");
    const [error, setError] = useState("");
    async function submit(event) {
        event.preventDefault();
        if (!symbolChoice) {
            setError("Choose an election symbol before saving.");
            return;
        }
        const fields = Object.fromEntries(new FormData(event.currentTarget));
        delete fields.symbolChoice;
        const symbol = symbolChoice === "current" && party ? { symbol: party.symbol } : { symbolId: symbolChoice };
        if (await save(`/registry/parties${party ? `/${party.id}` : ""}`, party ? "PATCH" : "POST", { ...fields, ...symbol }, party ? "Party details saved. The party must resubmit its roster." : "Party registered. The party can now sign in with the email and password you provided."))
            cancel();
    }
    return <section className="panel"><div className="section-heading"><h2>{party ? "Edit political party" : "Register a political party"}</h2><button className="text-button" disabled={busy} onClick={cancel}>Cancel</button></div>
    <form className="election-form" onSubmit={submit}><fieldset disabled={busy}>
      <div className="form-columns"><label>Party name<input name="name" required minLength={2} maxLength={120} defaultValue={party?.name}/></label><label>Abbreviation<input name="shortName" maxLength={16} defaultValue={party?.shortName}/></label></div>
      <ElectionSymbolPicker token={token} party={party} value={symbolChoice} onChange={id => { setSymbolChoice(id); setError(""); }} onSessionEnd={onSessionEnd}/>
      <label>Party manifesto<textarea name="manifesto" rows={3} maxLength={4000} defaultValue={party?.manifesto}/></label>
      {!party && <><h3>Party sign-in account</h3><p className="muted">Give these credentials to the party representative. They will sign in to nominate and submit their own candidates.</p><div className="form-columns"><label>Party email<input name="email" type="email" autoComplete="off" required maxLength={254}/></label><label>Initial password<input name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={72}/></label></div></>}
      {error && <p className="notice error" role="alert">{error}</p>}
      <button className="primary-button" type="submit">{busy ? "Saving..." : party ? "Save party" : "Register party and account"}</button>
    </fieldset></form></section>;
}
export function Registry({ token, admin, page, onSessionEnd }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");
    const [revision, setRevision] = useState(0);
    const [editingParty, setEditingParty] = useState(null);
    const [deletingParty, setDeletingParty] = useState(null);
    const [editingRole, setEditingRole] = useState(null);
    const [editingCandidate, setEditingCandidate] = useState(null);
    const [selectedPartyId, setSelectedPartyId] = useState("");
    const [search, setSearch] = useState("");
    useEffect(() => {
        let active = true;
        api("/registry", {}, token).then(result => { if (active) {
            setData(result);
            setError("");
        } }).catch(err => {
            if (!active)
                return;
            if (err instanceof ApiError && err.status === 401)
                onSessionEnd(err.message);
            else
                setError(err.message);
        }).finally(() => { if (active)
            setLoading(false); });
        return () => { active = false; };
    }, [token, revision, onSessionEnd]);
    const save = async (path, method, body, success) => {
        setBusy(true);
        setError("");
        setMessage("");
        try {
            await api(path, { method, body: body ? JSON.stringify(body) : undefined }, token);
            setData(await api("/registry", {}, token));
            setMessage(success);
            return true;
        }
        catch (err) {
            if (err instanceof ApiError && err.status === 401)
                onSessionEnd(err.message);
            else
                setError(err instanceof Error ? err.message : "The change could not be saved.");
            return false;
        }
        finally {
            setBusy(false);
        }
    };
    async function deleteParty() {
        setBusy(true); setError(""); setMessage("");
        try {
            const result = await api(`/registry/parties/${deletingParty.id}`, { method: "DELETE", body: JSON.stringify({ confirmation: "DELETE" }) }, token);
            const id = deletingParty.id;
            setData(current => ({
                ...current,
                parties: current.parties.filter(party => party.id !== id),
                roles: current.roles.filter(role => role.partyId !== id),
                candidates: current.candidates.filter(candidate => candidate.partyId !== id),
            }));
            if (editingParty?.id === id) setEditingParty(null);
            setDeletingParty(null);
            setMessage(result.message);
        } catch (err) {
            if (err instanceof ApiError && (err.status === 401 || err.status === 403)) onSessionEnd(err.message);
            else setError(err instanceof Error ? err.message : "The party could not be deleted.");
        } finally { setBusy(false); }
    }
    const ownParty = !admin ? data?.parties[0] : undefined;
    const roleParty = admin ? data?.parties.find(p => p.id === selectedPartyId) ?? data?.parties[0] : ownParty;
    const partyRoles = roleParty?.roles ?? [];
    const role = editingRole && editingRole !== "new" ? editingRole : undefined;
    const nominee = editingCandidate && "fullName" in editingCandidate ? editingCandidate : undefined;
    const candidateRole = nominee ? data?.roles.find(item => item.id === nominee.roleId) : editingCandidate;
    const filtered = data?.parties.filter(party => `${party.name} ${party.shortName}`.toLowerCase().includes(search.trim().toLowerCase())) ?? [];
    const refreshButton = <button className="secondary-button" disabled={busy || loading} onClick={() => { setLoading(true); setRevision(v => v + 1); }}><FontAwesomeIcon icon={faRotateRight} aria-hidden="true"/>Refresh</button>;
    return <div className="election-workspace">
    {error && <p className="notice error" role="alert">{error}</p>}{error && !data && <div className="button-row">{refreshButton}</div>}{message && <p className="notice success" role="status">{message}</p>}
    {loading ? <p className="empty-state" role="status">Loading registry...</p> : data && <>
      {page === "parties" && <>
        {admin && editingParty && <PartyForm token={token} onSessionEnd={onSessionEnd} key={typeof editingParty === "string" ? editingParty : editingParty.id} party={editingParty === "new" ? undefined : editingParty} busy={busy} save={save} cancel={() => setEditingParty(null)}/>}
        <section className="panel party-directory" aria-labelledby="party-directory-heading">
          <div className="section-heading party-directory-heading">
            <div className="party-directory-title">
              <span className="party-directory-icon" aria-hidden="true"><FontAwesomeIcon icon={faFlag}/></span>
              <h2 id="party-directory-heading">{admin ? "Registered parties" : "My party"}</h2>
              {admin && <span className="party-directory-count">{data.parties.length}</span>}
            </div>
            <div className="button-row">{refreshButton}{admin && !editingParty && <button className="primary-button" onClick={() => setEditingParty("new")}><FontAwesomeIcon icon={faPlus} aria-hidden="true"/>Register party</button>}</div>
          </div>
          {admin && <div className="party-directory-toolbar">
            <label className="party-directory-search"><span className="sr-only">Search parties</span><FontAwesomeIcon icon={faMagnifyingGlass} aria-hidden="true"/><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search by party name or abbreviation"/></label>
            <span className="party-directory-results" role="status">{search.trim() ? `${filtered.length} of ${data.parties.length} parties` : `${data.parties.length} ${data.parties.length === 1 ? "party" : "parties"} registered`}</span>
          </div>}
          {filtered.length ? <div className="registered-party-list">{filtered.map(party => <RegisteredPartyCard key={party.id} party={party} busy={busy} onEdit={admin ? () => setEditingParty(party) : undefined} onDelete={admin ? () => { setError(""); setDeletingParty(party); } : undefined}/>)}</div> : <div className="empty-state"><h3>{search ? "No matching parties" : "No parties registered"}</h3><p>{search ? "Try a different party name or abbreviation." : "Register the first party and create its sign-in account to begin."}</p>{search && <button className="secondary-button" onClick={() => setSearch("")}>Clear search</button>}</div>}
        </section>
      </>}
      {page === "roles" && <>
        {admin && <section className="panel"><label className="registry-search">Political party<select value={roleParty?.id ?? ""} disabled={busy || !data.parties.length} onChange={event => { setSelectedPartyId(event.target.value); setEditingRole(null); }}>{!data.parties.length && <option value="">Register a political party first</option>}{data.parties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><p className="muted">Roles and hierarchy ranks belong to the selected party. Other parties can use different positions.</p></section>}
        {admin && editingRole && roleParty && <section className="panel"><h2>{role ? "Edit candidate role" : "Add candidate role"}</h2><form className="election-form" key={role?.id ?? "new"} onSubmit={async (event) => {
                        event.preventDefault();
                        const fields = new FormData(event.currentTarget);
                        if (await save(`/registry/roles${role ? `/${role.id}` : ""}`, role ? "PATCH" : "POST", { partyId: roleParty.id, name: fields.get("name"), rank: Number(fields.get("rank")) }, "Role saved. This party must review and resubmit its roster."))
                            setEditingRole(null);
                    }}><fieldset disabled={busy}><div className="form-columns"><label>Position name<input name="name" required minLength={2} maxLength={80} defaultValue={role?.name} placeholder="e.g. Treasurer"/></label><label>Hierarchy rank<input name="rank" type="number" required min={1} max={100} step={1} defaultValue={role?.rank ?? Math.min(100, Math.max(0, ...partyRoles.map(r => r.rank)) + 1)}/></label></div><p className="notice">Changing roles requires only this party to resubmit its roster. Existing elections keep their saved positions.</p><div className="button-row"><button className="primary-button" type="submit">Save role</button><button className="secondary-button" type="button" onClick={() => setEditingRole(null)}>Cancel</button></div></fieldset></form></section>}
        <section className="panel"><div className="section-heading"><h2>{roleParty ? `${roleParty.name}: candidate roles` : "Candidate role hierarchy"}</h2><div className="button-row">{refreshButton}{admin && roleParty && !editingRole && <button className="primary-button" onClick={() => setEditingRole("new")}>Add role</button>}</div></div><ol className="role-hierarchy">{partyRoles.map(item => <li key={item.id}><span className="rank-marker">{item.rank}</span><div><h3>{item.name}</h3><p className="muted">One nomination for this position</p></div>{admin && <button className="secondary-button" disabled={busy} onClick={() => setEditingRole(item)}>Edit</button>}</li>)}</ol></section>
      </>}
      {page === "candidates" && (admin ? <section className="panel"><div className="section-heading"><h2>Party nominations</h2>{refreshButton}</div>{data.parties.length ? <div className="party-grid">{data.parties.map(party => <article className="party-card" key={party.id}><div className="party-card-heading"><PartyMark party={party}/><h3>{party.name}</h3></div><span className={`status-badge ${party.submittedAt ? "approved" : "awaiting"}`}>{party.submittedAt ? "Submitted" : "Draft roster"}</span><PartyRoster party={{ ...party, roster: party.candidates }}/><p className="muted">{party.candidates.length} of {party.roles.length} positions filled</p></article>)}</div> : <p className="empty-state">Register parties first. Their nominations will appear here.</p>}</section> : ownParty && <>
        <section className="panel"><div className="section-heading"><div><h2>My candidates</h2><p className="muted">{ownParty.candidates.length} of {ownParty.roles.length} positions filled</p></div><div className="button-row">{refreshButton}<span className={`status-badge ${ownParty.submittedAt ? "approved" : "awaiting"}`}>{ownParty.submittedAt ? "Submitted" : "Draft roster"}</span></div></div><p className="notice">Changes apply to future elections and return your roster to draft. Existing election ballots keep the candidates saved when the election was created.</p>
          <ol className="role-hierarchy">{partyRoles.map(item => {
                    const candidate = ownParty.candidates.find(c => c.roleId === item.id);
                    return <li key={item.id}><span className="rank-marker">{item.rank}</span><div><span className="panel-kicker">{item.name}</span><h3>{candidate?.fullName ?? "Candidate not nominated"}</h3>{candidate?.biography && <p className="preserve-lines">{candidate.biography}</p>}</div><div className="button-row"><button className="secondary-button" disabled={busy} onClick={() => setEditingCandidate(candidate ?? item)}>{candidate ? "Edit" : "Nominate"}</button>{candidate && <button className="text-button danger" disabled={busy} onClick={() => { if (window.confirm(`Remove ${candidate.fullName} from your future roster?`))
                        void save(`/registry/candidates/${candidate.id}`, "DELETE", undefined, "Candidate removed. Submit the roster again when complete."); }}>Remove</button>}</div></li>;
                })}</ol><button className="primary-button" disabled={busy || Boolean(editingCandidate) || Boolean(ownParty.submittedAt) || !ownParty.roles.length || ownParty.candidates.length !== ownParty.roles.length} onClick={() => { void save("/registry/submit", "POST", {}, "Roster submitted. The admin can now include your party in an election."); }}>{ownParty.submittedAt ? "Roster submitted" : "Submit candidate roster"}</button>
        </section>
        {editingCandidate && candidateRole && <section className="panel"><h2>Nominate {candidateRole.name}</h2><form className="election-form" key={editingCandidate.id} onSubmit={async (event) => {
                        event.preventDefault();
                        const fields = new FormData(event.currentTarget);
                        if (await save(`/registry/candidates${nominee ? `/${nominee.id}` : ""}`, nominee ? "PATCH" : "POST", { partyId: ownParty.id, roleId: candidateRole.id, fullName: fields.get("fullName"), biography: fields.get("biography") }, "Nomination saved. Submit the roster when all positions are filled."))
                            setEditingCandidate(null);
                    }}><fieldset disabled={busy}><label>Candidate full name<input name="fullName" autoFocus required minLength={2} maxLength={120} defaultValue={nominee?.fullName}/></label><label>Candidate statement<textarea name="biography" maxLength={4000} rows={3} defaultValue={nominee?.biography}/></label><div className="button-row"><button className="primary-button" type="submit">Save nomination</button><button className="secondary-button" type="button" onClick={() => setEditingCandidate(null)}>Cancel</button></div></fieldset></form></section>}
      </>)}
    </>}
    {admin && deletingParty && <ConfirmDialog title={`Delete ${deletingParty.name}?`} action="Delete party" permanent busy={busy} onConfirm={() => { void deleteParty(); }} onCancel={() => { setDeletingParty(null); setError(""); }}>
      <p>This removes the party from the registry and disables its sign-in account. Existing election ballots and results are preserved.</p>
      <p>The party name and account email remain reserved in the election history.</p>
      {error && <p className="notice error" role="alert">{error}</p>}
    </ConfirmDialog>}
  </div>;
}
