import { mkdir } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compareProductsByCreatedAt, ensureProductRoot, resolveProductImagePath, scanProducts } from "../server/scanner";
import type { ProductSummary } from "../shared/types";
import {
  cleanupTempWorkspace,
  findProduct,
  makeProduct,
  makeTempWorkspace,
  pathExists,
  productList,
  writeFakeImage
} from "./test-utils";

describe("product scanner and root bootstrap", () => {
  let workspace: string;
  let productRoot: string;

  beforeEach(async () => {
    workspace = await makeTempWorkspace();
    productRoot = path.join(workspace, "nsm100k");
  });

  afterEach(async () => {
    await cleanupTempWorkspace(workspace);
  });

  it("creates the configured root and never falls back to old Rugs/first_image data", async () => {
    await makeProduct(path.join(workspace, "Rugs"), "Legacy-Rug", ["first_image.jpg"]);

    await ensureProductRoot({ productRoot });

    expect(await pathExists(productRoot)).toBe(true);
    const products = productList(await scanProducts({ productRoot }));
    expect(products).toEqual([]);
  });

  it("orders products newest-created first instead of sorting by name", () => {
    const summary = (id: string, createdAt: string): ProductSummary => ({
      id,
      name: id,
      createdAt,
      status: "ready",
      baseImage: "base.jpg",
      referenceImages: [],
      counts: { totalShots: 5, accepted: 0, reviewNeeded: 0, failed: 0, running: 0 },
      errors: []
    });
    const products = [
      summary("z-old", "2026-01-01T00:00:00.000Z"),
      summary("a-new", "2026-03-01T00:00:00.000Z"),
      summary("m-middle", "2026-02-01T00:00:00.000Z")
    ];

    expect(products.sort(compareProductsByCreatedAt).map((product) => product.id)).toEqual([
      "a-new",
      "m-middle",
      "z-old"
    ]);
  });

  it("detects only direct child products with exact supported base.* images", async () => {
    await makeProduct(productRoot, "Valid-Jpg", ["base.jpg"]);
    await makeProduct(productRoot, "Valid-Case", ["Base.PNG"]);
    await makeProduct(productRoot, "First-Image-Only", ["first_image.jpg"]);
    await makeProduct(productRoot, "Looks-Like-Base", ["base-final.jpg", "base.old.png"]);
    await makeProduct(productRoot, ".Hidden", ["base.jpg"]);

    await mkdir(path.join(productRoot, "Valid-Jpg", "generated", "Nested-Product"), {
      recursive: true
    });
    await writeFakeImage(path.join(productRoot, "Valid-Jpg", "generated", "Nested-Product", "base.jpg"));

    const products = productList(await scanProducts({ productRoot }));
    const names = products.map((product) => product.name).sort();

    expect(names).toEqual(["First-Image-Only", "Looks-Like-Base", "Valid-Case", "Valid-Jpg"]);
    expect(findProduct(products, "Valid-Jpg").status).toBe("ready");
    expect(findProduct(products, "Valid-Case").status).toBe("ready");
    expect(findProduct(products, "First-Image-Only").status).toBe("missing_base");
    expect(findProduct(products, "Looks-Like-Base").status).toBe("missing_base");
  });

  it("marks products with multiple supported base images as invalid", async () => {
    await makeProduct(productRoot, "Duplicate-Base", ["base.jpg", "Base.PNG"]);

    const products = productList(await scanProducts({ productRoot }));
    const duplicate = findProduct(products, "Duplicate-Base");

    expect(duplicate.status).toBe("duplicate_base");
    expect(duplicate.baseImage).toBeNull();
    expect(duplicate.errors.join(" ")).toMatch(/multiple|duplicate/i);
  });

  it("detects supported direct reference images from the references folder", async () => {
    const productDir = await makeProduct(productRoot, "With-Refs", ["base.jpg"]);
    await mkdir(path.join(productDir, "references"), { recursive: true });
    await writeFakeImage(path.join(productDir, "references", "angle.png"));
    await writeFakeImage(path.join(productDir, "references", "texture.webp"));
    await writeFakeImage(path.join(productDir, "references", "notes.txt"));

    const products = productList(await scanProducts({ productRoot }));
    const product = findProduct(products, "With-Refs");

    expect(product.referenceImages).toEqual(["angle.png", "texture.webp"]);
  });

  it("exposes the refine source only while a product is missing its base image", async () => {
    const missingDir = await makeProduct(productRoot, "Needs-Refine", []);
    const readyDir = await makeProduct(productRoot, "Refined", ["base.png"]);
    for (const productDir of [missingDir, readyDir]) {
      await writeFakeImage(path.join(productDir, "references", "refine-reference.jpg"));
      await writeFakeImage(path.join(productDir, "references", "angle.png"));
    }

    const products = productList(await scanProducts({ productRoot }));

    expect(findProduct(products, "Needs-Refine").referenceImages).toEqual([
      "angle.png",
      "refine-reference.jpg"
    ]);
    expect(findProduct(products, "Refined").referenceImages).toEqual(["angle.png"]);
  });

  it("serves only detected reference images from the references folder", async () => {
    const productDir = await makeProduct(productRoot, "With-Refs", ["base.jpg"]);
    await mkdir(path.join(productDir, "references"), { recursive: true });
    await writeFakeImage(path.join(productDir, "references", "angle.png"));
    const scan = await scanProducts({ productRoot });
    const products = productList(scan);

    await expect(
      resolveProductImagePath({
        productRoot,
        scan,
        products,
        productId: "With-Refs",
        kind: "reference",
        filename: "angle.png"
      })
    ).resolves.toMatch(/references/);

    await expect(
      resolveProductImagePath({
        productRoot,
        scan,
        products,
        productId: "With-Refs",
        kind: "reference",
        filename: "missing.png"
      })
    ).rejects.toThrow(/reference|image|not found/i);
  });

  it("rejects raw path traversal for product IDs and served image filenames", async () => {
    await makeProduct(productRoot, "SKU 001", ["base.jpg"]);
    const scan = await scanProducts({ productRoot });
    const products = productList(scan);

    await expect(
      resolveProductImagePath({
        productRoot,
        scan,
        products,
        productId: "../SKU 001",
        kind: "base",
        filename: "base.jpg"
      })
    ).rejects.toThrow(/path|traversal|invalid|unknown|product/i);

    await expect(
      resolveProductImagePath({
        productRoot,
        scan,
        products,
        productId: "SKU 001",
        kind: "generated",
        filename: "../base.jpg"
      })
    ).rejects.toThrow(/path|traversal|basename|filename|invalid/i);
  });
});
