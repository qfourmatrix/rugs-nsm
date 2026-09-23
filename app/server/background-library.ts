import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  BackgroundLibraryState,
  BackgroundRecord,
  GenerationBackgroundSnapshot,
  GenerationLabelLogoSnapshot,
  RunnerBackgroundArchetype,
  RunnerRoomShotId
} from "../shared/types";
import { validationError } from "./errors";
import { atomicWriteJson, ensureDir, imageMimeType, pathExists, sha256File } from "./fsUtils";

interface PersistedBackgroundState {
  version: 1;
  manifestPath: string | null;
  labelLogoPath: string | null;
  seen: Record<string, {
    fingerprint: string;
    firstSeenAt: string;
    lastSeenAt: string;
  }>;
  usage: Record<string, {
    usedAt: string;
    useCount: number;
  }>;
}

interface ParsedManifestEntry {
  id: string;
  type: string;
  title: string;
  prompt: string;
  promptPath: string | null;
  previewImagePath: string | null;
  runnerArchetype: RunnerBackgroundArchetype | null;
  runnerShotCompatibility: RunnerRoomShotId[];
}

export interface LoadedBackgroundRecord extends BackgroundRecord {
  prompt: string;
}

export interface LoadedBackgroundLibraryState extends Omit<BackgroundLibraryState, "backgrounds"> {
  backgrounds: LoadedBackgroundRecord[];
}

const stateDirname = ".product-shot-queue";
const stateFilename = "background-library.json";
const libraryCache = new Map<string, { key: string; checkedAt: number; library: LoadedBackgroundLibraryState }>();
const libraryLocks = new Map<string, Promise<unknown>>();
async function withLibraryLock<T>(root: string, work: () => Promise<T>): Promise<T> {
  const previous = libraryLocks.get(root) ?? Promise.resolve();
  const task = previous.catch(() => undefined).then(work);
  libraryLocks.set(root, task);
  try { return await task; }
  finally { if (libraryLocks.get(root) === task) libraryLocks.delete(root); }
}

async function libraryKey(productRoot: string, state: PersistedBackgroundState) {
  const manifest = state.manifestPath ? await resolveProductLibraryPath(state.manifestPath, productRoot) : null;
  const info = manifest ? await fs.stat(manifest, { bigint: true }).catch(() => null) : null;
  return JSON.stringify([manifest, state.labelLogoPath, info ? `${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}` : null]);
}

// Cheap reads validate manifest identity every time. Explicit Rescan bypasses this
// cache; external prompt edits are refreshed within 10s, and generation reads its
// selected prompt fresh regardless of cache age.
export async function getCachedBackgroundLibrary({ productRoot }: { productRoot: string }) {
  return withLibraryLock(productRoot, async () => {
    const state = await loadPersisted(productRoot);
    const key = await libraryKey(productRoot, state);
    const cached = libraryCache.get(productRoot);
    if (!cached || cached.key !== key || Date.now() - cached.checkedAt >= 10000) {
      return scanBackgroundLibraryUnlocked({ productRoot });
    }
    const library = structuredClone(cached.library);
    for (const background of library.backgrounds) {
      const usage = state.usage[background.id];
      background.status = usage ? "used" : "new";
      background.usedAt = usage?.usedAt ?? null;
      background.useCount = usage?.useCount ?? 0;
    }
    library.backgrounds.sort((a, b) => Number(a.status === "used") - Number(b.status === "used") || a.title.localeCompare(b.title));
    library.labelLogoExists = library.labelLogoPath ? await pathExists(library.labelLogoPath) : false;
    return library;
  });
}
const runnerRoomShotIds = new Set<RunnerRoomShotId>(["wide_room_hero", "high_angle_lifestyle"]);
const runnerBackgroundArchetypes = new Set<RunnerBackgroundArchetype>([
  "long_hallway_gallery",
  "entry_foyer_lane",
  "open_living_circulation",
  "bedside_passage",
  "kitchen_galley_transition",
  "stair_landing_corridor"
]);

