import type { AssetRecord } from "../shared/types";

export type AppMode = "generate" | "compare";

export interface LocatedAsset extends AssetRecord {
  location: "generated" | "trash";
}
