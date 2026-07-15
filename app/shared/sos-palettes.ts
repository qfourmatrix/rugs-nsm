export const SOS_PALETTE_IDS = [
  "auto_flip",
  "brick_bone",
  "indigo_rust",
  "oxblood_camel",
  "terracotta_teal",
  "wine_olive",
  "plum_blush",
  "custom"
] as const;

export type SosPaletteId = (typeof SOS_PALETTE_IDS)[number];

export interface SosCustomPalette {
  fieldColor: string;
  motifColor: string;
}

export interface SosPresetPalette {
  id: Exclude<SosPaletteId, "custom">;
  label: string;
  fieldColor: string | null;
  motifColor: string | null;
}

export const DEFAULT_SOS_CUSTOM_PALETTE: SosCustomPalette = {
  fieldColor: "#91413A",
  motifColor: "#E0CFB2"
};

export const SOS_PRESET_PALETTES: readonly SosPresetPalette[] = [
  { id: "auto_flip", label: "Auto flip", fieldColor: null, motifColor: null },
  { id: "brick_bone", label: "Brick + Bone", fieldColor: "#91413A", motifColor: "#E0CFB2" },
  { id: "indigo_rust", label: "Indigo + Rust", fieldColor: "#283B66", motifColor: "#A7603B" },
  { id: "oxblood_camel", label: "Oxblood + Camel", fieldColor: "#611F25", motifColor: "#B79466" },
  { id: "terracotta_teal", label: "Terracotta + Teal", fieldColor: "#A5653C", motifColor: "#35575B" },
  { id: "wine_olive", label: "Wine + Olive", fieldColor: "#5E2628", motifColor: "#666A53" },
  { id: "plum_blush", label: "Plum + Blush", fieldColor: "#4E3448", motifColor: "#D5B69E" }
];

const SOS_PRESET_BY_ID = new Map(SOS_PRESET_PALETTES.map((palette) => [palette.id, palette]));
const HEX_COLOR_PATTERN = /^#[0-9A-F]{6}$/;

const SOS_TASSEL_LOCK = `SOS TASSEL / FRINGE LOCK — ABSOLUTE:
Use the input image as the exact physical reference for every tassel or fringe. First identify which rug edges actually carry tassels, then reproduce tassels on those edges only. Preserve the same visible strand or bundle count density, root positions, spacing, length, thickness, twist, knots, fray, direction, color, material, attachment method, and natural irregularity.

Do not add tassels to a plain or bound edge. Do not remove, crop away, hide, shorten, lengthen, thicken, thin, duplicate, mirror, wrap around corners, fan out, merge, flatten, braid, loop, comb, beautify, regularize, or redesign the tassels. Do not replace them with a woven band, brush fringe, rope, macrame, pom-poms, generic yarn tufts, or a pale edge strip. Keep every tassel physically attached to the same original rug edge and preserve the exact bare-edge gaps and corner behavior visible in the input.

The selected SOS palette applies only to the existing rug field, motif, line, and border color regions. It must not recolor or reconstruct the tassels or fringe. Ignore any generic instruction to make tassels neat or uniform when that would differ from the input. Tassel and fringe fidelity overrides all color, cleanup, symmetry, and minimal-design-change instructions.`;

export function normalizeHexColor(value: string): string | null {
  const trimmed = value.trim().toUpperCase();
  const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  return HEX_COLOR_PATTERN.test(withHash) ? withHash : null;
}

export function normalizeSosCustomPalette(palette: SosCustomPalette): SosCustomPalette | null {
  const fieldColor = normalizeHexColor(palette.fieldColor);
  const motifColor = normalizeHexColor(palette.motifColor);
  return fieldColor && motifColor ? { fieldColor, motifColor } : null;
}

export function sosCustomPaletteKey(palette: SosCustomPalette): string {
  const normalized = normalizeSosCustomPalette(palette);
  return normalized ? `${normalized.fieldColor}:${normalized.motifColor}` : "";
}

export function composeSosRefinePrompt({
  basePrompt,
  paletteId,
  customPalette,
  designChange
}: {
  basePrompt: string;
  paletteId: SosPaletteId;
  customPalette: SosCustomPalette;
  designChange: boolean;
}): string {
  const designInstruction = designChange
    ? `SOS DESIGN MODE — MINIMAL VARIATION ONLY:
Keep the rug immediately recognizable as the same design and preserve the exact outer silhouette, orientation, proportions, tassel placement, border system, dominant motif positions, major paths, symmetry or asymmetry, pattern scale, density, and design zones.

Only small localized adjustments are allowed: slightly alter secondary motif spacing, short line endpoints, minor turns, or small accent placement inside the same existing zones. Do not move dominant motifs to new regions. Do not add or remove a medallion, border, major branch, motif family, repeated structure, or large area of negative space. The result must remain much closer to the input than to a newly designed rug.`
    : `SOS DESIGN MODE — EXACT RECOLOR ONLY:
Treat the input rug as a fixed design template. Preserve the exact outer silhouette, orientation, proportions, tassel placement, border widths, every motif, line, path, turn, intersection, shape, position, scale, spacing, symmetry or asymmetry, color-region boundary, and area of negative space.

Do not add, remove, move, resize, mirror, simplify, regularize, clean up, reinterpret, or redesign any element. The output must be the same rug design with only its color assignment changed.`;

  const paletteInstruction = paletteInstructionFor(paletteId, customPalette);
  return `${basePrompt.trim()}\n\n${designInstruction}\n\n${paletteInstruction}\n\n${SOS_TASSEL_LOCK}`;
}

function paletteInstructionFor(paletteId: SosPaletteId, customPalette: SosCustomPalette): string {
  if (paletteId === "auto_flip") {
    return `SOS COLOR DIRECTION — FLIP ORIGINAL:
Use only the colors already visible in the input rug. Exchange the dominant field/background color with the primary motif or border color. Preserve the number of color roles and every existing color-region boundary. Do not invent a new hue, gradient, accent, or color block. Natural fiber highlights and shadows may vary only as required for realistic wool texture.`;
  }

  const colors =
    paletteId === "custom"
      ? normalizeSosCustomPalette(customPalette) ?? DEFAULT_SOS_CUSTOM_PALETTE
      : SOS_PRESET_BY_ID.get(paletteId);
  const fieldColor = colors?.fieldColor ?? DEFAULT_SOS_CUSTOM_PALETTE.fieldColor;
  const motifColor = colors?.motifColor ?? DEFAULT_SOS_CUSTOM_PALETTE.motifColor;

  return `SOS COLOR DIRECTION — SELECTED TWO-COLOR PALETTE:
Recolor the existing dominant field/background regions using ${fieldColor}. Recolor the existing primary motif, line, and border regions using ${motifColor}. Use these as the only two base hues. Preserve every original color-region boundary exactly. Do not create gradients, extra accent colors, new blocks, or new transitions. Allow only natural tonal variation within each base hue for realistic wool fibers, lighting, and texture.`;
}
