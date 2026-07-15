import { writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyShotToProductState, loadProductState, saveProductState } from "../server/product-state";
import type { ProductState } from "../shared/types";
import {
  cleanupTempWorkspace,
  fixedIso,
  makeProduct,
  makeShot,
  makeTempWorkspace,
  readJson
} from "./test-utils";

describe("product prompt state", () => {
  let workspace: string;
  let productRoot: string;

  beforeEach(async () => {
    workspace = await makeTempWorkspace();
    productRoot = path.join(workspace, "nsm100k");
    await makeProduct(productRoot, "SKU-A");
    await makeProduct(productRoot, "SKU-B");
  });

  afterEach(async () => {
    await cleanupTempWorkspace(workspace);
  });

  it("saves and reloads prompt box drafts per product without leaking across products", async () => {
    const initialA = await loadProductState({ productRoot, productId: "SKU-A" });
    expect(new Date(initialA.createdAt).toISOString()).toBe(initialA.createdAt);
    const draftA: ProductState = {
      ...initialA,
      selectedShotId: "hero",
      promptBox: {
        value: "A-specific prompt draft",
        sourceShotId: "hero",
        dirty: true,
        updatedAt: fixedIso
      }
    };

    await saveProductState({ productRoot, productId: "SKU-A", state: draftA });

    const reloadedA = await loadProductState({ productRoot, productId: "SKU-A" });
    const reloadedB = await loadProductState({ productRoot, productId: "SKU-B" });

    expect(reloadedA.promptBox.value).toBe("A-specific prompt draft");
    expect(reloadedA.selectedShotId).toBe("hero");
    expect(reloadedB.promptBox.value).not.toBe("A-specific prompt draft");
    expect(reloadedB.productId).toBe("SKU-B");
  });

  it("loads older product-state files with new optional defaults", async () => {
    const productDir = path.join(productRoot, "SKU-A");
    await writeFile(
      path.join(productDir, "product-state.json"),
      `${JSON.stringify({
        version: 1,
        productId: "SKU-A",
        selectedShotId: null,
        selectedAssetId: null,
        promptBox: {
          value: "",
          sourceShotId: null,
          dirty: false,
          updatedAt: fixedIso
        },
        settings: {
          aspectRatio: "1:1",
          imageSize: "4K",
          concurrency: 2
        }
      })}\n`
    );

    const reloaded = await loadProductState({ productRoot, productId: "SKU-A" });

    expect(reloaded.settings.batchSize).toBe(1);
    expect(reloaded.referenceImages).toEqual([]);
    expect(reloaded.selectedBackgroundId).toBeNull();
    expect(reloaded.selectedConstructionId).toBeNull();
    expect(reloaded.refinePatternMode).toBe("symmetrical");
    expect(reloaded.refineVariationCount).toBe(3);
    expect(reloaded.sosPaletteId).toBe("auto_flip");
    expect(reloaded.sosCustomPalette).toEqual({ fieldColor: "#91413A", motifColor: "#E0CFB2" });
    expect(reloaded.sosDesignChange).toBe(false);
    expect(new Date(reloaded.createdAt).toISOString()).toBe(reloaded.createdAt);

    const persisted = await readJson<ProductState>(path.join(productDir, "product-state.json"));
    expect(persisted.createdAt).toBe(reloaded.createdAt);
    expect(persisted.sosPaletteId).toBe("auto_flip");
    expect(persisted.refineVariationCount).toBe(3);
  });

  it("persists each product's SOS palette and design-change choice", async () => {
    const initial = await loadProductState({ productRoot, productId: "SKU-A" });
    await saveProductState({
      productRoot,
      productId: "SKU-A",
      state: {
        ...initial,
        refinePatternMode: "sos",
        refineVariationCount: 4,
        sosPaletteId: "custom",
        sosCustomPalette: { fieldColor: "#123456", motifColor: "#ABCDEF" },
        sosDesignChange: true
      }
    });

    const reloaded = await loadProductState({ productRoot, productId: "SKU-A" });
    expect(reloaded).toMatchObject({
      refinePatternMode: "sos",
      refineVariationCount: 4,
      sosPaletteId: "custom",
      sosCustomPalette: { fieldColor: "#123456", motifColor: "#ABCDEF" },
      sosDesignChange: true
    });
  });

  it("removes stale refine sources from persisted normal references", async () => {
    const initial = await loadProductState({ productRoot, productId: "SKU-A" });
    const productStatePath = path.join(productRoot, "SKU-A", "product-state.json");
    await writeFile(
      productStatePath,
      `${JSON.stringify({
        ...initial,
        referenceImages: ["angle.png", "refine-reference.jpg"]
      })}\n`
    );

    const reloaded = await loadProductState({ productRoot, productId: "SKU-A" });
    const persisted = await readJson<ProductState>(productStatePath);

    expect(reloaded.referenceImages).toEqual(["angle.png"]);
    expect(persisted.referenceImages).toEqual(["angle.png"]);
  });

  it("loading a master shot replaces only the selected product's prompt box", async () => {
    const productA = await loadProductState({ productRoot, productId: "SKU-A" });
    const productB = await loadProductState({ productRoot, productId: "SKU-B" });
    const shot = makeShot({
      id: "texture_focus",
      name: "Texture Focus",
      prompt: "Macro texture prompt from master shots."
    });

    const updatedA: ProductState = await applyShotToProductState({
      state: productA,
      shot,
      now: fixedIso
    });

    await saveProductState({ productRoot, productId: "SKU-A", state: updatedA });

    const reloadedA = await loadProductState({ productRoot, productId: "SKU-A" });
    const reloadedB = await loadProductState({ productRoot, productId: "SKU-B" });

    expect(reloadedA.selectedShotId).toBe("texture_focus");
    expect(reloadedA.promptBox).toMatchObject({
      value: "Macro texture prompt from master shots.",
      sourceShotId: "texture_focus",
      dirty: false
    });
    expect(reloadedB.promptBox).toEqual(productB.promptBox);
  });
});
