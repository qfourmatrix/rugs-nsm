import { AlertTriangle, Check, Eye, RotateCcw, Trash2, XCircle } from "lucide-react";
import { useEffect, useRef } from "react";
import { thumbnailUrl } from "../api";
import type { LocatedAsset } from "../types";
import { formatDateTime, truncate } from "../utils";

interface AttemptCardProps {
  asset: LocatedAsset;
  productId: string;
  selected: boolean;
  actionDisabled: boolean;
  retryDisabled: boolean;
  onSelect: (assetId: string) => void;
  onAccept: (assetId: string) => void;
  onReject: (assetId: string) => void;
  onRetry: (assetId: string) => void;
}

export function AttemptCard({
  asset,
  productId,
  selected,
  actionDisabled,
  retryDisabled,
  onSelect,
  onAccept,
  onReject,
  onRetry
}: AttemptCardProps) {
  const acceptedRef = useRef<HTMLSpanElement>(null);
  const retainAcceptFocus = useRef(false);
  useEffect(() => {
    if (asset.status === "accepted" && retainAcceptFocus.current) {
      acceptedRef.current?.focus();
      retainAcceptFocus.current = false;
    }
  }, [asset.status]);
  const canAccept = !actionDisabled && asset.status === "done" && asset.location === "generated" && Boolean(asset.output?.file);
  const canReject = !actionDisabled && asset.status !== "failed" && asset.status !== "rejected";
  const canRetry = !actionDisabled && !retryDisabled;
  const imageFile = asset.output?.file ?? null;
  const imageKind = asset.location === "trash" ? "trash" : "generated";
  const reviewLabel = `Review ${asset.shotName} attempt ${asset.attempt}`;

  return (
    <article
      className={`attemptCard status-${asset.status} ${selected ? "isSelected" : ""}`}
    >
      <button
        className="attemptReviewSurface"
        type="button"
        aria-label={`Open ${asset.shotName} attempt ${asset.attempt}`}
        aria-pressed={selected}
        onClick={() => onSelect(asset.assetId)}
      >
        <div className="attemptThumb">
          {asset.status === "failed" || !imageFile ? (
            <div className="failedThumb">
              <XCircle size={26} />
              <span>{asset.error?.code ?? "FAILED"}</span>
            </div>
          ) : (
            <img
              src={thumbnailUrl(productId, imageKind, imageFile)}
              alt={`${asset.shotName} generated attempt`}
              loading="lazy"
            />
          )}
        </div>

        <div className="attemptMeta">
          <div className="attemptTitleRow">
            <strong>{asset.shotName}</strong>
            <span className={`statusPill status-${asset.status}`}>{asset.status}</span>
          </div>
          <div className="attemptSubline">
            <span>{formatDateTime(asset.createdAt)}</span>
            {asset.inputs.construction ? (
              <span title={asset.inputs.construction.prompt}>{asset.inputs.construction.name}</span>
            ) : null}
            <span>A{asset.attempt}</span>
          </div>
          {asset.status === "failed" ? (
            <p className="errorSummary">
              <AlertTriangle size={13} />
              {truncate(asset.error?.message ?? "Generation failed", 96)}
            </p>
          ) : null}
        </div>
      </button>

      {asset.status === "accepted" && asset.location === "generated" ? (
        <span ref={acceptedRef} tabIndex={-1} className="attemptQuickAccept isAccepted" aria-label={`${asset.shotName} attempt ${asset.attempt} accepted`}><Check size={14} aria-hidden="true" /> Accepted</span>
      ) : asset.status === "done" && imageFile && asset.location === "generated" ? (
        <button className="attemptQuickAccept" type="button" disabled={!canAccept}
          title={`Accept ${asset.shotName} attempt ${asset.attempt}`}
          aria-label={`Accept ${asset.shotName} attempt ${asset.attempt}`}
          onClick={(event) => { retainAcceptFocus.current = document.activeElement === event.currentTarget; onAccept(asset.assetId); }}><Check size={14} aria-hidden="true" /> Accept</button>
      ) : null}

      <div className="attemptActions">
        <button
          className="iconTextButton reviewAction"
          type="button"
          aria-label={reviewLabel}
          onClick={() => onSelect(asset.assetId)}
        >
          <Eye size={14} />
          <span>Review</span>
        </button>
        <button
          className="iconButton"
          type="button"
          title={`Reject ${asset.shotName} attempt ${asset.attempt}`}
          aria-label={`Reject ${asset.shotName} attempt ${asset.attempt}`}
          disabled={!canReject}
          onClick={() => onReject(asset.assetId)}
        >
          <Trash2 size={15} />
        </button>
        <button
          className="iconButton"
          type="button"
          title={
            retryDisabled
              ? `${asset.shotName} is already queued or generating`
              : `Retry ${asset.shotName} attempt ${asset.attempt}`
          }
          aria-label={`Retry ${asset.shotName} attempt ${asset.attempt}`}
          disabled={!canRetry}
          onClick={() => onRetry(asset.assetId)}
        >
          <RotateCcw size={15} />
        </button>
      </div>
    </article>
  );
}
