import { useEffect, useState } from "react";
import { api, ApiError } from "./api";
export function ElectionSymbolPicker({ token, party, value, onChange, onSessionEnd }) {
    const [symbols, setSymbols] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [revision, setRevision] = useState(0);
    useEffect(() => {
        const controller = new AbortController();
        api("/registry/symbols", { signal: controller.signal }, token)
            .then(result => { if (!controller.signal.aborted) {
            setSymbols(result.symbols);
            setError("");
        } })
            .catch(err => {
            if (controller.signal.aborted)
                return;
            if (err instanceof ApiError && (err.status === 401 || err.status === 403))
                onSessionEnd(err.message);
            else
                setError(err instanceof Error ? err.message : "Symbols could not be loaded.");
        })
            .finally(() => { if (!controller.signal.aborted)
            setLoading(false); });
        return () => controller.abort();
    }, [token, revision, onSessionEnd]);
    // Preserve a previously uploaded symbol unless the admin explicitly replaces it.
    const choices = party?.symbolImage ? [{ id: "current", name: party.symbol, image: party.symbolImage }, ...symbols] : symbols;
    const chosen = choices.find(symbol => symbol.id === value);
    return <fieldset className="election-symbol-picker" aria-describedby="election-symbol-help">
    <legend>Election symbol</legend>
    <div className="symbol-picker-heading"><p id="election-symbol-help">Choose the symbol voters will see on the ballot.</p>{chosen && <span className="symbol-selection" role="status">Selected: {chosen.name}</span>}</div>
    {loading && <p className="muted" role="status">Loading symbols…</p>}
    {error && <div className="notice error" role="alert">{error} <button type="button" className="text-button" onClick={() => { setLoading(true); setRevision(current => current + 1); }}>Try again</button></div>}
    <div className="election-symbol-grid">
      {choices.map(symbol => <label className="election-symbol-option" key={symbol.id}>
        <input type="radio" name="symbolChoice" value={symbol.id} checked={value === symbol.id} onChange={() => onChange(symbol.id)} required/>
        <span className="symbol-option-art"><img src={symbol.image} alt=""/><span className="symbol-option-check" aria-hidden="true">✓</span></span>
        <span className="symbol-option-name">{symbol.name}</span>
        {symbol.id === "current" && <small>Current symbol</small>}
      </label>)}
    </div>
  </fieldset>;
}
