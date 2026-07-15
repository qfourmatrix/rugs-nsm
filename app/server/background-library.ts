import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  BackgroundLibraryState,
  BackgroundRecord,
  GenerationBackgroundSnapshot,
  GenerationLabelLogoSnapshot
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

interface ManifestEntry {
  id: string;
  type: string;
  title: string;
  prompt?: string;
  promptPath?: string;
  previewImagePath?: string;
}

interface ParsedManifestEntry {
  id: string;
  type: string;
  title: string;
  prompt: string;
  promptPath: string | null;
  previewImagePath: string | null;
}

export interface LoadedBackgroundRecord extends BackgroundRecord {
  prompt: string;
}

export interface LoadedBackgroundLibraryState extends Omit<BackgroundLibraryState, "backgrounds"> {
  backgrounds: LoadedBackgroundRecord[];
}

const stateDirname = ".product-shot-queue";
const stateFilename = "background-library.json";
const previewPathCache = new Map<string, Map<string, string>>();

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

function copiedProjectDataPath(productRoot: string, inputPath: string) {
  const dataRoot = path.dirname(productRoot);
  if (path.basename(dataRoot) !== "data" || !path.isAbsolute(inputPath)) {
    return null;
  }

  const pathParts = path.relative(path.parse(inputPath).root, inputPath).split(path.sep);
  const dataIndex = pathParts.lastIndexOf("data");
  if (dataIndex < 0) {
    return null;
  }

  return path.join(path.dirname(dataRoot), ...pathParts.slice(dataIndex));
}

async function resolvePortableProjectPath(inputPath: string, productRoot: string, baseDir = process.cwd()) {
  const resolved = resolveExternalPath(inputPath, baseDir);
  const copiedPath = copiedProjectDataPath(productRoot, resolved);

  // Background manifests created on another Mac used to contain absolute paths.
  // Prefer the equivalent file in this project's data folder when it exists.
  if (copiedPath && copiedPath !== resolved && await pathExists(copiedPath)) {
    return copiedPath;
  }

  return resolved;
}

async function relocatePersistedPaths(productRoot: string, state: PersistedBackgroundState) {
  if (state.manifestPath) {
    state.manifestPath = await resolvePortableProjectPath(state.manifestPath, productRoot);
  }
  if (state.labelLogoPath) {
    state.labelLogoPath = await resolvePortableProjectPath(state.labelLogoPath, productRoot);
  }
}

function assertString(value: unknown, field: string, lineNumber: number) {
  if (typeof value !== "string" || !value.trim()) {
    throw validationError("INVALID_BACKGROUND_MANIFEST", `Line ${lineNumber}: ${field} must be a non-empty string.`);
  }
  return value.trim();
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
  const promptPath =
    typeof parsed.promptPath === "string" && parsed.promptPath.trim()
      ? await resolvePortableProjectPath(parsed.promptPath, productRoot, manifestDir)
      : null;
  const previewImagePath =
    typeof parsed.previewImagePath === "string" && parsed.previewImagePath.trim()
      ? await resolvePortableProjectPath(parsed.previewImagePath, productRoot, manifestDir)
      : null;
  const inlinePrompt = typeof parsed.prompt === "string" ? parsed.prompt.trim() : "";
  const prompt = promptPath ? (await fs.readFile(promptPath, "utf8")).trim() : inlinePrompt;

  if (!prompt) {
    throw validationError("INVALID_BACKGROUND_MANIFEST", `Line ${lineNumber}: prompt or promptPath is required.`);
  }

  return { id, type, title, prompt, promptPath, previewImagePath };
}

function fingerprintBackground(entry: Pick<LoadedBackgroundRecord, "id" | "type" | "title" | "prompt" | "previewImagePath" | "promptPath">) {
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
  const state = await loadPersisted(productRoot);
  state.manifestPath = resolveExternalPath(manifestPath);
  await savePersisted(productRoot, state);
  return scanBackgroundLibrary({ productRoot });
}

export async function setLabelLogoPath({
  productRoot,
  labelLogoPath
}: {
  productRoot: string;
  labelLogoPath: string;
}): Promise<LoadedBackgroundLibraryState> {
  const state = await loadPersisted(productRoot);
  state.labelLogoPath = resolveExternalPath(labelLogoPath);
  await savePersisted(productRoot, state);
  return scanBackgroundLibrary({ productRoot });
}

