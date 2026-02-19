import { FormEvent, memo, useEffect, useMemo, useState } from "react";
import { Category } from "../types";
import { ModalBackdrop } from "./ModalBackdrop";

type EditNameModalProps = {
  isOpen: boolean;
  monsterName: string;
  selectedCategoryId: string | null;
  categories: Category[];
  onCancel: () => void;
  onSave: (name: string, categoryId: string | null) => void;
};

export const EditNameModal = memo(function EditNameModal({
  isOpen,
  monsterName,
  selectedCategoryId,
  categories,
  onCancel,
  onSave,
}: EditNameModalProps) {
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const selectedCategoryColor = useMemo(() => {
    if (!categoryId) {
      return undefined;
    }
    return categories.find((category) => category.id === categoryId)?.color;
  }, [categories, categoryId]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setName(monsterName);
    setCategoryId(selectedCategoryId ?? "");
  }, [isOpen, monsterName, selectedCategoryId]);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    onSave(trimmed, categoryId || null);
  }

  if (!isOpen) {
    return null;
  }

  return (
    <ModalBackdrop onClose={onCancel}>
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
          <label className="form-row" htmlFor="edit-category-input">
            <span>Category</span>
            <select
              id="edit-category-input"
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
              style={selectedCategoryColor ? { color: selectedCategoryColor } : undefined}
            >
              <option value="">None</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id} style={{ color: category.color }}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <div className="modal-actions">
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit">Save</button>
          </div>
        </form>
      </section>
    </ModalBackdrop>
  );
});
