import { AlertTriangle, Circle, Eye, LayoutGrid, LoaderCircle, Trash2, XCircle } from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type {
  GeneratedResponse,
  JobRecord,
  ProductSummary
} from "../../shared/types";
import { AttemptCard } from "./AttemptCard";
import { JobLog } from "./JobLog";
import type { LocatedAsset } from "../types";
import { formatDateTime, isRunningJob, truncate } from "../utils";

const INITIAL_VISIBLE_ATTEMPTS = 80;
const LOAD_MORE_ATTEMPTS = 80;
const GRID_COLUMN_STORAGE_KEY = "product-shot-queue:left-grid-columns";
const gridColumnOptions = [3, 4, 5] as const;

type GridColumnCount = (typeof gridColumnOptions)[number];

interface LeftPanelProps {
  product: ProductSummary | null;
  generated: GeneratedResponse;
  jobs: JobRecord[];
  assets: LocatedAsset[];
  selectedAssetId: string | null;
  showTrash: boolean;
  actionDisabled: boolean;
  runningShotIds: Set<string>;
  onShowTrashChange: (value: boolean) => void;
  onSelectAsset: (assetId: string) => void;
  onAccept: (assetId: string) => void;
  onReject: (assetId: string) => void;
  onRetry: (assetId: string) => void;
  onCancelJob: (jobId: string) => void;
}

export function LeftPanel({
  product,
  generated,
  jobs,
  assets,
  selectedAssetId,
  showTrash,
  actionDisabled,
  runningShotIds,
  onShowTrashChange,
  onSelectAsset,
  onAccept,
  onReject,
  onRetry,
  onCancelJob
}: LeftPanelProps) {
  const [visibleLimit, setVisibleLimit] = useState(INITIAL_VISIBLE_ATTEMPTS);
  const [gridColumns, setGridColumns] = useState<GridColumnCount>(() => {
    const stored = window.localStorage.getItem(GRID_COLUMN_STORAGE_KEY);
    const parsed = stored ? Number.parseInt(stored, 10) : 4;
    return isGridColumnCount(parsed) ? parsed : 4;
  });
  const visibleAssets = useMemo(
    () => (showTrash ? assets : assets.filter((asset) => asset.location !== "trash")),
    [assets, showTrash]
  );
  const visibleAssetIds = useMemo(
    () => new Set(visibleAssets.map((asset) => asset.assetId)),
    [visibleAssets]
  );
  const gridJobs = useMemo(
    () =>
      jobs.filter((job) => {
        if (job.status !== "queued" && job.status !== "generating" && job.status !== "failed") {
          return false;
        }

        return !job.assetId || !visibleAssetIds.has(job.assetId);
      }),
    [jobs, visibleAssetIds]
  );
  const displayItems = useMemo(
    () =>
      [
        ...gridJobs.map((job) => ({ type: "job" as const, id: job.jobId, timestamp: job.updatedAt, job })),
        ...visibleAssets.map((asset) => ({ type: "asset" as const, id: asset.assetId, timestamp: asset.createdAt, asset }))
      ].sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime()),
    [gridJobs, visibleAssets]
  );
  const visibleItems = displayItems.slice(0, visibleLimit);

  useEffect(() => {
    setVisibleLimit(INITIAL_VISIBLE_ATTEMPTS);
  }, [product?.id, showTrash]);

  useEffect(() => {
    window.localStorage.setItem(GRID_COLUMN_STORAGE_KEY, String(gridColumns));
  }, [gridColumns]);

  const gridStyle = {
    "--attempt-grid-columns": gridColumns
  } as CSSProperties;

  return (
    <aside className="leftPanel">
      <section className="attemptsPanel" aria-label="Generated attempts">
        <div className="panelHeader">
          <div>
            <h1>{product?.name ?? "No product selected"}</h1>
            <p>{productSubline(product, generated.active.length, generated.trash.length)}</p>
          </div>

          <div className="leftPanelTools">
            <div className="gridPillGroup" aria-label="Grid columns">
              <LayoutGrid size={14} aria-hidden="true" />
              {gridColumnOptions.map((count) => (
                <button
                  key={count}
                  type="button"
                  className={gridColumns === count ? "isActive" : ""}
                  aria-label={`${count} columns`}
                  aria-pressed={gridColumns === count}
                  onClick={() => setGridColumns(count)}
                >
                  {count}
                </button>
              ))}
            </div>

            <label className="toggleControl">
              <input
                type="checkbox"
                checked={showTrash}
                onChange={(event) => onShowTrashChange(event.target.checked)}
              />
              <Trash2 size={14} />
              <span>Show Trash</span>
            </label>
          </div>
        </div>

        {product?.errors.length ? (
          <div className="inlineAlert">
            {product.errors.map((error) => (
              <span key={error}>{error}</span>
            ))}
          </div>
        ) : null}

        {displayItems.length === 0 ? (
          <div className="emptyState compact">
            <Eye size={22} />
            <strong>No visible attempts</strong>
            <span>
              {showTrash
                ? "This product has no generated, failed, or rejected attempts yet."
                : "Generated and failed attempts will appear newest first."}
            </span>
          </div>
        ) : (
          <>
            <div className="attemptGrid" style={gridStyle}>
              {visibleItems.map((item) =>
                item.type === "asset" ? (
                  <AttemptCard
                    asset={item.asset}
                    productId={item.asset.productId}
                    key={`${item.asset.location}:${item.asset.assetId}`}
                    selected={selectedAssetId === item.asset.assetId}
                    actionDisabled={actionDisabled}
                    retryDisabled={runningShotIds.has(item.asset.shotId)}
                    onSelect={onSelectAsset}
                    onAccept={onAccept}
                    onReject={onReject}
                    onRetry={onRetry}
                  />
                ) : (
                  <JobAttemptCard
                    job={item.job}
                    key={`job:${item.job.jobId}`}
                    onCancelJob={onCancelJob}
                  />
                )
              )}
            </div>
            {displayItems.length > visibleItems.length ? (
              <button
                className="loadMoreAttempts"
                type="button"
                onClick={() => setVisibleLimit((limit) => limit + LOAD_MORE_ATTEMPTS)}
              >
                Show {Math.min(LOAD_MORE_ATTEMPTS, displayItems.length - visibleItems.length)} more
              </button>
            ) : null}
          </>
        )}
      </section>

      <JobLog jobs={jobs} onCancelJob={onCancelJob} />
    </aside>
  );
}

