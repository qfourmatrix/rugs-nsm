#!/usr/bin/env node

import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RUNNER_TYPES = new Set(["runner_foyer", "runner_hallway"]);
const DEFAULT_EXPECTED_COUNTS = Object.freeze({ runner_foyer: 194, runner_hallway: 383 });
const MERGED_MANIFEST_NAME = "background-library-with-runner.jsonl";
const RUNNER_MANIFEST_NAME = "runner-background-library-expanded.jsonl";
const STATE_RELATIVE_PATH = path.join(".product-shot-queue", "background-library.json");
const REQUIRED_APP_CAPABILITY = "runner-library-v1-area-round-isolated-text-only";

function fail(message) {
  throw new Error(message);
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function portableRelative(from, to) {
  const relative = path.relative(from, to) || ".";
  return relative.split(path.sep).join("/");
}

async function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(await fs.readFile(filePath));
  return hash.digest("hex");
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    fail(`Could not read valid JSON from ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function readManifest(filePath, label) {
  let text;
  try {
    text = await fs.readFile(filePath, "utf8");
  } catch (error) {
    fail(`Could not read ${label} manifest at ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }

  const records = [];
  const ids = new Set();
  for (const [index, sourceLine] of text.split(/\r?\n/).entries()) {
    const line = sourceLine.trim();
    if (!line || line.startsWith("#")) continue;

    let record;
    try {
      record = JSON.parse(line);
    } catch {
      fail(`${label} manifest line ${index + 1} is not valid JSON.`);
    }
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      fail(`${label} manifest line ${index + 1} must be a JSON object.`);
    }
    for (const field of ["id", "type", "title"]) {
      if (typeof record[field] !== "string" || !record[field].trim()) {
        fail(`${label} manifest line ${index + 1} has no valid ${field}.`);
      }
    }
    if (ids.has(record.id)) fail(`${label} manifest contains duplicate id ${record.id}.`);
    ids.add(record.id);
    records.push(record);
  }
  return records;
}

function validateRunnerRecord(record, index) {
  if (!RUNNER_TYPES.has(record.type)) {
    fail(`Runner manifest record ${index + 1} has forbidden type ${record.type}.`);
  }
  if (typeof record.promptPath !== "string" || !record.promptPath.trim()) {
    fail(`Runner manifest record ${record.id} has no promptPath.`);
  }
  if (typeof record.previewImagePath !== "string" || !record.previewImagePath.trim()) {
    fail(`Runner manifest record ${record.id} has no previewImagePath.`);
  }
  if (typeof record.runnerArchetype !== "string" || !record.runnerArchetype.trim()) {
    fail(`Runner manifest record ${record.id} has no runnerArchetype.`);
  }
}

function expectedCountSummary(expectedCounts) {
  return Object.values(expectedCounts).reduce((sum, count) => sum + count, 0);
}

async function validateRunnerPack(packRoot, expectedCounts) {
  const packDataRoot = path.join(packRoot, "data");
  const packManifest = path.join(packDataRoot, "nsm100k", RUNNER_MANIFEST_NAME);
  const records = await readManifest(packManifest, "Runner add-on");
  const counts = Object.fromEntries([...RUNNER_TYPES].map((type) => [type, 0]));
  const referencedFiles = new Map();

  records.forEach((record, index) => {
    validateRunnerRecord(record, index);
    counts[record.type] += 1;
  });

  for (const [type, expected] of Object.entries(expectedCounts)) {
    if (counts[type] !== expected) {
      fail(`Runner pack is incomplete: expected ${expected} ${type} records, found ${counts[type] ?? 0}.`);
    }
  }
  if (records.length !== expectedCountSummary(expectedCounts)) {
    fail(`Runner pack must contain exactly ${expectedCountSummary(expectedCounts)} records; found ${records.length}.`);
  }

  const allowedAssetRoots = [
    path.join(packDataRoot, "Preping bgs", "Runner Foyer"),
    path.join(packDataRoot, "Preping bgs", "Runner Hallway")
  ];
  for (const record of records) {
    for (const field of ["promptPath", "previewImagePath"]) {
      if (path.isAbsolute(record[field])) fail(`${record.id} uses a non-portable absolute ${field}.`);
      const sourcePath = path.resolve(path.dirname(packManifest), record[field]);
      if (!allowedAssetRoots.some((root) => isWithin(root, sourcePath))) {
        fail(`${record.id} points outside the Runner asset folders: ${record[field]}`);
      }
      if (!(await pathExists(sourcePath))) fail(`${record.id} is missing ${field}: ${record[field]}`);
      const stat = await fs.stat(sourcePath);
      if (!stat.isFile() || stat.size === 0) fail(`${record.id} has an empty or invalid ${field}.`);
      const relativeFromData = path.relative(packDataRoot, sourcePath);
      referencedFiles.set(relativeFromData, sourcePath);
    }
  }

  return { packDataRoot, packManifest, records, counts, referencedFiles };
}

