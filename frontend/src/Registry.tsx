import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api, ApiError } from "./api";
import type { CandidateRole, RegisteredCandidate, RegisteredParty, RegistryData } from "./api";
import { PartyMark, PartyRoster } from "./ElectionPresentation";

export type RegistryPage = "parties" | "roles" | "candidates";
type Props = { token: string; admin: boolean; page: RegistryPage; onSessionEnd: (message: string) => void };
type Save = (path: string, method: string, body: object | undefined, message: string) => Promise<boolean>;

function PartyForm({ party, busy, save, cancel }: { party?: RegisteredParty; busy: boolean; save: Save; cancel: () => void }) {
  const [image, setImage] = useState("");
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (reading || (!party && !image) || error) return;
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    delete fields.symbolFile;
    if (await save(`/registry/parties${party ? `/${party.id}` : ""}`, party ? "PATCH" : "POST", { ...fields, ...(image ? { symbolImage: image } : {}) }, party ? "Party details saved. The party must resubmit its roster." : "Party registered. The party can now sign in with the email and password you provided.")) cancel();
  }
  return <section className="panel"><div className="section-heading"><h2>{party ? "Edit political party" : "Register a political party"}</h2><button className="text-button" disabled={busy || reading} onClick={cancel}>Cancel</button></div>
    <form className="election-form" onSubmit={submit}><fieldset disabled={busy || reading}>
      <label>Party name<input name="name" required minLength={2} maxLength={120} defaultValue={party?.name} /></label>
      <div className="form-columns"><label>Abbreviation<input name="shortName" maxLength={16} defaultValue={party?.shortName} /></label><label>Election symbol name<input name="symbol" required maxLength={60} defaultValue={party?.symbol} placeholder="e.g. Sun" /></label></div>
      <label>Election symbol image<input name="symbolFile" type="file" required={!party} accept="image/png,image/jpeg,image/webp" onChange={event => {
        const file = event.target.files?.[0]; setError(""); setImage("");
        if (!file) return;
        if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 4 * 1024 * 1024) { setError("Choose a PNG, JPEG, or WebP image up to 4 MB."); return; }
        setReading(true);
        const reader = new FileReader();
        reader.onload = () => { setImage(String(reader.result)); setReading(false); };
        reader.onerror = () => { setError("The image could not be read. Please choose it again."); setReading(false); };
        reader.readAsDataURL(file);
      }} /></label><small>PNG, JPEG, or WebP, up to 4 MB. This symbol appears on the ballot.</small>
      {(image || party?.symbolImage) && <img className="symbol-preview" src={image || party?.symbolImage || ""} alt="Election symbol preview" />}
      <label>Party manifesto<textarea name="manifesto" rows={3} maxLength={4000} defaultValue={party?.manifesto} /></label>
      {!party && <><h3>Party sign-in account</h3><p className="muted">Give these credentials to the party representative. They will sign in to nominate and submit their own candidates.</p><div className="form-columns"><label>Party email<input name="email" type="email" autoComplete="off" required maxLength={254} /></label><label>Initial password<input name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={72} /></label></div></>}
      {error && <p className="notice error" role="alert">{error}</p>}
      <button className="primary-button" disabled={Boolean(error)} type="submit">{busy ? "Saving..." : party ? "Save party" : "Register party and account"}</button>
    </fieldset></form></section>;
}

