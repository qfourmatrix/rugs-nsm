import path from "node:path";
import { z } from "zod";
import {
  normalizeSosCustomPalette,
  sosCustomPaletteKey,
  type SosCustomPalette
} from "../shared/sos-palettes";
import type { RefinePatternMode, RefineSettings } from "../shared/types";
import { AppError } from "./errors";
import { atomicWriteJson, ensureDir, pathExists, readJsonFile } from "./fsUtils";

const PROMPT_LIMIT = 20_000;
const PromptSchema = z.string().trim().min(1).max(PROMPT_LIMIT);
const RefinePatternModeSchema = z.enum(["symmetrical", "asymmetrical", "sos"]);
const SosCustomPaletteSchema = z
  .object({
    fieldColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    motifColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/)
  })
  .strict();

export const DEFAULT_SYMMETRICAL_REFINE_PROMPT = `Create a high-fidelity, top-down studio photograph of a premium hand-knotted wool area rug isolated on a pure white background.

NON-NEGOTIABLE RUG GEOMETRY:
Preserve the exact outer width-to-height ratio, orientation, rectangular silhouette, and visible physical proportions of the rug in the input image, excluding the tassels when measuring its body.

A landscape rug must remain landscape. A portrait rug must remain portrait. A square rug must remain square.

The 1:1 output format applies only to the white canvas, not to the rug itself. Scale and center the rug inside that canvas with sufficient white space around it. Never reshape the rug to fill the canvas.

Do not rotate, transpose, stretch, compress, widen, narrow, lengthen, shorten, or square off the rug. Preserve the relative thickness of its borders and the proportions of its major internal design zones. Keep tassels on the same edges as the input.

DESIGN VARIATION:
Using this locked rug geometry, create a clearly different sibling pattern from the same collection. Make meaningful changes inside the existing design zones by reconfiguring the paths of lines, motif placement, spacing, intersections, repetition rhythm, and internal arrangement.

The result must be visibly different from the original, but it must use the same motif vocabulary, colors, line character, visual density, border language, texture, and overall mood. Do not introduce unrelated motifs or a different decorative style.

SYMMETRICAL DESIGN RULE:
The input is a symmetrical design. Preserve its same symmetry type and axis. Every structural change must be mirrored consistently. Create a visibly different symmetrical arrangement without copying the exact original motif positions or paths.

The result should be a genuinely new design by the same designer, built inside the exact same rug dimensions and construction.

Render the complete rug directly from above, centered and fully visible without cropping. Use a dense premium wool pile with realistic fiber depth, precise edges, and uniform neat tassels.`;

export const DEFAULT_ASYMMETRICAL_REFINE_PROMPT = `Create a high-fidelity, top-down studio photograph of a premium hand-knotted wool area rug isolated on a pure white background.

NON-NEGOTIABLE RUG GEOMETRY:
Preserve the exact outer width-to-height ratio, orientation, rectangular silhouette, and visible physical proportions of the rug in the input image, excluding the tassels when measuring its body.

A landscape rug must remain landscape. A portrait rug must remain portrait. A square rug must remain square.

The 1:1 output format applies only to the white canvas, not to the rug itself. Scale and center the complete rug inside the canvas with sufficient white space. Never reshape the rug to fill the canvas.

Do not rotate, transpose, stretch, compress, widen, narrow, lengthen, shorten, or square off the rug. Keep tassels on the same edges as the input.

MANDATORY ASYMMETRICAL RECOMPOSITION - HIGHEST PRIORITY:
Create a genuinely new asymmetrical composition. Do not refine, clean up, trace, or lightly adjust the existing layout. Treat the input pattern only as a reference for design language, not as a map of where motifs must remain.

Mentally clear the rug's internal field and rebuild a fresh arrangement using the same motif vocabulary. More than half of the visible internal composition must be newly arranged, and the difference must be obvious when the input and output are viewed as small thumbnails.

REQUIRED STRUCTURAL CHANGES:
- Relocate the dominant motif groups into different regions of the rug.
- Give the major lines different starting points, endpoints, lengths, turns, routes, and vertical ordering.
- Replace the original connection map with new branches, separations, intersections, gaps, and relationships between motifs.
- Create a clearly different distribution of occupied areas and negative space.
- Ensure that no dominant line follows substantially the same complete route as its counterpart in the input.

DESIGN-LANGUAGE LOCK:
Preserve the exact color palette and color relationships, motif family, angular or curved character, line thickness, edge character, textural irregularity, overall density level, material appearance, and handmade mood of the input. Do not introduce an unrelated motif family or decorative style.

ASYMMETRY LOCK:
Keep the internal motif composition intentionally asymmetric and freeform. Do not mirror it, regularize it, or organize it around a central axis. Do not add a centered medallion, decorative perimeter, repeated border pattern, or symmetry that does not exist in the input. Center only the complete rug object within the white output canvas.

FAILURE CHECK:
The result is invalid if the dominant paths, motif groups, and negative spaces remain in approximately the same locations as the input, or if the changes are limited to small shifts, extensions, texture changes, or endpoint adjustments. If it still looks like the same layout at thumbnail size, recompose it again before returning the image.

The final result must look like a different rug designed by the same designer for the same collection: same visual language, clearly different internal topology.

Render the complete rug directly from above, centered and fully visible without cropping. Use a dense premium wool pile with realistic fiber depth, precise edges, and uniform neat tassels.`;

