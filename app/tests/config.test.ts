import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../server/config";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("portable app configuration", () => {
  it("defaults to the data folder beside the app on any Mac username", () => {
    const config = loadConfig({ PROVIDER_MODE: "mock" });

    expect(config.productRoot).toBe(path.resolve(appRoot, "../data/nsm100k"));
  });

  it("resolves a relative configured product root from the app folder", () => {
    const config = loadConfig({
      PROVIDER_MODE: "mock",
      APP_PRODUCT_ROOT: "../data/recipient-library"
    });

    expect(config.productRoot).toBe(path.resolve(appRoot, "../data/recipient-library"));
  });

  it("preserves an explicitly configured absolute product root", () => {
    const config = loadConfig({
      PROVIDER_MODE: "mock",
      APP_PRODUCT_ROOT: "/Volumes/Rugs/products"
    });

    expect(config.productRoot).toBe("/Volumes/Rugs/products");
  });
});
