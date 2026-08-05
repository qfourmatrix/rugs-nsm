import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  Circle,
  Images,
  Layers3,
  LoaderCircle,
  RectangleHorizontal,
  Sparkles,
  X
} from "lucide-react";
import type {
  AssetRecord,
  ProductSummary,
  RoundEdgePolicy,
  ShapeVariantRecord,
  ShapeVariantShape,
  ShapeVariantStrategy
} from "../../shared/types";
import {
  approveShapeVariant,
  generateShapeVariantShots,
  generateShapeVariants,
  getShapeVariant,
  getShapeVariants,
  imageUrl,
  prepareShapeVariants,
  rejectShapeVariantCandidate,
  thumbnailUrl,
  type ShapeVariantsOverview
} from "../api";
import { getErrorMessage } from "../utils";

const EMPTY_OVERVIEW: ShapeVariantsOverview = {
  records: [],
  counts: {
    planned: 0,
    queued: 0,
    generating: 0,
    needs_review: 0,
    approved: 0,
    failed: 0,
    cancelled: 0,
    stale: 0
  },
  plannedProviderCalls: 0
};

const STRATEGIES: Array<{ id: ShapeVariantStrategy; label: string }> = [
  { id: "auto", label: "Auto — infer design grammar" },
  { id: "repeat_border", label: "Repeat / border" },
  { id: "endcap", label: "Endcaps + extended field" },
  { id: "stripe_band", label: "Stripes / bands" },
  { id: "focal", label: "Focal composition" },
  { id: "asymmetrical", label: "Asymmetrical composition" }
];

interface WorkshopTarget {
  sourceProductId: string;
  shape: ShapeVariantShape;
}

