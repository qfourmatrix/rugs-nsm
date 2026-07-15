import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  ImageOff,
  RotateCcw,
  Trash2
} from "lucide-react";
import type { ProductSummary } from "../../shared/types";
import { imageUrl } from "../api";
import type { LocatedAsset } from "../types";
import { formatDateTime } from "../utils";

interface ComparePanelProps {
  product: ProductSummary | null;
  selectedAsset: LocatedAsset | null;
  assets: LocatedAsset[];
  actionDisabled: boolean;
  retryDisabled: boolean;
  onBackToGenerate: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onAccept: (assetId: string) => void;
  onReject: (assetId: string) => void;
  onRetry: (assetId: string) => void;
}

export function ComparePanel({
  product,
  selectedAsset,
  assets,
  actionDisabled,
  retryDisabled,
  onBackToGenerate,
  onPrevious,
  onNext,
  onAccept,
  onReject,
  onRetry
}: ComparePanelProps) {
  const selectedIndex = selectedAsset
    ? assets.findIndex((asset) => asset.assetId === selectedAsset.assetId)
    : -1;
  const canNavigatePrevious = selectedIndex > 0;
  const canNavigateNext = selectedIndex >= 0 && selectedIndex < assets.length - 1;
  const canAccept = !actionDisabled && selectedAsset?.status !== "failed" && selectedAsset?.status !== "rejected";
  const canReject = !actionDisabled && selectedAsset?.status !== "failed" && selectedAsset?.status !== "rejected";

  if (!product || !selectedAsset) {
    return (
      <section className="comparePanel">
        <div className="modeHeader">
          <div>
            <h2>Compare</h2>
            <p>Select a generated or failed card to review it against the base image.</p>
          </div>
          <button className="controlButton" type="button" onClick={onBackToGenerate}>
            <ArrowLeft size={15} />
            <span>Generate</span>
          </button>
        </div>
        <div className="emptyState">
          <ImageOff size={24} />
          <strong>No attempt selected</strong>
          <span>Click a generated card in the left panel to open compare mode.</span>
        </div>
      </section>
    );
  }

  return (
    <section className="comparePanel">
      <div className="modeHeader">
        <div>
          <h2>{selectedAsset.shotName}</h2>
          <p>
            {formatDateTime(selectedAsset.createdAt)} - Attempt {selectedAsset.attempt} -{" "}
            {selectedIndex + 1}/{assets.length}
          </p>
        </div>

        <div className="bulkActions">
          <button className="iconTextButton" type="button" onClick={onPrevious} disabled={!canNavigatePrevious}>
            <ChevronLeft size={15} />
            <span>Prev</span>
          </button>
          <button className="iconTextButton" type="button" onClick={onNext} disabled={!canNavigateNext}>
            <ChevronRight size={15} />
            <span>Next</span>
          </button>
          <button
            className="iconTextButton success"
            type="button"
            disabled={!canAccept || selectedAsset.status === "accepted"}
            onClick={() => onAccept(selectedAsset.assetId)}
          >
            <Check size={15} />
            <span>Accept</span>
          </button>
          <button
            className="iconTextButton danger"
            type="button"
            disabled={!canReject}
            onClick={() => onReject(selectedAsset.assetId)}
          >
            <Trash2 size={15} />
            <span>Reject</span>
          </button>
          <button
            className="iconTextButton"
            type="button"
            disabled={actionDisabled || retryDisabled}
            title={retryDisabled ? "This shot is already queued or generating" : "Retry exact prompt and settings"}
            onClick={() => onRetry(selectedAsset.assetId)}
          >
            <RotateCcw size={15} />
            <span>Retry Exact</span>
          </button>
          <button className="iconTextButton" type="button" onClick={onBackToGenerate}>
            <ArrowLeft size={15} />
            <span>Generate</span>
          </button>
        </div>
      </div>

      <div className="compareGrid">
        <figure className="imagePane">
          <figcaption>Base image</figcaption>
          {product.baseImage ? (
            <img src={imageUrl(product.id, "base", product.baseImage)} alt={`${product.name} base`} />
          ) : (
            <div className="missingImage">
              <AlertTriangle size={24} />
              <span>No valid base image</span>
            </div>
          )}
        </figure>

        <figure className="imagePane">
          <figcaption>
            Generated image
            <span className={`statusPill status-${selectedAsset.status}`}>{selectedAsset.status}</span>
          </figcaption>
          {selectedAsset.status === "failed" ? (
            <FailedDetails asset={selectedAsset} />
          ) : selectedAsset.output?.file ? (
            <img
              src={imageUrl(
                product.id,
                selectedAsset.location === "trash" ? "trash" : "generated",
                selectedAsset.output.file
              )}
              alt={`${selectedAsset.shotName} generated result`}
            />
          ) : (
            <div className="missingImage">
              <ImageOff size={24} />
              <span>Image output missing</span>
            </div>
          )}
        </figure>
      </div>

      <div className="assetMetaStrip" aria-label="Generated asset metadata">
        <div>
          <strong>Prompt</strong>
          <span>{selectedAsset.prompt}</span>
        </div>
        <div>
          <strong>Output</strong>
          <span>
            {selectedAsset.settings.aspectRatio} - {selectedAsset.settings.imageSize} -{" "}
            {selectedAsset.settings.model}
          </span>
        </div>
        <div>
          <strong>Inputs</strong>
          <span>
            {selectedAsset.inputs.baseImage.file}
            {selectedAsset.inputs.references.length > 0
              ? ` + ${selectedAsset.inputs.references.join(", ")}`
              : ""}{" "}
            ({selectedAsset.provider.requestPreview.inputImageCount} images)
          </span>
        </div>
      </div>
    </section>
  );
}

function FailedDetails({ asset }: { asset: LocatedAsset }) {
  const raw = asset.error?.raw ? JSON.stringify(asset.error.raw, null, 2) : "";

  return (
    <div className="failedDetails">
      <AlertTriangle size={24} />
      <strong>{asset.error?.message ?? "Generation failed"}</strong>
      <dl>
        <div>
          <dt>Code</dt>
          <dd>{asset.error?.code ?? "UNKNOWN"}</dd>
        </div>
        <div>
          <dt>Provider status</dt>
          <dd>{asset.provider.normalizedStatus}</dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd>{asset.provider.durationMs} ms</dd>
        </div>
        <div>
          <dt>Request</dt>
          <dd>
            {asset.provider.requestPreview.aspectRatio}, {asset.provider.requestPreview.imageSize},{" "}
            {asset.provider.requestPreview.inputImageCount} input image
          </dd>
        </div>
      </dl>
      {raw ? <pre>{raw}</pre> : null}
    </div>
  );
}
