import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPenToSquare, faTrashCan, faUsers } from "@fortawesome/free-solid-svg-icons";
import { PartyMark } from "./ElectionPresentation";
export function RegisteredPartyCard({ party, busy, onEdit, onDelete }) {
    const filled = party.candidates.length;
    const total = party.roles.length;
    const remaining = Math.max(0, total - filled);
    const submitted = Boolean(party.submittedAt);
    const complete = total > 0 && filled >= total;
    return <article className="registered-party" aria-labelledby={`party-name-${party.id}`}>
    <div className="registered-party-main">
      <div className="registered-party-identity">
        <PartyMark party={party}/>
        <div className="registered-party-name">
          <h3 id={`party-name-${party.id}`}>{party.name}</h3>
          <div className="registered-party-tags">
            {party.shortName && <span className="party-short-name">{party.shortName}</span>}
            <span className={`party-roster-status ${submitted ? "submitted" : "pending"}`}>
              <span aria-hidden="true"/>{submitted ? "Roster submitted" : complete ? "Ready to submit" : "Awaiting nominations"}
            </span>
          </div>
        </div>
      </div>
      <dl className="registered-party-details">
        <div><dt>Election symbol</dt><dd>{party.symbol}</dd></div>
        <div><dt>Party account</dt><dd>{party.accountEmail}</dd></div>
      </dl>
      {party.manifesto ? <div className="registered-party-manifesto">
        {party.manifesto.length > 220 ? <details><summary>Read party manifesto</summary><p>{party.manifesto}</p></details> : <p>{party.manifesto}</p>}
      </div> : <p className="registered-party-no-manifesto">No manifesto added yet.</p>}
    </div>
    <div className="registered-party-roster">
      <span className="roster-progress-title"><FontAwesomeIcon icon={faUsers} aria-hidden="true"/>Candidate roster</span>
      <div className="roster-progress-value"><strong>{filled}<span> / {total}</span></strong><span>positions filled</span></div>
      <progress value={Math.min(filled, total)} max={total || 1} aria-label={`${party.name}: ${filled} of ${total} candidate positions filled`}/>
      <p>{submitted ? "Submitted for election preparation" : !total ? "No candidate roles configured" : complete ? "All positions filled. Ready to submit." : `${remaining} ${remaining === 1 ? "nomination" : "nominations"} remaining`}</p>
      {onEdit && <button type="button" className="secondary-button" disabled={busy} onClick={onEdit} aria-label={`Edit ${party.name}`}><FontAwesomeIcon icon={faPenToSquare} aria-hidden="true"/>Edit party</button>}
      {onDelete && <button type="button" className="text-button danger party-delete-button" disabled={busy} onClick={onDelete} aria-label={`Delete ${party.name}`}><FontAwesomeIcon icon={faTrashCan} aria-hidden="true" />Delete party</button>}
    </div>
  </article>;
}
