import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { validationError } from "./errors";

export const SUPPORTED_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

export function imageMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "application/octet-stream";
}

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export function assertSafeBasename(filename: string): void {
  if (
    !filename ||
    filename !== path.basename(filename) ||
    filename.includes("/") ||
    filename.includes("\\") ||
    filename === "." ||
    filename === ".."
  ) {
    throw validationError("INVALID_FILENAME", "Filename must be a basename only.");
  }
}

export function safeChildPath(parentDir: string, filename: string): string {
  assertSafeBasename(filename);
  const resolvedParent = path.resolve(parentDir);
  const resolvedChild = path.resolve(resolvedParent, filename);

  if (path.dirname(resolvedChild) !== resolvedParent) {
    throw validationError("INVALID_FILENAME", "Filename resolves outside the allowed directory.");
  }

  return resolvedChild;
}

async function fsyncDirectory(dirPath: string): Promise<void> {
  try {
    const handle = await fs.open(dirPath, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Directory fsync is not available on every platform/filesystem. File fsync still happened.
  }
}

export async function atomicWriteJson(
  filePath: string,
  value: unknown,
  options: { overwrite?: boolean } = {}
): Promise<void> {
  const overwrite = options.overwrite ?? true;
  const dirPath = path.dirname(filePath);
  await ensureDir(dirPath);

  const tmpPath = path.join(
    dirPath,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString("hex")}.tmp`
  );

  const payload = `${JSON.stringify(value, null, 2)}\n`;
  const handle = await fs.open(tmpPath, "wx");
  try {
    await handle.writeFile(payload, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }

  if (overwrite) {
    await fs.rename(tmpPath, filePath);
  } else {
    try {
      await fs.link(tmpPath, filePath);
    } catch (error) {
      await fs.unlink(tmpPath).catch(() => undefined);
      throw error;
    }
    await fs.unlink(tmpPath);
  }

  await fsyncDirectory(dirPath);
}

export async function readJsonFile(filePath: string): Promise<unknown> {
  const text = await fs.readFile(filePath, "utf8");
  return JSON.parse(text) as unknown;
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  const handle = await fs.open(filePath, "r");
  try {
    const stream = handle.createReadStream();
    for await (const chunk of stream) {
      hash.update(chunk);
    }
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
}

export async function writeFileExclusive(filePath: string, data: Buffer): Promise<void> {
  const handle = await fs.open(filePath, "wx");
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function regularFileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.lstat(filePath);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}
