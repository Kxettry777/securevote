import { useEffect, useState } from "react";
import type { Election, Party } from "./api";
import { countdownParts, electionPhase } from "./electionTime";

export function ElectionCountdown({ election, now, compact = false }: { election: Pick<Election, "startsAt" | "endsAt">; now: number; compact?: boolean }) {
  const phase = electionPhase(election.startsAt, election.endsAt, now);
  if (phase === "ended") return <div className="election-countdown ended"><span className="countdown-dot" aria-hidden="true" /><strong>Voting ended</strong></div>;
  const parts = countdownParts(phase === "active" ? election.endsAt : election.startsAt, now);
  const label = phase === "active" ? "Voting closes in" : "Voting opens in";
  return <div className={`election-countdown ${phase} ${compact ? "compact" : ""}`}><span className="countdown-label"><span className="countdown-dot" aria-hidden="true" />{label}</span>
    <div className="countdown-digits" role="timer" aria-live="off" aria-label={`${label} ${parts.days} days, ${parts.hours} hours, ${parts.minutes} minutes, ${parts.seconds} seconds`}>
      {Object.entries(parts).map(([unit, value]) => <span className="countdown-unit" key={unit}><strong>{String(value).padStart(2, "0")}</strong><small>{unit}</small></span>)}
    </div></div>;
}

export function PartyMark({ party }: { party: Pick<Party, "name" | "shortName" | "symbol" | "symbolImage"> }) {
  const initials = party.shortName || party.name.trim().split(/\s+/).slice(0, 3).map(word => Array.from(word)[0]).join("");
  return <span className="party-mark">{party.symbolImage ? <img src={party.symbolImage} alt={`${party.symbol} election symbol`} /> : <span aria-hidden="true">{initials}</span>}</span>;
}

export function PartyRoster({ party }: { party: Party }) {
  if (!party.roster?.length) return null;
  return <ol className="party-roster" aria-label={`${party.name} candidates`}>{party.roster.map(candidate => <li key={candidate.id}><span>{candidate.roleName}</span><strong>{candidate.fullName}</strong></li>)}</ol>;
}

export function ElectionBanner({ election, token, compact = false }: { election: Election; token: string; compact?: boolean }) {
  const [source, setSource] = useState<{ version: string; url: string } | null>(null);
  const [failedVersion, setFailedVersion] = useState<string | null>(null);
  useEffect(() => {
    if (!election.bannerVersion) return;
    const controller = new AbortController();
    let url: string | undefined;
    fetch(`/api/elections/${election.id}/banner`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Image unavailable");
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setFailedVersion(null);
        setSource({ version: election.bannerVersion!, url });
      }).catch(() => { if (!controller.signal.aborted) setFailedVersion(election.bannerVersion); });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [election.id, election.bannerVersion, token]);
  const failed = Boolean(election.bannerVersion && failedVersion === election.bannerVersion);
  const visible = !failed && election.bannerVersion && source?.version === election.bannerVersion;
  return <div className={`election-banner ${compact ? "compact" : ""} ${visible ? "has-image" : "placeholder"}`}>
    {visible ? <img src={source.url} alt={`${election.title} election banner`} loading="lazy" onError={() => setFailedVersion(election.bannerVersion)} /> : <div className="banner-placeholder"><span className="banner-emblem" aria-hidden="true">SV</span><span><strong>Political party election</strong><small>{failed ? "Banner unavailable" : "One voter. One party. One vote."}</small></span></div>}
  </div>;
}

export function BannerEditor({ election, busy, save }: { election: Election; busy: boolean; save: (file: File | null) => Promise<boolean> }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const [inputKey, setInputKey] = useState(0);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  function clear() { setFile(null); setPreview(""); setError(""); setInputKey(value => value + 1); }
  return <form className="election-form banner-editor" onSubmit={async event => { event.preventDefault(); if (file && await save(file)) clear(); }}>
    <h3>Election banner</h3><p className="muted">Upload a banner or election emblem. PNG, JPEG, or WebP; up to 4 MB and 16 million pixels. A wide image (about 3:1) works well. Changes lock when voting starts.</p>
    <fieldset disabled={busy}><label>Choose banner image<input key={inputKey} type="file" accept="image/png,image/jpeg,image/webp" onChange={event => {
      const next = event.target.files?.[0]; setError(""); setFile(null); setPreview("");
      if (!next) return;
      if (!["image/png", "image/jpeg", "image/webp"].includes(next.type)) { setError("Choose a PNG, JPEG, or WebP image."); return; }
      if (next.size > 4 * 1024 * 1024) { setError("The banner must be 4 MB or smaller."); return; }
      setFile(next); setPreview(URL.createObjectURL(next));
    }} /></label>
    {preview && <img className="banner-preview" src={preview} alt="Selected banner preview" />}
    {error && <p className="notice error" role="alert">{error}</p>}
    <div className="button-row"><button className="primary-button" disabled={!file} type="submit">{busy ? "Saving..." : election.bannerVersion ? "Replace banner" : "Upload banner"}</button>{file && <button className="secondary-button" type="button" onClick={clear}>Cancel selection</button>}{election.bannerVersion && <button className="text-button danger" type="button" onClick={async () => { if (await save(null)) clear(); }}>Remove banner</button>}</div></fieldset>
  </form>;
}
