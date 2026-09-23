import { DatabaseSync } from "node:sqlite";
import { constants } from "node:fs";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { JobRecord } from "../shared/types";
import { AppError } from "./errors";

const recordSchema = z.object({
  jobId: z.string().min(1), runId: z.string(), productId: z.string(),
  shotId: z.string(), shotName: z.string().optional(), batchIndex: z.number().optional(), batchTotal: z.number().optional(),
  status: z.enum(["queued", "generating", "succeeded", "failed", "cancelled"]),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(), message: z.string()
}).passthrough();

export interface JobHistoryPage { jobs: JobRecord[]; nextCursor: number | null }

/** Local durable history. Queries are bounded; no whole-history in-memory mirror. */
export class JobLedger {
  private constructor(private readonly db: DatabaseSync) {}

  static async open(productRoot: string): Promise<JobLedger> {
    const directory = path.join(productRoot, ".product-shot-queue");
    await mkdir(directory, { recursive: true });
    const db = new DatabaseSync(path.join(directory, "job-ledger.sqlite"));
    try {
      db.exec(`PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
        CREATE TABLE IF NOT EXISTS ledger_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS job_history (
          seq INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL UNIQUE,
          product_id TEXT NOT NULL, status TEXT NOT NULL, record TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS job_history_product ON job_history(product_id, seq DESC);
        CREATE INDEX IF NOT EXISTS job_history_active ON job_history(status, seq DESC);
        CREATE TABLE IF NOT EXISTS generation_requests (
          scope TEXT NOT NULL, key TEXT NOT NULL, body_hash TEXT NOT NULL,
          state TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
          response_status INTEGER, response_body TEXT, PRIMARY KEY(scope,key)
        );
        CREATE TABLE IF NOT EXISTS generation_dispatch (
          job_id TEXT PRIMARY KEY, scope TEXT NOT NULL, request_key TEXT NOT NULL,
          payload TEXT NOT NULL, state TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS generation_request_expiry ON generation_requests(expires_at);
        CREATE INDEX IF NOT EXISTS generation_dispatch_request ON generation_dispatch(scope,request_key,state);`);
      const version = db.prepare("SELECT value FROM ledger_meta WHERE key='schema'").get();
      if (version && version.value !== "1") throw new Error("Unsupported job ledger schema; refusing to modify history.");
      const ledger = new JobLedger(db);
      if (!db.prepare("SELECT value FROM ledger_meta WHERE key='legacy_import'").get()) {
        const legacyPath = path.join(directory, "jobs.json");
        let raw: string | null = null;
        try { raw = await readFile(legacyPath, "utf8"); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        const legacy = raw === null ? [] : z.array(recordSchema).parse(JSON.parse(raw)) as JobRecord[];
        if (raw !== null) {
          await copyFile(legacyPath, path.join(directory, "jobs.pre-ledger-v1.json"), constants.COPYFILE_EXCL)
            .catch(error => { if (error.code !== "EEXIST") throw error; });
        }
        ledger.transaction(() => {
          // Legacy JSON was newest-first. Sequence remains stable across later updates.
          for (const job of [...legacy].reverse()) ledger.put(job);
          db.prepare("INSERT OR IGNORE INTO ledger_meta VALUES ('schema', '1')").run();
          db.prepare("INSERT OR IGNORE INTO ledger_meta VALUES ('legacy_import', '1')").run();
        });
      }
      return ledger;
    } catch (error) { db.close(); throw error; }
  }

  transaction<T>(action: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = action(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  put(job: JobRecord): void {
    recordSchema.parse(job);
    this.db.prepare(`INSERT INTO job_history(job_id,product_id,status,record) VALUES (?,?,?,?)
      ON CONFLICT(job_id) DO UPDATE SET product_id=excluded.product_id,status=excluded.status,record=excluded.record`)
      .run(job.jobId, job.productId, job.status, JSON.stringify(job));
  }

  get(jobId: string): JobRecord | null {
    const row = this.db.prepare("SELECT record FROM job_history WHERE job_id=?").get(jobId);
    return row ? JSON.parse(String(row.record)) : null;
  }

  active(): JobRecord[] {
    return this.db.prepare("SELECT record FROM job_history WHERE status IN ('queued','generating') ORDER BY seq DESC")
      .all().map(row => JSON.parse(String(row.record)));
  }

  history({ productId, before, limit = 100 }: { productId?: string; before?: number; limit?: number } = {}): JobHistoryPage {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("History limit must be 1–500.");
    if (before !== undefined && (!Number.isSafeInteger(before) || before < 1)) throw new Error("Invalid history cursor.");
    const where = ["status NOT IN ('queued','generating')"];
    const values: (string | number)[] = [];
    if (productId !== undefined) { where.push("product_id=?"); values.push(productId); }
    if (before !== undefined) { where.push("seq<?"); values.push(before); }
    const rows = this.db.prepare(`SELECT seq,record FROM job_history WHERE ${where.join(" AND ")} ORDER BY seq DESC LIMIT ?`).all(...values, limit + 1);
    const page = rows.slice(0, limit);
    return { jobs: page.map(row => JSON.parse(String(row.record))), nextCursor: rows.length > limit ? Number(page.at(-1)!.seq) : null };
  }

  close() { this.db.close(); }

  /** Null wins admission; completed duplicates replay the exact stored response bytes. */
  claimRequest(scope: string, key: string, bodyHash: string, now = Date.now()): { status: number; body: string } | null {
    if (!key || key.length > 255 || !/^[a-zA-Z0-9._:-]+$/.test(key)) throw new AppError(400, "IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key is required. Reload the studio before generating.");
    return this.transaction(() => {
      const row = this.db.prepare("SELECT * FROM generation_requests WHERE scope=? AND key=?").get(scope, key);
      if (row) {
        if (row.body_hash !== bodyHash) throw new AppError(422, "IDEMPOTENCY_BODY_MISMATCH", "This request ID was already used for different input.");
        if (row.state === "in_progress") throw new AppError(409, "GENERATION_REQUEST_PENDING", "This submission is already being prepared, or was interrupted. Check its status; do not submit a new request blindly.");
        return { status: Number(row.response_status), body: String(row.response_body) };
      }
      this.db.prepare("INSERT INTO generation_requests(scope,key,body_hash,state,created_at,expires_at) VALUES (?,?,?,'in_progress',?,?)")
        .run(scope, key, bodyHash, now, now + 7 * 24 * 60 * 60 * 1000);
      return null;
    });
  }

  commitRequest(scope: string, key: string, bodyHash: string, batch: Array<{ job: JobRecord; payload: unknown }>, status: number, body: string) {
    this.transaction(() => {
      const row = this.db.prepare("SELECT state,body_hash FROM generation_requests WHERE scope=? AND key=?").get(scope, key);
      if (!row || row.state !== "in_progress" || row.body_hash !== bodyHash) throw new AppError(409, "REQUEST_NOT_ADMITTED", "Request cannot be committed twice.");
      for (const item of batch) {
        // The UNIQUE dispatch key also prevents accidentally attaching an existing job to a second request.
        this.db.prepare("INSERT INTO generation_dispatch VALUES (?,?,?,?,'queued')").run(item.job.jobId, scope, key, JSON.stringify(item.payload));
        this.put(item.job);
      }
      this.db.prepare("UPDATE generation_requests SET state='complete',response_status=?,response_body=? WHERE scope=? AND key=?")
        .run(status, body, scope, key);
    });
  }

  finishUndispatched(jobId: string) {
    // A cancelled/preparation-failed item never reached the provider. Do not
    // convert an ambiguous started dispatch into a resolved one.
    this.db.prepare("UPDATE generation_dispatch SET state='finished' WHERE job_id=? AND state='queued'").run(jobId);
  }

  markDispatch(jobId: string, state: "started" | "finished") {
    this.db.prepare("UPDATE generation_dispatch SET state=? WHERE job_id=?").run(state, jobId);
  }

  requestStatus(scope: string, key: string) {
    const row = this.db.prepare("SELECT state,response_status,response_body FROM generation_requests WHERE scope=? AND key=?").get(scope, key);
    if (!row) return { state: "missing" as const, responseStatus: null, response: null };
    return { state: String(row.state), responseStatus: row.response_status === null ? null : Number(row.response_status), response: row.response_body === null ? null : JSON.parse(String(row.response_body)) };
  }

  sweepRequests(now = Date.now(), limit = 100): number {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("Invalid cleanup limit.");
    return this.transaction(() => {
      const expired = this.db.prepare(`SELECT scope,key FROM generation_requests r WHERE expires_at<? AND state='complete'
        AND NOT EXISTS (SELECT 1 FROM generation_dispatch d WHERE d.scope=r.scope AND d.request_key=r.key AND d.state!='finished') LIMIT ?`).all(now, limit);
      for (const row of expired) {
        this.db.prepare("DELETE FROM generation_dispatch WHERE scope=? AND request_key=?").run(row.scope, row.key);
        this.db.prepare("DELETE FROM generation_requests WHERE scope=? AND key=?").run(row.scope, row.key);
      }
      return expired.length;
    });
  }
}
