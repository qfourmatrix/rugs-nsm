import { CheckCircle2, Image as ImageIcon, Layers2, Pencil, Ratio, Save } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { AspectRatio, ImageSize, ProductState } from "../../shared/types";

const aspectRatios: AspectRatio[] = ["1:1", "16:9", "9:16", "4:3", "3:4"];
const imageSizes: ImageSize[] = ["1K", "2K", "4K"];
const batchSizes = [1, 2, 3, 4];

interface PromptSettingsProps {
  state: ProductState | null;
  selectedShotName: string | null;
  saving: boolean;
  title?: string;
  emptyLabel?: string;
  actions?: ReactNode;
  settingsExtra?: ReactNode;
  onPromptChange: (value: string) => void;
  onSettingsChange: (settings: Partial<ProductState["settings"]>) => void;
}

export function PromptSettings({
  state,
  selectedShotName,
  saving,
  title = "Prompt",
  emptyLabel = "Pick a shot to load its prompt",
  actions,
  settingsExtra,
  onPromptChange,
  onSettingsChange
}: PromptSettingsProps) {
  const [promptExpanded, setPromptExpanded] = useState(false);
  const promptValue = state?.promptBox.value ?? "";
  const promptPreview = promptValue.trim() || "Load a shot prompt, then edit it for this product.";

  return (
    <section className="promptPanel" aria-label="Prompt box">
      <div className="panelHeader compactHeader">
        <div>
          <h2>{title}</h2>
          <p>{selectedShotName ? `Selected shot: ${selectedShotName}` : emptyLabel}</p>
        </div>
        <span className="saveState">
          {saving ? <Save size={14} /> : <CheckCircle2 size={14} />}
          {saving ? "Saving" : state?.promptBox.dirty ? "Draft saved" : "Saved"}
        </span>
      </div>

      <div className="settingsGrid compactSettingsGrid">
        <fieldset className="segmentedField">
          <legend>
            <Ratio size={14} />
            Aspect
          </legend>
          <div className="segmentedOptions">
            {aspectRatios.map((ratio) => (
              <button
                key={ratio}
                type="button"
                className={state?.settings.aspectRatio === ratio ? "isActive" : ""}
                aria-pressed={state?.settings.aspectRatio === ratio}
                disabled={!state}
                onClick={() => onSettingsChange({ aspectRatio: ratio })}
              >
                {ratio}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="segmentedField">
          <legend>
            <ImageIcon size={14} />
            Size
          </legend>
          <div className="segmentedOptions">
            {imageSizes.map((size) => (
              <button
                key={size}
                type="button"
                className={state?.settings.imageSize === size ? "isActive" : ""}
                aria-pressed={state?.settings.imageSize === size}
                disabled={!state}
                onClick={() => onSettingsChange({ imageSize: size })}
              >
                {size}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="segmentedField">
          <legend>
            <Layers2 size={14} />
            Batch
          </legend>
          <div className="segmentedOptions">
            {batchSizes.map((size) => (
              <button
                key={size}
                type="button"
                className={(state?.settings.batchSize ?? 1) === size ? "isActive" : ""}
                aria-pressed={(state?.settings.batchSize ?? 1) === size}
                disabled={!state}
                onClick={() => onSettingsChange({ batchSize: size })}
              >
                x{size}
              </button>
            ))}
          </div>
        </fieldset>

        {settingsExtra}
      </div>

      <div className={`promptEditorBlock ${promptExpanded ? "isExpanded" : ""}`}>
        <div className="promptPreviewHeader">
          <div>
            <span className="eyebrow">Prompt</span>
            <p className="promptPreviewText">{promptPreview}</p>
          </div>
          <button
            className="miniButton"
            type="button"
            disabled={!state}
            aria-expanded={promptExpanded}
            onClick={() => setPromptExpanded((value) => !value)}
          >
            <Pencil size={14} />
            <span>{promptExpanded ? "Done" : "Edit Prompt"}</span>
          </button>
        </div>

        {promptExpanded ? (
          <textarea
            className="promptTextarea"
            aria-label="Prompt text"
            value={promptValue}
            disabled={!state}
            placeholder="Load a shot prompt, then edit it for this product."
            onChange={(event) => onPromptChange(event.target.value)}
          />
        ) : null}
      </div>

      {actions ? <div className="promptActionsSlot">{actions}</div> : null}
    </section>
  );
}
