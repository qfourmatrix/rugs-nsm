import type {
  AssetRecord,
  JobRecord,
  ProductSummary,
  ShotAggregateState
} from "../shared/types";
import { ApiError } from "./api";
import type { LocatedAsset } from "./types";

export const aggregateLabels: Record<ShotAggregateState, string> = {
  empty: "Empty",
  generating: "Generating",
  accepted: "Accepted",
  review_needed: "Review",
  failed: "Failed",
  rejected_only: "Trash only"
};

export function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return `${error.code}: ${error.message}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unknown error";
}

export function isRunningJob(job: JobRecord): boolean {
  return job.status === "queued" || job.status === "generating";
}

export function isProductGeneratable(product: ProductSummary | null): boolean {
  return product?.status === "ready";
}

export function formatDateTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export function sortNewestAssets<T extends AssetRecord>(assets: T[]): T[] {
  return [...assets].sort((left, right) => {
    return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
  });
}

export function toLocatedAssets(active: AssetRecord[], trash: AssetRecord[]): LocatedAsset[] {
  return sortNewestAssets([
    ...active.map((asset) => ({ ...asset, location: "generated" as const })),
    ...trash.map((asset) => ({ ...asset, location: "trash" as const }))
  ]);
}

export function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function truncate(value: string, max = 140): string {
  if (value.length <= max) {
    return value;
  }

  return `${value.slice(0, max - 1)}...`;
}
