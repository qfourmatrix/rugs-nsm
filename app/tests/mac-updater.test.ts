import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("recipient Mac updater safety order", () => {
  it("tests a detached candidate before fast-forwarding the live copy and verifies catalog inventory", async () => {
    const script = await readFile(path.resolve(appRoot, "../scripts/mac/update.sh"), "utf8");
    const worktree = script.indexOf("worktree add --detach");
    const candidateTests = script.indexOf("npm test", worktree);
    const candidateBuild = script.indexOf("npm run build", candidateTests);
    const liveMerge = script.indexOf("merge --ff-only", candidateBuild);
    const beforeInventory = script.indexOf("catalog-inventory.mjs");
    const inventoryCompare = script.indexOf("cmp -s");

    expect(worktree).toBeGreaterThan(0);
    expect(candidateTests).toBeGreaterThan(worktree);
    expect(candidateBuild).toBeGreaterThan(candidateTests);
    expect(liveMerge).toBeGreaterThan(candidateBuild);
    expect(beforeInventory).toBeLessThan(liveMerge);
    expect(inventoryCompare).toBeGreaterThan(liveMerge);
    expect(script).toContain("tracked_changes=");
    expect(script).toContain("merge-base --is-ancestor");
    expect(script).toContain('live_updated=1');
    expect(script).toContain('reset --hard "$previous_commit"');
  });
});