function statePath(productRoot: string) {
  return path.join(productRoot, stateDirname, stateFilename);
}

function defaultState(): PersistedBackgroundState {
  return {
    version: 1,
    manifestPath: null,
    labelLogoPath: null,
    seen: {},
    usage: {}
  };
}

async function loadPersisted(productRoot: string): Promise<PersistedBackgroundState> {
  const filePath = statePath(productRoot);
  if (!(await pathExists(filePath))) {
    return defaultState();
  }

  const raw = JSON.parse(await fs.readFile(filePath, "utf8")) as Partial<PersistedBackgroundState>;
  return {
    version: 1,
    manifestPath: typeof raw.manifestPath === "string" ? raw.manifestPath : null,
    labelLogoPath: typeof raw.labelLogoPath === "string" ? raw.labelLogoPath : null,
    seen: raw.seen && typeof raw.seen === "object" ? raw.seen : {},
    usage: raw.usage && typeof raw.usage === "object" ? raw.usage : {}
  };
}

async function savePersisted(productRoot: string, state: PersistedBackgroundState) {
  await ensureDir(path.join(productRoot, stateDirname));
  await atomicWriteJson(statePath(productRoot), state);
}

function resolveExternalPath(inputPath: string, baseDir = process.cwd()) {
  const trimmed = inputPath.trim();
  if (!trimmed) {
    throw validationError("INVALID_PATH", "Path cannot be empty.");
  }
  return path.resolve(baseDir, trimmed);
}

function projectRootFromProductRoot(productRoot: string) {
  const dataRoot = path.dirname(productRoot);
  return path.basename(dataRoot) === "data" ? path.dirname(dataRoot) : null;
}

function portablePathFromProductRoot(productRoot: string, inputPath: string) {
  const projectRoot = projectRootFromProductRoot(productRoot);
  if (!projectRoot) {
    return inputPath;
  }

  const projectRelative = path.relative(projectRoot, inputPath);
  if (projectRelative === ".." || projectRelative.startsWith(`..${path.sep}`) || path.isAbsolute(projectRelative)) {
    return inputPath;
  }

  return path.relative(productRoot, inputPath) || ".";
}

function copiedProjectDataPath(productRoot: string, inputPath: string) {
  const projectRoot = projectRootFromProductRoot(productRoot);
  if (!projectRoot || !path.isAbsolute(inputPath)) {
    return null;
  }

  const pathParts = path.relative(path.parse(inputPath).root, inputPath).split(path.sep);
  const dataIndex = pathParts.lastIndexOf("data");
  if (dataIndex < 0) {
    return null;
  }

  return path.join(projectRoot, ...pathParts.slice(dataIndex));
}

export async function resolveProductLibraryPath(
  inputPath: string,
  productRoot: string,
  baseDir = productRoot
) {
  const resolved = resolveExternalPath(inputPath, baseDir);
  const copiedPath = copiedProjectDataPath(productRoot, resolved);

  // Background manifests created on another Mac used to contain absolute paths.
  // Prefer the equivalent file in this project's data folder when it exists.
  if (copiedPath && copiedPath !== resolved && await pathExists(copiedPath)) {
    return copiedPath;
  }

  return resolved;
}

function assertString(value: unknown, field: string, lineNumber: number) {
  if (typeof value !== "string" || !value.trim()) {
    throw validationError("INVALID_BACKGROUND_MANIFEST", `Line ${lineNumber}: ${field} must be a non-empty string.`);
  }
  return value.trim();
}

function parseRunnerArchetype(value: unknown, lineNumber: number): RunnerBackgroundArchetype | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !runnerBackgroundArchetypes.has(value as RunnerBackgroundArchetype)) {
    throw validationError(
      "INVALID_BACKGROUND_MANIFEST",
      `Line ${lineNumber}: runnerArchetype must be a supported Runner archetype.`
    );
  }
  return value as RunnerBackgroundArchetype;
}

