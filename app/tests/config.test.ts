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

  it("supports explicit QA overrides without editing the recipient's private env file", () => {
    const config = loadConfig({
      PROVIDER_MODE: "laozhang",
      LAOZHANG_API_KEY: "private-key",
      APP_PORT: "8787",
      APP_PRODUCT_ROOT: "/Volumes/Rugs/live",
      RUGS_PROVIDER_MODE_OVERRIDE: "mock",
      RUGS_PORT_OVERRIDE: "18878",
      RUGS_PRODUCT_ROOT_OVERRIDE: "/tmp/rugs-qa"
    });

    expect(config).toMatchObject({ providerMode: "mock", port: 18878, productRoot: "/tmp/rugs-qa" });
  });
});
