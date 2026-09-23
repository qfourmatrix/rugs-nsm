import { useEffect, useState } from "react";
import { checkGenerationRequest } from "../api";
import { clearGenerationIntent, listGenerationIntents, listDamagedGenerationIntents, clearDamagedGenerationIntent } from "../generation-intent";

function readablePath(path: string) {
  const label = path.replace("/api/products/", "").replace("/api/shape-variants/", "Shapes / ");
  try { return decodeURIComponent(label); } catch { return label; }
}

export function GenerationRecovery() {
  const [items, setItems] = useState<ReturnType<typeof listGenerationIntents>>([]);
  const [damaged, setDamaged] = useState<ReturnType<typeof listDamagedGenerationIntents>>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const refresh = () => {
    try {
      setItems(listGenerationIntents(localStorage).filter(item => Date.now() - item.createdAt > 5000));
      setDamaged(listDamagedGenerationIntents(localStorage));
    }
    catch { /* Generation submission itself fails closed if recovery storage is unavailable. */ }
  };
  useEffect(() => {
    refresh();
    const timer = window.setInterval(() => { if (!document.hidden) refresh(); }, 5000);
    window.addEventListener("storage", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("storage", refresh); };
  }, []);

  const check = async (path: string, key: string) => {
    setChecking(key); setMessage(null);
    try {
      const result = await checkGenerationRequest(path, key);
      if (result.state === "complete") {
        clearGenerationIntent(localStorage, path, key);
        setMessage(result.responseStatus && result.responseStatus < 400
          ? "Original submission found. Check job history for its result; no generation was resubmitted."
          : "The original submission was rejected before dispatch. You can correct the input and submit again.");
        refresh();
      } else setMessage(result.state === "in_progress"
        ? "This request is still being prepared or was interrupted. Nothing was resubmitted. Check job history before deciding whether to start again."
        : "No request record was found. This does not prove that no generation occurred. Check job history before starting again.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Status check failed. Nothing was resubmitted."); }
    finally { setChecking(null); }
  };

  if (!items.length && !damaged.length && !message) return null;
  return <section className="appAlert" aria-label="Unconfirmed generation recovery">
    {items.length ? <strong>{items.length} unconfirmed generation submission{items.length === 1 ? "" : "s"}</strong> : null}
    {items.slice(0, 10).map(item => <div key={item.key}>
      <span>{readablePath(item.path)}</span>{" "}
      <button className="miniButton" type="button" disabled={checking !== null} onClick={() => void check(item.path, item.key)}>Check submission</button>{" "}
      <button className="miniButton" type="button" disabled={checking !== null} onClick={() => {
        if (window.confirm("Only clear this notice after reviewing job history. A provider may already have charged for an interrupted request. Clearing does not cancel it; generating again may create another charge. Continue?")) {
          clearGenerationIntent(localStorage, item.path, item.key); refresh();
        }
      }}>Clear after review</button>
    </div>)}
    {damaged.slice(0, 10).map(item => <div key={item.storageKey}>
      <strong>Damaged saved submission</strong>{" "}<span>{readablePath(item.label)}. Its status cannot be checked safely. Nothing was resubmitted.</span>{" "}
      <button className="miniButton" type="button" onClick={() => {
        if (!window.confirm("Review job history first. This damaged record cannot prove whether a job was submitted. Clearing it does not cancel any job; submitting again may create a duplicate charge. Clear this saved record?")) return;
        try {
          const cleared = clearDamagedGenerationIntent(localStorage, item);
          setMessage(cleared ? "Damaged record cleared. No job was submitted or canceled." : "The saved record changed. It was not cleared; review the refreshed notice.");
          refresh();
        } catch { setMessage("Could not clear saved recovery data. Nothing was resubmitted."); }
      }}>Clear damaged record after review</button>
    </div>)}
    {message ? <span role="status">{message} <button className="miniButton" type="button" onClick={() => setMessage(null)}>Dismiss</button></span> : null}
  </section>;
}
