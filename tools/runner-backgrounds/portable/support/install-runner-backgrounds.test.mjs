import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { installRunnerBackgrounds } from "./install-runner-backgrounds.mjs";

async function writeFile(filePath, contents = "test") {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, contents);
}

async function writeManifest(filePath, records) {
  await writeFile(filePath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
}

async function createFixture({ collision = false } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "runner-merge-test-"));
  const projectRoot = path.join(root, "RUGS NSM");
  const packRoot = path.join(root, "Runner Pack");
  const productRoot = path.join(projectRoot, "data", "nsm100k");
  await writeFile(path.join(projectRoot, "app", "package.json"), "{}");
  await writeFile(
    path.join(projectRoot, "app", "shared", "background-compatibility.ts"),
    'export const capability = "runner-library-v1-area-round-isolated-text-only";\n'
  );

  const normalRecords = [
    {
      id: collision ? "runner-foyer-new" : "normal-living",
      type: "interior_living",
      title: "Existing Living",
      promptPath: "normal-prompts/living.txt",
      previewImagePath: "normal-images/living.jpg",
      friendLocalField: "must survive"
    },
    {
      id: "friend-local-bedroom",
      type: "bedroom",
      title: "Friend Local Bedroom",
      prompt: "Keep the friend's inline prompt exactly.",
      friendOnly: true
    }
  ];
  const previousRunnerRecord = {
    id: "runner-old",
    type: "runner_foyer",
    title: "Old Runner",
    prompt: "old runner prompt"
  };
  const baseManifest = path.join(productRoot, "background-library.jsonl");
  await writeManifest(baseManifest, [...normalRecords, previousRunnerRecord]);
  await writeFile(path.join(productRoot, "normal-prompts", "living.txt"), "normal prompt");
  await writeFile(path.join(productRoot, "normal-images", "living.jpg"), "normal image");

  const state = {
    version: 1,
    manifestPath: "background-library.jsonl",
    labelLogoPath: "label-logo.png",
    seen: { "normal-living": { fingerprint: "abc", firstSeenAt: "before", lastSeenAt: "before" } },
    usage: { "normal-living": { usedAt: "before", useCount: 7 } },
    friendPrivateState: "preserve me"
  };
  const statePath = path.join(productRoot, ".product-shot-queue", "background-library.json");
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);

  const runnerRecords = [
    {
      id: "runner-foyer-new",
      type: "runner_foyer",
      title: "Runner Foyer",
      promptPath: "../Preping bgs/Runner Foyer/reverse_engineered_KEEP/foyer.txt",
      previewImagePath: "../Preping bgs/Runner Foyer/KEEP/foyer.jpg",
      runnerArchetype: "entry_foyer_lane"
    },
    {
      id: "runner-hall-new",
      type: "runner_hallway",
      title: "Runner Hall",
      promptPath: "../Preping bgs/Runner Hallway/reverse_engineered_KEEP/hall.txt",
      previewImagePath: "../Preping bgs/Runner Hallway/KEEP/hall.jpg",
      runnerArchetype: "long_hallway_gallery"
    }
  ];
  await writeManifest(path.join(packRoot, "data", "nsm100k", "runner-background-library-expanded.jsonl"), runnerRecords);
  await writeFile(path.join(packRoot, "data", "Preping bgs", "Runner Foyer", "reverse_engineered_KEEP", "foyer.txt"), "foyer prompt");
  await writeFile(path.join(packRoot, "data", "Preping bgs", "Runner Foyer", "KEEP", "foyer.jpg"), "foyer image");
  await writeFile(path.join(packRoot, "data", "Preping bgs", "Runner Hallway", "reverse_engineered_KEEP", "hall.txt"), "hall prompt");
  await writeFile(path.join(packRoot, "data", "Preping bgs", "Runner Hallway", "KEEP", "hall.jpg"), "hall image");

  return { root, projectRoot, packRoot, productRoot, baseManifest, statePath, state, normalRecords };
}