export function ShapeVariantStudio({
  products,
  selectedProduct,
  loading,
  onSelectProduct,
  onCatalogChanged
}: {
  products: ProductSummary[];
  selectedProduct: ProductSummary | null;
  loading: boolean;
  onSelectProduct: (productId: string) => void;
  onCatalogChanged: () => Promise<void>;
}) {
  const [overview, setOverview] = useState<ShapeVariantsOverview>(EMPTY_OVERVIEW);
  const [workshop, setWorkshop] = useState<WorkshopTarget | null>(null);
  const [campaignOpen, setCampaignOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshOverview = useCallback(async () => {
    try {
      setOverview(await getShapeVariants());
      setError(null);
    } catch (nextError) {
      setError(getErrorMessage(nextError));
    }
  }, []);

  useEffect(() => {
    void refreshOverview();
  }, [products, refreshOverview]);

  const hasActiveCampaign = overview.counts.queued + overview.counts.generating > 0;
  useEffect(() => {
    if (!hasActiveCampaign) return undefined;
    const interval = window.setInterval(() => void refreshOverview(), 2500);
    return () => window.clearInterval(interval);
  }, [hasActiveCampaign, refreshOverview]);

  const sourceProductId = selectedProduct?.sourceProductId ?? selectedProduct?.id ?? null;
  const sourceProduct = products.find((product) => product.id === sourceProductId) ?? null;
  const familyProducts = useMemo(
    () => products.filter((product) => sourceProduct && product.familyId === sourceProduct.familyId),
    [products, sourceProduct]
  );

  const familyRecords = useMemo(
    () => overview.records.filter((record) => record.sourceProductId === sourceProductId),
    [overview.records, sourceProductId]
  );

  const openShape = (shape: ShapeVariantShape) => {
    const approved = familyProducts.find((product) => product.shape === shape);
    if (approved) {
      onSelectProduct(approved.id);
      return;
    }
    if (sourceProduct?.status === "ready") setWorkshop({ sourceProductId: sourceProduct.id, shape });
  };

  if (!sourceProduct || sourceProduct.shape !== "area") return null;

  return (
    <>
      <section className="shapeFamilyBar" aria-label="Rug shape family">
        <div className="shapeFamilyIdentity">
          <span className="shapeFamilyEyebrow">Product family</span>
          <strong>{sourceProduct.name}</strong>
        </div>
        <div className="shapeSwitch" role="group" aria-label="Product shape">
          <ShapeButton
            label="Area"
            icon={<Images size={16} aria-hidden="true" />}
            selected={selectedProduct?.shape === "area"}
            status="approved"
            onClick={() => onSelectProduct(sourceProduct.id)}
          />
          {(["runner", "round"] as const).map((shape) => {
            const product = familyProducts.find((candidate) => candidate.shape === shape);
            const record = familyRecords.find((candidate) => candidate.shape === shape);
            return (
              <ShapeButton
                key={shape}
                label={shape === "runner" ? "Runner" : "Round"}
                icon={shape === "runner" ? <RectangleHorizontal size={17} aria-hidden="true" /> : <Circle size={16} aria-hidden="true" />}
                selected={selectedProduct?.shape === shape}
                status={product ? "approved" : record?.status ?? "missing"}
                disabled={!product && sourceProduct.status !== "ready"}
                onClick={() => openShape(shape)}
              />
            );
          })}
        </div>
        <button className="shapeCampaignButton" type="button" onClick={() => setCampaignOpen(true)} disabled={loading}>
          <Layers3 size={16} aria-hidden="true" />
          <span>Shape campaign</span>
          {overview.counts.needs_review > 0 ? <span className="shapeCampaignBadge">{overview.counts.needs_review}</span> : null}
        </button>
      </section>
      {error ? <div className="shapeInlineError">Shape studio: {error}</div> : null}

      {workshop ? (
        <ShapeWorkshop
          target={workshop}
          source={products.find((product) => product.id === workshop.sourceProductId) ?? sourceProduct}
          record={overview.records.find((candidate) => candidate.id === `${workshop.sourceProductId}::${workshop.shape}`) ?? null}
          onClose={() => setWorkshop(null)}
          onChanged={async () => {
            await refreshOverview();
            await onCatalogChanged();
          }}
          onSelectProduct={onSelectProduct}
        />
      ) : null}

      {campaignOpen ? (
        <ShapeCampaign
          products={products}
          overview={overview}
          onClose={() => setCampaignOpen(false)}
          onOpenReview={(record) => {
            setCampaignOpen(false);
            setWorkshop({ sourceProductId: record.sourceProductId, shape: record.shape });
          }}
          onChanged={async () => {
            await refreshOverview();
            await onCatalogChanged();
          }}
        />
      ) : null}
    </>
  );
}

function ShapeButton({
  label,
  icon,
  selected,
  status,
  disabled = false,
  onClick
}: {
  label: string;
  icon: React.ReactNode;
  selected: boolean;
  status: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  const statusLabel = status === "approved" ? "Ready" : status === "missing" ? "Create" : status.replaceAll("_", " ");
  return (
    <button className={`shapeSwitchButton ${selected ? "isSelected" : ""}`} type="button" disabled={disabled} onClick={onClick}>
      {icon}
      <span>{label}</span>
      <small className={`shapeStatus shapeStatus-${status}`}>{statusLabel}</small>
    </button>
  );
}

function ShapeWorkshop({
  target,
  source,
  record,
  onClose,
  onChanged,
  onSelectProduct
}: {
  target: WorkshopTarget;
  source: ProductSummary;
  record: ShapeVariantRecord | null;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onSelectProduct: (productId: string) => void;
}) {
  const [strategy, setStrategy] = useState<ShapeVariantStrategy>(record?.strategy ?? "auto");
  const [runnerRatio, setRunnerRatio] = useState(record?.runnerRatio ?? 3.33);
  const [roundEdgePolicy, setRoundEdgePolicy] = useState<RoundEdgePolicy>(record?.roundEdgePolicy ?? "preserve_source");
  const [imageSize, setImageSize] = useState<"2K" | "4K">(record?.imageSize ?? "4K");
  const [candidateCount, setCandidateCount] = useState<1 | 2>(record?.candidateCount ?? 1);
  const [candidates, setCandidates] = useState<AssetRecord[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(record?.candidateAssetIds[0] ?? null);
  const [liveRecord, setLiveRecord] = useState(record);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [approvalProductId, setApprovalProductId] = useState<string | null>(record?.status === "approved" ? record.variantProductId : null);

  const loadDetail = useCallback(async () => {
    try {
      const detail = await getShapeVariant(`${target.sourceProductId}::${target.shape}`);
      setLiveRecord(detail.variant);
      setCandidates(detail.candidates.filter((asset) => asset.status !== "failed" && Boolean(asset.output?.file)));
      setSelectedAssetId((current) => current && detail.variant.candidateAssetIds.includes(current) ? current : detail.variant.candidateAssetIds[0] ?? null);
    } catch (nextError) {
      if (record) setError(getErrorMessage(nextError));
    }
  }, [record, target.shape, target.sourceProductId]);

  useEffect(() => {
    if (record) void loadDetail();
  }, [loadDetail, record]);

  const running = liveRecord?.status === "queued" || liveRecord?.status === "generating";
  useEffect(() => {
    if (!running) return undefined;
    const interval = window.setInterval(() => void loadDetail(), 2200);
    return () => window.clearInterval(interval);
  }, [loadDetail, running]);

  const run = async (label: string, action: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await action();
    } catch (nextError) {
      setError(getErrorMessage(nextError));
    } finally {
      setBusy(null);
    }
  };

  const handleGenerate = () => void run("generate", async () => {
    const callCount = candidateCount;
    if (!window.confirm(`Generate ${callCount} ${target.shape} design candidate${callCount === 1 ? "" : "s"}?\n\nThis request allows up to ${callCount} billable provider call${callCount === 1 ? "" : "s"}; failed validation makes no call. No product is published until you approve one.`)) return;
    const prepared = await prepareShapeVariants({
      sourceProductIds: [source.id],
      shapes: [target.shape],
      strategy,
      runnerRatio,
      roundEdgePolicy,
      imageSize,
      candidateCount
    });
    const nextRecord = prepared.records[0];
    if (!nextRecord) throw new Error("Shape variant was not prepared.");
    const result = await generateShapeVariants([nextRecord.id]);
    const failure = result.results[0]?.error;
    if (failure) throw new Error(failure);
    setLiveRecord({ ...nextRecord, status: "queued" });
    setCandidates([]);
    setSelectedAssetId(null);
    await onChanged();
    await loadDetail();
  });

  const handleApprove = () => void run("approve", async () => {
    if (!selectedAssetId || !liveRecord) return;
    if (!window.confirm(`Approve this ${target.shape} design?\n\nA new product folder named ${liveRecord.variantProductId} will be created atomically. The Area rug stays unchanged.`)) return;
    const response = await approveShapeVariant(liveRecord.id, selectedAssetId);
    setLiveRecord(response.variant);
    setApprovalProductId(response.product?.id ?? liveRecord.variantProductId);
    await onChanged();
  });

  const handleReject = () => void run("reject", async () => {
    if (!selectedAssetId || !liveRecord) return;
    await rejectShapeVariantCandidate(liveRecord.id, selectedAssetId);
    await onChanged();
    await loadDetail();
  });

  const handleGenerateShots = () => void run("shots", async () => {
    if (!approvalProductId) return;
    if (!window.confirm("Queue every missing product shot for this approved shape?\n\nThe backend will queue at most 5 provider calls and report shots blocked by missing background or label settings.")) return;
    const response = await generateShapeVariantShots([approvalProductId], imageSize);
    const blocked = response.results.flatMap((result) => result.blocked);
    if (blocked.length > 0) setError(`${response.providerCallsQueued} queued; ${blocked.length} blocked. ${blocked[0]?.message}`);
    await onChanged();
  });

  const selectedCandidate = candidates.find((candidate) => candidate.assetId === selectedAssetId) ?? null;

  return (
    <div className="shapeModalOverlay" role="presentation">
      <section className="shapeWorkshop" role="dialog" aria-modal="true" aria-labelledby="shape-workshop-title">
        <header className="shapeModalHeader">
          <div>
            <span className="shapeModalEyebrow">Design approval · {source.name}</span>
            <h2 id="shape-workshop-title">Make {target.shape === "runner" ? "Runner" : "Round"}</h2>
            <p>Rebuild the same design for a new manufactured shape. Nothing enters the catalog until approval.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close shape workshop"><X size={19} /></button>
        </header>

        <div className="shapeWorkshopBody">
          <div className="shapeComparison">
            <figure className="shapePreviewCard">
              <figcaption><span>Source</span><strong>Approved Area</strong></figcaption>
              {source.baseImage ? <img src={imageUrl(source.id, "base", source.baseImage)} alt={`${source.name} Area rug`} /> : null}
            </figure>
            <figure className="shapePreviewCard isCandidate">
              <figcaption>
                <span>Candidate</span>
                <strong>{liveRecord ? statusText(liveRecord.status) : "Not generated"}</strong>
              </figcaption>
              {selectedCandidate?.output?.file ? (
                <img src={imageUrl(source.id, "generated", selectedCandidate.output.file)} alt={`${source.name} ${target.shape} candidate`} />
              ) : running ? (
                <div className="shapePreviewEmpty"><LoaderCircle className="spin" size={30} /><strong>Nano Banana Pro is reconstructing it</strong><span>Campaign state is saved if the app restarts.</span></div>
              ) : (
                <div className="shapePreviewEmpty"><Sparkles size={29} /><strong>Ready to create</strong><span>Generate one production candidate, or two for a pilot comparison.</span></div>
              )}
            </figure>
          </div>

          {candidates.length > 1 ? (
            <div className="shapeCandidateStrip" aria-label="Generated candidates">
              {candidates.map((candidate, index) => candidate.output?.file ? (
                <button className={candidate.assetId === selectedAssetId ? "isSelected" : ""} type="button" key={candidate.assetId} onClick={() => setSelectedAssetId(candidate.assetId)}>
                  <img src={thumbnailUrl(source.id, "generated", candidate.output.file)} alt="" />
                  <span>Candidate {index + 1}</span>
                </button>
              ) : null)}
            </div>
          ) : null}

          <aside className="shapeControls">
            <label><span>Design strategy</span><select value={strategy} disabled={running || Boolean(approvalProductId)} onChange={(event) => setStrategy(event.target.value as ShapeVariantStrategy)}>{STRATEGIES.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}</select></label>
            {target.shape === "runner" ? (
              <label><span>Runner body ratio</span><input type="number" min="2" max="6" step="0.05" value={runnerRatio} disabled={running || Boolean(approvalProductId)} onChange={(event) => setRunnerRatio(Number(event.target.value))} /><small>Default 3.33:1. Use the intended SKU ratio when known.</small></label>
            ) : (
              <label><span>Round edge policy</span><select value={roundEdgePolicy} disabled={running || Boolean(approvalProductId)} onChange={(event) => setRoundEdgePolicy(event.target.value as RoundEdgePolicy)}><option value="preserve_source">Preserve source edge</option><option value="bound">Clean bound edge</option><option value="radial_fringe">Radial fringe</option></select><small>Never invent a manufacturing edge silently.</small></label>
            )}
            <div className="shapeControlRow">
              <label><span>Resolution</span><select value={imageSize} disabled={running || Boolean(approvalProductId)} onChange={(event) => setImageSize(event.target.value as "2K" | "4K")}><option value="4K">4K</option><option value="2K">2K</option></select></label>
              <label><span>Candidates</span><select value={candidateCount} disabled={running || Boolean(approvalProductId)} onChange={(event) => setCandidateCount(Number(event.target.value) as 1 | 2)}><option value={1}>1 · Production</option><option value={2}>2 · Pilot</option></select></label>
            </div>
            <div className="shapeGuardrail"><Check size={15} /><span>No stretching. No squeezing. Palette, material, motif scale, borders, and edge topology stay locked to Image 1.</span></div>
            {error ? <div className="shapePanelError"><AlertTriangle size={16} />{error}</div> : null}
            <div className="shapeActions">
              {approvalProductId ? (
                <>
                  <button className="controlButton" type="button" onClick={() => onSelectProduct(approvalProductId)}>Open approved product</button>
                  <button className="controlButton primary" type="button" disabled={Boolean(busy)} onClick={handleGenerateShots}>{busy === "shots" ? "Queuing…" : "Generate missing product shots"}</button>
                </>
              ) : (
                <>
                  {selectedCandidate ? <button className="controlButton danger" type="button" disabled={running || Boolean(busy)} onClick={handleReject}>Reject candidate</button> : null}
                  <button className="controlButton" type="button" disabled={running || Boolean(busy)} onClick={handleGenerate}>{running ? "Generating…" : candidates.length ? "Generate another" : `Generate ${target.shape}`}</button>
                  <button className="controlButton primary" type="button" disabled={running || !selectedCandidate || Boolean(busy)} onClick={handleApprove}>{busy === "approve" ? "Approving…" : "Approve design"}</button>
                </>
              )}
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}

function ShapeCampaign({
  products,
  overview,
  onClose,
  onOpenReview,
  onChanged
}: {
  products: ProductSummary[];
  overview: ShapeVariantsOverview;
  onClose: () => void;
  onOpenReview: (record: ShapeVariantRecord) => void;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const areaProducts = products.filter((product) => product.shape === "area" && product.status === "ready");
  const generatable = overview.records.filter((record) => ["planned", "failed", "cancelled", "stale"].includes(record.status));
  const providerCalls = generatable.reduce((sum, record) => sum + record.candidateCount, 0);
  const reviewNext = overview.records.find((record) => record.status === "needs_review") ?? null;
  const approvedProducts = products.filter((product) => product.shape !== "area" && product.status === "ready");
  const missingShotCalls = approvedProducts.reduce(
    (sum, product) => sum + Math.max(0, product.counts.totalShots - product.counts.accepted - product.counts.reviewNeeded - product.counts.failed - product.counts.running),
    0
  );

  const run = async (label: string, action: () => Promise<void>) => {
    setBusy(label);
    setMessage(null);
    try {
      await action();
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const prepareAll = () => void run("prepare", async () => {
    if (areaProducts.length === 0) return;
    const response = await prepareShapeVariants({
      sourceProductIds: areaProducts.map((product) => product.id),
      shapes: ["runner", "round"],
      strategy: "auto",
      runnerRatio: 3.33,
      roundEdgePolicy: "preserve_source",
      imageSize: "4K",
      candidateCount: 1
    });
    setMessage(`Prepared ${response.records.length} variants. No provider calls were made.`);
    await onChanged();
  });

  const generatePlanned = () => void run("generate", async () => {
    if (providerCalls === 0) return;
    if (!window.confirm(`Generate all planned shape designs?\n\nThis request allows up to ${providerCalls} billable provider call${providerCalls === 1 ? "" : "s"}; stale or invalid records make no call. Every result still requires human design approval.`)) return;
    const response = await generateShapeVariants(generatable.map((record) => record.id));
    const failures = response.results.filter((result) => result.error);
    setMessage(`${response.results.length - failures.length} variants queued${failures.length ? `; ${failures.length} blocked` : ""}.`);
    await onChanged();
  });

  const generateAllShots = () => void run("shots", async () => {
    if (missingShotCalls === 0) return;
    if (!window.confirm(`Queue missing product shots for approved Runner and Round rugs?\n\nUp to ${missingShotCalls} provider calls may be queued. Shots missing a required background or label are reported and skipped.`)) return;
    let queued = 0;
    let blocked = 0;
    for (let index = 0; index < approvedProducts.length; index += 50) {
      const response = await generateShapeVariantShots(approvedProducts.slice(index, index + 50).map((product) => product.id), "4K");
      queued += response.providerCallsQueued;
      blocked += response.results.reduce((total, result) => total + result.blocked.length, 0);
    }
    setMessage(`${queued} product shots queued${blocked ? `; ${blocked} blocked by missing setup` : ""}.`);
    await onChanged();
  });

  return (
    <div className="shapeModalOverlay" role="presentation">
      <section className="shapeCampaignModal" role="dialog" aria-modal="true" aria-labelledby="shape-campaign-title">
        <header className="shapeModalHeader">
          <div><span className="shapeModalEyebrow">Batch operations</span><h2 id="shape-campaign-title">Runner + Round campaign</h2><p>Prepare safely, generate deliberately, review every design, then create product shots.</p></div>
          <button type="button" onClick={onClose} aria-label="Close campaign"><X size={19} /></button>
        </header>
        <div className="campaignMetrics">
          <CampaignMetric value={areaProducts.length} label="Area sources" />
          <CampaignMetric value={overview.counts.planned} label="Planned" />
          <CampaignMetric value={overview.counts.queued + overview.counts.generating} label="Generating" active />
          <CampaignMetric value={overview.counts.needs_review} label="Need review" warning />
          <CampaignMetric value={overview.counts.approved} label="Approved" />
          <CampaignMetric value={overview.counts.failed + overview.counts.stale} label="Blocked" warning />
        </div>
        <div className="campaignSteps">
          <CampaignStep number="1" title="Prepare the matrix" copy={`Plan Runner and Round for ${areaProducts.length} ready Area rugs. This writes campaign state only.`} actionLabel={busy === "prepare" ? "Preparing…" : `Prepare ${areaProducts.length * 2} variants · 0 calls`} disabled={Boolean(busy) || areaProducts.length === 0} onAction={prepareAll} />
          <CampaignStep number="2" title="Generate design candidates" copy="Production default is one candidate per shape. Campaign state survives an app restart." actionLabel={busy === "generate" ? "Queuing…" : `Generate planned · up to ${providerCalls} calls`} disabled={Boolean(busy) || providerCalls === 0} onAction={generatePlanned} />
          <CampaignStep number="3" title="Human design review" copy="Approve the new shape itself before any lifestyle or detail images are produced." actionLabel={reviewNext ? `Review next · ${overview.counts.needs_review} waiting` : "Nothing waiting"} disabled={Boolean(busy) || !reviewNext} onAction={() => reviewNext && onOpenReview(reviewNext)} />
          <CampaignStep number="4" title="Generate shape-aware product shots" copy="Approved variants use the normal five-shot workflow with Runner- or Round-specific placement instructions." actionLabel={busy === "shots" ? "Queuing…" : `Generate missing shots · up to ${missingShotCalls} calls`} disabled={Boolean(busy) || missingShotCalls === 0} onAction={generateAllShots} />
        </div>
        {message ? <div className="campaignMessage">{message}</div> : null}
      </section>
    </div>
  );
}

function CampaignMetric({ value, label, active, warning }: { value: number; label: string; active?: boolean; warning?: boolean }) {
  return <div className={`campaignMetric ${active ? "isActive" : ""} ${warning ? "isWarning" : ""}`}><strong>{value}</strong><span>{label}</span></div>;
}

function CampaignStep({ number, title, copy, actionLabel, disabled, onAction }: { number: string; title: string; copy: string; actionLabel: string; disabled: boolean; onAction: () => void }) {
  return <div className="campaignStep"><span className="campaignStepNumber">{number}</span><div><strong>{title}</strong><p>{copy}</p></div><button className="controlButton" type="button" disabled={disabled} onClick={onAction}>{actionLabel}</button></div>;
}

function statusText(status: ShapeVariantRecord["status"]) {
  if (status === "needs_review") return "Ready for review";
  if (status === "approved") return "Approved";
  if (status === "queued") return "Queued";
  if (status === "generating") return "Generating";
  if (status === "stale") return "Source changed";
  if (status === "failed") return "Generation failed";
  return status.replaceAll("_", " ");
}
