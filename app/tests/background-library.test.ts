import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getBackgroundSnapshot,
  getLabelLogoSnapshot,
  markBackgroundUsed,
  scanBackgroundLibrary,
  setBackgroundManifestPath,
  setLabelLogoPath,
  toClientBackgroundLibraryState
} from "../server/background-library";
import { cleanupTempWorkspace, makeTempWorkspace, pathExists, readJson, writeFakeImage } from "./test-utils";

describe("background library", () => {
  let workspace: string;
  let productRoot: string;
  let libraryDir: string;
  let manifestPath: string;

  beforeEach(async () => {
    workspace = await makeTempWorkspace();
    productRoot = path.join(workspace, "nsm100k");
    libraryDir = path.join(workspace, "library");
    manifestPath = path.join(libraryDir, "backgrounds.jsonl");
    await mkdir(productRoot, { recursive: true });
    await mkdir(libraryDir, { recursive: true });
  });

  afterEach(async () => {
    await cleanupTempWorkspace(workspace);
  });

  it("imports JSONL backgrounds and resolves prompt and preview paths", async () => {
    const promptPath = path.join(libraryDir, "bedroom.txt");
    const previewPath = path.join(libraryDir, "bedroom.jpg");
    await writeFile(promptPath, "Warm bedroom prompt");
    await writeFakeImage(previewPath);
    await writeFile(
      manifestPath,
      [
        JSON.stringify({
          id: "living-1",
          type: "living",
          title: "Living One",
          prompt: "Living room prompt"
        }),
        JSON.stringify({
          id: "bedroom-1",
          type: "bedroom",
          title: "Bedroom One",
          promptPath: "bedroom.txt",
          previewImagePath: "bedroom.jpg"
        })
      ].join("\n")
    );

    const library = await setBackgroundManifestPath({ productRoot, manifestPath });

    expect(library.errors).toEqual([]);
    expect(library.backgrounds).toHaveLength(2);
    expect(library.backgrounds.map((item) => item.status)).toEqual(["new", "new"]);
    expect(library.backgrounds.find((item) => item.id === "bedroom-1")).toMatchObject({
      prompt: "Warm bedroom prompt",
      previewImagePath: previewPath,
      runnerArchetype: null,
      runnerShotCompatibility: []
    });
  });

  it("imports validated Runner archetype and shot compatibility metadata", async () => {
    await writeFile(
      manifestPath,
      `${JSON.stringify({
        id: "runner-hall-1",
        type: "architectural_living",
        title: "Runner Hall One",
        prompt: "Long clear gallery prompt",
        runnerArchetype: "long_hallway_gallery",
        runnerShotCompatibility: ["wide_room_hero", "high_angle_lifestyle"]
      })}\n`
    );

    const library = await setBackgroundManifestPath({ productRoot, manifestPath });
    const clientLibrary = toClientBackgroundLibraryState(library);
    const snapshot = await getBackgroundSnapshot({ productRoot, backgroundId: "runner-hall-1" });

    expect(library.errors).toEqual([]);
    expect(clientLibrary.backgrounds[0]).toMatchObject({
      runnerArchetype: "long_hallway_gallery",
      runnerShotCompatibility: ["wide_room_hero", "high_angle_lifestyle"]
    });
    expect(snapshot).toMatchObject({
      runnerArchetype: "long_hallway_gallery",
      runnerShotCompatibility: ["wide_room_hero", "high_angle_lifestyle"]
    });
  });

  it.each([
    {
      label: "unknown archetype",
      metadata: { runnerArchetype: "ballroom" },
      error: /runnerArchetype/i
    },
    {
      label: "unknown shot id",
      metadata: { runnerShotCompatibility: ["studio_corner_detail"] },
      error: /unsupported shot id/i
    },
    {
      label: "duplicate shot id",
      metadata: { runnerShotCompatibility: ["wide_room_hero", "wide_room_hero"] },
      error: /must not contain duplicates/i
    },
    {
      label: "compatibility without an archetype",
      metadata: { runnerShotCompatibility: ["wide_room_hero"] },
      error: /runnerArchetype is required/i
    }
  ])("rejects $label Runner metadata", async ({ metadata, error }) => {
    await writeFile(
      manifestPath,
      `${JSON.stringify({
        id: "runner-invalid",
        type: "architectural_living",
        title: "Runner Invalid",
        prompt: "Invalid Runner room prompt",
        ...metadata
      })}\n`
    );

    const library = await setBackgroundManifestPath({ productRoot, manifestPath });

    expect(library.backgrounds).toEqual([]);
    expect(library.errors[0]).toMatch(error);
  });

  it("changes the fingerprint when Runner compatibility metadata changes", async () => {
    const entry = {
      id: "runner-fingerprint",
      type: "architectural_living",
      title: "Runner Fingerprint",
      prompt: "Clear circulation path",
      runnerArchetype: "entry_foyer_lane"
    };
    await writeFile(
      manifestPath,
      `${JSON.stringify({ ...entry, runnerShotCompatibility: ["wide_room_hero"] })}\n`
    );
    const first = await setBackgroundManifestPath({ productRoot, manifestPath });

    await writeFile(
      manifestPath,
      `${JSON.stringify({ ...entry, runnerShotCompatibility: ["high_angle_lifestyle"] })}\n`
    );
    const second = await scanBackgroundLibrary({ productRoot });

    expect(second.backgrounds[0]?.fingerprint).not.toBe(first.backgrounds[0]?.fingerprint);
  });

  it("tracks newly added and used backgrounds independently from the manifest file", async () => {
    await writeFile(
      manifestPath,
      `${JSON.stringify({
        id: "living-1",
        type: "living",
        title: "Living One",
        prompt: "Living room prompt"
      })}\n`
    );

    await setBackgroundManifestPath({ productRoot, manifestPath });
    await writeFile(
      manifestPath,
      [
        JSON.stringify({
          id: "living-1",
          type: "living",
          title: "Living One",
          prompt: "Living room prompt"
        }),
        JSON.stringify({
          id: "living-2",
          type: "living",
          title: "Living Two",
          prompt: "New living room prompt"
        })
      ].join("\n")
    );

    let library = await scanBackgroundLibrary({ productRoot });
    expect(library.backgrounds.find((item) => item.id === "living-1")?.status).toBe("new");
    expect(library.backgrounds.find((item) => item.id === "living-2")?.status).toBe("new");

    await getBackgroundSnapshot({ productRoot, backgroundId: "living-2" });
    library = await scanBackgroundLibrary({ productRoot });
    expect(library.backgrounds.find((item) => item.id === "living-2")).toMatchObject({
      status: "new",
      useCount: 0,
      usedAt: null
    });

    await markBackgroundUsed({ productRoot, backgroundId: "living-2", now: "2026-07-05T00:00:00.000Z" });
    await markBackgroundUsed({ productRoot, backgroundId: "living-2", now: "2026-07-06T00:00:00.000Z" });
    library = await scanBackgroundLibrary({ productRoot });

    const used = library.backgrounds.find((item) => item.id === "living-2");
    expect(used?.status).toBe("used");
    expect(used?.useCount).toBe(2);
    expect(used?.usedAt).toBe("2026-07-05T00:00:00.000Z");
    expect(library.backgrounds.find((item) => item.id === "living-1")).toMatchObject({
      status: "new",
      useCount: 0,
      usedAt: null
    });

    await writeFile(
      manifestPath,
      [
        JSON.stringify({
          id: "living-1",
          type: "living",
          title: "Living One",
          prompt: "Living room prompt"
        }),
        JSON.stringify({
          id: "living-2",
          type: "living",
          title: "Living Two Updated",
          prompt: "Updated living room prompt"
        })
      ].join("\n")
    );
    library = await scanBackgroundLibrary({ productRoot });
    expect(library.backgrounds.find((item) => item.id === "living-2")).toMatchObject({
      status: "used",
      useCount: 2,
      usedAt: "2026-07-05T00:00:00.000Z"
    });
    expect(await pathExists(path.join(productRoot, ".product-shot-queue", "background-library.json"))).toBe(true);
  });

  it("omits prompt bodies from the client library payload", async () => {
    await writeFile(
      manifestPath,
      `${JSON.stringify({
        id: "living-1",
        type: "living",
        title: "Living One",
        prompt: "Large prompt body"
      })}\n`
    );

    const loaded = await setBackgroundManifestPath({ productRoot, manifestPath });
    const clientLibrary = toClientBackgroundLibraryState(loaded);

    expect(loaded.backgrounds[0]?.prompt).toBe("Large prompt body");
    expect(clientLibrary.backgrounds[0]).not.toHaveProperty("prompt");
  });

  it("stores and validates the label logo path", async () => {
    const labelPath = path.join(libraryDir, "label.png");
    await writeFakeImage(labelPath);

    const library = await setLabelLogoPath({ productRoot, labelLogoPath: labelPath });
    const label = await getLabelLogoSnapshot({ productRoot });

    expect(library.labelLogoExists).toBe(true);
    expect(label).toMatchObject({
      file: "label.png",
      path: labelPath,
      mimeType: "image/png"
    });
  });

  it("relocates copied project data paths from another Mac", async () => {
    const oldProjectRoot = path.join(workspace, "owner", "RUGS NSM");
    const copiedProjectRoot = path.join(workspace, "friend", "RUGS NSM");
    productRoot = path.join(copiedProjectRoot, "data", "nsm100k");
    libraryDir = path.join(copiedProjectRoot, "data", "Preping bgs", "Living");
    manifestPath = path.join(productRoot, "background-library.jsonl");
    const promptPath = path.join(libraryDir, "living.txt");
    const previewPath = path.join(libraryDir, "living.jpg");
    const labelPath = path.join(productRoot, "label-logo.png");

    await mkdir(path.join(productRoot, ".product-shot-queue"), { recursive: true });
    await mkdir(libraryDir, { recursive: true });
    await writeFile(promptPath, "Copied living room prompt");
    await writeFakeImage(previewPath);
    await writeFakeImage(labelPath);
    await writeFile(
      manifestPath,
      `${JSON.stringify({
        id: "living-copied",
        type: "living",
        title: "Copied Living Room",
        promptPath: path.join(oldProjectRoot, "data", "Preping bgs", "Living", "living.txt"),
        previewImagePath: path.join(oldProjectRoot, "data", "Preping bgs", "Living", "living.jpg")
      })}\n`
    );
    await writeFile(
      path.join(productRoot, ".product-shot-queue", "background-library.json"),
      JSON.stringify({
        version: 1,
        manifestPath: path.join(oldProjectRoot, "data", "nsm100k", "background-library.jsonl"),
        labelLogoPath: path.join(oldProjectRoot, "data", "nsm100k", "label-logo.png"),
        seen: {},
        usage: {}
      })
    );

    const library = await scanBackgroundLibrary({ productRoot });
    const label = await getLabelLogoSnapshot({ productRoot });
    const background = await getBackgroundSnapshot({ productRoot, backgroundId: "living-copied" });

    expect(library.errors).toEqual([]);
    expect(library.manifestPath).toBe(manifestPath);
    expect(library.labelLogoPath).toBe(labelPath);
    expect(library.backgrounds[0]).toMatchObject({
      prompt: "Copied living room prompt",
      promptPath,
      previewImagePath: previewPath
    });
    expect(label?.path).toBe("label-logo.png");
    expect(background?.previewImagePath).toBe(path.join("..", "Preping bgs", "Living", "living.jpg"));

    const persisted = await readJson<{ manifestPath: string; labelLogoPath: string }>(
      path.join(productRoot, ".product-shot-queue", "background-library.json")
    );
    expect(persisted).toMatchObject({
      manifestPath: "background-library.jsonl",
      labelLogoPath: "label-logo.png"
    });
  });
});