function parseRunnerShotCompatibility(value: unknown, lineNumber: number): RunnerRoomShotId[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw validationError(
      "INVALID_BACKGROUND_MANIFEST",
      `Line ${lineNumber}: runnerShotCompatibility must be an array.`
    );
  }

  const shotIds = value.map((item) => {
    if (typeof item !== "string" || !runnerRoomShotIds.has(item as RunnerRoomShotId)) {
      throw validationError(
        "INVALID_BACKGROUND_MANIFEST",
        `Line ${lineNumber}: runnerShotCompatibility contains unsupported shot id ${String(item)}.`
      );
    }
    return item as RunnerRoomShotId;
  });
  if (new Set(shotIds).size !== shotIds.length) {
    throw validationError(
      "INVALID_BACKGROUND_MANIFEST",
      `Line ${lineNumber}: runnerShotCompatibility must not contain duplicates.`
    );
  }
  return shotIds;
}

async function parseManifestLine(
  line: string,
  lineNumber: number,
  manifestDir: string,
  productRoot: string
): Promise<ParsedManifestEntry> {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(line) as Record<string, unknown>;
  } catch {
    throw validationError("INVALID_BACKGROUND_MANIFEST", `Line ${lineNumber}: not valid JSON.`);
  }

  const id = assertString(parsed.id, "id", lineNumber);
  const type = assertString(parsed.type, "type", lineNumber);
  const title = assertString(parsed.title, "title", lineNumber);
  const runnerArchetype = parseRunnerArchetype(parsed.runnerArchetype, lineNumber);
  const runnerShotCompatibility = parseRunnerShotCompatibility(parsed.runnerShotCompatibility, lineNumber);
  if (runnerShotCompatibility.length > 0 && !runnerArchetype) {
    throw validationError(
      "INVALID_BACKGROUND_MANIFEST",
      `Line ${lineNumber}: runnerArchetype is required when runnerShotCompatibility is declared.`
    );
  }
  const promptPath =
    typeof parsed.promptPath === "string" && parsed.promptPath.trim()
      ? await resolveProductLibraryPath(parsed.promptPath, productRoot, manifestDir)
      : null;
  const previewImagePath =
    typeof parsed.previewImagePath === "string" && parsed.previewImagePath.trim()
      ? await resolveProductLibraryPath(parsed.previewImagePath, productRoot, manifestDir)
      : null;
  const inlinePrompt = typeof parsed.prompt === "string" ? parsed.prompt.trim() : "";
  const prompt = promptPath ? (await fs.readFile(promptPath, "utf8")).trim() : inlinePrompt;

  if (!prompt) {
    throw validationError("INVALID_BACKGROUND_MANIFEST", `Line ${lineNumber}: prompt or promptPath is required.`);
  }

  return {
    id,
    type,
    title,
    prompt,
    promptPath,
    previewImagePath,
    runnerArchetype,
    runnerShotCompatibility
  };
}

function fingerprintBackground(entry: Pick<LoadedBackgroundRecord,
  | "id"
  | "type"
  | "title"
  | "prompt"
  | "previewImagePath"
  | "promptPath"
  | "runnerArchetype"
  | "runnerShotCompatibility"
>) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(entry))
    .digest("hex");
}

export async function setBackgroundManifestPath({
  productRoot,
  manifestPath
}: {
  productRoot: string;
  manifestPath: string;
}): Promise<LoadedBackgroundLibraryState> {
  await withLibraryLock(productRoot, async () => {
  const state = await loadPersisted(productRoot);
  const resolvedPath = await resolveProductLibraryPath(manifestPath, productRoot, process.cwd());
  state.manifestPath = portablePathFromProductRoot(productRoot, resolvedPath);
  await savePersisted(productRoot, state);
  libraryCache.delete(productRoot);
  });
  return scanBackgroundLibrary({ productRoot });
}

