import { FormEvent, memo, useEffect, useState } from "react";

type EditNameModalProps = {
  isOpen: boolean;
  monsterName: string;
  onCancel: () => void;
  onSave: (name: string) => void;
};

export const EditNameModal = memo(function EditNameModal({
  isOpen,
  monsterName,
  onCancel,
  onSave,
}: EditNameModalProps) {
  const [name, setName] = useState("");

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setName(monsterName);
  }, [isOpen, monsterName]);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    onSave(trimmed);
  }

  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-name-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="edit-name-modal-title">Edit Name</h3>
        <form className="modal-form" onSubmit={handleSubmit}>
          <label className="form-row" htmlFor="edit-name-input">
            <span>Name</span>
            <input
              id="edit-name-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              required
              autoFocus
            />
          </label>
          <div className="modal-actions">
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit">Save</button>
          </div>
        </form>
      </section>
    </div>
  );
});
