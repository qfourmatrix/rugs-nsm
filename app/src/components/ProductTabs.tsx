import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  LayoutGrid,
  LoaderCircle,
  MoreHorizontal,
  Package,
  Plus,
  RefreshCw,
  Search,
  X
} from "lucide-react";
import type { ProductSummary } from "../../shared/types";
import { thumbnailUrl } from "../api";

interface ProductTabsProps {
  products: ProductSummary[];
  selectedProductId: string | null;
  search: string;
  loading: boolean;
  onSearchChange: (value: string) => void;
  onSelectProduct: (productId: string) => void;
  onRescan: () => void;
  onCreateProduct: () => void;
}

type ProductFilter = "all" | "needs_attention" | "in_progress" | "complete";
type StatusTone = "warning" | "danger" | "running" | "review" | "progress" | "complete";

const PRODUCT_FILTERS: { id: ProductFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "needs_attention", label: "Needs attention" },
  { id: "in_progress", label: "In progress" },
  { id: "complete", label: "Complete" }
];

const productDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric"
});

export function ProductTabs({
  products,
  selectedProductId,
  search,
  loading,
  onSearchChange,
  onSelectProduct,
  onRescan,
  onCreateProduct
}: ProductTabsProps) {
  const [browserOpen, setBrowserOpen] = useState(false);
  const [filter, setFilter] = useState<ProductFilter>("all");
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());
  const browseButtonRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const overflowRef = useRef<HTMLDetailsElement>(null);
  const productTabsRef = useRef<HTMLElement>(null);

  const productsByFamily = useMemo(() => {
    const families = new Map<string, ProductSummary[]>();
    for (const product of products) {
      const family = families.get(product.familyId) ?? [];
      family.push(product);
      families.set(product.familyId, family);
    }
    return families;
  }, [products]);
  const familySources = useMemo(
    () => [...productsByFamily.values()].map((family) => family.find((product) => product.shape === "area") ?? family[0]).filter((product): product is ProductSummary => Boolean(product)),
    [productsByFamily]
  );
  const selectedProduct = products.find((product) => product.id === selectedProductId) ?? null;
  const selectedFamilyIndex = familySources.findIndex((product) => product.familyId === selectedProduct?.familyId);
  const selectedStatus = selectedProduct ? productStatus(selectedProduct) : null;
  const previousProduct = selectedFamilyIndex > 0 ? familySources[selectedFamilyIndex - 1] : null;
  const nextProduct = selectedFamilyIndex >= 0 && selectedFamilyIndex < familySources.length - 1 ? familySources[selectedFamilyIndex + 1] : null;
  const runningCount = products.reduce((total, product) => total + product.counts.running, 0);

  const visibleProducts = useMemo(
    () =>
      familySources.filter((product) => {
        const matchesSearch = !deferredSearch || product.name.toLowerCase().includes(deferredSearch);
        return matchesSearch && matchesFamilyFilter(productsByFamily.get(product.familyId) ?? [product], filter);
      }),
    [deferredSearch, familySources, filter, productsByFamily]
  );

  const selectFamily = (product: ProductSummary) => {
    const desiredShape = selectedProduct?.shape ?? "area";
    const family = productsByFamily.get(product.familyId) ?? [product];
    onSelectProduct(family.find((candidate) => candidate.shape === desiredShape)?.id ?? product.id);
  };

  useEffect(() => {
    if (!browserOpen) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.requestAnimationFrame(() => searchInputRef.current?.focus());

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setBrowserOpen(false);
        return;
      }

      if (event.key !== "Tab" || !dialogRef.current) {
        return;
      }

      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      )].filter((element) => !element.hasAttribute("hidden"));
      const first = focusable[0];
      const last = focusable.at(-1);

      if (!first || !last) {
        return;
      }

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      browseButtonRef.current?.focus();
    };
  }, [browserOpen]);

  useEffect(() => {
    const selectedTab = productTabsRef.current?.querySelector<HTMLElement>('[data-selected="true"]');
    selectedTab?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [selectedProductId]);

  const closeBrowser = () => setBrowserOpen(false);
  const selectFromBrowser = (productId: string) => {
    onSelectProduct(productId);
    closeBrowser();
  };
  const runOverflowAction = (action: () => void) => {
    if (overflowRef.current) {
      overflowRef.current.open = false;
    }
    action();
  };

  return (
    <>
      <header className="topbar">
        <div className="topbarNavigation">
          {selectedProduct ? (
            <button
              className="currentProductButton"
              type="button"
              onClick={() => setBrowserOpen(true)}
              title="Open product browser"
            >
              <ProductThumbnail product={selectedProduct} className="currentProductThumb" />
              <span className="currentProductCopy">
                <span className="currentProductName">{selectedProduct.name}</span>
                <span className={`currentProductStatus status-${selectedStatus?.tone}`}>
                  {selectedStatus?.label}
                </span>
              </span>
            </button>
          ) : (
            <div className="currentProductEmpty">
              <Package size={17} aria-hidden="true" />
              <span>{products.length === 0 ? "No products scanned" : "Select a product"}</span>
            </div>
          )}

          <div className="productStepControls" aria-label="Product navigation">
            <button
              className="topbarIconButton"
              type="button"
              onClick={() => previousProduct && selectFamily(previousProduct)}
              disabled={!previousProduct || loading}
              aria-label={previousProduct ? `Previous product: ${previousProduct.name}` : "No previous product"}
              title={previousProduct?.name ?? "No previous product"}
            >
              <ArrowLeft size={16} aria-hidden="true" />
            </button>
            <button
              className="topbarIconButton"
              type="button"
              onClick={() => nextProduct && selectFamily(nextProduct)}
              disabled={!nextProduct || loading}
              aria-label={nextProduct ? `Next product: ${nextProduct.name}` : "No next product"}
              title={nextProduct?.name ?? "No next product"}
            >
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          </div>

          <button
            ref={browseButtonRef}
            className="browseProductsButton"
            type="button"
            onClick={() => setBrowserOpen(true)}
            aria-label={`Browse product families, ${familySources.length} total`}
          >
            <LayoutGrid size={16} aria-hidden="true" />
            <span>Browse families</span>
            <span className="browseProductCount">{familySources.length}</span>
          </button>
        </div>

        <div className="topbarTools">
          <div className={`queueSummary ${runningCount > 0 ? "isActive" : ""}`} aria-live="polite">
            {runningCount > 0 ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : null}
            <span>{runningCount > 0 ? `${runningCount} running` : "Queue idle"}</span>
          </div>

          <details className="topbarOverflow" ref={overflowRef}>
            <summary aria-label="Product actions" title="Product actions">
              <MoreHorizontal size={18} aria-hidden="true" />
            </summary>
            <div className="topbarOverflowMenu">
              <button type="button" onClick={() => runOverflowAction(onRescan)} disabled={loading}>
                <RefreshCw className={loading ? "spin" : undefined} size={15} aria-hidden="true" />
                <span>Rescan products</span>
              </button>
              <button type="button" onClick={() => runOverflowAction(onCreateProduct)} disabled={loading}>
                <Plus size={15} aria-hidden="true" />
                <span>Create product</span>
              </button>
            </div>
          </details>
        </div>

        <nav className="productTabsRail" ref={productTabsRef} aria-label="Product tabs">
          {familySources.map((product) => {
            const selected = product.familyId === selectedProduct?.familyId;
            const family = productsByFamily.get(product.familyId) ?? [product];
            const status = familyStatus(family);

            return (
              <button
                className={`productRailTab ${selected ? "isSelected" : ""}`}
                type="button"
                key={product.id}
                data-selected={selected}
                onClick={() => selectFamily(product)}
                aria-current={selected ? "page" : undefined}
                title={product.name}
              >
                <ProductThumbnail product={product} className="productRailThumb" />
                <span className="productRailCopy">
                  <span className="productRailName">{product.name}</span>
                  <span className={`productRailStatus status-${status.tone}`}>{status.label}</span>
                </span>
              </button>
            );
          })}
        </nav>
      </header>

      {browserOpen ? (
        <div className="productBrowserOverlay" onMouseDown={(event) => handleBackdropMouseDown(event, closeBrowser)}>
          <section
            className="productBrowserModal"
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="product-browser-title"
          >
            <header className="productBrowserHeader">
              <div>
                <h2 id="product-browser-title">Products</h2>
                <p>{visibleProducts.length === familySources.length ? `${familySources.length} families` : `${visibleProducts.length} of ${familySources.length} families`}</p>
              </div>
              <button className="productBrowserClose" type="button" onClick={closeBrowser} aria-label="Close product browser">
                <X size={18} aria-hidden="true" />
              </button>
            </header>

            <div className="productBrowserControls">
              <div className="productBrowserSearch">
                <Search size={17} aria-hidden="true" />
                <input
                  ref={searchInputRef}
                  value={search}
                  aria-label="Search products"
                  placeholder="Search products"
                  onChange={(event) => onSearchChange(event.target.value)}
                />
                {search ? (
                  <button type="button" onClick={() => onSearchChange("")} aria-label="Clear product search">
                    <X size={15} aria-hidden="true" />
                  </button>
                ) : null}
              </div>

              <div className="productFilterGroup" role="group" aria-label="Filter products">
                {PRODUCT_FILTERS.map((option) => (
                  <button
                    className={filter === option.id ? "isSelected" : ""}
                    type="button"
                    key={option.id}
                    onClick={() => setFilter(option.id)}
                    aria-pressed={filter === option.id}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="productBrowserResults">
              {visibleProducts.length > 0 ? (
                <div className="productCardGrid">
                  {visibleProducts.map((product) => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      family={productsByFamily.get(product.familyId) ?? [product]}
                      selected={product.familyId === selectedProduct?.familyId}
                      onSelect={() => selectFromBrowser(product.id)}
                    />
                  ))}
                </div>
              ) : (
                <div className="productBrowserEmpty">
                  <Search size={24} aria-hidden="true" />
                  <strong>No matching products</strong>
                  <span>Try a different name or status filter.</span>
                  <button
                    type="button"
                    onClick={() => {
                      onSearchChange("");
                      setFilter("all");
                    }}
                  >
                    Clear filters
                  </button>
                </div>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

function ProductCard({
  product,
  family,
  selected,
  onSelect
}: {
  product: ProductSummary;
  family: ProductSummary[];
  selected: boolean;
  onSelect: () => void;
}) {
  const status = familyStatus(family);

  return (
    <button
      className={`productBrowserCard ${selected ? "isSelected" : ""}`}
      type="button"
      onClick={onSelect}
      aria-current={selected ? "page" : undefined}
    >
      <ProductThumbnail product={product} className="productBrowserCardImage" />
      <span className="productBrowserCardBody">
        <span className="productBrowserCardTitle">{product.name}</span>
        <span className="productShapeAvailability">
          {(["area", "runner", "round"] as const).map((shape) => (
            <span className={family.some((candidate) => candidate.shape === shape) ? "isReady" : ""} key={shape}>{shape}</span>
          ))}
        </span>
        <span className="productBrowserCardDate">Created {formatProductDate(product.createdAt)}</span>
        <span className="productBrowserCardMeta">
          <span>{product.counts.accepted} of {product.counts.totalShots} accepted</span>
          <span className={`productPriorityStatus status-${status.tone}`}>{status.label}</span>
        </span>
      </span>
    </button>
  );
}

function ProductThumbnail({ product, className }: { product: ProductSummary; className: string }) {
  const preview = productPreview(product);

  return (
    <span className={className} aria-hidden="true">
      {preview ? (
        <img src={thumbnailUrl(product.id, preview.kind, preview.filename)} alt="" loading="lazy" />
      ) : (
        <Package size={22} />
      )}
    </span>
  );
}

export function productPreview(
  product: ProductSummary
): { kind: "base" | "reference"; filename: string } | null {
  if (product.baseImage) {
    return { kind: "base", filename: product.baseImage };
  }

  if (product.status !== "missing_base") {
    return null;
  }

  const currentReference =
    product.referenceImages.find((filename) => /^refine-reference\./i.test(filename)) ??
    product.referenceImages[0];
  return currentReference ? { kind: "reference", filename: currentReference } : null;
}

export function productStatus(product: ProductSummary): { label: string; tone: StatusTone } {
  if (product.status === "missing_base") return { label: "Missing base", tone: "warning" };
  if (product.status === "duplicate_base") return { label: "Duplicate base", tone: "danger" };
  if (product.status === "invalid_variant") return { label: "Invalid variant", tone: "danger" };
  if (product.counts.running > 0) return { label: "Running", tone: "running" };
  if (product.counts.failed > 0) return { label: "Failed", tone: "danger" };
  if (product.counts.reviewNeeded > 0) return { label: "Needs review", tone: "review" };
  if (isProductComplete(product)) return { label: "Complete", tone: "complete" };
  return { label: "In progress", tone: "progress" };
}

export function matchesProductFilter(product: ProductSummary, filter: ProductFilter) {
  if (filter === "all") return true;
  if (filter === "complete") return isProductComplete(product);

  const needsAttention =
    product.status !== "ready" || product.counts.failed > 0 || product.counts.reviewNeeded > 0;
  return filter === "needs_attention" ? needsAttention : !needsAttention && !isProductComplete(product);
}

function matchesFamilyFilter(family: ProductSummary[], filter: ProductFilter) {
  if (filter === "all") return true;
  const statuses = family.map(productStatus);
  const complete = family.length > 0 && family.every(isProductComplete);
  if (filter === "complete") return complete;
  const needsAttention = family.some((product) => product.status !== "ready") || statuses.some((status) => ["danger", "review", "warning"].includes(status.tone));
  return filter === "needs_attention" ? needsAttention : !needsAttention && !complete;
}

function familyStatus(family: ProductSummary[]): { label: string; tone: StatusTone } {
  const statuses = family.map(productStatus);
  for (const tone of ["running", "danger", "review", "warning"] as const) {
    const match = statuses.find((status) => status.tone === tone);
    if (match) return match;
  }
  const shapesReady = new Set(family.filter((product) => product.status === "ready").map((product) => product.shape)).size;
  if (shapesReady === 3 && family.every(isProductComplete)) return { label: "Family complete", tone: "complete" };
  return { label: `${shapesReady}/3 shapes`, tone: shapesReady === 3 ? "progress" : "review" };
}

function isProductComplete(product: ProductSummary) {
  return (
    product.status === "ready" &&
    product.counts.totalShots > 0 &&
    product.counts.accepted >= product.counts.totalShots &&
    product.counts.failed === 0 &&
    product.counts.reviewNeeded === 0 &&
    product.counts.running === 0
  );
}

function formatProductDate(createdAt: string) {
  const date = new Date(createdAt);
  return Number.isNaN(date.getTime()) ? "Unknown" : productDateFormatter.format(date);
}

function handleBackdropMouseDown(event: ReactMouseEvent<HTMLDivElement>, close: () => void) {
  if (event.target === event.currentTarget) {
    close();
  }
}
