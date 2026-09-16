import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "./api";
import type { Party, Election } from "./api";

import { ElectionCountdown, PartyMark, PartyRoster } from "./ElectionPresentation";

type Receipt = { status: "not_submitted" | "pending" | "confirmed" | "failed"; transactionHash?: string; blockNumber?: number; contractAddress?: string; chainId?: number };
type Credential = { credential: string; expiresAt: string };
type Props = { electionId: string; token: string; onSessionEnd: (message: string) => void };
type Result = { parties: (Party & { votes: number })[]; totalVotes: number; status: "verified" | "pending" | "mismatch" | "insufficient_parties"; contractAddress?: string; chainId?: number;
  receipts: Receipt[]; audit: { confirmedTransactions: number; ballotEvents: number; pendingTransactions: number; failedTransactions: number; matches: boolean } | null };

function ReceiptView({ receipt }: { receipt: Receipt }) {
  return <div className={`notice ${receipt.status === "confirmed" ? "success" : receipt.status === "failed" ? "error" : ""}`} role="status">
    <h3>{receipt.status === "confirmed" ? "Your vote is recorded" : receipt.status === "failed" ? "The transaction failed" : "Awaiting blockchain confirmation"}</h3>
    <p>{receipt.status === "confirmed" ? "The blockchain confirmed your ballot. You cannot vote again in this election." : receipt.status === "failed" ? "The blockchain rejected this transaction and no vote was counted. You can prepare another submission while voting is open." : "Your submission is saved. This page will check for confirmation; you can also return to this election later."}</p>
    <dl className="receipt-details"><dt>Transaction</dt><dd>{receipt.transactionHash}</dd>{receipt.blockNumber != null && <><dt>Block</dt><dd>{receipt.blockNumber}</dd></>}<dt>Contract</dt><dd>{receipt.contractAddress}</dd><dt>Network</dt><dd>Local development chain ({receipt.chainId})</dd></dl>
  </div>;
}

export function Ballot({ electionId, token, onSessionEnd, parties, active, now, election }: Props & { parties: Party[]; active: boolean; now: number; election: Election }) {
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [credential, setCredential] = useState<Credential | null>(null);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [revision, setRevision] = useState(0);
  const fail = useCallback((err: unknown) => {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) onSessionEnd(err.message);
    else setError(err instanceof Error ? err.message : "Voting is unavailable. Please refresh.");
  }, [onSessionEnd]);

  useEffect(() => {
    let mounted = true;
    let timer: number;
    async function check() {
      try {
        const result = await api<Receipt>(`/elections/${electionId}/ballot`, {}, token);
        if (mounted) { setReceipt(result); setUncertain(false); setError(""); if (result.status === "pending") timer = window.setTimeout(check, 3000); }
      } catch (err) { if (mounted) fail(err); }
    }
    void check();
    return () => { mounted = false; window.clearTimeout(timer); };
  }, [electionId, token, fail, revision]);

  const submitted = receipt?.status === "confirmed" || receipt?.status === "pending";
  const party = parties.find(item => item.id === selected);
  const expired = credential ? now >= Date.parse(credential.expiresAt) : false;
  return <section className="panel ballot-panel"><div className="section-heading"><div><span className="panel-kicker">Your ballot</span><h2>{active ? "Make your choice" : "Voting status"}</h2></div><button className="secondary-button" disabled={busy} onClick={() => { setRevision(value => value + 1); }}>Check transaction status</button></div>
    <ElectionCountdown election={election} now={now} compact />
    {error && <p className="notice error" role="alert">{error}</p>}
    {!receipt && !error && <p role="status">Checking for a previous submission...</p>}
    {receipt && receipt.status !== "not_submitted" && <ReceiptView receipt={receipt} />}
    {uncertain && <p className="notice" role="status">The response was interrupted. Check transaction status before submitting again.</p>}
    {active && receipt && !submitted && !uncertain && parties.length >= 2 && <>
      <p>Choose one political party and its full candidate slate. Your vote counts toward that party's total. Review your choice before confirming.</p>
      <fieldset className="ballot-options" disabled={busy || Boolean(credential && !expired)}><legend>Select a political party</legend>{parties.map(item => <label className={`ballot-choice ${selected === item.id ? "selected" : ""}`} key={item.id}><input type="radio" name={`ballot-${electionId}`} value={item.id} checked={selected === item.id} onChange={() => setSelected(item.id)} /><PartyMark party={item} /><span><strong>{item.name}</strong>{item.symbol && <small className="party-symbol">Election symbol: {item.symbol}</small>}<small className="preserve-lines">{item.manifesto || "No party manifesto provided."}</small></span></label>)}</fieldset>
      {credential && !expired ? <div className="ballot-review"><h3>Confirm your vote for {party?.name}</h3><p>Once confirmed on the blockchain, this choice cannot be changed.</p>{party && <PartyRoster party={party} />}<p className="muted">Confirmation expires in {Math.max(0, Math.ceil((Date.parse(credential.expiresAt) - now) / 1000))} seconds.</p><div className="button-row"><button className="primary-button" disabled={busy} onClick={async () => {
        setBusy(true); setError(""); setUncertain(true);
        try {
          const result = await api<Receipt>(`/elections/${electionId}/ballots`, { method: "POST", body: JSON.stringify({ partyId: selected, credential: credential.credential }) }, token);
          setReceipt(result); setCredential(null); setUncertain(false); setRevision(value => value + 1);
        } catch (err) { fail(err); setCredential(null); }
        finally { setBusy(false); }
      }}>{busy ? "Submitting your ballot..." : "Confirm and cast vote"}</button><button className="secondary-button" disabled={busy} onClick={() => setCredential(null)}>Change choice</button></div></div> : <>
        {expired && <p className="notice">Your confirmation window expired. Review your choice again to continue.</p>}
        <button className="primary-button" disabled={busy || !party} onClick={async () => {
          setBusy(true); setError("");
          try { setCredential(await api<Credential>(`/elections/${electionId}/credentials`, { method: "POST" }, token)); }
          catch (err) { fail(err); }
          finally { setBusy(false); }
        }}>{busy ? "Preparing your ballot..." : "Review my choice"}</button>
      </>}
    </>}
    {!active && receipt?.status === "not_submitted" && <p>You have no submitted ballot in this election. Voting is closed.</p>}
    {active && parties.length < 2 && <p>Voting requires at least two registered political parties.</p>}
  </section>;
}

