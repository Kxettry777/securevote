import { useEffect, useRef, useState } from "react";

export function ConfirmDialog({ title, children, busy, permanent = false, action, onConfirm, onCancel }: {
  title: string; children: React.ReactNode; busy: boolean; permanent?: boolean; action: string; onConfirm: () => void; onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [confirmation, setConfirmation] = useState("");
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="confirm-dialog" aria-labelledby="confirmation-title" onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
    <h2 id="confirmation-title">{title}</h2>{children}
    <form className="election-form" onSubmit={event => { event.preventDefault(); if (!busy && (!permanent || confirmation === "DELETE")) onConfirm(); }}>
      <fieldset disabled={busy}>{permanent && <label>Type DELETE to confirm<input value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" autoFocus /></label>}
        <div className="button-row"><button type="button" className="secondary-button" autoFocus={!permanent} onClick={onCancel}>Cancel</button><button type="submit" className="primary-button danger-button" disabled={permanent && confirmation !== "DELETE"}>{busy ? "Please wait..." : action}</button></div>
      </fieldset>
    </form>
  </dialog>;
}