export async function scanBackgroundLibrary({
  productRoot
}: {
  productRoot: string;
}): Promise<LoadedBackgroundLibraryState> {
  const state = await loadPersisted(productRoot);
  await relocatePersistedPaths(productRoot, state);
  const errors: string[] = [];
  let manifestMtimeMs: number | null = null;
  let manifestSha256: string | null = null;
  let backgrounds: LoadedBackgroundRecord[] = [];
  const scannedAt = new Date().toISOString();

  if (state.manifestPath) {
    try {
      const manifestStat = await fs.stat(state.manifestPath);
      if (!manifestStat.isFile()) {
        throw validationError("INVALID_BACKGROUND_MANIFEST", "Background manifest path must point to a file.");
      }
      manifestMtimeMs = manifestStat.mtimeMs;
      manifestSha256 = await sha256File(state.manifestPath);
      const manifestDir = path.dirname(state.manifestPath);
      const text = await fs.readFile(state.manifestPath, "utf8");
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
          lastSeenAt: scannedAt
        };
        const usage = state.usage[entry.id];
        const status: LoadedBackgroundRecord["status"] = usage ? "used" : "new";
        backgrounds.push({
          ...entry,
          fingerprint,
          firstSeenAt: state.seen[entry.id].firstSeenAt,
          lastSeenAt: scannedAt,
          usedAt: usage?.usedAt ?? null,
          useCount: usage?.useCount ?? 0,
          status
        });
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Could not scan background manifest.");
    }
  }

  await savePersisted(productRoot, state);
  backgrounds = backgrounds.sort((left, right) => {
    const rank = { new: 0, used: 1 };
    return rank[left.status] - rank[right.status] || left.title.localeCompare(right.title);
  });
  previewPathCache.set(
    productRoot,
    new Map(
      backgrounds.flatMap((background) =>
        background.previewImagePath ? [[background.id, background.previewImagePath] as const] : []
      )
    )
  );

  return {
    manifestPath: state.manifestPath,
    manifestMtimeMs,
    manifestSha256,
    scannedAt,
    labelLogoPath: state.labelLogoPath,
    labelLogoExists: state.labelLogoPath ? await pathExists(state.labelLogoPath) : false,
    backgrounds,
    errors
  };
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
  const library = await scanBackgroundLibrary({ productRoot });
  const background = library.backgrounds.find((item) => item.id === backgroundId);
  if (!background) {
    throw validationError("UNKNOWN_BACKGROUND", `Unknown background: ${backgroundId}.`);
  }
  return {
    id: background.id,
    type: background.type,
    title: background.title,
    prompt: background.prompt,
    previewImagePath: background.previewImagePath
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
  const state = await loadPersisted(productRoot);
  const current = state.usage[backgroundId];
  state.usage[backgroundId] = {
    usedAt: current?.usedAt ?? now,
    useCount: (current?.useCount ?? 0) + 1
  };
  await savePersisted(productRoot, state);
}

export async function getLabelLogoSnapshot({
  productRoot
}: {
  productRoot: string;
}): Promise<GenerationLabelLogoSnapshot | null> {
  const state = await loadPersisted(productRoot);
  await relocatePersistedPaths(productRoot, state);
  await savePersisted(productRoot, state);
  if (!state.labelLogoPath) return null;
  if (!(await pathExists(state.labelLogoPath))) return null;
  return {
    file: path.basename(state.labelLogoPath),
    path: state.labelLogoPath,
    sha256: await sha256File(state.labelLogoPath),
    mimeType: imageMimeType(state.labelLogoPath)
  };
}

export async function resolveBackgroundPreviewPath({
  productRoot,
  backgroundId
}: {
  productRoot: string;
  backgroundId: string;
}) {
  const cachedPath = previewPathCache.get(productRoot)?.get(backgroundId);
  if (cachedPath && await pathExists(cachedPath)) {
    return cachedPath;
  }

  const library = await scanBackgroundLibrary({ productRoot });
  const background = library.backgrounds.find((item) => item.id === backgroundId);
  if (!background?.previewImagePath) {
    throw validationError("BACKGROUND_PREVIEW_MISSING", "Background preview image is missing.");
  }
  return background.previewImagePath;
}
