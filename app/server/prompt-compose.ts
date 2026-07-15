import type {
  GenerationBackgroundSnapshot,
  GenerationConstructionSnapshot,
  GenerationLabelLogoSnapshot
} from "../shared/types";
import {
  FORBIDDEN_RUG_CHANGES,
  PROMPT_PRIORITY_NOTE,
  RUG_REFERENCE_LOCK,
  rugPileMaterialInstruction
} from "../shared/constants";

export const FINAL_VISUAL_LOCK_PRIORITY =
  "Final priority: the supplied rug reference image overrides all text for product identity. Room, camera, label, and pile instructions are secondary and must not change the rug's visual identity, proportions, edges, colors, or visible design.";

type JsonPrompt = Record<string, unknown>;

const DEFAULT_PILE_TYPE = "infer conservatively from Image 1";

const SECTION_MARKER_PATTERN = "[A-Z][A-Z _]+";

function sectionValue(prompt: string, section: string) {
  const escapedSection = section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = prompt.match(
    new RegExp(
      `(?:^|\\n)\\s*${escapedSection}:\\s*([\\s\\S]*?)(?=\\n\\s*${SECTION_MARKER_PATTERN}:\\s*|$)`,
      "i"
    )
  );
  return match?.[1]?.trim() || null;
}

function roomStyle(prompt: string) {
  const firstSectionIndex = prompt.search(new RegExp(`(?:^|\\n)\\s*${SECTION_MARKER_PATTERN}:\\s*`));
  const preamble = (firstSectionIndex >= 0 ? prompt.slice(0, firstSectionIndex) : "").trim();
  return preamble.split(/\r?\n/).find((line) => line.trim())?.trim() || null;
}