async function validateProjectRoot(projectRoot) {
  const normalized = path.resolve(projectRoot);
  const appPackage = path.join(normalized, "app", "package.json");
  if (!(await pathExists(appPackage))) {
    fail(`That is not a RUGS NSM folder (missing app/package.json): ${normalized}`);
  }
  const compatibilityPath = path.join(normalized, "app", "shared", "background-compatibility.ts");
  const compatibilitySource = (await pathExists(compatibilityPath))
    ? await fs.readFile(compatibilityPath, "utf8")
    : "";
  if (!compatibilitySource.includes(REQUIRED_APP_CAPABILITY)) {
    fail("This RUGS NSM app is older than the merge-safe Runner release. Run 3 Update RUGS NSM.command first, then run this installer again. Nothing was changed.");
  }
  return normalized;
}

async function resolveActiveManifest({ projectRoot, productRoot, state }) {
  const configured = typeof state?.manifestPath === "string" && state.manifestPath.trim()
    ? state.manifestPath.trim()
    : "background-library.jsonl";
  let candidate = path.isAbsolute(configured)
    ? configured
    : path.resolve(productRoot, configured);

  if (!(await pathExists(candidate)) && path.isAbsolute(configured)) {
    const parts = configured.split(path.sep);
    const dataIndex = parts.lastIndexOf("data");
    if (dataIndex >= 0) {
      const relocated = path.join(projectRoot, ...parts.slice(dataIndex));
      if (await pathExists(relocated)) candidate = relocated;
    }
  }

  if (!(await pathExists(candidate))) {
    fail(`The currently connected background manifest does not exist: ${configured}`);
  }
  return path.resolve(candidate);
}

function rebaseManifestRecord(record, sourceDir, targetDir) {
  if (sourceDir === targetDir) return record;
  const rebased = { ...record };
  for (const field of ["promptPath", "previewImagePath"]) {
    const value = rebased[field];
    if (typeof value !== "string" || !value.trim() || path.isAbsolute(value)) continue;
    rebased[field] = portableRelative(targetDir, path.resolve(sourceDir, value));
  }
  return rebased;
}

function assertNormalRecordsPreserved(beforeRecords, afterRecords, sourceDir, targetDir) {
  const expected = beforeRecords
    .filter((record) => !RUNNER_TYPES.has(record.type))
    .map((record) => rebaseManifestRecord(record, sourceDir, targetDir));
  const actual = afterRecords.filter((record) => !RUNNER_TYPES.has(record.type));
  if (expected.length !== actual.length) fail("Normal background count changed during the Runner merge.");
  for (let index = 0; index < expected.length; index += 1) {
    if (JSON.stringify(expected[index]) !== JSON.stringify(actual[index])) {
      fail(`Normal background ${expected[index].id} changed during the Runner merge.`);
    }
  }
}

async function ensureBackup(sourcePath, backupPath) {
  if (!(await pathExists(sourcePath))) return false;
  await fs.mkdir(path.dirname(backupPath), { recursive: true });
  await fs.copyFile(sourcePath, backupPath);
  return true;
}

