import { Download, PenLine, Save, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { SUPPORTED_ASPECT_RATIOS, SUPPORTED_IMAGE_SIZES } from "../../shared/constants";
import type { MasterShots } from "../../shared/types";

interface MasterShotEditorProps {
  masterShots: MasterShots;
  disabled: boolean;
  onSave: (masterShots: MasterShots) => void;
}

export function MasterShotEditor({ masterShots, disabled, onSave }: MasterShotEditorProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<MasterShots>(masterShots);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) {
      setDraft(masterShots);
      setImportError(null);
    }
  }, [masterShots, open]);

  const updateShot = (index: number, patch: Partial<MasterShots["shots"][number]>) => {
    setDraft((current) => ({
      ...current,
      shots: current.shots.map((shot, shotIndex) =>
        shotIndex === index ? { ...shot, ...patch } : shot
      )
    }));
  };

  const exportJson = () => {
    const blob = new Blob([`${JSON.stringify(draft, null, 2)}\n`], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "master-shots.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importJson = async (file: File | undefined) => {
    if (!file) return;
    setImportError(null);
    try {
      const parsed = JSON.parse(await file.text()) as MasterShots;
      setDraft(parsed);
    } catch {
      setImportError("Import file is not valid JSON.");
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const saveDraft = () => {
    onSave({
      ...draft,
      updatedAt: new Date().toISOString()
    });
    setOpen(false);
  };

  return (
    <>
      <button
        className="miniButton"
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <PenLine size={14} />
        <span>Edit Shots</span>
      </button>

      {open ? (
        <div className="modalOverlay" role="presentation">
          <section className="masterShotModal" role="dialog" aria-modal="true" aria-label="Edit master shots">
            <div className="modalHeader">
              <div>
                <h2>Master Shots</h2>
                <p>{draft.shots.length} global templates</p>
              </div>
              <div className="modalActions">
                <button className="miniButton" type="button" onClick={exportJson}>
                  <Download size={14} />
                  <span>Export</span>
                </button>
                <button
                  className="miniButton"
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload size={14} />
                  <span>Import</span>
                </button>
                <button className="miniButton primary" type="button" onClick={saveDraft}>
                  <Save size={14} />
                  <span>Save</span>
                </button>
                <button className="iconButton" type="button" aria-label="Close editor" onClick={() => setOpen(false)}>
                  <X size={15} />
                </button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(event) => void importJson(event.currentTarget.files?.[0])}
              />
            </div>

            {importError ? <div className="inlineAlert">{importError}</div> : null}

            <div className="masterShotEditorGrid">
              {draft.shots.map((shot, index) => (
                <article className="masterShotEditCard" key={`${shot.id}:${index}`}>
                  <div className="masterShotEditHeader">
                    <span className="shotIndex">{String(index + 1).padStart(2, "0")}</span>
                    <label>
                      <span>Name</span>
                      <input
                        value={shot.name}
                        onChange={(event) => updateShot(index, { name: event.target.value })}
                      />
                    </label>
                    <label>
                      <span>ID</span>
                      <input
                        value={shot.id}
                        onChange={(event) => updateShot(index, { id: event.target.value })}
                      />
                    </label>
                  </div>
                  <textarea
                    aria-label={`${shot.name} prompt`}
                    value={shot.prompt}
                    onChange={(event) => updateShot(index, { prompt: event.target.value })}
                  />
                  <div className="masterShotDefaults">
                    <label>
                      <span>Aspect</span>
                      <select
                        value={shot.defaultAspectRatio}
                        onChange={(event) =>
                          updateShot(index, { defaultAspectRatio: event.target.value as typeof shot.defaultAspectRatio })
                        }
                      >
                        {SUPPORTED_ASPECT_RATIOS.map((ratio) => (
                          <option key={ratio} value={ratio}>
                            {ratio}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Size</span>
                      <select
                        value={shot.defaultImageSize}
                        onChange={(event) =>
                          updateShot(index, { defaultImageSize: event.target.value as typeof shot.defaultImageSize })
                        }
                      >
                        {SUPPORTED_IMAGE_SIZES.map((size) => (
                          <option key={size} value={size}>
                            {size}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
