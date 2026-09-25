import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Grid2X2, RotateCcw, RotateCw } from "lucide-react";
import { DEFAULT_MAIN_IMAGE, DEFAULT_PREPARATION, WebpSettingsSchema, type ExportPreparation as Preparation, type ExportPreview, type MainImageSettings } from "../../shared/export-preparation";
import type { ProductSummary } from "../../shared/types";
import { getMainCutouts, getPhotoroomStatus, removeMainBackground, approveMainCutout, type MainCutout, getGallerySelection, getGenerated, imageUrl, previewGalleryExport, thumbnailUrl } from "../api";
import { getErrorMessage } from "../utils";
import "../export-preparation.css";

const storageKey = "rugs-studio-export-webp-v1";
export function initialExportPreparation(): Preparation {
  try { return { ...DEFAULT_PREPARATION, webp: WebpSettingsSchema.parse(JSON.parse(localStorage.getItem(storageKey) ?? "null")) }; }
  catch { return structuredClone(DEFAULT_PREPARATION); }
}
const bytes = (value: number) => value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(2)} MB` : `${(value / 1024).toFixed(1)} KB`;

export function ExportPreparation({ products, value, onChange, onBack, onContinue }: {
  products: ProductSummary[];
  value: Preparation;
  onChange: (next: Preparation) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const [step, setStep] = useState<"main" | "webp">("main");
  const [photoroomReady, setPhotoroomReady] = useState(false);
  const [cutouts, setCutouts] = useState<MainCutout[]>([]);
  const [removing, setRemoving] = useState(false);
  const [batchProgress, setBatchProgress] = useState<string | null>(null);
  const stopBatch = useRef(false);
  const valueRef = useRef(value); valueRef.current = value;
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
  const [collectionPreviews, setCollectionPreviews] = useState<Array<{ id: string; image: string; key: string; sourceSha256: string }>>([]);
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
  const previewKey = JSON.stringify([productId, assetId, value.webp, settingsKey(value.mainImages[productId])]);
  const collectionKey = JSON.stringify(products.map(product => [product.id, settingsKey(value.mainImages[product.id])]));
  const current = preview?.key === previewKey;
  const selectedCutout = cutouts.find(cutout => cutout.id === main.cutoutId);
  const pending = Object.entries(value.mainImages).filter(([id, settings]) => products.some(product => product.id === id) && approvals[id] !== JSON.stringify(settings)).length;
  useEffect(() => { headingRef.current?.focus(); void getPhotoroomStatus().then(result => setPhotoroomReady(result.configured)).catch(error => setError(getErrorMessage(error))); return () => { requestRef.current?.abort(); stopBatch.current = true; }; }, []);
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
  const changeMain = (patch: Partial<MainImageSettings>) => onChange({ ...value, mainImages: { ...value.mainImages, [productId]: { ...main, ...patch, reviewedSourceSha256: undefined } } });
  const makePreview = async () => {
    requestRef.current?.abort();
    const controller = new AbortController(); requestRef.current = controller;
    setBusy(true); setError(null);
    try {
      if (collection) {
        setCollectionPreviews([]);
        for (const product of products.slice(collectionPage * 6, collectionPage * 6 + 6)) {
          const key = settingsKey(value.mainImages[product.id]);
          const result = await previewGalleryExport(product.id, undefined, { ...value, webp: { ...value.webp, maximumDimension: 600 } }, controller.signal);
          if (!controller.signal.aborted) setCollectionPreviews(previous => [...previous, { id: product.id, image: result.image, key, sourceSha256: result.sourceSha256 }]);
        }
        return;
      }
      const result = await previewGalleryExport(productId, assetId || undefined, value, controller.signal);
      if (!controller.signal.aborted) setPreview({ key: previewKey, result });
    } catch (error) { if (!controller.signal.aborted) setError(getErrorMessage(error)); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  };
  // Only local previews refresh automatically. Provider submissions always require a click.
  useEffect(() => {
    const timer = setTimeout(() => void makePreview(), 350);
    return () => { clearTimeout(timer); requestRef.current?.abort(); };
  }, [previewKey, collectionKey, collection, collectionPage]);
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
    if (removing) return;
    setRemoving(true); setError(null); stopBatch.current = false;
    try {
      for (const [index, product] of products.entries()) {
        if (stopBatch.current) break;
        setBatchProgress(`${index + 1} of ${products.length}: ${product.name} · ${product.shape}`);
        const saved = await getMainCutouts(product.id);
        if (!saved.some(cutout => cutout.status === "ready") && saved.some(cutout => cutout.status === "processing" || cutout.status === "failed")) throw new Error(`${product.name}: a previous attempt needs attention. Review it and choose an explicit retry; the batch did not resubmit it.`);
        const cutout = saved.find(cutout => cutout.status === "ready" && cutout.approved) ?? saved.find(cutout => cutout.status === "ready") ?? await removeMainBackground(product.id, crypto.randomUUID());
        if (stopBatch.current) break;
        useCutout(product.id, cutout);
        if (product.id === productIdRef.current) setCutouts([cutout, ...saved.filter(item => item.id !== cutout.id)]);
      }
    } catch (error) { setError(getErrorMessage(error)); }
    finally { setRemoving(false); setBatchProgress(null); }
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
          <button type="button" disabled={!photoroomReady || removing} onClick={() => void removeOne()}>{removing ? "Removing background…" : main.cutoutId ? "Retry from original · $0.02" : "Remove background · $0.02"}</button>
          <button type="button" disabled={!photoroomReady || removing} onClick={() => void removeBatch()}>Remove all selected · up to ${(products.length * 0.02).toFixed(2)}</button>
          <p>API usage estimate before taxes and plan minimums. Saved cutouts are reused. Every new retry may be charged.</p>
          {batchProgress && <p role="status">{batchProgress} <button type="button" onClick={() => { stopBatch.current = true; }}>Stop after current image</button></p>}
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
        <div className="exportPrepToolbar"><div><h4>{collection ? "Review your collection" : product?.name} {!collection && <> · {assetId ? images.find(image => image.id === assetId)?.name : "Main image"}</>}</h4><p>{collection ? "Open a rug to compare, rotate, or adjust its spacing." : current ? `${preview.result.width} × ${preview.result.height} px · WebP ${bytes(preview.result.outputBytes)} · source ${bytes(preview.result.sourceBytes)}` : "Create a preview to measure the current settings."}</p></div><label className="exportPrepCheck"><input type="checkbox" checked={zoom} onChange={event => setZoom(event.target.checked)} /> View at 100%</label></div>
        <div className="exportPrepViewToggle">{step === "main" && <button type="button" aria-pressed={guides} onClick={() => setGuides(!guides)}><Grid2X2 size={15}/>Framing grid</button>}<button type="button" aria-pressed={!collection} onClick={() => setCollection(false)}>Image detail</button><button type="button" aria-pressed={collection} onClick={() => setCollection(true)}>Collection layout</button></div>
        {step === "main" && collection && <div className="exportPrepBatch"><div><strong>Clean backgrounds</strong><p>{photoroomReady ? `Photoroom · up to $${(products.length * 0.02).toFixed(2)} for ${products.length} images. Saved cutouts are reused.` : "Use saved cutouts, or connect Photoroom in app/.env.local to remove new backgrounds."}</p></div><button type="button" disabled={removing} onClick={() => void removeBatch()}>{removing ? "Preparing images…" : photoroomReady ? "Remove backgrounds" : "Use saved cutouts"}</button>{batchProgress && <p role="status">{batchProgress} <button type="button" onClick={() => { stopBatch.current = true; }}>Stop after current image</button></p>}</div>}
        {step === "main" && guides && <p className="exportPrepGuideNote">5% grid · Center lines · Blue outline = fit area. Guides never export.</p>}
        {collection ? <><p>Showing six images at a time. Approval applies only to this page.</p><div className="exportPrepCollection">{products.slice(collectionPage * 6, collectionPage * 6 + 6).map(product => { const settings = value.mainImages[product.id]; const item = collectionPreviews.find(item => item.id === product.id && item.key === settingsKey(settings)); const approved = settings && approvals[product.id] === JSON.stringify(settings); return <figure key={product.id}><button type="button" className="exportPrepCard" aria-label={`Adjust ${product.name} ${product.shape}`} onClick={() => { setProductId(product.id); setAssetId(""); setCollection(false); }}><FramedPreview src={item?.image ?? (product.baseImage ? thumbnailUrl(product.id, "base", product.baseImage) : "")} alt={`${product.name} ${product.shape} export layout`} occupancy={settings?.occupancy ?? 90} guides={!!item && !!settings?.frame && guides && step === "main"}/></button><figcaption><strong>{product.name}</strong> · {product.shape}<span>{approved ? "Approved" : settings ? "Needs review" : "Original"}</span></figcaption></figure>; })}</div><div className="exportPrepActions"><button type="button" disabled={collectionPage === 0 || busy} onClick={() => { setCollectionPage(page => page - 1); setCollectionPreviews([]); }}>Previous page</button><span>Page {collectionPage + 1} of {Math.ceil(products.length / 6)}</span><button type="button" disabled={(collectionPage + 1) * 6 >= products.length || busy} onClick={() => { setCollectionPage(page => page + 1); setCollectionPreviews([]); }}>Next page</button></div></> : preview ? <div className={`exportPrepCompare ${zoom ? "isActualSize" : ""} ${current ? "" : "isStale"}`}><figure><figcaption>{step === "main" ? "Untouched original" : "Prepared image · before compression"}</figcaption><div><img src={step === "main" && product?.baseImage ? imageUrl(product.id, "base", product.baseImage) : preview.result.reference} alt={step === "main" ? "Untouched original" : "Prepared image before WebP compression"} /></div></figure><figure><figcaption>{step === "main" ? "Prepared image" : `WebP · ${bytes(preview.result.outputBytes)}`}</figcaption>{step === "main" && main.frame ? <FramedPreview src={preview.result.image} alt="Prepared main image" occupancy={main.occupancy} guides={guides && current} naturalSize={zoom ? preview.result.width : undefined}/> : <div><img src={preview.result.image} alt="Actual WebP output at the selected settings" /></div>}</figure></div> : <div className="exportPrepEmpty"><img src={product?.baseImage ? thumbnailUrl(product.id, "base", product.baseImage) : undefined} alt="Original main image" /><p>Preview the actual export before downloading.</p></div>}
        {!collection && preview && !current && <p className="exportPrepStale" role="status">Settings changed. Update the preview before judging quality or approving.</p>}
        {error && <p role="alert" className="exportPrepError">{error}</p>}
        <div className="exportPrepActions"><button type="button" className="galleryPrimaryButton" disabled={busy} onClick={() => void makePreview()}>{busy ? "Creating preview…" : "Update preview"}</button>{collection && <button type="button" disabled={busy || removing || !collectionPreviews.some(item => value.mainImages[item.id] && item.key === settingsKey(value.mainImages[item.id]) && approvals[item.id] !== JSON.stringify(value.mainImages[item.id]))} onClick={() => void approveVisible()}>Approve this page</button>}{!collection && !assetId && value.mainImages[productId] && <button type="button" disabled={!current || busy || removing} onClick={() => void approveMain()}>{approvals[productId] === JSON.stringify(main) ? <><Check size={16} /> Main image approved</> : "Approve this main image"}</button>}</div>
        {!collection && <details className="exportPrepOriginal"><summary>Compare with untouched original</summary>{product?.baseImage && <img loading="lazy" src={imageUrl(product.id, "base", product.baseImage)} alt="Untouched source main image" />}</details>}
        {pending > 0 && <button type="button" onClick={() => { const next = products.find(product => value.mainImages[product.id] && approvals[product.id] !== JSON.stringify(value.mainImages[product.id])); if (next) { setProductId(next.id); setAssetId(""); setCollection(false); } }}>Next main image to review</button>}
        <p className="exportPrepBackgroundNote">Approve only when the whole rug and fringe are intact. A failed cutout stays out of export. Retry from the original, or keep a better saved attempt. Adjusting WebP settings does not call Photoroom.</p>
      </main>
    </div>
    <footer className="exportPrepFooter"><div><strong>{products.length} shape galleries</strong><p>{pending ? `${pending} edited main ${pending === 1 ? "image needs" : "images need"} preview and approval.` : "Settings apply to WebPs. The ZIP also includes untouched originals."}</p></div><button type="button" className="galleryPrimaryButton" disabled={pending > 0 || busy || removing} onClick={() => { if (step === "main") { setStep("webp"); setCollection(false); } else onContinue(); }}>{step === "main" ? "Continue to WebP" : "Download ZIP"}</button></footer>
  </div>;
}

function CanvasFields({occupancy,background,onChange}:{occupancy:number;background:string;onChange:(patch:Partial<MainImageSettings>)=>void}) {
  return <><label>Minimum edge margin <output>{(100-occupancy)/2}%</output><input aria-label="Minimum edge margin" type="range" min="0" max="30" step="0.5" value={(100-occupancy)/2} onChange={event=>onChange({occupancy:100-Number(event.target.value)*2})}/></label><div className="exportPrepPresets">{[["Default",5],["Roomy",10],["Airy",15]].map(([label,margin])=><button type="button" key={label} aria-pressed={occupancy===100-Number(margin)*2} onClick={()=>onChange({occupancy:100-Number(margin)*2})}>{label} {margin}%</button>)}</div><p>Fits inside {occupancy}% of the canvas. Narrow shapes keep more space on their sides.</p><label>Canvas color<input aria-label="Canvas color" type="color" value={background} onChange={event=>onChange({background:event.target.value})}/></label></>;
}
function FramedPreview({src,alt,occupancy,guides,naturalSize}:{src:string;alt:string;occupancy:number;guides:boolean;naturalSize?:number}) {
  const [loaded,setLoaded]=useState("");
  const margin=(100-occupancy)/2;
  return <div className="exportFrameViewport"><div className={`exportFrameCanvas ${naturalSize?'isZoomed':''}`} style={naturalSize?{width:naturalSize,height:naturalSize}:undefined}><img src={src} alt={alt} onLoad={()=>setLoaded(src)}/>{guides&&loaded===src&&<div className="exportFrameGuides" aria-hidden="true"><div className="exportFrameGrid"/><div className="exportFrameCenter vertical"/><div className="exportFrameCenter horizontal"/><div className="exportFrameFit" style={{inset:`${margin}%`}}/><span className="exportFrameLabel" style={{top:`${margin/2}%`}}>{margin}% min</span></div>}</div></div>;
}
