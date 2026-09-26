import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, Grid2X2, RotateCcw, RotateCw } from "lucide-react";
import { DEFAULT_MAIN_IMAGE, DEFAULT_PREPARATION, ExportPreparationSchema, WebpSettingsSchema, type ExportPreparation as Preparation, type ExportPreview, type MainImageSettings } from "../../shared/export-preparation";
import type { ProductSummary } from "../../shared/types";
import { getCutoutBatch, startCutoutBatch, controlCutoutBatch, getMainCutouts, getPhotoroomStatus, removeMainBackground, approveMainCutout, type MainCutout, getGallerySelection, getGenerated, imageUrl, previewGalleryExport, thumbnailUrl } from "../api";
import { getErrorMessage } from "../utils";
import "../export-preparation.css";

import type { CutoutBatch } from "../../shared/cutout-batch";
const draftKey = "rugs-studio-export-draft-v1";
const storageKey = "rugs-studio-export-webp-v1";
export function initialExportPreparation(): Preparation {
  try { const draft = localStorage.getItem(draftKey); if (draft) return ExportPreparationSchema.parse(JSON.parse(draft)); } catch { /* Recover legacy WebP settings below. */ }
  try { return { ...DEFAULT_PREPARATION, webp: WebpSettingsSchema.parse(JSON.parse(localStorage.getItem(storageKey) ?? "null")) }; }
  catch { return structuredClone(DEFAULT_PREPARATION); }
}
const bytes = (value: number) => value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(2)} MB` : `${(value / 1024).toFixed(1)} KB`;

export function ExportPreparation({ products: inputProducts, value, onChange: updateValue, onBack, onContinue }: {
  products: ProductSummary[];
  value: Preparation;
  onChange: (next: Preparation) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const products = useMemo(() => [...inputProducts].sort((a, b) => a.familyId.localeCompare(b.familyId, undefined, { numeric: true }) || ["area", "runner", "round"].indexOf(a.shape) - ["area", "runner", "round"].indexOf(b.shape)), [inputProducts]);
  const [familySearch, setFamilySearch] = useState("");
  const families = useMemo(() => [...new Set(products.map(product => product.familyId))].filter(id => id.toLowerCase().includes(familySearch.toLowerCase())), [products, familySearch]);
  const [batch, setBatch] = useState<CutoutBatch | null>(null);
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const batchRequest = useRef<string | null>(null);
  const appliedCutouts = useRef(new Map<string, string>());
  const [saveError, setSaveError] = useState(false);
  const [step, setStep] = useState<"main" | "webp">("main");
  const [photoroomReady, setPhotoroomReady] = useState(false);
  const [cutouts, setCutouts] = useState<MainCutout[]>([]);
  const [removing, setRemoving] = useState(false);

  const valueRef = useRef(value); valueRef.current = value;
  const onChange = (next: Preparation) => {
    valueRef.current = next;
    try { localStorage.setItem(draftKey, JSON.stringify(next)); setSaveError(false); } catch { setSaveError(true); }
    updateValue(next);
  };
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const productIdRef = useRef(productId); productIdRef.current = productId;
  const [assetId, setAssetId] = useState("");
  const [images, setImages] = useState<Array<{ id: string; name: string }>>([]);
  const [preview, setPreview] = useState<{ key: string; result: ExportPreview } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collection, setCollection] = useState(true);
  const [guides, setGuides] = useState(true);
  const [sharedCanvas, setSharedCanvas] = useState({ occupancy: 90, background: "#f1eee8" });
  const [collectionPage, setCollectionPage] = useState(0);
  const pageFamilies = families.slice(collectionPage * 2, collectionPage * 2 + 2);
  const visibleProducts = products.filter(product => pageFamilies.includes(product.familyId));
  const pageCount = Math.max(1, Math.ceil(families.length / 2));
  const [collectionPreviews, setCollectionPreviews] = useState<Array<{ id: string; image: string; key: string; sourceSha256: string }>>([]);
  const previewCache = useRef(new Map<string, { id: string; image: string; key: string; sourceSha256: string }>());
  const [zoom, setZoom] = useState(false);
  const [approvals, setApprovals] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(value.mainImages).filter(([, settings]) => settings.reviewedSourceSha256).map(([id, settings]) => [id, JSON.stringify(settings)])));
  const requestRef = useRef<AbortController | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const previewPaneRef = useRef<HTMLElement>(null);
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = 0; if (previewPaneRef.current) previewPaneRef.current.scrollTop = 0; }, [step, collection, productId, collectionPage]);
  const product = products.find(item => item.id === productId) ?? products[0];
  const main = value.mainImages[productId] ?? DEFAULT_MAIN_IMAGE;
  const settingsKey = (settings?: MainImageSettings) => JSON.stringify(settings ? { ...settings, reviewedSourceSha256: undefined } : null);
  const previewKey = JSON.stringify([step, zoom, productId, assetId, step === "webp" ? value.webp : null, settingsKey(value.mainImages[productId])]);
  const collectionKey = JSON.stringify(visibleProducts.map(product => [product.id, settingsKey(value.mainImages[product.id])]));
  const current = preview?.key === previewKey;
  const selectedCutout = cutouts.find(cutout => cutout.id === main.cutoutId);
  const pending = Object.entries(value.mainImages).filter(([id, settings]) => products.some(product => product.id === id) && approvals[id] !== JSON.stringify(settings)).length;
  useEffect(() => { headingRef.current?.focus(); void getPhotoroomStatus().then(result => setPhotoroomReady(result.configured)).catch(error => setError(getErrorMessage(error))); return () => { requestRef.current?.abort(); }; }, []);
  useEffect(() => {
    let cancelled = false;
    setImages([]); setCutouts([]); setAssetId(""); setError(null);
    void getMainCutouts(productId).then(results => { if (!cancelled) setCutouts(results); }).catch(error => { if (!cancelled) setError(getErrorMessage(error)); });
    void Promise.all([getGallerySelection(productId), getGenerated(productId)]).then(([gallery, generated]) => {
      if (!cancelled) setImages(gallery.assetIds.map(id => ({ id, name: generated.active.find(asset => asset.assetId === id)?.shotName ?? id })));
    }).catch(error => { if (!cancelled) setError(getErrorMessage(error)); });
    return () => { cancelled = true; };
  }, [productId]);
  useEffect(() => { try { localStorage.setItem(storageKey, JSON.stringify(value.webp)); } catch { /* Settings still apply to this export. */ } }, [value.webp]);
  const batchActive = batchSubmitting || batch?.status === "running" || !!batch?.items.some(item => item.status === "processing");
  const batchReady = batch?.items.filter(item => item.status === "ready").length ?? 0;
  const batchFailed = batch?.items.filter(item => item.status === "failed" || item.status === "attention").length ?? 0;
  const syncBatch = (next: CutoutBatch | null) => {
    setBatch(next);
    if (!next) return;
    const latest = valueRef.current;
    const mainImages = { ...latest.mainImages };
    let changed = false;
    for (const item of next.items) {
      if (item.status !== "ready" || !item.cutoutId || !products.some(product => product.id === item.productId)) continue;
      if (appliedCutouts.current.get(item.productId) === item.cutoutId) continue;
      appliedCutouts.current.set(item.productId, item.cutoutId);
      if (mainImages[item.productId]?.cutoutId === item.cutoutId) continue;
      mainImages[item.productId] = { ...(mainImages[item.productId] ?? DEFAULT_MAIN_IMAGE), cutoutId: item.cutoutId, frame: true, portrait: true, reviewedSourceSha256: undefined };
      changed = true;
    }
    if (changed) onChange({ ...latest, mainImages });
  };
  useEffect(() => {
    let alive = true; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const next = await getCutoutBatch(); if (alive) syncBatch(next); }
      catch (error) { if (alive) setError(getErrorMessage(error)); }
      finally { if (alive) timer = setTimeout(() => void poll(), 1500); }
    };
    void poll(); return () => { alive = false; clearTimeout(timer); };
  }, [products.map(product => product.id).join("|")]);
  const batchControl = async (action: "pause" | "resume" | "retry") => {
    setBatchSubmitting(true); setError(null);
    try { syncBatch(await controlCutoutBatch(action)); } catch (error) { setError(getErrorMessage(error)); }
    finally { setBatchSubmitting(false); }
  };
  const rotateCard = (id: string, direction: number) => {
    const latest = valueRef.current; const main = latest.mainImages[id] ?? DEFAULT_MAIN_IMAGE;
    const rotation = ((main.rotation + direction + 540) % 360) - 180;
    onChange({ ...latest, mainImages: { ...latest.mainImages, [id]: { ...main, rotation, reviewedSourceSha256: undefined } } });
  };
  const changeMain = (patch: Partial<MainImageSettings>) => onChange({ ...value, mainImages: { ...value.mainImages, [productId]: { ...main, ...patch, reviewedSourceSha256: undefined } } });
  const makePreview = async () => {
    requestRef.current?.abort();
    const controller = new AbortController(); requestRef.current = controller;
    setBusy(true); setError(null);
    try {
      if (collection) {
        const targets = visibleProducts;
        const snapshot = valueRef.current;
        const cached = targets.flatMap(product => {
          const key = settingsKey(snapshot.mainImages[product.id]);
          const found = previewCache.current.get(`${product.id}:${key}`);
          return found ? [found] : [];
        });
        setCollectionPreviews(previous => [...cached, ...previous.filter(item => targets.some(product => product.id === item.id) && !cached.some(value => value.id === item.id))]);
        const missing = targets.filter(product => !cached.some(item => item.id === product.id));
        let index = 0;
        const worker = async () => {
          while (index < missing.length && !controller.signal.aborted) {
            const product = missing[index++]; const key = settingsKey(snapshot.mainImages[product.id]);
            const result = await previewGalleryExport(product.id, undefined, { ...snapshot, mainImages: snapshot.mainImages[product.id] ? { [product.id]: snapshot.mainImages[product.id] } : {} }, controller.signal, "layout");
            if (controller.signal.aborted) return;
            const item = { id: product.id, image: result.image, key, sourceSha256: result.sourceSha256 };
            previewCache.current.set(`${product.id}:${key}`, item);
            while (previewCache.current.size > 36) previewCache.current.delete(previewCache.current.keys().next().value!);
            setCollectionPreviews(previous => [...previous.filter(value => value.id !== item.id), item]);
          }
        };
        await Promise.all([worker(), worker()]);
        return;
      }
      const result = await previewGalleryExport(productId, assetId || undefined, value, controller.signal, step === "main" && !zoom ? "layout" : "webp");
      if (!controller.signal.aborted) setPreview({ key: previewKey, result });
    } catch (error) { if (!controller.signal.aborted) setError(getErrorMessage(error)); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  };
  // Only local previews refresh automatically. Provider submissions always require a click.
  useEffect(() => {
    const timer = setTimeout(() => void makePreview(), 350);
    return () => { clearTimeout(timer); requestRef.current?.abort(); };
  }, [collection ? collectionKey : previewKey, collection, collectionPage]);
  const approveVisible = async () => {
    setBusy(true); setError(null);
    try {
      const snapshot = valueRef.current;
      const reviewed: Record<string, MainImageSettings> = {};
      for (const item of collectionPreviews) {
        const settings = snapshot.mainImages[item.id];
        if (!settings || item.key !== settingsKey(settings)) continue;
        if (settings.cutoutId) await approveMainCutout(settings.cutoutId);
        reviewed[item.id] = { ...settings, reviewedSourceSha256: item.sourceSha256 };
      }
      const latest = valueRef.current;
      const valid = Object.fromEntries(Object.entries(reviewed).filter(([id]) => settingsKey(latest.mainImages[id]) === settingsKey(snapshot.mainImages[id])));
      onChange({ ...latest, mainImages: { ...latest.mainImages, ...valid } });
      setApprovals(previous => ({ ...previous, ...Object.fromEntries(Object.entries(valid).map(([id, settings]) => [id, JSON.stringify(settings)])) }));
    } catch (error) { setError(getErrorMessage(error)); }
    finally { setBusy(false); }
  };
  const useCutout = (id: string, cutout: MainCutout) => {
    if (cutout.status !== "ready") throw new Error(cutout.error ?? "This request is still processing or was interrupted. Check saved attempts before starting a paid retry.");
    const latest = valueRef.current;
    onChange({ ...latest, mainImages: { ...latest.mainImages, [id]: { ...(latest.mainImages[id] ?? DEFAULT_MAIN_IMAGE), cutoutId: cutout.id, frame: true, portrait: true, occupancy: latest.mainImages[id]?.occupancy ?? DEFAULT_MAIN_IMAGE.occupancy, reviewedSourceSha256: undefined } } });
  };
  const removeOne = async () => {
    if (removing) return;
    setRemoving(true); setError(null);
    try {
      const cutout = await removeMainBackground(productId, crypto.randomUUID());
      if (productIdRef.current === productId) setCutouts(previous => [cutout, ...previous]);
      useCutout(productId, cutout);
    } catch (error) { setError(getErrorMessage(error)); }
    finally { setRemoving(false); }
  };
  const removeBatch = async () => {
    if (batchActive) return;
    setBatchSubmitting(true); setError(null);
    batchRequest.current ??= crypto.randomUUID();
    try {
      syncBatch(await startCutoutBatch(products.map(product => product.id), batchRequest.current));
      batchRequest.current = null;
    } catch (error) { setError(getErrorMessage(error)); }
    finally { setBatchSubmitting(false); }
  };
  const approveMain = async () => {
    setBusy(true); setError(null);
    try {
      if (main.cutoutId) {
        const approved = await approveMainCutout(main.cutoutId);
        if (productIdRef.current === productId) setCutouts(previous => previous.map(cutout => cutout.id === approved.id ? approved : cutout));
      }
      const reviewed = { ...main, reviewedSourceSha256: preview!.result.sourceSha256 };
      const latest = valueRef.current;
      if (settingsKey(latest.mainImages[productId]) !== settingsKey(main)) throw new Error("Image settings changed during approval. Review the updated preview and approve again.");
      onChange({ ...latest, mainImages: { ...latest.mainImages, [productId]: reviewed } });
      setApprovals(previous => ({ ...previous, [productId]: JSON.stringify(reviewed) }));
    } catch (error) { setError(getErrorMessage(error)); }
    finally { setBusy(false); }
  };
  return <div className="exportPreparation">
    <div className="exportPrepHeading">
      <button type="button" className="gallerySecondaryButton" onClick={onBack}><ArrowLeft size={15} /> Back to galleries</button>
      <div><h3 ref={headingRef} tabIndex={-1}>Prepare your export</h3><p>{step === "main" ? "Clean backgrounds, check the rugs, and approve the result." : "Choose the file quality. Preview before downloading."}</p><nav className="exportPrepSteps" aria-label="Export preparation steps"><button type="button" aria-current={step === "main" ? "step" : undefined} onClick={() => { setStep("main"); setAssetId(""); }}>1. Main images</button><button type="button" aria-current={step === "webp" ? "step" : undefined} onClick={() => { setStep("webp"); setCollection(false); }}>2. WebP quality</button></nav></div>
    </div>
    <div className="exportPrepBody" ref={bodyRef}>
      <aside className="exportPrepControls" aria-label="Export settings">
        {(!collection || step === "webp") && <section><h4>Preview an image</h4>
          <label>Rug and shape<select aria-label="Rug and shape" value={productId} onChange={event => { setProductId(event.target.value); setPreview(null); }}>{products.map(product => <option key={product.id} value={product.id}>{product.name} · {product.shape}</option>)}</select></label>
          {step === "webp" && <label>Gallery image<select aria-label="Gallery image" value={assetId} onChange={event => setAssetId(event.target.value)}><option value="">Main image</option>{images.map(image => <option key={image.id} value={image.id}>{image.name}</option>)}</select></label>}
        </section>}
        {step === "main" && collection && <section><h4>Collection settings</h4><p>5% minimum space on each side by default. Keep every shape centered and in proportion.</p><CanvasFields occupancy={sharedCanvas.occupancy} background={sharedCanvas.background} onChange={patch => setSharedCanvas(previous => ({ ...previous, ...patch }))}/><button type="button" onClick={() => onChange({ ...value, mainImages: { ...value.mainImages, ...Object.fromEntries(products.map(product => [product.id, { ...(value.mainImages[product.id] ?? DEFAULT_MAIN_IMAGE), ...sharedCanvas, frame: true, reviewedSourceSha256: undefined }])) } })}>Apply to all main images</button><p>Updates clear approvals. Rotation stays individual.</p></section>}
        {step === "webp" && <section><h4>WebP settings <span>All exported images</span></h4>
          <div className="exportPrepPresets">{[{ name: "Smaller", quality: 75, maximumDimension: 1024 }, { name: "Balanced", quality: 82, maximumDimension: 1600 }, { name: "More detail", quality: 92, maximumDimension: 2048 }].map(preset => <button key={preset.name} type="button" onClick={() => onChange({ ...value, webp: { quality: preset.quality, maximumDimension: preset.maximumDimension, lossless: false } })}>{preset.name}</button>)}</div>
          <details className="exportPrepAdvanced"><summary>Advanced WebP settings</summary><label>Quality <output>{value.webp.quality}</output><input aria-label="WebP quality" type="range" min="1" max="100" value={value.webp.quality} disabled={value.webp.lossless} onChange={event => onChange({ ...value, webp: { ...value.webp, quality: Number(event.target.value) } })} /></label>
          <label>Maximum edge<select aria-label="Maximum edge" value={value.webp.maximumDimension} onChange={event => onChange({ ...value, webp: { ...value.webp, maximumDimension: Number(event.target.value) } })}>{[1024, 1600, 2048, 2560, 3200, 4096].map(size => <option key={size} value={size}>{size} px</option>)}</select></label>
          <label className="exportPrepCheck"><input type="checkbox" checked={value.webp.lossless} onChange={event => onChange({ ...value, webp: { ...value.webp, lossless: event.target.checked } })} /> Lossless compression</label>
          <p>Smaller sources are never upscaled. Lossless avoids compression loss; resizing still changes pixels.</p></details>
          <p>{value.webp.lossless ? "Lossless" : `Quality ${value.webp.quality}`} · up to {value.webp.maximumDimension}px. Applies to every exported image and is saved for next time.</p>
        </section>}
        {step === "main" && !collection && !assetId && <section><h4>Main image <span>This shape only</span></h4>
          <h5>Background removal · Photoroom</h5>
          {!photoroomReady && <p>To connect, add PHOTOROOM_API_KEY to app/.env.local and restart Studio. Keep the key private.</p>}
          {!main.cutoutId && cutouts.some(cutout => cutout.status === "ready") && <button type="button" onClick={() => useCutout(productId, cutouts.find(cutout => cutout.status === "ready" && cutout.approved) ?? cutouts.find(cutout => cutout.status === "ready")!)}>Use saved cutout · free</button>}
          <button type="button" disabled={!photoroomReady || removing || batchActive} onClick={() => void removeOne()}>{removing ? "Removing background…" : main.cutoutId || cutouts.some(item => item.status === "failed") ? "Retry from original · $0.02" : "Remove background · $0.02"}</button>
          <button type="button" disabled={!photoroomReady || removing || batchActive} onClick={() => void removeBatch()}>Remove all selected · up to ${(products.length * 0.02).toFixed(2)}</button>
          <p>API usage estimate before taxes and plan minimums. Saved cutouts are reused. Every new retry may be charged.</p>

          <details className="exportPrepAdvanced"><summary>Saved attempts & provider confidence</summary>{cutouts.some(cutout => cutout.status === "ready") && <label>Saved cutout<select aria-label="Saved cutout" value={main.cutoutId ?? ""} onChange={event => { if (event.target.value) useCutout(productId, cutouts.find(cutout => cutout.id === event.target.value)!); else changeMain({ cutoutId: undefined }); }}><option value="">Use original background</option>{cutouts.filter(cutout => cutout.status === "ready").map(cutout => <option key={cutout.id} value={cutout.id}>{new Date(cutout.createdAt).toLocaleString()} · {cutout.approved ? "Approved" : "Needs review"}</option>)}</select></label>}
          {selectedCutout && <p>{selectedCutout.uncertainty === null ? "Provider confidence unavailable." : `Provider uncertainty: ${Math.round(selectedCutout.uncertainty * 100)}%.` } Inspect fringe and pale edges against the original before approving. Confidence is not a quality guarantee.</p>}</details>

          <details className="exportPrepAdvanced" open><summary>Adjust image</summary><label className="exportPrepCheck"><input type="checkbox" checked={main.portrait} onChange={event => changeMain({ portrait: event.target.checked })} /> Turn the long side vertical</label>
          <div className="exportPrepRotation"><button type="button" aria-label="Rotate main image left" onClick={() => changeMain({ rotation: main.rotation - 90 < -180 ? main.rotation + 270 : main.rotation - 90 })}><RotateCcw size={16} /> 90°</button><button type="button" aria-label="Rotate main image right" onClick={() => changeMain({ rotation: main.rotation + 90 > 180 ? main.rotation - 270 : main.rotation + 90 })}><RotateCw size={16} /> 90°</button></div>
          <label>Rotation in degrees<input type="number" min="-180" max="180" step="0.5" value={main.rotation} onChange={event => changeMain({ rotation: Math.min(180, Math.max(-180, Number(event.target.value))) })} /></label>
          <label className="exportPrepCheck"><input type="checkbox" checked={main.trim} onChange={event => changeMain({ trim: event.target.checked, frame: event.target.checked || main.frame })} /> Trim uniform outer space</label>
          {main.trim && <><label>Trim sensitivity <output>{main.trimThreshold}</output><input aria-label="Trim sensitivity" type="range" min="1" max="40" value={main.trimThreshold} onChange={event => changeMain({ trimThreshold: Number(event.target.value) })} /></label><p>Check fringe carefully. Trimming only removes outer borders; it does not remove the background around the rug.</p></>}
          <label className="exportPrepCheck"><input type="checkbox" checked={main.frame} onChange={event => changeMain({ frame: event.target.checked })} /> Center on a square canvas</label>
          {main.frame && <><CanvasFields occupancy={main.occupancy} background={main.background} onChange={changeMain}/><button type="button" onClick={() => onChange({ ...value, mainImages: Object.fromEntries(products.map(product => [product.id, { ...(value.mainImages[product.id] ?? DEFAULT_MAIN_IMAGE), frame: true, occupancy: main.occupancy, background: main.background, reviewedSourceSha256: undefined }])) })}>Apply canvas settings to all main images</button></>}
          <button type="button" className="galleryTextButton" onClick={() => { const next = { ...value.mainImages }; delete next[productId]; onChange({ ...value, mainImages: next }); }}>Reset this main image</button></details>
        </section>}
      </aside>
      <main className="exportPrepPreview" ref={previewPaneRef}>
        <div className="exportPrepToolbar"><div><h4>{collection ? "Review your collection" : product?.name} {!collection && <> · {assetId ? images.find(image => image.id === assetId)?.name : "Main image"}</>}</h4><p>{collection ? "Rotate on each preview. Open an image for a closer look." : current ? `${preview.result.width} × ${preview.result.height} px · ${step === "webp" || zoom ? "WebP" : "Preview"} ${bytes(preview.result.outputBytes)} · source ${bytes(preview.result.sourceBytes)}` : "Create a preview to measure the current settings."}</p></div>{!collection && <label className="exportPrepCheck"><input type="checkbox" checked={zoom} onChange={event => setZoom(event.target.checked)} /> View at 100%</label>}</div>
        <div className="exportPrepViewToggle">{step === "main" && <button type="button" aria-pressed={guides} onClick={() => setGuides(!guides)}><Grid2X2 size={15}/>Framing grid</button>}<button type="button" aria-pressed={!collection} onClick={() => setCollection(false)}>Image detail</button><button type="button" aria-pressed={collection} onClick={() => setCollection(true)}>Collection layout</button></div>
        {step === "main" && <div className="exportPrepBatch">
          <div><strong>{batchActive ? "Removing backgrounds" : "Background removal"}</strong><p>{batch ? `${batchReady} of ${batch.items.length} ready${batchFailed ? ` · ${batchFailed} need attention` : ""}` : `${products.length} main images · up to $${(products.length * 0.02).toFixed(2)}. Saved cutouts are reused.`}</p><p>{!photoroomReady ? "Photoroom is not connected. Reuse saved cutouts for free." : "Runs while you review. Keep the Studio server open; you can close this tab."}</p></div>
          {batch?.status === "running" ? <button type="button" disabled={batchSubmitting} onClick={() => void batchControl("pause")}>Pause batch</button> : batch?.status === "paused" ? <button type="button" disabled={batchActive} onClick={() => void batchControl("resume")}>Resume batch</button> : <button type="button" className="galleryPrimaryButton" disabled={batchActive || removing} onClick={() => void removeBatch()}>{batchSubmitting ? "Queuing…" : photoroomReady ? "Remove all backgrounds" : "Use saved cutouts"}</button>}
          {batchFailed > 0 && <button type="button" disabled={batchActive || removing} onClick={() => void batchControl("retry")}>Retry {batchFailed} failed · up to ${(batchFailed * 0.02).toFixed(2)}</button>}
          {batch && <progress aria-label="Background removal progress" value={batch.items.filter(item => ["ready", "failed", "attention"].includes(item.status)).length} max={batch.items.length} />}
          {batch?.error && <p role="alert" className="exportPrepError">{batch.error}</p>}
        </div>}
        {step === "main" && guides && <p className="exportPrepGuideNote">5% grid · Center lines · Blue outline = fit area. Guides never export.</p>}
        {collection ? <>
          <div className="exportPrepFamilyNav"><label>Find a family<input type="search" value={familySearch} placeholder="Search rug families" onChange={event => { setFamilySearch(event.target.value); setCollectionPage(0); }} /></label><span>Area · Runner · Round, together</span></div>
          {pageFamilies.map(family => <section className="exportPrepFamily" key={family} aria-label={`${family} family`}><h4>{family}</h4><div className="exportPrepCollection">{products.filter(product => product.familyId === family).map(product => {
            const settings = value.mainImages[product.id];
            const item = collectionPreviews.find(item => item.id === product.id && item.key === settingsKey(settings));
            const previous = collectionPreviews.find(item => item.id === product.id);
            const previousSettings = previous ? JSON.parse(previous.key) as MainImageSettings | null : null;
            const rotationOnly = previous && settingsKey({ ...DEFAULT_MAIN_IMAGE, ...previousSettings, rotation: settings?.rotation ?? 0 }) === settingsKey(settings);
            const shown = item ?? (rotationOnly ? previous : undefined);
            const rotationDelta = !item && rotationOnly ? (settings?.rotation ?? 0) - (previousSettings?.rotation ?? 0) : 0;
            const approved = settings && approvals[product.id] === JSON.stringify(settings);
            const job = batch?.items.find(item => item.productId === product.id);
            return <figure key={product.id}><div className="exportPrepCardWrap"><button type="button" className="exportPrepCard" aria-label={`Adjust ${product.familyId} ${product.shape}`} onClick={() => { setProductId(product.id); setAssetId(""); setCollection(false); }}><FramedPreview rotation={rotationDelta} src={shown?.image ?? (product.baseImage ? thumbnailUrl(product.id, "base", product.baseImage) : "")} alt={`${product.familyId} ${product.shape} export layout`} occupancy={settings?.occupancy ?? 90} guides={!!shown && !!settings?.frame && guides && step === "main"}/></button><div className="exportPrepCardRotate"><button type="button" aria-label={`Rotate ${product.familyId} ${product.shape} left`} title="Rotate left 90°" onClick={() => rotateCard(product.id, -90)}><RotateCcw size={17}/></button><button type="button" aria-label={`Rotate ${product.familyId} ${product.shape} right`} title="Rotate right 90°" onClick={() => rotateCard(product.id, 90)}><RotateCw size={17}/></button></div></div><figcaption><strong>{product.shape}</strong><span>{job?.status === "processing" ? "Removing background…" : job?.status === "queued" ? "Queued" : job?.status === "failed" || job?.status === "attention" ? "Needs retry" : !item ? "Updating preview…" : approved ? "Approved" : settings ? "Needs review" : "Original"}</span>{job?.error && <span className="exportPrepError">{job.error}</span>}</figcaption></figure>;
          })}</div></section>)}
          {families.length === 0 && <p>No families match your search.</p>}
          <div className="exportPrepActions"><button type="button" disabled={collectionPage === 0} onClick={() => setCollectionPage(page => page - 1)}>Previous families</button><span>Page {collectionPage + 1} of {pageCount}</span><button type="button" disabled={collectionPage + 1 >= pageCount} onClick={() => setCollectionPage(page => page + 1)}>Next families</button></div></> : preview ? <div className={`exportPrepCompare ${zoom ? "isActualSize" : ""} ${current ? "" : "isStale"}`}><figure><figcaption>{step === "main" ? "Untouched original" : "Prepared image · before compression"}</figcaption><div><img src={step === "main" && product?.baseImage ? imageUrl(product.id, "base", product.baseImage) : preview.result.reference} alt={step === "main" ? "Untouched original" : "Prepared image before WebP compression"} /></div></figure><figure><figcaption>{step === "main" ? "Prepared image" : `WebP · ${bytes(preview.result.outputBytes)}`}</figcaption>{step === "main" && main.frame ? <FramedPreview src={preview.result.image} alt="Prepared main image" occupancy={main.occupancy} guides={guides && current} naturalSize={zoom ? preview.result.width : undefined}/> : <div><img src={preview.result.image} alt="Actual WebP output at the selected settings" /></div>}</figure></div> : <div className="exportPrepEmpty"><img src={product?.baseImage ? thumbnailUrl(product.id, "base", product.baseImage) : undefined} alt="Original main image" /><p>Preview the actual export before downloading.</p></div>}
        {!collection && preview && !current && <p className="exportPrepStale" role="status">Settings changed. Update the preview before judging quality or approving.</p>}
        {saveError && <p role="alert" className="exportPrepError">Could not save your draft in this browser. Keep this tab open.</p>}
        {error && <p role="alert" className="exportPrepError">{error}</p>}
        <div className="exportPrepActions"><button type="button" className="galleryPrimaryButton" disabled={busy} onClick={() => void makePreview()}>{busy ? "Creating preview…" : "Update preview"}</button>{collection && <button type="button" disabled={busy || removing || !collectionPreviews.some(item => value.mainImages[item.id] && item.key === settingsKey(value.mainImages[item.id]) && approvals[item.id] !== JSON.stringify(value.mainImages[item.id]))} onClick={() => void approveVisible()}>Approve this page</button>}{!collection && !assetId && value.mainImages[productId] && <button type="button" disabled={!current || busy || removing} onClick={() => void approveMain()}>{approvals[productId] === JSON.stringify(main) ? <><Check size={16} /> Main image approved</> : "Approve this main image"}</button>}</div>
        {!collection && <details className="exportPrepOriginal"><summary>Compare with untouched original</summary>{product?.baseImage && <img loading="lazy" src={imageUrl(product.id, "base", product.baseImage)} alt="Untouched source main image" />}</details>}
        {pending > 0 && <button type="button" onClick={() => { const next = products.find(product => value.mainImages[product.id] && approvals[product.id] !== JSON.stringify(value.mainImages[product.id])); if (next) { setProductId(next.id); setAssetId(""); setCollection(false); } }}>Next main image to review</button>}
        <p className="exportPrepBackgroundNote">Approve only when the whole rug and fringe are intact. A failed cutout stays out of export. Retry from the original, or keep a better saved attempt. Adjusting WebP settings does not call Photoroom.</p>
      </main>
    </div>
    <footer className="exportPrepFooter"><div><strong>{products.length} shape galleries · {saveError ? "Draft not saved" : "Draft saved on this browser"}</strong><p>{pending ? `${pending} edited main ${pending === 1 ? "image needs" : "images need"} preview and approval.` : "Settings apply to WebPs. The ZIP also includes untouched originals."}</p></div><button type="button" className="galleryPrimaryButton" disabled={pending > 0 || busy || removing || batchActive} onClick={() => { if (step === "main") { setStep("webp"); setCollection(false); } else onContinue(); }}>{step === "main" ? "Continue to WebP" : "Download ZIP"}</button></footer>
  </div>;
}

function CanvasFields({occupancy,background,onChange}:{occupancy:number;background:string;onChange:(patch:Partial<MainImageSettings>)=>void}) {
  return <><label>Minimum edge margin <output>{(100-occupancy)/2}%</output><input aria-label="Minimum edge margin" type="range" min="0" max="30" step="0.5" value={(100-occupancy)/2} onChange={event=>onChange({occupancy:100-Number(event.target.value)*2})}/></label><div className="exportPrepPresets">{[["Default",5],["Roomy",10],["Airy",15]].map(([label,margin])=><button type="button" key={label} aria-pressed={occupancy===100-Number(margin)*2} onClick={()=>onChange({occupancy:100-Number(margin)*2})}>{label} {margin}%</button>)}</div><p>Fits inside {occupancy}% of the canvas. Narrow shapes keep more space on their sides.</p><label>Canvas color<input aria-label="Canvas color" type="color" value={background} onChange={event=>onChange({background:event.target.value})}/></label></>;
}
function FramedPreview({src,alt,occupancy,guides,naturalSize,rotation=0}:{src:string;alt:string;occupancy:number;guides:boolean;naturalSize?:number;rotation?:number}) {
  const [loaded,setLoaded]=useState("");
  const margin=(100-occupancy)/2;
  return <div className="exportFrameViewport"><div className={`exportFrameCanvas ${naturalSize?'isZoomed':''}`} style={naturalSize?{width:naturalSize,height:naturalSize}:undefined}><img src={src} alt={alt} style={rotation ? { transform: `rotate(${rotation}deg)` } : undefined} onLoad={()=>setLoaded(src)}/>{guides&&loaded===src&&<div className="exportFrameGuides" aria-hidden="true"><div className="exportFrameGrid"/><div className="exportFrameCenter vertical"/><div className="exportFrameCenter horizontal"/><div className="exportFrameFit" style={{inset:`${margin}%`}}/><span className="exportFrameLabel" style={{top:`${margin/2}%`}}>{margin}% min</span></div>}</div></div>;
}
