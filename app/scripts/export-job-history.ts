import path from "node:path";
import { exportJobHistory } from "../server/job-history-backup";

const [productRoot, destination, ...extra] = process.argv.slice(2);
if (!productRoot || !destination || extra.length || !path.isAbsolute(productRoot) || !path.isAbsolute(destination)) {
  throw Error("Usage: export-job-history.ts /absolute/product/root /absolute/new/snapshot.json. Stop the studio first. Existing files are never overwritten.");
}
console.log(JSON.stringify(await exportJobHistory(productRoot, destination), null, 2));
