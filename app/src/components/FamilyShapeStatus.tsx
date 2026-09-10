import type { ProductShape, ProductSummary } from "../../shared/types";

export type ShapeExportStatus = "ready" | "not-ready" | "missing";
const labels: Record<ProductShape, string> = { area: "Area", runner: "Runner", round: "Round" };

export function ShapeStatusIcon({ shape, status, label }: { shape: ProductShape; status: ShapeExportStatus; label?: string }) {
  const description = label ?? `${labels[shape]}: ${status === "ready" ? "ready for export" : status === "missing" ? "missing" : "not ready for export"}`;
  return <span className="familyShapeStatusSlot" role="img" aria-label={description} title={description}>
    <span className={`familyShapeGlyph shape-${shape} export-${status}`} aria-hidden="true" />
  </span>;
}

export function FamilyShapeStatus({ products, familyName }: { products: ProductSummary[]; familyName?: string }) {
  return <span className="familyShapeStatus" aria-label={familyName ? `${familyName} export readiness` : "Shape export readiness"}>
    {(["area", "runner", "round"] as const).map((shape) => {
      const product = products.find((candidate) => candidate.shape === shape);
      if (product?.readinessError) return <span key={shape} className="familyShapeStatusError" title={`${labels[shape]}: readiness unavailable — ${product.readinessError}`} aria-label={`${labels[shape]}: readiness unavailable`}>?</span>;
      const status: ShapeExportStatus = !product?.baseImage || product.status === "missing_base" ? "missing" : product.exportReady ? "ready" : "not-ready";
      return <ShapeStatusIcon key={shape} shape={shape} status={status} />;
    })}
  </span>;
}
