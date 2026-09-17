import { useCallback, useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { api, ApiError } from "./api";
import { Ballot, Results } from "./Voting";
import { BannerEditor, ElectionBanner, ElectionCountdown, PartyMark, PartyRoster } from "./ElectionPresentation";
import { electionPhase } from "./electionTime";
const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const dateLabel = (value) => new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
function localInput(value) {
    if (!value)
        return "";
    const date = new Date(value);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function statusAt(election, now) {
    return electionPhase(election.startsAt, election.endsAt, now);
}
function ScheduleForm({ election, parties = [], busy, save }) {
    async function submit(event) {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        await save({ title: fields.get("title"), description: fields.get("description"),
            startsAt: new Date(String(fields.get("startsAt"))).toISOString(),
            endsAt: new Date(String(fields.get("endsAt"))).toISOString(),
            ...(!election ? { partyIds: fields.getAll("partyIds") } : {}) });
    }
    return <form className="election-form" onSubmit={submit}><fieldset disabled={busy}>
    {!election && <div className="party-selection"><h3>Participating parties</h3><p className="muted">Select at least two submitted rosters. Each ballot choice represents a party's complete candidate slate. Names, symbols, and candidates are saved with this election.</p>{parties.map(party => <label className="party-choice" key={party.id}><input type="checkbox" name="partyIds" value={party.id} disabled={!party.submittedAt} defaultChecked={Boolean(party.submittedAt)}/><PartyMark party={party}/><span><strong>{party.name}</strong><small>{party.submittedAt ? `${party.candidates.length} candidates - Submitted` : "Waiting for the party to submit its roster"}</small></span></label>)}{!parties.length && <p className="notice">Register parties from the sidebar, then have them sign in and submit their candidates.</p>}</div>}
    <label>Election title<input name="title" required minLength={3} maxLength={120} defaultValue={election?.title} placeholder="Political party election"/></label>
    <label>Description<textarea name="description" maxLength={4000} rows={3} defaultValue={election?.description} placeholder="What is this election for?"/></label>
    <div className="form-columns"><label>Starts at<input name="startsAt" type="datetime-local" required defaultValue={localInput(election?.startsAt)}/></label><label>Ends at<input name="endsAt" type="datetime-local" required defaultValue={localInput(election?.endsAt)}/></label></div>
    <p className="muted">Times are shown in {zone}. Choose a future start time.</p>
    <button className="primary-button" disabled={!election && parties.filter(p => p.submittedAt).length < 2} type="submit">{busy ? "Saving..." : election ? "Save election details" : "Create election"}</button>
  </fieldset></form>;
}
function ElectionView({ id, token, admin, voter, onSessionEnd, back, onChange, now, syncClock }) {
    const [data, setData] = useState(null);
    const [available, setAvailable] = useState([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");
    const [revision, setRevision] = useState(0);
    const [search, setSearch] = useState("");
    useEffect(() => {
        let active = true;
        Promise.all([api(`/elections/${id}`, {}, token), admin ? api("/admin/voters", {}, token) : Promise.resolve({ voters: [] })])
            .then(([detail, users]) => { if (active) {
            syncClock(detail.election.serverTime);
            setData(detail);
            setAvailable(users.voters);
            setError("");
        } })
            .catch(err => {
            if (!active)
                return;
            setData(null);
            if (err instanceof ApiError && (err.status === 401 || err.status === 403))
                onSessionEnd(err.message);
            else
                setError(err.message);
        }).finally(() => { if (active)
            setLoading(false); });
        return () => { active = false; };
    }, [id, token, admin, revision, onSessionEnd, syncClock]);
    async function mutate(path, method, body, success) {
        setBusy(true);
        setError("");
        setMessage("");
        try {
            await api(path, { method, body: body instanceof File ? body : body === undefined ? undefined : JSON.stringify(body),
                ...(body instanceof File ? { headers: { "Content-Type": body.type } } : {}) }, token);
            const detail = await api(`/elections/${id}`, {}, token);
            syncClock(detail.election.serverTime);
            setData(detail);
            setMessage(success);
            onChange();
            return true;
        }
        catch (err) {
            if (err instanceof ApiError && (err.status === 401 || err.status === 403))
                onSessionEnd(err.message);
            else
                setError(err instanceof Error ? err.message : "Please try again.");
            return false;
        }
        finally {
            setBusy(false);
        }
    }
    const status = data ? statusAt(data.election, now) : "upcoming";
    const editable = admin && status === "upcoming";
    const assigned = new Set(data?.voters?.map(voter => voter.id));
    const choices = available.filter(voter => voter.isApproved && !assigned.has(voter.id));
    const filtered = data?.voters?.filter(voter => `${voter.fullName} ${voter.email}`.toLowerCase().includes(search.toLowerCase().trim())) ?? [];
    return <div className="election-workspace">
    <div className="section-heading"><button className="text-button" disabled={busy} onClick={back}>← All elections</button><button className="secondary-button" disabled={busy || loading} onClick={() => { setLoading(true); setRevision(value => value + 1); }}>Refresh</button></div>
    {error && <p className="notice error" role="alert">{error}</p>}{message && <p className="notice success" role="status">{message}</p>}
    {loading ? <p className="empty-state" role="status">Loading election...</p> : data && <>
      <section className="panel election-summary">{data.election.removedAt && <p className="notice">This election has been removed from participant views. Restore it from Removed elections to make it visible again.</p>}<ElectionBanner election={data.election} token={token}/><div className="election-summary-heading"><div><span className={`status-badge ${status}`}>{status}</span><h2>{data.election.title}</h2></div><ElectionCountdown election={data.election} now={now}/></div><p className="preserve-lines">{data.election.description || "No description provided."}</p><div className="schedule-line"><span><strong>Starts</strong> {dateLabel(data.election.startsAt)}</span><span><strong>Ends</strong> {dateLabel(data.election.endsAt)}</span></div><p className="muted">Times shown in {zone}.</p>
        {admin ? <p className="notice">{editable ? "Party rosters are saved for this election. Assign approved voters and check the schedule before voting starts." : "This election has started. Election details, parties, and assignments are locked."}</p> : <p className="notice">{voter ? status === "upcoming" ? "You are assigned to this election. Voting opens at the scheduled start time." : status === "active" ? "Voting is open. Review the parties and cast your ballot below." : "Voting has ended. View the confirmed results below." : "You can review election details and view results after voting ends."}</p>}
      </section>
      {editable && <details className="panel"><summary>Edit election details</summary><ScheduleForm key={`${data.election.title}:${data.election.description}:${data.election.startsAt}:${data.election.endsAt}`} election={data.election} busy={busy} save={body => mutate(`/elections/${id}`, "PATCH", body, "Election details saved.")}/></details>}
      {editable && <section className="panel"><BannerEditor election={data.election} busy={busy} save={file => mutate(`/elections/${id}/banner`, file ? "PUT" : "DELETE", file ?? undefined, file ? "Election banner saved." : "Election banner removed.")}/></section>}
      {data.parties.length < 2 && status !== "ended" && <p className="notice" role="status">{editable ? "This older election has fewer than two parties. Create a new election from submitted rosters." : status === "upcoming" ? "Party registration is in progress. At least two parties are needed before voting can open." : "Voting is unavailable because fewer than two parties were registered before the election started."}</p>}
      <section className="panel"><div className="section-heading"><div><span className="panel-kicker">Saved ballot</span><h2>Participating parties <span className="count-label">{data.parties.length}</span></h2></div></div>
        {data.parties.length ? <div className="party-grid">{data.parties.map(item => <article className="party-card" key={item.id}><div className="party-card-heading"><PartyMark party={item}/><div><h3>{item.name}</h3>{item.shortName && <span className="party-abbreviation">{item.shortName}</span>}</div></div><p className="party-symbol"><strong>Election symbol:</strong> {item.symbol || "Not recorded"}</p><p className="preserve-lines">{item.manifesto || "No party manifesto provided."}</p><PartyRoster party={item}/></article>)}</div> : <p className="empty-state">This older election has no saved parties. Prepare a new election using submitted party rosters.</p>}
      </section>
      {voter && status !== "upcoming" && <Ballot electionId={id} token={token} onSessionEnd={onSessionEnd} parties={data.parties} active={status === "active"} now={now} election={data.election}/>}
      {status === "ended" && <Results electionId={id} token={token} onSessionEnd={onSessionEnd}/>}
      {admin && <section className="panel"><div className="section-heading"><div><span className="panel-kicker">Election access</span><h2>Assigned voters <span className="count-label">{data.voters?.length ?? 0}</span></h2></div></div>
        {editable && <form className="election-form" onSubmit={async (event) => {
                        event.preventDefault();
                        const form = event.currentTarget;
                        const ok = await mutate(`/elections/${id}/voters`, "POST", { voterId: new FormData(form).get("voterId") }, "Voter assigned.");
                        if (ok)
                            form.reset();
                    }}><fieldset disabled={busy || !choices.length}><label>Approved voter<select name="voterId" required defaultValue=""><option value="" disabled>Select a voter</option>{choices.map(voter => <option key={voter.id} value={voter.id}>{voter.fullName} — {voter.email}</option>)}</select></label><button className="primary-button" type="submit">{busy ? "Saving..." : "Assign voter"}</button></fieldset>{!choices.length && <p className="muted">No unassigned approved voters. Review registrations in Voter management, then refresh this election.</p>}</form>}
        <div className="voter-toolbar assignment-toolbar"><label>Search assigned voters<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Name or email"/></label></div>
        {filtered.length ? <div className="table-scroll" tabIndex={0} role="region" aria-label="Assigned voters"><table><thead><tr><th scope="col">Voter</th><th scope="col">Account status</th>{editable && <th scope="col">Action</th>}</tr></thead><tbody>{filtered.map(voter => <tr key={voter.id}><td><strong>{voter.fullName}</strong><span className="voter-email">{voter.email}</span></td><td><span className={`status-badge ${voter.isApproved ? "approved" : "awaiting"}`}>{voter.isApproved ? "Approved" : "Access revoked"}</span></td>{editable && <td><button className="text-button danger" disabled={busy} onClick={() => { void mutate(`/elections/${id}/voters/${voter.id}`, "DELETE", undefined, "Voter assignment removed."); }} aria-label={`Remove assignment for ${voter.fullName}`}>Remove assignment</button></td>}</tr>)}</tbody></table></div> : <p className="empty-state">{search ? "No matching voters." : "No voters are assigned to this election yet."}</p>}
      </section>}
    </>}
  </div>;
}
export function Elections(props) {
    const { token, admin, voter, onSessionEnd } = props;
    const [showRemoved, setShowRemoved] = useState(false);
    const [removing, setRemoving] = useState(null);
    const [message, setMessage] = useState("");
    const [elections, setElections] = useState([]);
    const [selected, setSelected] = useState(props.initialElectionId ?? "");
    const [creating, setCreating] = useState(Boolean(props.createMode));
    const [registeredParties, setRegisteredParties] = useState([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [revision, setRevision] = useState(0);
    const [initialClock] = useState(() => ({ time: Date.now(), observedAt: performance.now() }));
    const [now, setNow] = useState(initialClock.time);
    const clock = useRef(initialClock);
    const syncClock = useCallback((value) => {
        const time = Date.parse(value);
        if (Number.isFinite(time)) {
            clock.current = { time, observedAt: performance.now() };
            setNow(time);
        }
    }, []);
    useEffect(() => {
        const tick = () => setNow(clock.current.time + performance.now() - clock.current.observedAt);
        const timer = window.setInterval(tick, 1000);
        window.addEventListener("focus", tick);
        return () => { window.clearInterval(timer); window.removeEventListener("focus", tick); };
    }, []);
    useEffect(() => {
        let active = true;
        Promise.all([api(showRemoved ? "/elections?removed=true" : "/elections", {}, token), admin ? api("/registry", {}, token) : Promise.resolve(null)]).then(([result, registry]) => { if (active && registry)
            setRegisteredParties(registry.parties); if (active) {
            if (result.elections[0])
                syncClock(result.elections[0].serverTime);
            setElections(result.elections);
            setError("");
        } })
            .catch(err => {
            if (!active)
                return;
            if (err instanceof ApiError && (err.status === 401 || err.status === 403))
                onSessionEnd(err.message);
            else
                setError(err.message);
        }).finally(() => { if (active)
            setLoading(false); });
        return () => { active = false; };
    }, [token, revision, onSessionEnd, syncClock, admin, showRemoved]);
    async function changeRemoval(election, restore = false) {
        setBusy(true);
        setError("");
        setMessage("");
        try {
            await api(`/elections/${election.id}${restore ? "/restore" : ""}`, { method: restore ? "POST" : "DELETE" }, token);
            setRemoving(null);
            setElections(current => current.filter(item => item.id !== election.id));
            setMessage(restore ? "Election restored." : "Election removed. You can restore it from Removed elections.");
        }
        catch (err) {
            if (err instanceof ApiError && (err.status === 401 || err.status === 403))
                onSessionEnd(err.message);
            else
                setError(err instanceof Error ? err.message : "The election could not be updated.");
        }
        finally {
            setBusy(false);
        }
    }
    if (selected)
        return <ElectionView key={selected} {...props} id={selected} now={now} syncClock={syncClock} back={() => { setSelected(""); setRevision(value => value + 1); }} onChange={() => setRevision(value => value + 1)}/>;
    return <div className="election-workspace">
    {removing && <ConfirmDialog title="Remove previous election?" busy={busy} action="Remove election" onCancel={() => { setRemoving(null); setError(""); }} onConfirm={() => { void changeRemoval(removing); }}><p>Remove <strong>{removing.title}</strong> from the election list? It will no longer be visible to voters or parties.</p><p>You can restore it from Removed elections. Recorded votes and results are retained.</p>{error && <p className="notice error" role="alert">{error}</p>}</ConfirmDialog>}
    {message && <p className="notice success" role="status">{message}</p>}
    {admin && !creating && <div className="button-row" role="group" aria-label="Election visibility"><button className={showRemoved ? "secondary-button" : "primary-button"} aria-pressed={!showRemoved} disabled={busy || loading} onClick={() => { if (showRemoved) {
        setLoading(true);
        setShowRemoved(false);
    } }}>Current elections</button><button className={showRemoved ? "primary-button" : "secondary-button"} aria-pressed={showRemoved} disabled={busy || loading} onClick={() => { if (!showRemoved) {
        setLoading(true);
        setShowRemoved(true);
    } }}>Removed elections</button></div>}
    <section className="panel"><div className="section-heading"><h2>{creating ? "Prepare an election" : voter ? "Assigned elections" : "Elections"}</h2><div className="button-row"><button className="secondary-button" disabled={loading || busy} onClick={() => { setLoading(true); setRevision(value => value + 1); }}>Refresh</button>{admin && <button className="primary-button" disabled={busy} onClick={() => { if (props.onCreate && !creating)
        props.onCreate();
    else if (creating && props.onList)
        props.onList();
    else
        setCreating(!creating); setError(""); }}>{creating ? "Cancel" : "New election"}</button>}</div></div>
      {error && <p className="notice error" role="alert">{error}</p>}
      {creating && !loading && <ScheduleForm parties={registeredParties} busy={busy} save={async (body) => {
                setBusy(true);
                setError("");
                try {
                    const result = await api("/elections", { method: "POST", body: JSON.stringify(body) }, token);
                    setCreating(false);
                    setSelected(result.election.id);
                    setRevision(value => value + 1);
                    props.onCreated?.(result.election.id);
                    return true;
                }
                catch (err) {
                    if (err instanceof ApiError && (err.status === 401 || err.status === 403))
                        onSessionEnd(err.message);
                    else
                        setError(err instanceof Error ? err.message : "Election could not be created.");
                    return false;
                }
                finally {
                    setBusy(false);
                }
            }}/>}
      {creating ? null : loading ? <p className="empty-state" role="status">Loading elections...</p> : elections.length ? <div className="election-list">{elections.map(election => {
                const status = statusAt(election, now);
                return <article className="election-card party-election-card" key={election.id}>
          <ElectionBanner election={election} token={token} compact/>
          <div className="election-card-content"><div className="section-heading"><span className={`status-badge ${status}`}>{status}</span><span className="party-count">{election.partyCount} {election.partyCount === 1 ? "party" : "parties"}</span></div>
            <h3>{election.title}</h3><p className="election-excerpt">{election.description || "Choose the political party that represents your priorities."}</p>
            <p className="muted">{dateLabel(election.startsAt)} to {dateLabel(election.endsAt)}</p><ElectionCountdown election={election} now={now} compact/>
            <button className="secondary-button" disabled={busy} onClick={() => setSelected(election.id)} aria-label={`${admin ? "Manage" : "View"} ${election.title}`}>{admin ? "Manage election" : status === "ended" ? "View results" : status === "active" && voter ? "View parties and vote" : "View political parties"}</button>
            {admin && (election.removedAt ? <button className="secondary-button" disabled={busy} onClick={() => { void changeRemoval(election, true); }}>Restore election</button> : status === "ended" && <button className="text-button danger" disabled={busy} onClick={() => { setError(""); setRemoving(election); }}>Remove election</button>)}
          </div></article>;
            })}</div> : !error && <div className="empty-state"><h3>{showRemoved ? "No removed elections" : admin ? "Create your first election" : voter ? "No elections assigned yet" : "No elections yet"}</h3><p>{showRemoved ? "Ended elections you remove will appear here for restoration." : admin ? "Register parties, wait for their candidate rosters, then create the election." : voter ? "An administrator will assign you to elections you can participate in." : "Elections will appear here when an administrator creates them."}</p></div>}
    </section>
  </div>;
}
