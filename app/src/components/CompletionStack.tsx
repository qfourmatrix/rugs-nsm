import { memo, useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import type { JobRecord } from "../../shared/types";
import { getCompletionPreview, thumbnailUrl } from "../api";
import { CompletionTracker } from "../completion-tracker";
import "./CompletionStack.css";

interface Props { jobs: JobRecord[]; currentProductId: string | null; onOpen: (job: JobRecord) => void; }
const LIMIT = 6;

export const CompletionStack = memo(function CompletionStack({ jobs, currentProductId, onOpen }: Props) {
  const tracker = useRef(new CompletionTracker());
  const [items, setItems] = useState<JobRecord[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const dock = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; dx: number } | null>(null);
  const suppressClick = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissIds = useRef(new Set<string>());
  useEffect(() => {
    const fresh = tracker.current.observe(jobs, currentProductId);
    if (fresh.length) setItems(old => [...old, ...fresh].slice(-LIMIT));
  }, [jobs, currentProductId]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const dismiss = useCallback(() => {
    if (timer.current) return;
    dismissIds.current = new Set(items.map(item => item.jobId));
    setLeaving(true);
    timer.current = setTimeout(() => {
      setItems(old => old.filter(item => !dismissIds.current.has(item.jobId)));
      setExpanded(false); setLeaving(false); timer.current = null;
      if (dock.current) { dock.current.style.transform = ""; dock.current.style.opacity = ""; }
    }, window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : 180);
  }, [items]);
  useEffect(() => {
    if (!items.length) return;
    const outside = (e: globalThis.PointerEvent) => { if (expanded && !dock.current?.contains(e.target as Node)) dismiss(); };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") dismiss(); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [expanded, items.length, dismiss]);
  const drop = useCallback((id: string) => setItems(old => old.filter(item => item.jobId !== id)), []);
  function release(e: PointerEvent<HTMLDivElement>, cancelled = false) {
    if (!drag.current) return;
    const dx = drag.current.dx; drag.current = null;
    suppressClick.current = dx > 8;
    e.currentTarget.classList.remove("isDragging");
    if (!cancelled && dx > 55) dismiss();
    else { e.currentTarget.style.transform = ""; e.currentTarget.style.opacity = ""; }
  }
  if (!items.length) return null;
  return <div ref={dock} className={`completionStack${expanded ? " isExpanded" : ""}${leaving ? " isLeaving" : ""}`}
    role="group" aria-label="Finished shots. Click to expand or compare. Swipe right or press Escape to dismiss."
    onPointerDown={e => { if (expanded || leaving || e.button !== 0) return; suppressClick.current = false; drag.current = { x: e.clientX, dx: 0 }; (e.target as HTMLElement).setPointerCapture(e.pointerId); }}
    onPointerMove={e => { if (!drag.current) return; const dx = Math.max(0, e.clientX - drag.current.x); drag.current.dx = dx; if (dx > 8) { e.currentTarget.classList.add("isDragging"); e.currentTarget.style.transform = `translateX(${dx}px)`; e.currentTarget.style.opacity = String(Math.max(.2, 1 - dx / 220)); } }}
    onPointerUp={e => release(e)} onPointerCancel={e => release(e, true)}>
    <span className="completionAnnouncement" aria-live="polite">{items.length} finished shots in other rugs or shapes.</span>
    {items.map((item, index) => <CompletionThumbnail key={item.jobId} job={item} index={index} count={items.length} expanded={expanded} disabled={leaving}
      onUnavailable={drop} onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } if (items.length > 1 && !expanded) setExpanded(true); else { onOpen(item); dismiss(); } }} />)}
  </div>;
});

function CompletionThumbnail({ job, index, count, expanded, disabled, onClick, onUnavailable }: {
  job: JobRecord; index: number; count: number; expanded: boolean; disabled: boolean; onClick: () => void; onUnavailable: (id: string) => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void getCompletionPreview(job.productId, job.assetId!, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      if (result.file) setSrc(thumbnailUrl(job.productId, "generated", result.file));
      else onUnavailable(job.jobId);
    }).catch(() => { if (!controller.signal.aborted) onUnavailable(job.jobId); });
    return () => controller.abort();
  }, [job.productId, job.assetId, job.jobId, onUnavailable]);
  const depth = count - index - 1;
  return <button type="button" className="completionThumbnail" disabled={disabled || !src || (!expanded && depth > 0)}
    style={{ "--depth": Math.min(depth, 2), "--column": depth % 3, "--row": Math.floor(depth / 3), visibility: !src || (!expanded && depth > 2) ? "hidden" : undefined } as CSSProperties}
    aria-label={count > 1 && !expanded ? `Expand ${count} finished shots` : `Compare ${job.productId}: ${job.shotName ?? job.shotId}`}
    onClick={onClick}>
    {src ? <img src={src} alt="" draggable={false} decoding="async" onError={() => onUnavailable(job.jobId)} /> : null}
  </button>;
}
