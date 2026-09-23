import { DatabaseSync } from "node:sqlite";
import { constants, promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { notFoundError, validationError } from "./errors";
import type { GalleryExportReceipt } from "../shared/types";

const summarySchema = z.object({
  exportId: z.string().regex(/^export_[a-zA-Z0-9_-]+$/),
  completedAt: z.string().datetime(), downloadedAt: z.string().datetime().nullable(),
  archiveFilename: z.string(), archiveBytes: z.number().nonnegative(),
  includedShapes: z.number().int().nonnegative(), skippedShapes: z.number().int().nonnegative()
});
export type ExportReceiptSummary = z.infer<typeof summarySchema>;
export interface ExportReceiptPage { receipts: ExportReceiptSummary[]; nextCursor: string | null }
const operations = new Map<string, Promise<unknown>>();

async function readReceipt(file: string): Promise<unknown> {
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!(await handle.stat()).isFile()) throw validationError("INVALID_RECEIPT_FILE", "Receipt must be a regular file.");
    return JSON.parse(await handle.readFile("utf8"));
  } finally { await handle.close(); }
}

/** Serialize index refreshes only; exports keep writing their authoritative JSON independently. */
async function serialized<T>(root: string, operation: () => Promise<T>): Promise<T> {
  const previous = operations.get(root) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  operations.set(root, next);
  try { return await next; } finally { if (operations.get(root) === next) operations.delete(root); }
}

function parseCursor(cursor?: string): { time: number; id: string } | null {
  if (cursor === undefined) return null;
  try {
    if (cursor.length > 512) throw Error();
    return z.object({ time: z.number().finite(), id: z.string().regex(/^export_[a-zA-Z0-9_-]+$/) }).parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
  } catch { throw validationError("INVALID_RECEIPT_CURSOR", "Invalid export-history cursor."); }
}

export async function listExportReceiptPage(root: string, options: { limit?: number; cursor?: string } = {}): Promise<ExportReceiptPage> {
  const limit = options.limit ?? 8;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw validationError("INVALID_RECEIPT_LIMIT", "Export-history page size must be 1–100.");
  const cursor = parseCursor(options.cursor);
  return serialized(path.resolve(root), async () => {
    const state = path.join(root, ".product-shot-queue");
    const directory = path.join(state, "export-receipts");
    await fs.mkdir(directory, { recursive: true });
    // Derived cache only. Removing this file rebuilds it from untouched original receipts.
    const db = new DatabaseSync(path.join(state, "export-receipt-index.sqlite"));
    try {
      db.exec(`PRAGMA busy_timeout=1000;
        CREATE TABLE IF NOT EXISTS receipt_summary_v1 (
          filename TEXT PRIMARY KEY, fingerprint TEXT NOT NULL,
          completed REAL NOT NULL, export_id TEXT NOT NULL, summary TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS receipt_order_v1 ON receipt_summary_v1(completed DESC, export_id DESC);`);
      const lookup = db.prepare("SELECT fingerprint FROM receipt_summary_v1 WHERE filename=?");
      const put = db.prepare("INSERT OR REPLACE INTO receipt_summary_v1 VALUES (?,?,?,?,?)");
      const remove = db.prepare("DELETE FROM receipt_summary_v1 WHERE filename=?");
      const seen = new Set<string>();
      const entries = await fs.opendir(directory);
      for await (const entry of entries) {
        if (!entry.isFile() || !/^export_[a-zA-Z0-9_-]+\.json$/.test(entry.name)) continue;
        seen.add(entry.name);
        const file = path.join(directory, entry.name);
        try {
          const stat = await fs.stat(file, { bigint: true });
          const fingerprint = `${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
          if (lookup.get(entry.name)?.fingerprint === fingerprint) continue;
          const summary = summarySchema.parse(await readReceipt(file));
          if (`${summary.exportId}.json` !== entry.name) throw Error("Receipt identity mismatch");
          // A concurrent atomic receipt update will be detected by the next refresh.
          put.run(entry.name, fingerprint, Date.parse(summary.completedAt), summary.exportId, JSON.stringify(summary));
        } catch (error) {
          if (error instanceof z.ZodError || error instanceof SyntaxError || (error instanceof Error && error.message === "Receipt identity mismatch") || (error as NodeJS.ErrnoException).code === "ENOENT") {
            remove.run(entry.name);
          } else throw error; // Permission/storage failures must not masquerade as empty history.
        }
      }
      for (const row of db.prepare("SELECT filename FROM receipt_summary_v1").iterate()) {
        if (!seen.has(String(row.filename))) remove.run(String(row.filename));
      }
      const rows = cursor
        ? db.prepare("SELECT summary FROM receipt_summary_v1 WHERE completed < ? OR (completed = ? AND export_id < ?) ORDER BY completed DESC, export_id DESC LIMIT ?").all(cursor.time, cursor.time, cursor.id, limit + 1)
        : db.prepare("SELECT summary FROM receipt_summary_v1 ORDER BY completed DESC, export_id DESC LIMIT ?").all(limit + 1);
      const receipts = rows.slice(0, limit).map(row => summarySchema.parse(JSON.parse(String(row.summary))));
      const last = receipts.at(-1);
      return { receipts, nextCursor: rows.length > limit && last ? Buffer.from(JSON.stringify({ time: Date.parse(last.completedAt), id: last.exportId })).toString("base64url") : null };
    } finally { db.close(); }
  });
}

export async function getExportReceipt(root: string, exportId: string): Promise<GalleryExportReceipt> {
  if (!/^export_[a-zA-Z0-9_-]+$/.test(exportId)) throw validationError("INVALID_EXPORT_ID", "Invalid export receipt ID.");
  try {
    const receipt = await readReceipt(path.join(root, ".product-shot-queue", "export-receipts", `${exportId}.json`));
    if (summarySchema.parse(receipt).exportId !== exportId) throw Error("Receipt identity mismatch");
    return receipt as GalleryExportReceipt;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw notFoundError("RECEIPT_NOT_FOUND", "Export receipt not found.");
    if ((error as NodeJS.ErrnoException).code === "ELOOP") throw validationError("INVALID_RECEIPT_FILE", "Receipt cannot be a symbolic link.");
    throw error;
  }
}