function resolveBackgroundPlaceholders(prompt: string) {
  return prompt
    .replace(/\b(?:a|an)\s+\[SHOT_TYPE\]/gi, "the requested interior product shot")
    .replace(/\[SHOT_TYPE\]/gi, "the requested interior product shot")
    .replace(/\[SHOT_ASPECT_RATIO\]/gi, "the configured output aspect ratio")
    .replace(/\[RUG_REFERENCE\]/gi, "Image 1")
    .replace(/\[RUG_SIZE\]/gi, "the scene-appropriate product scale")
    .replace(/\[RUG_COLOR_FAMILY\]/gi, "Image 1's visible colors")
    .replace(
      /at (?:the )?exact physical size the scene-appropriate product scale/gi,
      "at a scene-appropriate physical scale"
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function sanitizeBackgroundPrompt(prompt: string) {
  const normalized = prompt.replace(/\r\n?/g, "\n").trim();
  const reusableRoomPrompt = sectionValue(normalized, "FINAL REUSABLE ROOM PROMPT");

  if (reusableRoomPrompt) {
    const style = roomStyle(normalized);
    const negativeConstraints = sectionValue(normalized, "NEGATIVE CONSTRAINTS");
    const cameraSide = sectionValue(normalized, "CAMERA_SIDE");

    return resolveBackgroundPlaceholders(
      [
        style ? `ROOM STYLE: ${style}` : null,
        `REUSABLE ROOM SCENE: ${reusableRoomPrompt}`,
        negativeConstraints ? `ROOM NEGATIVE CONSTRAINTS: ${negativeConstraints}` : null,
        cameraSide ? `CAMERA SIDE: ${cameraSide}` : null
      ]
        .filter((section): section is string => Boolean(section))
        .join("\n\n")
    );
  }

  return resolveBackgroundPlaceholders(
    normalized.replace(
      /(?:^|\n)\s*(?:BEST RUG TYPES|LESS SUITABLE RUG TYPES):[\s\S]*?(?=\n\s*[A-Z][A-Z _]+:\s*|$)/gi,
      ""
    )
  );
}

function parseJsonPrompt(prompt: string): JsonPrompt | null {
  try {
    const parsed: unknown = JSON.parse(prompt);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as JsonPrompt) : null;
  } catch {
    return null;
  }
}

function stringField(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function optionalStringField(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function forbiddenChangesField(value: unknown) {
  if (!Array.isArray(value)) return [...FORBIDDEN_RUG_CHANGES];
  const items = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return items.length ? items : [...FORBIDDEN_RUG_CHANGES];
}

function pileInstruction(construction: GenerationConstructionSnapshot | null) {
  return construction?.prompt?.trim() || rugPileMaterialInstruction(DEFAULT_PILE_TYPE);
}

function normalizeJsonPrompt(prompt: string, construction: GenerationConstructionSnapshot | null): JsonPrompt {
  const parsed = parseJsonPrompt(prompt.trim());

  if (!parsed) {
    return {
      shot_id: "custom_prompt",
      prompt_priority_note: PROMPT_PRIORITY_NOTE,
      rug_reference_lock: RUG_REFERENCE_LOCK,
      allowed_rug_material_instruction: pileInstruction(construction),
      scene: prompt.trim(),
      rug_placement: "Use Image 1 as the exact rug product spec and place it according to the scene instruction.",
      camera: "Follow the scene instruction without changing the Image 1 rug.",
      lighting: "Use realistic lighting without changing the Image 1 rug.",
      styling: "Keep all styling secondary to the rug_reference_lock.",
      forbidden_changes: [...FORBIDDEN_RUG_CHANGES],
      quality: "Photorealistic product image with physically plausible placement, contact shadows, and material scale.",
      output_requirements: "The generated rug must remain visually identical to Image 1."
    };
  }

  return {
    shot_id: stringField(parsed.shot_id, "custom_prompt"),
    prompt_priority_note: PROMPT_PRIORITY_NOTE,
    rug_reference_lock: RUG_REFERENCE_LOCK,
    allowed_rug_material_instruction: pileInstruction(construction),
    ...(optionalStringField(parsed.crop_lock) ? { crop_lock: optionalStringField(parsed.crop_lock) } : {}),
    ...(optionalStringField(parsed.label_instruction) ? { label_instruction: optionalStringField(parsed.label_instruction) } : {}),
    ...(optionalStringField(parsed.front_face) ? { front_face: optionalStringField(parsed.front_face) } : {}),
    ...(optionalStringField(parsed.back_face) ? { back_face: optionalStringField(parsed.back_face) } : {}),
    ...(optionalStringField(parsed.fold_geometry) ? { fold_geometry: optionalStringField(parsed.fold_geometry) } : {}),
    ...(optionalStringField(parsed.fringe_tassel_lock) ? { fringe_tassel_lock: optionalStringField(parsed.fringe_tassel_lock) } : {}),
    ...(optionalStringField(parsed.edge_strip_lock) ? { edge_strip_lock: optionalStringField(parsed.edge_strip_lock) } : {}),
    ...(optionalStringField(parsed.label_placement) ? { label_placement: optionalStringField(parsed.label_placement) } : {}),
    ...(optionalStringField(parsed.label_geometry_lock) ? { label_geometry_lock: optionalStringField(parsed.label_geometry_lock) } : {}),
    scene: stringField(parsed.scene, ""),
    rug_placement: stringField(parsed.rug_placement, ""),
    camera: stringField(parsed.camera, ""),
    lighting: stringField(parsed.lighting, ""),
    styling: stringField(parsed.styling, ""),
    ...(parsed.background_context ? { background_context: parsed.background_context } : {}),
    forbidden_changes: forbiddenChangesField(parsed.forbidden_changes),
    ...(Array.isArray(parsed.forbidden_label_errors) ? { forbidden_label_errors: forbiddenChangesField(parsed.forbidden_label_errors) } : {}),
    quality: stringField(parsed.quality, ""),
    output_requirements: stringField(parsed.output_requirements, "")
  };
}

export function composeGenerationPrompt({
  prompt,
  background,
  labelLogo,
  construction
}: {
  prompt: string;
  background: GenerationBackgroundSnapshot | null;
  labelLogo: GenerationLabelLogoSnapshot | null;
  construction: GenerationConstructionSnapshot | null;
}) {
  const composed = normalizeJsonPrompt(prompt, construction);

  if (background) {
    const sanitizedBackground = sanitizeBackgroundPrompt(background.prompt);
    composed.background_context = {
      id: background.id,
      title: background.title,
      instruction:
        "Secondary room context only. Use this background for architecture, furniture, room materials, lighting, and camera context. Ignore room-context wording that suggests rug type, rug style, textile construction, product design, product colors, or product suitability.",
      prompt: sanitizedBackground
    };
  }

  if (labelLogo) {
    const existingLabelInstruction = optionalStringField(composed.label_instruction);
    const runtimeLabelInstruction =
      "Runtime label reference check: Image 2 is attached in this request and is the exact label-logo artwork. Use Image 2 exactly on the sewn cloth label on the rug back side only. Do not omit it, leave the label blank, invent alternate text, redraw the logo, alter it, translate it, crop it, distort it, or add readable label text.";
    composed.label_instruction = existingLabelInstruction
      ? `${existingLabelInstruction} ${runtimeLabelInstruction}`
      : runtimeLabelInstruction;
  }

  return JSON.stringify(composed, null, 2);
}
