import { FormEvent, memo, useEffect, useState } from "react";

type ClipboardImportResult = {
  importedCount: number;
  skippedCount: number;
};

type ClipboardImportModalProps = {
  isOpen: boolean;
  onCancel: () => void;
  onImport: (clipboardText: string) => Promise<ClipboardImportResult>;
};

function formatImportSummary(importedCount: number, skippedCount: number): string {
  const importedLabel = importedCount === 1 ? "monster" : "monsters";
  const skippedLabel = skippedCount === 1 ? "line" : "lines";
  return `Imported ${importedCount} ${importedLabel}. Skipped ${skippedCount} invalid ${skippedLabel}.`;
}

export const ClipboardImportModal = memo(function ClipboardImportModal({
  isOpen,
  onCancel,
  onImport,
}: ClipboardImportModalProps) {
  const [clipboardText, setClipboardText] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [importSummary, setImportSummary] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setImportSummary(null);
  }, [isOpen]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (isImporting) {
      return;
    }

    setIsImporting(true);
    try {
      const result = await onImport(clipboardText);
      setImportSummary(formatImportSummary(result.importedCount, result.skippedCount));
    } finally {
      setIsImporting(false);
    }
  }

  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      <section
        className="modal clipboard-import-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="clipboard-import-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="clipboard-import-modal-title">Import from Clipboard</h3>
        <p className="clipboard-import-note">
          Format: <code>{"{Monster Name}\t@{time}"}</code>
          <br />
          Example:
          <br />
          <code>{"Test Monster\t@3hr"}</code>
        </p>
        <form className="modal-form" onSubmit={handleSubmit}>
          <label className="form-row" htmlFor="clipboard-import-textarea">
            <span>Paste tab-delimited lines</span>
            <textarea
              id="clipboard-import-textarea"
              className="clipboard-import-textarea"
              value={clipboardText}
              onChange={(event) => setClipboardText(event.target.value)}
              spellCheck={false}
              autoFocus
            />
          </label>
          {importSummary ? (
            <p className="clipboard-import-summary" role="status">
              {importSummary}
            </p>
          ) : null}
          <div className="modal-actions">
            <button type="button" onClick={onCancel} disabled={isImporting}>
              Close
            </button>
            <button type="submit" disabled={isImporting}>
              {isImporting ? "Importing..." : "Import"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
});