function isGridColumnCount(value: number): value is GridColumnCount {
  return gridColumnOptions.includes(value as GridColumnCount);
}

function JobAttemptCard({
  job,
  onCancelJob
}: {
  job: JobRecord;
  onCancelJob: (jobId: string) => void;
}) {
  const canCancel = isRunningJob(job);
  const batch = job.batchTotal && job.batchTotal > 1 ? ` ${job.batchIndex ?? 1}/${job.batchTotal}` : "";

  return (
    <article className={`attemptCard jobAttemptCard status-${job.status}`}>
      <div className="jobAttemptThumb">
        <span className={`jobAttemptIcon status-${job.status}`}>{jobGridIcon(job.status)}</span>
        <span className={`statusPill status-${job.status}`}>{job.status}</span>
      </div>

      <div className="attemptMeta">
        <div className="attemptTitleRow">
          <strong>{job.shotName ?? job.shotId}</strong>
        </div>
        <div className="attemptSubline">
          <span>{formatDateTime(job.updatedAt)}</span>
          <span>{batch ? `Batch${batch}` : "Queue"}</span>
        </div>
        <p className={job.status === "failed" ? "errorSummary" : "jobAttemptMessage"}>
          {job.status === "failed" ? <AlertTriangle size={13} /> : null}
          {truncate(job.message, 96)}
        </p>
      </div>

      {canCancel ? (
        <div className="attemptActions">
          <button className="iconTextButton reviewAction" type="button" onClick={() => onCancelJob(job.jobId)}>
            <XCircle size={14} />
            <span>Cancel</span>
          </button>
        </div>
      ) : null}
    </article>
  );
}

function jobGridIcon(status: JobRecord["status"]) {
  if (status === "generating") {
    return <LoaderCircle className="spin" size={24} />;
  }

  if (status === "queued") {
    return <Circle size={24} />;
  }

  if (status === "failed") {
    return <AlertTriangle size={24} />;
  }

  return <XCircle size={24} />;
}

function productSubline(product: ProductSummary | null, activeCount: number, trashCount: number) {
  if (!product) {
    return "Scan or select a product folder to begin.";
  }

  if (product.status === "missing_base") {
    return "Missing a base.* image. Generation is disabled.";
  }

  if (product.status === "duplicate_base") {
    return "Multiple base images found. Resolve before generating.";
  }

  return `${activeCount} active attempts, ${trashCount} rejected`;
}