export const DEFAULT_SOS_REFINE_PROMPT = `Create a high-fidelity, top-down studio photograph of the exact input rug isolated on a pure white background.

NON-NEGOTIABLE PRODUCT LOCK:
Preserve the exact outer width-to-height ratio, orientation, rectangular silhouette, visible physical proportions, edge shape, border thickness, and tassel placement of the input rug. A landscape rug must remain landscape, a portrait rug must remain portrait, and a square rug must remain square.

The 1:1 output format applies only to the white canvas. Scale and center the complete rug inside that canvas with sufficient white space. Never reshape the rug to fill the canvas. Do not rotate, transpose, stretch, compress, widen, narrow, lengthen, shorten, crop, or square off the rug.

SOS PRIORITY:
This is a controlled recolor, not a request for a new rug. Follow the appended SOS design-mode and color-direction instructions as the highest-priority editing rules. Never introduce an unrelated motif family, decorative style, material, construction, border treatment, or composition.

Render the complete rug directly from above with realistic dense premium wool fibers, authentic handmade texture, precise edges, and the input rug's tassels or fringe preserved exactly without cleanup or regularization. Preserve the input camera orientation and physical character.`;

// Kept as an alias for callers that still identify the original single prompt.
export const DEFAULT_REFINE_PROMPT = DEFAULT_SYMMETRICAL_REFINE_PROMPT;

const DefaultPrompts: Record<RefinePatternMode, string> = {
  symmetrical: DEFAULT_SYMMETRICAL_REFINE_PROMPT,
  asymmetrical: DEFAULT_ASYMMETRICAL_REFINE_PROMPT,
  sos: DEFAULT_SOS_REFINE_PROMPT
};

const LegacyRefineSettingsSchema = z
  .object({
    version: z.literal(1),
    prompt: PromptSchema,
    updatedAt: z.string().datetime()
  })
  .strict();

const PersistedRefineSettingsV2Schema = z
  .object({
    version: z.literal(2),
    prompts: z
      .object({
        symmetrical: PromptSchema,
        asymmetrical: PromptSchema
      })
      .strict(),
    updatedAt: z.string().datetime()
  })
  .strict();

const PersistedRefineSettingsV3Schema = z
  .object({
    version: z.literal(3),
    prompts: z
      .object({
        symmetrical: PromptSchema,
        asymmetrical: PromptSchema,
        sos: PromptSchema
      })
      .strict(),
    recentSosPalettes: z.array(SosCustomPaletteSchema).max(6),
    updatedAt: z.string().datetime()
  })
  .strict();

type PersistedRefineSettings = z.infer<typeof PersistedRefineSettingsV3Schema>;
type StoredRefineSettings =
  | PersistedRefineSettings
  | z.infer<typeof PersistedRefineSettingsV2Schema>
  | z.infer<typeof LegacyRefineSettingsSchema>;

export function refineSettingsPath(productRoot: string) {
  return path.join(productRoot, ".product-shot-queue", "refine-settings.json");
}