export async function setLabelLogoPath({
  productRoot,
  labelLogoPath
}: {
  productRoot: string;
  labelLogoPath: string;
}): Promise<LoadedBackgroundLibraryState> {
  await withLibraryLock(productRoot, async () => {
  const state = await loadPersisted(productRoot);
  const resolvedPath = await resolveProductLibraryPath(labelLogoPath, productRoot, process.cwd());
  state.labelLogoPath = portablePathFromProductRoot(productRoot, resolvedPath);
  await savePersisted(productRoot, state);
  libraryCache.delete(productRoot);
  });
  return scanBackgroundLibrary({ productRoot });
}

export async function scanBackgroundLibrary({
  productRoot
}: { productRoot: string }): Promise<LoadedBackgroundLibraryState> {
  return withLibraryLock(productRoot, () => scanBackgroundLibraryUnlocked({ productRoot }));
}

async function scanBackgroundLibraryUnlocked({
  productRoot
}: {
  productRoot: string;
}): Promise<LoadedBackgroundLibraryState> {
  const state = await loadPersisted(productRoot);
  const originalState = JSON.stringify(state);
  const initialKey = await libraryKey(productRoot, state);
  const manifestPath = state.manifestPath
    ? await resolveProductLibraryPath(state.manifestPath, productRoot)
    : null;
  const labelLogoPath = state.labelLogoPath
    ? await resolveProductLibraryPath(state.labelLogoPath, productRoot)
    : null;
  if (manifestPath) {
    state.manifestPath = portablePathFromProductRoot(productRoot, manifestPath);
  }
  if (labelLogoPath) {
    state.labelLogoPath = portablePathFromProductRoot(productRoot, labelLogoPath);
  }
  const errors: string[] = [];
  let manifestMtimeMs: number | null = null;
  let manifestSha256: string | null = null;
  let backgrounds: LoadedBackgroundRecord[] = [];
  const scannedAt = new Date().toISOString();

  if (manifestPath) {
    try {
      const manifestStat = await fs.stat(manifestPath);
      if (!manifestStat.isFile()) {
        throw validationError("INVALID_BACKGROUND_MANIFEST", "Background manifest path must point to a file.");
      }
      manifestMtimeMs = manifestStat.mtimeMs;
      manifestSha256 = await sha256File(manifestPath);
      const manifestDir = path.dirname(manifestPath);
      const text = await fs.readFile(manifestPath, "utf8");
      const seenIds = new Set<string>();

      const parsedEntries = await Promise.all(
        text
          .split(/\r?\n/)
          .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
          .filter(({ line }) => line && !line.startsWith("#"))
          .map(({ line, lineNumber }) => parseManifestLine(line, lineNumber, manifestDir, productRoot))
      );

      for (const entry of parsedEntries) {
        if (seenIds.has(entry.id)) {
          throw validationError("INVALID_BACKGROUND_MANIFEST", `Duplicate background id: ${entry.id}.`);
        }
        seenIds.add(entry.id);
        const fingerprint = fingerprintBackground(entry);
        const existing = state.seen[entry.id];
        state.seen[entry.id] = {
          fingerprint,
          firstSeenAt: existing?.firstSeenAt ?? scannedAt,
          lastSeenAt: existing?.fingerprint === fingerprint ? existing.lastSeenAt : scannedAt
        };
        const usage = state.usage[entry.id];
        const status: LoadedBackgroundRecord["status"] = usage ? "used" : "new";
        backgrounds.push({
          ...entry,
          fingerprint,
          firstSeenAt: state.seen[entry.id].firstSeenAt,
          lastSeenAt: state.seen[entry.id].lastSeenAt,
          usedAt: usage?.usedAt ?? null,
          useCount: usage?.useCount ?? 0,
          status
        });
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Could not scan background manifest.");
    }
  }

  if (JSON.stringify(state) !== originalState) await savePersisted(productRoot, state);
  backgrounds = backgrounds.sort((left, right) => {
    const rank = { new: 0, used: 1 };
    return rank[left.status] - rank[right.status] || left.title.localeCompare(right.title);
  });

  const library: LoadedBackgroundLibraryState = {
    manifestPath,
    manifestMtimeMs,
    manifestSha256,
    scannedAt,
    labelLogoPath,
    labelLogoExists: labelLogoPath ? await pathExists(labelLogoPath) : false,
    backgrounds,
    errors
  };
  if (errors.length === 0 && initialKey === await libraryKey(productRoot, state)) {
    if (libraryCache.size >= 8) libraryCache.delete(libraryCache.keys().next().value!);
    libraryCache.set(productRoot, { key: await libraryKey(productRoot, state), checkedAt: Date.now(), library: structuredClone(library) });
  } else libraryCache.delete(productRoot);
  return library;
}

export function toClientBackgroundLibraryState(library: LoadedBackgroundLibraryState): BackgroundLibraryState {
  return {
    ...library,
    backgrounds: library.backgrounds.map(({ prompt: _prompt, ...background }) => background)
  };
}

export async function getBackgroundSnapshot({
  productRoot,
  backgroundId
}: {
  productRoot: string;
  backgroundId: string | null;
}): Promise<GenerationBackgroundSnapshot | null> {
  if (!backgroundId) return null;
  const library = await getCachedBackgroundLibrary({ productRoot });
  if (library.errors.length) throw validationError("INVALID_BACKGROUND_MANIFEST", library.errors.join("; "));
  const background = library.backgrounds.find((item) => item.id === backgroundId);
  if (!background) {
    throw validationError("UNKNOWN_BACKGROUND", `Unknown background: ${backgroundId}.`);
  }
  return {
    id: background.id,
    type: background.type,
    title: background.title,
    prompt: background.promptPath ? await fs.readFile(background.promptPath, "utf8").then(text => {
      if (!text.trim()) throw validationError("INVALID_BACKGROUND_MANIFEST", "Selected background prompt is empty.");
      return text.trim();
    }) : background.prompt,
    previewImagePath: background.previewImagePath
      ? portablePathFromProductRoot(productRoot, background.previewImagePath)
      : null,
    runnerArchetype: background.runnerArchetype,
    runnerShotCompatibility: background.runnerShotCompatibility
  };
}

export async function markBackgroundUsed({
  productRoot,
  backgroundId,
  now = new Date().toISOString()
}: {
  productRoot: string;
  backgroundId: string;
  now?: string;
}) {
  return withLibraryLock(productRoot, async () => {
  const state = await loadPersisted(productRoot);
  const current = state.usage[backgroundId];
  state.usage[backgroundId] = {
    usedAt: current?.usedAt ?? now,
    useCount: (current?.useCount ?? 0) + 1
  };
  await savePersisted(productRoot, state);
  });
}

export async function getLabelLogoSnapshot({
  productRoot
}: {
  productRoot: string;
}): Promise<GenerationLabelLogoSnapshot | null> {
  const state = await loadPersisted(productRoot);
  const labelLogoPath = state.labelLogoPath
    ? await resolveProductLibraryPath(state.labelLogoPath, productRoot)
    : null;
  if (labelLogoPath) {
    state.labelLogoPath = portablePathFromProductRoot(productRoot, labelLogoPath);
  }
  if (!labelLogoPath) return null;
  if (!(await pathExists(labelLogoPath))) return null;
  return {
    file: path.basename(labelLogoPath),
    path: portablePathFromProductRoot(productRoot, labelLogoPath),
    sha256: await sha256File(labelLogoPath),
    mimeType: imageMimeType(labelLogoPath)
  };
}

export async function resolveBackgroundPreviewPath({
  productRoot,
  backgroundId
}: {
  productRoot: string;
  backgroundId: string;
}) {
  const library = await getCachedBackgroundLibrary({ productRoot });
  if (library.errors.length) throw validationError("INVALID_BACKGROUND_MANIFEST", library.errors.join("; "));
  const background = library.backgrounds.find((item) => item.id === backgroundId);
  if (!background?.previewImagePath) {
    throw validationError("BACKGROUND_PREVIEW_MISSING", "Background preview image is missing.");
  }
  return background.previewImagePath;
}
