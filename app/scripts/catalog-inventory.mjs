import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const supportedImages = new Set([".png", ".jpg", ".jpeg", ".webp"]);

function parseEnvValue(text, key) {
  const line = text.split(/\r?\n/).find((candidate) => candidate.trim().match(new RegExp(`^(?:export\\s+)?${key}\\s*=`)));
  if (!line) return null;
  const raw = line.slice(line.indexOf("=") + 1).trim();
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) return raw.slice(1, -1);
  return raw.replace(/\s+#.*$/, "").trim();
}

async function productRoot() {
  let envText = "";
  try {
    envText = await fs.readFile(path.join(appRoot, ".env.local"), "utf8");
  } catch {
    // The default product root is valid when no local env file exists.
  }
  const configured = parseEnvValue(envText, "PRODUCT_ROOT") ?? parseEnvValue(envText, "APP_PRODUCT_ROOT");
  if (!configured) return path.resolve(appRoot, "../data/nsm100k");
  return path.isAbsolute(configured) ? path.normalize(configured) : path.resolve(appRoot, configured);
}

async function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  const handle = await fs.open(filePath, "r");
  try {
    for await (const chunk of handle.createReadStream()) hash.update(chunk);
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
}

async function walkStats(dirPath) {
  let fileCount = 0;
  let totalBytes = 0;
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const child = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const nested = await walkStats(child);
      fileCount += nested.fileCount;
      totalBytes += nested.totalBytes;
    } else if (entry.isFile()) {
      const info = await fs.stat(child);
      fileCount += 1;
      totalBytes += info.size;
    }
  }
  return { fileCount, totalBytes };
}

async function inventory() {
  const root = await productRoot();
  const entries = await fs.readdir(root, { withFileTypes: true });
  const products = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const dirPath = path.join(root, entry.name);
    const files = await fs.readdir(dirPath, { withFileTypes: true });
    const baseFiles = files
      .filter((file) => file.isFile() && path.parse(file.name).name.toLowerCase() === "base" && supportedImages.has(path.extname(file.name).toLowerCase()))
      .map((file) => file.name)
      .sort();
    const baseHashes = [];
    for (const file of baseFiles) baseHashes.push({ file, sha256: await sha256(path.join(dirPath, file)) });
    const variantPath = path.join(dirPath, "variant.json");
    let variantSha256 = null;
    try {
      variantSha256 = await sha256(variantPath);
    } catch {
      // Area rugs do not have variant.json.
    }
    products.push({ id: entry.name, baseHashes, variantSha256, ...(await walkStats(dirPath)) });
  }
  products.sort((left, right) => left.id.localeCompare(right.id));
  return { version: 1, productRoot: root, productCount: products.length, products };
}

const outputIndex = process.argv.indexOf("--output");
const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : null;
if (!outputPath) throw new Error("Usage: node scripts/catalog-inventory.mjs --output /absolute/path.json");
await fs.writeFile(outputPath, `${JSON.stringify(await inventory(), null, 2)}\n`, { flag: "wx" });
