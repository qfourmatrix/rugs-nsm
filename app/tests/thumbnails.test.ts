import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getOrCreateThumbnail } from "../server/thumbnails";
import { cleanupTempWorkspace, makeProduct, makeTempWorkspace, pathExists } from "./test-utils";

describe("thumbnail cache", () => {
  let workspace: string;
  let productRoot: string;

  beforeEach(async () => {
    workspace = await makeTempWorkspace();
    productRoot = path.join(workspace, "nsm100k");
    await makeProduct(productRoot, "SKU-001", ["base.png"]);
  });

  afterEach(async () => {
    await cleanupTempWorkspace(workspace);
  });

  it("creates a cached jpeg thumbnail for a supported image", async () => {
    const sourcePath = path.join(productRoot, "SKU-001", "base.png");
    const thumbnailPath = await getOrCreateThumbnail({
      productRoot,
      productId: "SKU-001",
      kind: "base",
      filename: "base.png",
      sourcePath
    });

    expect(thumbnailPath).toMatch(/\.jpg$/);
    expect(thumbnailPath ? await pathExists(thumbnailPath) : false).toBe(true);
  });

  it("returns null for unreadable thumbnail inputs so callers can fall back", async () => {
    const productDir = path.join(productRoot, "SKU-001");
    const sourcePath = path.join(productDir, "not-an-image.jpg");
    await mkdir(productDir, { recursive: true });
    await writeFile(sourcePath, "not actually an image");

    await expect(
      getOrCreateThumbnail({
        productRoot,
        productId: "SKU-001",
        kind: "generated",
        filename: "not-an-image.jpg",
        sourcePath
      })
    ).resolves.toBeNull();
  });
});