export async function validateRefineSettings(value: unknown): Promise<StoredRefineSettings> {
  const parsed = z
    .union([PersistedRefineSettingsV3Schema, PersistedRefineSettingsV2Schema, LegacyRefineSettingsSchema])
    .safeParse(value);

  if (!parsed.success) {
    throw new AppError(
      400,
      "INVALID_REFINE_SETTINGS",
      `Invalid refine settings: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`
    );
  }

  return parsed.data;
}

function withDefaultPrompts(settings: PersistedRefineSettings): RefineSettings {
  return {
    ...settings,
    defaultPrompts: { ...DefaultPrompts }
  };
}

function newSettings(now = new Date().toISOString()): PersistedRefineSettings {
  return {
    version: 3,
    prompts: { ...DefaultPrompts },
    recentSosPalettes: [],
    updatedAt: now
  };
}

export async function loadRefineSettings({ productRoot }: { productRoot: string }): Promise<RefineSettings> {
  const filePath = refineSettingsPath(productRoot);
  if (!(await pathExists(filePath))) {
    const settings = newSettings();
    await ensureDir(path.dirname(filePath));
    await atomicWriteJson(filePath, settings);
    return withDefaultPrompts(settings);
  }

  const stored = await validateRefineSettings(await readJsonFile(filePath));
  if (stored.version === 3) {
    return withDefaultPrompts(stored);
  }

  const migrated: PersistedRefineSettings = {
    version: 3,
    prompts:
      stored.version === 2
        ? { ...stored.prompts, sos: DEFAULT_SOS_REFINE_PROMPT }
        : {
            symmetrical: stored.prompt,
            asymmetrical: DEFAULT_ASYMMETRICAL_REFINE_PROMPT,
            sos: DEFAULT_SOS_REFINE_PROMPT
          },
    recentSosPalettes: [],
    updatedAt: stored.updatedAt
  };
  await atomicWriteJson(filePath, migrated);
  return withDefaultPrompts(migrated);
}

export async function saveRefineSettings({
  productRoot,
  mode,
  prompt
}: {
  productRoot: string;
  mode: unknown;
  prompt: unknown;
}): Promise<RefineSettings> {
  const parsedMode = RefinePatternModeSchema.safeParse(mode);
  const parsedPrompt = PromptSchema.safeParse(prompt);
  if (!parsedMode.success || !parsedPrompt.success) {
    const issues = [...(parsedMode.error?.issues ?? []), ...(parsedPrompt.error?.issues ?? [])];
    throw new AppError(
      400,
      "INVALID_REFINE_SETTINGS",
      `Invalid refine settings: ${issues.map((issue) => issue.message).join("; ")}`
    );
  }

  const current = await loadRefineSettings({ productRoot });
  const settings: PersistedRefineSettings = {
    version: 3,
    prompts: {
      ...current.prompts,
      [parsedMode.data]: parsedPrompt.data
    },
    recentSosPalettes: current.recentSosPalettes,
    updatedAt: new Date().toISOString()
  };
  const filePath = refineSettingsPath(productRoot);
  await ensureDir(path.dirname(filePath));
  await atomicWriteJson(filePath, settings);
  return withDefaultPrompts(settings);
}

export async function saveRecentSosPalette({
  productRoot,
  palette
}: {
  productRoot: string;
  palette: unknown;
}): Promise<RefineSettings> {
  const parsedPalette = SosCustomPaletteSchema.safeParse(palette);
  const normalized = parsedPalette.success
    ? normalizeSosCustomPalette(parsedPalette.data as SosCustomPalette)
    : null;
  if (!normalized || normalized.fieldColor === normalized.motifColor) {
    throw new AppError(
      400,
      "INVALID_SOS_PALETTE",
      "SOS custom colors must be two different six-digit hex colors."
    );
  }

  const current = await loadRefineSettings({ productRoot });
  const key = sosCustomPaletteKey(normalized);
  const recentSosPalettes = [
    normalized,
    ...current.recentSosPalettes.filter((entry) => sosCustomPaletteKey(entry) !== key)
  ].slice(0, 6);
  const settings: PersistedRefineSettings = {
    version: 3,
    prompts: current.prompts,
    recentSosPalettes,
    updatedAt: new Date().toISOString()
  };
  const filePath = refineSettingsPath(productRoot);
  await ensureDir(path.dirname(filePath));
  await atomicWriteJson(filePath, settings);
  return withDefaultPrompts(settings);
}
