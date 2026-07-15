import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_ASYMMETRICAL_REFINE_PROMPT,
  DEFAULT_SOS_REFINE_PROMPT,
  DEFAULT_SYMMETRICAL_REFINE_PROMPT,
  loadRefineSettings,
  refineSettingsPath,
  saveRecentSosPalette,
  saveRefineSettings
} from "../server/refine-settings";
import { cleanupTempWorkspace, fixedIso, makeTempWorkspace, pathExists, readJson } from "./test-utils";

describe("refine settings", () => {
  let workspace: string;
  let productRoot: string;

  beforeEach(async () => {
    workspace = await makeTempWorkspace();
    productRoot = path.join(workspace, "nsm100k");
    await mkdir(productRoot, { recursive: true });
  });

  afterEach(async () => {
    await cleanupTempWorkspace(workspace);
  });

  it("creates all global prompt profiles with their built-in defaults", async () => {
    const settings = await loadRefineSettings({ productRoot });

    expect(settings.prompts.symmetrical).toBe(DEFAULT_SYMMETRICAL_REFINE_PROMPT);
    expect(settings.prompts.asymmetrical).toBe(DEFAULT_ASYMMETRICAL_REFINE_PROMPT);
    expect(settings.prompts.sos).toBe(DEFAULT_SOS_REFINE_PROMPT);
    expect(settings.defaultPrompts).toEqual(settings.prompts);
    expect(settings.recentSosPalettes).toEqual([]);
    expect(await pathExists(refineSettingsPath(productRoot))).toBe(true);
  });

  it("updates only the selected prompt profile", async () => {
    const saved = await saveRefineSettings({
      productRoot,
      mode: "asymmetrical",
      prompt: "  A lasting custom asymmetrical prompt.  "
    });
    const reloaded = await loadRefineSettings({ productRoot });
    const persisted = await readJson<Record<string, unknown>>(refineSettingsPath(productRoot));

    expect(saved.prompts.asymmetrical).toBe("A lasting custom asymmetrical prompt.");
    expect(saved.prompts.symmetrical).toBe(DEFAULT_SYMMETRICAL_REFINE_PROMPT);
    expect(saved.prompts.sos).toBe(DEFAULT_SOS_REFINE_PROMPT);
    expect(reloaded.prompts).toEqual(saved.prompts);
    expect(reloaded.defaultPrompts.asymmetrical).toBe(DEFAULT_ASYMMETRICAL_REFINE_PROMPT);
    expect(persisted).not.toHaveProperty("defaultPrompts");
  });

  it("migrates the existing single custom prompt into the symmetrical profile", async () => {
    const filePath = refineSettingsPath(productRoot);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(
      filePath,
      `${JSON.stringify({ version: 1, prompt: "Existing proven prompt", updatedAt: fixedIso })}\n`
    );

    const settings = await loadRefineSettings({ productRoot });
    const persisted = await readJson<{ version: number; prompts: Record<string, string> }>(filePath);

    expect(settings.prompts.symmetrical).toBe("Existing proven prompt");
    expect(settings.prompts.asymmetrical).toBe(DEFAULT_ASYMMETRICAL_REFINE_PROMPT);
    expect(settings.prompts.sos).toBe(DEFAULT_SOS_REFINE_PROMPT);
    expect(persisted.version).toBe(3);
    expect(persisted.prompts).toEqual(settings.prompts);
  });

  it("migrates version 2 settings without losing either customized prompt", async () => {
    const filePath = refineSettingsPath(productRoot);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(
      filePath,
      `${JSON.stringify({
        version: 2,
        prompts: { symmetrical: "Custom symmetrical", asymmetrical: "Custom asymmetrical" },
        updatedAt: fixedIso
      })}\n`
    );

    const settings = await loadRefineSettings({ productRoot });
    const persisted = await readJson<{ version: number; prompts: Record<string, string> }>(filePath);

    expect(settings.prompts).toEqual({
      symmetrical: "Custom symmetrical",
      asymmetrical: "Custom asymmetrical",
      sos: DEFAULT_SOS_REFINE_PROMPT
    });
    expect(persisted.version).toBe(3);
  });

  it("stores six deduplicated recent custom SOS palettes", async () => {
    for (let index = 0; index < 7; index += 1) {
      await saveRecentSosPalette({
        productRoot,
        palette: {
          fieldColor: `#${(0x111111 + index).toString(16).toUpperCase().padStart(6, "0")}`,
          motifColor: `#${(0xEEEEEE - index).toString(16).toUpperCase().padStart(6, "0")}`
        }
      });
    }
    const repeated = await saveRecentSosPalette({
      productRoot,
      palette: { fieldColor: "#111117", motifColor: "#EEEEE8" }
    });

    expect(repeated.recentSosPalettes).toHaveLength(6);
    expect(repeated.recentSosPalettes[0]).toEqual({ fieldColor: "#111117", motifColor: "#EEEEE8" });
    expect(new Set(repeated.recentSosPalettes.map((palette) => `${palette.fieldColor}:${palette.motifColor}`)).size).toBe(6);
  });

  it("rejects an empty prompt or unknown profile", async () => {
    await expect(
      saveRefineSettings({ productRoot, mode: "symmetrical", prompt: "   " })
    ).rejects.toMatchObject({ code: "INVALID_REFINE_SETTINGS" });
    await expect(
      saveRefineSettings({ productRoot, mode: "organic", prompt: "A prompt" })
    ).rejects.toMatchObject({ code: "INVALID_REFINE_SETTINGS" });
    await expect(
      saveRecentSosPalette({
        productRoot,
        palette: { fieldColor: "#123456", motifColor: "#123456" }
      })
    ).rejects.toMatchObject({ code: "INVALID_SOS_PALETTE" });
  });
});
