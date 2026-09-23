import { DatabaseSync } from "node:sqlite";
import { open, link, unlink } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

/** Offline compatibility snapshot. The ledger is read-only; existing files are never replaced. */
export async function exportJobHistory(productRoot: string, destination: string) {
  const output = path.resolve(destination);
  const temporary = path.join(path.dirname(output), `.job-history-${randomUUID()}.tmp`);
  const database = new DatabaseSync(path.join(path.resolve(productRoot), ".product-shot-queue", "job-ledger.sqlite"), { readOnly: true });
  let file: Awaited<ReturnType<typeof open>> | undefined;
  let createdTemporary = false;
  try {
    database.exec("PRAGMA busy_timeout=3000; BEGIN");
    const schema = database.prepare("SELECT value FROM ledger_meta WHERE key='schema'").get();
    if (schema?.value !== "1") throw Error("Unsupported ledger schema; no snapshot written.");
    const active = database.prepare("SELECT COUNT(*) AS count FROM job_history WHERE status IN ('queued','generating')").get();
    if (Number(active?.count)) throw Error("Active jobs exist. Finish or cancel them and stop the studio before exporting a rollback snapshot.");
    const unknown = database.prepare("SELECT COUNT(*) AS count FROM generation_dispatch WHERE state='started'").get();
    if (Number(unknown?.count)) throw Error("Unresolved provider outcomes exist. Reconcile them before rollback; a legacy app cannot preserve deduplication protection.");
    file = await open(temporary, "wx", 0o600);
    createdTemporary = true;
    const hash = createHash("sha256");
    const write = async (text: string) => { hash.update(text); await file!.writeFile(text); };
    await write("[\n");
    let count = 0;
    for (const row of database.prepare("SELECT record FROM job_history ORDER BY seq DESC").iterate()) {
      const record = JSON.parse(String(row.record));
      if (!record || typeof record.jobId !== "string") throw Error("Malformed job record; no snapshot published.");
      await write(`${count ? ",\n" : ""}${JSON.stringify(record)}`);
      count++;
    }
    await write("\n]\n");
    await file.sync();
    await file.close(); file = undefined;
    database.exec("COMMIT");
    // Atomic publication without overwrite, including symlink/existing-file targets.
    await link(temporary, output);
    return { output, count, sha256: hash.digest("hex") };
  } finally {
    await file?.close();
    database.close();
    if (createdTemporary) await unlink(temporary);
  }
}