async function atomicWrite(filePath, contents) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.runner-install-${process.pid}-${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(tempPath, contents);
    await fs.rename(tempPath, filePath);
  } finally {
    if (await pathExists(tempPath)) await fs.unlink(tempPath);
  }
}

async function copyFileSafely({ sourcePath, destinationPath, backupPath }) {
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  if (await pathExists(destinationPath)) {
    if ((await sha256(sourcePath)) === (await sha256(destinationPath))) return "unchanged";
    await ensureBackup(destinationPath, backupPath);
  }
  const tempPath = `${destinationPath}.runner-install-${process.pid}-${crypto.randomUUID()}.tmp`;
  try {
    await fs.copyFile(sourcePath, tempPath);
    await fs.rename(tempPath, destinationPath);
  } finally {
    if (await pathExists(tempPath)) await fs.unlink(tempPath);
  }
  return "copied";
}

function timestampForPath(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

export async function installRunnerBackgrounds({
  packRoot,
  projectRoot,
  expectedCounts = DEFAULT_EXPECTED_COUNTS,
  now = new Date()
}) {
  const normalizedPackRoot = path.resolve(packRoot);
  const normalizedProjectRoot = await validateProjectRoot(projectRoot);
  const productRoot = path.join(normalizedProjectRoot, "data", "nsm100k");
  const statePath = path.join(productRoot, STATE_RELATIVE_PATH);
  const state = (await pathExists(statePath)) ? await readJson(statePath) : {
    version: 1,
    manifestPath: null,
    labelLogoPath: null,
    seen: {},
    usage: {}
  };
  const runnerPack = await validateRunnerPack(normalizedPackRoot, expectedCounts);
  const sourceManifest = await resolveActiveManifest({ projectRoot: normalizedProjectRoot, productRoot, state });
  const sourceRecords = await readManifest(sourceManifest, "currently connected");
  const targetManifest = path.join(productRoot, MERGED_MANIFEST_NAME);
  const targetDir = path.dirname(targetManifest);
  const sourceDir = path.dirname(sourceManifest);

  const normalRecords = sourceRecords
    .filter((record) => !RUNNER_TYPES.has(record.type))
    .map((record) => rebaseManifestRecord(record, sourceDir, targetDir));
  const normalIds = new Set(normalRecords.map((record) => record.id));
  for (const runner of runnerPack.records) {
    if (normalIds.has(runner.id)) {
      fail(`Runner id ${runner.id} collides with an existing normal background. Nothing was merged.`);
    }
  }

  const mergedRecords = [...normalRecords, ...runnerPack.records];
  assertNormalRecordsPreserved(sourceRecords, mergedRecords, sourceDir, targetDir);
  if (new Set(mergedRecords.map((record) => record.id)).size !== mergedRecords.length) {
    fail("The merged manifest would contain duplicate ids.");
  }

  const backupRoot = path.join(productRoot, ".runner-background-install-backups", timestampForPath(now));
  await ensureBackup(statePath, path.join(backupRoot, "background-library-state.before.json"));
  await ensureBackup(targetManifest, path.join(backupRoot, `${MERGED_MANIFEST_NAME}.before`));
  if (sourceManifest !== targetManifest) {
    await ensureBackup(sourceManifest, path.join(backupRoot, "active-manifest.before.jsonl"));
  }

  let copiedFiles = 0;
  let unchangedFiles = 0;
  for (const [relativeFromData, sourcePath] of runnerPack.referencedFiles) {
    const destinationPath = path.resolve(normalizedProjectRoot, "data", relativeFromData);
    const destinationDataRoot = path.join(normalizedProjectRoot, "data");
    if (!isWithin(destinationDataRoot, destinationPath)) fail(`Unsafe destination path: ${destinationPath}`);
    const result = await copyFileSafely({
      sourcePath,
      destinationPath,
      backupPath: path.join(backupRoot, "replaced-runner-files", relativeFromData)
    });
    if (result === "copied") copiedFiles += 1;
    else unchangedFiles += 1;
  }

  const standaloneManifestDestination = path.join(productRoot, RUNNER_MANIFEST_NAME);
  await copyFileSafely({
    sourcePath: runnerPack.packManifest,
    destinationPath: standaloneManifestDestination,
    backupPath: path.join(backupRoot, `${RUNNER_MANIFEST_NAME}.before`)
  });

  const mergedText = `${mergedRecords.map((record) => JSON.stringify(record)).join("\n")}\n`;
  await atomicWrite(targetManifest, mergedText);

  const installedRecords = await readManifest(targetManifest, "installed merged");
  assertNormalRecordsPreserved(sourceRecords, installedRecords, sourceDir, targetDir);
  const installedRunnerRecords = installedRecords.filter((record) => RUNNER_TYPES.has(record.type));
  if (installedRunnerRecords.length !== runnerPack.records.length) {
    fail("Installed Runner count does not match the validated pack.");
  }
  for (const record of installedRunnerRecords) {
    for (const field of ["promptPath", "previewImagePath"]) {
      const installedPath = path.resolve(targetDir, record[field]);
      if (!(await pathExists(installedPath))) fail(`Installed file is missing for ${record.id}: ${record[field]}`);
    }
  }

  const nextState = {
    ...state,
    version: 1,
    manifestPath: MERGED_MANIFEST_NAME,
    labelLogoPath: typeof state.labelLogoPath === "string" ? state.labelLogoPath : null,
    seen: state.seen && typeof state.seen === "object" ? state.seen : {},
    usage: state.usage && typeof state.usage === "object" ? state.usage : {}
  };
  await atomicWrite(statePath, `${JSON.stringify(nextState, null, 2)}\n`);

  const report = {
    installedAt: now.toISOString(),
    sourceManifest,
    activeManifest: targetManifest,
    originalManifestUntouched: sourceManifest !== targetManifest,
    normalBackgroundsBefore: normalRecords.length,
    normalBackgroundsAfter: installedRecords.filter((record) => !RUNNER_TYPES.has(record.type)).length,
    runnerFoyer: runnerPack.counts.runner_foyer,
    runnerHallway: runnerPack.counts.runner_hallway,
    runnerTotal: runnerPack.records.length,
    totalBackgrounds: installedRecords.length,
    runnerFilesCopied: copiedFiles,
    runnerFilesAlreadyCurrent: unchangedFiles,
    backupRoot
  };
  await atomicWrite(path.join(productRoot, "runner-background-install-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--pack-root" || argument === "--project-root") {
      const value = argv[index + 1];
      if (!value) fail(`${argument} needs a path.`);
      values[argument.slice(2)] = value;
      index += 1;
      continue;
    }
    fail(`Unknown installer argument: ${argument}`);
  }
  return values;
}

async function main() {
  const argumentsByName = parseArguments(process.argv.slice(2));
  const scriptPath = fileURLToPath(import.meta.url);
  const defaultPackRoot = path.resolve(path.dirname(scriptPath), "..");
  const defaultProjectRoot = path.join(os.homedir(), "Documents", "RUGS NSM");
  const report = await installRunnerBackgrounds({
    packRoot: argumentsByName["pack-root"] ?? defaultPackRoot,
    projectRoot: argumentsByName["project-root"] ?? process.env.RUGS_PROJECT_ROOT ?? defaultProjectRoot
  });

  process.stdout.write(`\nRunner background merge complete.\n`);
  process.stdout.write(`Normal backgrounds preserved: ${report.normalBackgroundsAfter}\n`);
  process.stdout.write(`Runner backgrounds added: ${report.runnerTotal} (${report.runnerFoyer} Foyer + ${report.runnerHallway} Hallway)\n`);
  process.stdout.write(`Active library total: ${report.totalBackgrounds}\n`);
  process.stdout.write(`Original manifest untouched: ${report.originalManifestUntouched ? "yes" : "active merged manifest updated with backup"}\n`);
  process.stdout.write(`Backup: ${report.backupRoot}\n`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`\nINSTALL FAILED: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