export function Registry({ token, admin, page, onSessionEnd }: Props) {
  const [data, setData] = useState<RegistryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [revision, setRevision] = useState(0);
  const [editingParty, setEditingParty] = useState<RegisteredParty | "new" | null>(null);
  const [editingRole, setEditingRole] = useState<CandidateRole | "new" | null>(null);
  const [editingCandidate, setEditingCandidate] = useState<RegisteredCandidate | CandidateRole | null>(null);
  const [selectedPartyId, setSelectedPartyId] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    let active = true;
    api<RegistryData>("/registry", {}, token).then(result => { if (active) { setData(result); setError(""); } }).catch(err => {
      if (!active) return;
      if (err instanceof ApiError && err.status === 401) onSessionEnd(err.message);
      else setError(err.message);
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token, revision, onSessionEnd]);
  const save: Save = async (path, method, body, success) => {
    setBusy(true); setError(""); setMessage("");
    try {
      await api(path, { method, body: body ? JSON.stringify(body) : undefined }, token);
      setData(await api<RegistryData>("/registry", {}, token)); setMessage(success); return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) onSessionEnd(err.message);
      else setError(err instanceof Error ? err.message : "The change could not be saved.");
      return false;
    } finally { setBusy(false); }
  };
  const ownParty = !admin ? data?.parties[0] : undefined;
  const roleParty = admin ? data?.parties.find(p => p.id === selectedPartyId) ?? data?.parties[0] : ownParty;
  const partyRoles = roleParty?.roles ?? [];
  const role = editingRole && editingRole !== "new" ? editingRole : undefined;
  const nominee = editingCandidate && "fullName" in editingCandidate ? editingCandidate : undefined;
  const candidateRole = nominee ? data?.roles.find(item => item.id === nominee.roleId) : editingCandidate as CandidateRole | null;
  const filtered = data?.parties.filter(party => `${party.name} ${party.shortName}`.toLowerCase().includes(search.trim().toLowerCase())) ?? [];
  return <div className="election-workspace">
    <section className="welcome-panel"><div><span className="panel-kicker">{admin ? "Election preparation" : "Party workspace"}</span><h2>{page === "parties" ? admin ? "Register parties before the election." : "Your party, ready to participate." : page === "roles" ? "Define the positions on each party slate." : admin ? "Review the candidates nominated by each party." : "Build your party’s candidate roster."}</h2><p>{page === "parties" ? "The admin registers each party and its symbol. Party representatives sign in, nominate candidates, and submit a complete roster." : page === "roles" ? admin ? "Choose a party to manage its positions. A lower rank appears first, and each position needs one nominee." : "These are the positions configured for your party. Nominate one candidate for each position from My candidates." : admin ? "Submitted rosters are available when you create an election. Candidate nominations are managed by the parties themselves." : "Fill every position, then submit your roster to the election administrator. Votes are cast for your party’s full slate."}</p></div></section>
    {error && <p className="notice error" role="alert">{error}</p>}{message && <p className="notice success" role="status">{message}</p>}
    <div className="section-heading"><p className="muted">{admin ? "Parties → Candidate rosters → Election preparation" : ownParty?.name}</p><button className="secondary-button" disabled={busy || loading} onClick={() => { setLoading(true); setRevision(v => v + 1); }}>Refresh</button></div>
    {loading ? <p className="empty-state" role="status">Loading registry...</p> : data && <>
      {page === "parties" && <>
        {admin && editingParty && <PartyForm key={typeof editingParty === "string" ? editingParty : editingParty.id} party={editingParty === "new" ? undefined : editingParty} busy={busy} save={save} cancel={() => setEditingParty(null)} />}
        <section className="panel"><div className="section-heading"><h2>{admin ? "Registered parties" : "My party"} <span className="count-label">{data.parties.length}</span></h2>{admin && !editingParty && <button className="primary-button" onClick={() => setEditingParty("new")}>Register party</button>}</div>
          {admin && <label className="registry-search">Search parties<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Party name or abbreviation" /></label>}
          {filtered.length ? <div className="party-grid">{filtered.map(party => <article className="party-card" key={party.id}><div className="party-card-heading"><PartyMark party={party} /><div><h3>{party.name}</h3><span className="party-abbreviation">{party.shortName}</span></div></div><span className={`status-badge ${party.submittedAt ? "approved" : "awaiting"}`}>{party.submittedAt ? "Roster submitted" : "Awaiting nominations"}</span><p><strong>Symbol:</strong> {party.symbol}</p><p className="preserve-lines">{party.manifesto || "No manifesto provided."}</p><p className="muted">{party.accountEmail}<br />{party.candidates.length} of {party.roles.length} positions filled</p>{admin && <button className="secondary-button" disabled={busy} onClick={() => setEditingParty(party)}>Edit party</button>}</article>)}</div> : <p className="empty-state">{search ? "No matching parties." : "Register the first party and create its sign-in account to begin."}</p>}
        </section>
      </>}
      {page === "roles" && <>
        {admin && <section className="panel"><label className="registry-search">Political party<select value={roleParty?.id ?? ""} disabled={busy || !data.parties.length} onChange={event => { setSelectedPartyId(event.target.value); setEditingRole(null); }}>{!data.parties.length && <option value="">Register a political party first</option>}{data.parties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><p className="muted">Roles and hierarchy ranks belong to the selected party. Other parties can use different positions.</p></section>}
        {admin && editingRole && roleParty && <section className="panel"><h2>{role ? "Edit candidate role" : "Add candidate role"}</h2><form className="election-form" key={role?.id ?? "new"} onSubmit={async event => {
          event.preventDefault(); const fields = new FormData(event.currentTarget);
          if (await save(`/registry/roles${role ? `/${role.id}` : ""}`, role ? "PATCH" : "POST", { partyId: roleParty.id, name: fields.get("name"), rank: Number(fields.get("rank")) }, "Role saved. This party must review and resubmit its roster.")) setEditingRole(null);
        }}><fieldset disabled={busy}><div className="form-columns"><label>Position name<input name="name" required minLength={2} maxLength={80} defaultValue={role?.name} placeholder="e.g. Treasurer" /></label><label>Hierarchy rank<input name="rank" type="number" required min={1} max={100} step={1} defaultValue={role?.rank ?? Math.min(100, Math.max(0, ...partyRoles.map(r => r.rank)) + 1)} /></label></div><p className="notice">Changing roles requires only this party to resubmit its roster. Existing elections keep their saved positions.</p><div className="button-row"><button className="primary-button" type="submit">Save role</button><button className="secondary-button" type="button" onClick={() => setEditingRole(null)}>Cancel</button></div></fieldset></form></section>}
        <section className="panel"><div className="section-heading"><h2>{roleParty ? `${roleParty.name}: candidate roles` : "Candidate role hierarchy"}</h2>{admin && roleParty && !editingRole && <button className="primary-button" onClick={() => setEditingRole("new")}>Add role</button>}</div><ol className="role-hierarchy">{partyRoles.map(item => <li key={item.id}><span className="rank-marker">{item.rank}</span><div><h3>{item.name}</h3><p className="muted">One nomination for this position</p></div>{admin && <button className="secondary-button" disabled={busy} onClick={() => setEditingRole(item)}>Edit</button>}</li>)}</ol></section>
      </>}
      {page === "candidates" && (admin ? <section className="panel"><h2>Party nominations</h2>{data.parties.length ? <div className="party-grid">{data.parties.map(party => <article className="party-card" key={party.id}><div className="party-card-heading"><PartyMark party={party} /><h3>{party.name}</h3></div><span className={`status-badge ${party.submittedAt ? "approved" : "awaiting"}`}>{party.submittedAt ? "Submitted" : "Draft roster"}</span><PartyRoster party={{ ...party, roster: party.candidates }} /><p className="muted">{party.candidates.length} of {party.roles.length} positions filled</p></article>)}</div> : <p className="empty-state">Register parties first. Their nominations will appear here.</p>}</section> : ownParty && <>
        <section className="panel"><div className="section-heading"><div><h2>My candidates</h2><p className="muted">{ownParty.candidates.length} of {ownParty.roles.length} positions filled</p></div><span className={`status-badge ${ownParty.submittedAt ? "approved" : "awaiting"}`}>{ownParty.submittedAt ? "Submitted" : "Draft roster"}</span></div><p className="notice">Changes apply to future elections and return your roster to draft. Existing election ballots keep the candidates saved when the election was created.</p>
          <ol className="role-hierarchy">{partyRoles.map(item => {
            const candidate = ownParty.candidates.find(c => c.roleId === item.id);
            return <li key={item.id}><span className="rank-marker">{item.rank}</span><div><span className="panel-kicker">{item.name}</span><h3>{candidate?.fullName ?? "Candidate not nominated"}</h3>{candidate?.biography && <p className="preserve-lines">{candidate.biography}</p>}</div><div className="button-row"><button className="secondary-button" disabled={busy} onClick={() => setEditingCandidate(candidate ?? item)}>{candidate ? "Edit" : "Nominate"}</button>{candidate && <button className="text-button danger" disabled={busy} onClick={() => { if (window.confirm(`Remove ${candidate.fullName} from your future roster?`)) void save(`/registry/candidates/${candidate.id}`, "DELETE", undefined, "Candidate removed. Submit the roster again when complete."); }}>Remove</button>}</div></li>;
          })}</ol><button className="primary-button" disabled={busy || Boolean(editingCandidate) || Boolean(ownParty.submittedAt) || !ownParty.roles.length || ownParty.candidates.length !== ownParty.roles.length} onClick={() => { void save("/registry/submit", "POST", {}, "Roster submitted. The admin can now include your party in an election."); }}>{ownParty.submittedAt ? "Roster submitted" : "Submit candidate roster"}</button>
        </section>
        {editingCandidate && candidateRole && <section className="panel"><h2>Nominate {candidateRole.name}</h2><form className="election-form" key={editingCandidate.id} onSubmit={async event => {
          event.preventDefault(); const fields = new FormData(event.currentTarget);
          if (await save(`/registry/candidates${nominee ? `/${nominee.id}` : ""}`, nominee ? "PATCH" : "POST", { partyId: ownParty.id, roleId: candidateRole.id, fullName: fields.get("fullName"), biography: fields.get("biography") }, "Nomination saved. Submit the roster when all positions are filled.")) setEditingCandidate(null);
        }}><fieldset disabled={busy}><label>Candidate full name<input name="fullName" autoFocus required minLength={2} maxLength={120} defaultValue={nominee?.fullName} /></label><label>Candidate statement<textarea name="biography" maxLength={4000} rows={3} defaultValue={nominee?.biography} /></label><div className="button-row"><button className="primary-button" type="submit">Save nomination</button><button className="secondary-button" type="button" onClick={() => setEditingCandidate(null)}>Cancel</button></div></fieldset></form></section>}
      </>)}
    </>}
  </div>;
}