async function readManifest(filePath) {
  return (await fs.readFile(filePath, "utf8"))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test("merges only Runner records and keeps the original library and state", async (t) => {
  const fixture = await createFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const originalManifestText = await fs.readFile(fixture.baseManifest, "utf8");

  const report = await installRunnerBackgrounds({
    packRoot: fixture.packRoot,
    projectRoot: fixture.projectRoot,
    expectedCounts: { runner_foyer: 1, runner_hallway: 1 },
    now: new Date("2026-08-07T12:00:00.000Z")
  });

  assert.equal(await fs.readFile(fixture.baseManifest, "utf8"), originalManifestText);
  const merged = await readManifest(path.join(fixture.productRoot, "background-library-with-runner.jsonl"));
  assert.deepEqual(merged.filter((record) => !record.type.startsWith("runner_")), fixture.normalRecords);
  assert.deepEqual(merged.filter((record) => record.type.startsWith("runner_")).map((record) => record.id), [
    "runner-foyer-new",
    "runner-hall-new"
  ]);
  assert.equal(merged.some((record) => record.id === "runner-old"), false);

  const nextState = JSON.parse(await fs.readFile(fixture.statePath, "utf8"));
  assert.equal(nextState.manifestPath, "background-library-with-runner.jsonl");
  assert.equal(nextState.labelLogoPath, fixture.state.labelLogoPath);
  assert.deepEqual(nextState.seen, fixture.state.seen);
  assert.deepEqual(nextState.usage, fixture.state.usage);
  assert.equal(nextState.friendPrivateState, "preserve me");
  assert.equal(report.normalBackgroundsBefore, 2);
  assert.equal(report.normalBackgroundsAfter, 2);
  assert.equal(report.runnerTotal, 2);
  assert.equal(report.totalBackgrounds, 4);
});

test("is idempotent and never duplicates Runner records", async (t) => {
  const fixture = await createFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const options = {
    packRoot: fixture.packRoot,
    projectRoot: fixture.projectRoot,
    expectedCounts: { runner_foyer: 1, runner_hallway: 1 }
  };

  await installRunnerBackgrounds({ ...options, now: new Date("2026-08-07T12:00:00.000Z") });
  await installRunnerBackgrounds({ ...options, now: new Date("2026-08-07T12:01:00.000Z") });

  const merged = await readManifest(path.join(fixture.productRoot, "background-library-with-runner.jsonl"));
  assert.equal(new Set(merged.map((record) => record.id)).size, merged.length);
  assert.equal(merged.filter((record) => record.type.startsWith("runner_")).length, 2);
  assert.deepEqual(merged.filter((record) => !record.type.startsWith("runner_")), fixture.normalRecords);
});

test("aborts before changing the library if a Runner id collides with a normal record", async (t) => {
  const fixture = await createFixture({ collision: true });
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const originalState = await fs.readFile(fixture.statePath, "utf8");

  await assert.rejects(
    installRunnerBackgrounds({
      packRoot: fixture.packRoot,
      projectRoot: fixture.projectRoot,
      expectedCounts: { runner_foyer: 1, runner_hallway: 1 }
    }),
    /collides with an existing normal background/
  );

  await assert.rejects(fs.access(path.join(fixture.productRoot, "background-library-with-runner.jsonl")));
  assert.equal(await fs.readFile(fixture.statePath, "utf8"), originalState);
});

test("refuses an older app before copying or changing data", async (t) => {
  const fixture = await createFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  await fs.unlink(path.join(fixture.projectRoot, "app", "shared", "background-compatibility.ts"));
  const originalState = await fs.readFile(fixture.statePath, "utf8");

  await assert.rejects(
    installRunnerBackgrounds({
      packRoot: fixture.packRoot,
      projectRoot: fixture.projectRoot,
      expectedCounts: { runner_foyer: 1, runner_hallway: 1 }
    }),
    /older than the merge-safe Runner release/
  );

  await assert.rejects(fs.access(path.join(fixture.productRoot, "background-library-with-runner.jsonl")));
  await assert.rejects(fs.access(path.join(fixture.projectRoot, "data", "Preping bgs", "Runner Foyer", "KEEP", "foyer.jpg")));
  assert.equal(await fs.readFile(fixture.statePath, "utf8"), originalState);
});