export function Results({ electionId, token, onSessionEnd }: Props) {
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let mounted = true;
    api<Result>(`/elections/${electionId}/results`, {}, token).then(data => { if (mounted) { setResult(data); setError(""); } })
      .catch(err => { if (!mounted) return; setResult(null); if (err instanceof ApiError && (err.status === 401 || err.status === 403)) onSessionEnd(err.message); else setError(err.message); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [electionId, token, onSessionEnd, revision]);
  const maximum = result?.parties[0]?.votes ?? 0;
  const leaders = result?.parties.filter(party => maximum > 0 && party.votes === maximum) ?? [];
  return <section className="panel results-panel"><div className="section-heading"><div><span className="panel-kicker">Election results</span><h2>Confirmed vote totals</h2></div><button className="secondary-button" disabled={loading} onClick={() => { setLoading(true); setRevision(value => value + 1); }}>Refresh results</button></div>
    {loading ? <p role="status">Reading the voting ledger...</p> : error ? <p className="notice error" role="alert">{error}</p> : result && <>
      <div className={`notice ${result.status === "verified" ? "success" : result.status === "mismatch" ? "error" : ""}`} role="status">{result.status === "verified" ? "Verified: party totals, ballot events, and application transaction records agree." : result.status === "pending" ? "Some transactions are still pending. Refresh to check the final count." : result.status === "insufficient_parties" ? "This election ended with fewer than two parties. Voting did not open." : "The audit found a mismatch. An administrator should investigate before declaring a result."}</div>
      <p><strong>{result.totalVotes}</strong> confirmed {result.totalVotes === 1 ? "vote" : "votes"}</p>
      {result.status === "verified" && <h3>{!leaders.length ? "No votes were cast" : leaders.length > 1 ? `Tie: ${leaders.map(party => party.name).join(", ")}` : `Winning party: ${leaders[0].name}`}</h3>}
      <div className="result-list">{result.parties.map(party => <div className="result-row" key={party.id}><div><strong>{party.name}</strong><span>{party.votes} votes · {result.totalVotes ? (party.votes / result.totalVotes * 100).toFixed(1) : "0"}%</span></div><meter min={0} max={Math.max(1, result.totalVotes)} value={party.votes} aria-label={`${party.name}: ${party.votes} votes`} /></div>)}</div>
      {result.audit && <details className="audit-details"><summary>Audit and transaction references</summary><dl className="receipt-details"><dt>Contract</dt><dd>{result.contractAddress}</dd><dt>Network</dt><dd>Local development chain ({result.chainId})</dd><dt>Ballot events</dt><dd>{result.audit.ballotEvents}</dd><dt>Pending transactions</dt><dd>{result.audit.pendingTransactions}</dd><dt>Failed transactions</dt><dd>{result.audit.failedTransactions}</dd></dl><p className="muted">Ballots on this local ledger are public. These references contain no voter names or email addresses.</p>
        <button className="secondary-button" onClick={() => {
          const url = URL.createObjectURL(new Blob([JSON.stringify({ electionId, exportedAt: new Date().toISOString(), ...result }, null, 2)], { type: "application/json" }));
          const link = document.createElement("a"); link.href = url; link.download = `securevote-results-${electionId}.json`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        }}>Download audit report</button>
        {result.receipts.length > 0 && <ul className="transaction-list">{result.receipts.map(receipt => <li key={receipt.transactionHash}><code>{receipt.transactionHash}</code><span>Block {receipt.blockNumber}</span></li>)}</ul>}
      </details>}
    </>}
  </section>;
}
