import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import type { RequestHandler } from "express";
import type { JobRecord } from "../shared/types";
import { isGenerationRoute } from "../shared/generation-routes";
import { JobLedger } from "./job-ledger";
import { AppError } from "./errors";
import { canonicalJson } from "../shared/canonical-json";

export class GenerationAdmission<T extends { job: JobRecord }> {
  private readonly context = new AsyncLocalStorage<{ items: T[]; rejected: Array<() => Promise<void>> }>();
  constructor(private readonly ledger: JobLedger, private readonly validate: (items: T[]) => void, private readonly activate: (items: T[]) => void) {}

  stage(item: T): boolean {
    const current = this.context.getStore();
    if (!current) throw new AppError(500, "UNPROTECTED_GENERATION", "Generation must use durable request admission.");
    current.items.push(item);
    return true;
  }

  onRejected(action: () => Promise<void>) {
    const current = this.context.getStore();
    if (!current) throw new AppError(500, "UNPROTECTED_GENERATION", "Preparation recovery must use durable request admission.");
    current.rejected.push(action);
  }

  middleware: RequestHandler = (req, res, next) => {
    if (req.method !== "POST" || !isGenerationRoute(req.path)) { next(); return; }
    const scope = req.path; // Ledger is scoped to a single catalog root.
    const key = req.get("Idempotency-Key") ?? "";
    const hash = createHash("sha256").update(canonicalJson(req.body ?? null)).digest("hex");
    try {
      const replay = this.ledger.claimRequest(scope, key, hash);
      if (replay) { res.setHeader("Idempotency-Status", "complete"); res.status(replay.status).type("json").send(replay.body); return; }
    } catch (error) {
      if (error instanceof AppError && error.code === "GENERATION_REQUEST_PENDING") res.setHeader("Retry-After", "2");
      next(error); return;
    }
    const context = { items: [] as T[], rejected: [] as Array<() => Promise<void>> };
    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      const status = res.statusCode;
      const batch = status < 400 ? context.items : [];
      if (status < 400) this.validate(batch);
      const serialized = JSON.stringify(body);
      if (status >= 400 && context.rejected.length) {
        res.json = originalJson;
        // Restore file-backed preparation state before acknowledging rejection.
        // Failed recovery stays an explicit error; it cannot activate any job.
        void (async () => {
          const results = await Promise.allSettled(context.rejected.map(action => action()));
          const failed = results.find(result => result.status === "rejected");
          if (failed?.status === "rejected") throw failed.reason;
          this.ledger.commitRequest(scope, key, hash, [], status, serialized);
          res.setHeader("Idempotency-Status", "complete");
          res.status(status).type("json").send(serialized);
        })().catch(next);
        return res;
      }
      this.ledger.commitRequest(scope, key, hash, batch.map(item => ({ job: item.job, payload: item })), status, serialized);
      res.json = originalJson;
      // Commit above is synchronous. No provider dispatch can happen before durable acceptance.
      if (batch.length) this.activate(batch);
      res.setHeader("Idempotency-Status", "complete");
      return res.type("json").send(serialized);
    }) as typeof res.json;
    this.context.run(context, next);
  };
}
