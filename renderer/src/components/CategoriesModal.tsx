import { CSSProperties, FormEvent, memo, useMemo, useState } from "react";
import { ConfirmModal } from "./ConfirmModal";
import { Category } from "../types";
import { ModalBackdrop } from "./ModalBackdrop";

type CategoriesModalProps = {
  isOpen: boolean;
  categories: Category[];
  onCancel: () => void;
  onCreateCategory: (name: string, color: string) => Promise<boolean>;
  onUpdateCategory: (id: string, name: string, color: string) => Promise<boolean>;
  onDeleteCategory: (id: string) => Promise<boolean>;
};

function normalizeHexColor(color: string): string | null {
  const trimmed = color.trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return null;
  }
  return trimmed.toLowerCase();
}

function getReadableTextColor(hexColor: string): "#0f131a" | "#f6fbff" {
  const color = normalizeHexColor(hexColor);
  if (!color) {
    return "#f6fbff";
  }

  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);
  const brightness = (red * 299 + green * 587 + blue * 114) / 1000;

  return brightness > 148 ? "#0f131a" : "#f6fbff";
}

function getColorButtonStyle(color: string): CSSProperties {
  return {
    "--picker-color": color,
    "--picker-text-color": getReadableTextColor(color),
  } as CSSProperties;
}

function getCategoryNameStyle(color: string): CSSProperties {
  return { color };
}

export const CategoriesModal = memo(function CategoriesModal({
  isOpen,
  categories,
  onCancel,
  onCreateCategory,
  onUpdateCategory,
  onDeleteCategory,
}: CategoriesModalProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [createName, setCreateName] = useState("");
  const [createColor, setCreateColor] = useState("#5dd4a1");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("#5dd4a1");
  const [pendingDeleteCategory, setPendingDeleteCategory] = useState<Category | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const filteredCategories = useMemo(() => {
    const normalizedTerm = searchTerm.trim().toLowerCase();
    if (!normalizedTerm) {
      return categories;
    }
    return categories.filter((category) => category.name.toLowerCase().includes(normalizedTerm));
  }, [categories, searchTerm]);

  async function handleCreateCategory(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const name = createName.trim();
    const color = normalizeHexColor(createColor);
    if (!name || !color || isSaving) {
      setErrorMessage("Name and a valid color are required.");
      return;
    }

    setIsSaving(true);
    const created = await onCreateCategory(name, color);
    setIsSaving(false);
    if (!created) {
      return;
    }

    setCreateName("");
    setCreateColor("#5dd4a1");
    setErrorMessage(null);
  }

  function startEdit(category: Category): void {
    setEditingId(category.id);
    setEditName(category.name);
    setEditColor(category.color);
    setErrorMessage(null);
  }

  function cancelEdit(): void {
    setEditingId(null);
    setEditName("");
    setEditColor("#5dd4a1");
    setErrorMessage(null);
  }

  function openDeleteConfirm(category: Category): void {
    if (isSaving) {
      return;
    }
    setPendingDeleteCategory(category);
  }

  function closeDeleteConfirm(): void {
    setPendingDeleteCategory(null);
  }

  async function saveEdit(categoryId: string): Promise<void> {
    const name = editName.trim();
    const color = normalizeHexColor(editColor);
    if (!name || !color || isSaving) {
      setErrorMessage("Name and a valid color are required.");
      return;
    }

    setIsSaving(true);
    const updated = await onUpdateCategory(categoryId, name, color);
    setIsSaving(false);
    if (updated) {
      cancelEdit();
    }
  }

  async function confirmDeleteCategory(): Promise<void> {
    if (isSaving || !pendingDeleteCategory) {
      return;
    }

    setIsSaving(true);
    const deleted = await onDeleteCategory(pendingDeleteCategory.id);
    setIsSaving(false);
    if (!deleted) {
      return;
    }

    if (editingId === pendingDeleteCategory.id) {
      setEditingId(null);
      setEditName("");
      setEditColor("#5dd4a1");
    }
    setErrorMessage(null);
    closeDeleteConfirm();
  }

  if (!isOpen) {
    return null;
  }

  return (
    <>
      <ModalBackdrop onClose={onCancel}>
        <section
          className="modal categories-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="categories-modal-title"
          onClick={(event) => event.stopPropagation()}
        >
        <h3 id="categories-modal-title">Categories</h3>
        <form className="categories-create-form" onSubmit={handleCreateCategory}>
          <label className="form-row" htmlFor="category-search-input">
            <span>Search</span>
            <input
              id="category-search-input"
              type="text"
              placeholder="Filter by name..."
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
          </label>
          <label className="form-row" htmlFor="category-create-name">
            <span>New Category Name</span>
            <input
              id="category-create-name"
              type="text"
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
              maxLength={60}
            />
          </label>
          <label className="form-row" htmlFor="category-create-color">
            <span>Color</span>
            <span className="category-color-picker" style={getColorButtonStyle(createColor)}>
              <span className="category-color-picker-trigger" aria-hidden="true">
                {createColor}
              </span>
              <input
                id="category-create-color"
                type="color"
                value={createColor}
                onChange={(event) => setCreateColor(event.target.value)}
                aria-label="Choose category color"
              />
            </span>
          </label>
          <button type="submit" disabled={isSaving}>
            Create Category
          </button>
        </form>

        {errorMessage ? (
          <p className="set-exact-validation" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <div className="table-wrap categories-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Color</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredCategories.map((category) => {
                const isEditing = editingId === category.id;
                return (
                  <tr key={category.id}>
                    <td>
                      {isEditing ? (
                        <input
                          className="table-input"
                          type="text"
                          value={editName}
                          onChange={(event) => setEditName(event.target.value)}
                          maxLength={60}
                        />
                      ) : (
                        <span className="category-name-label" style={getCategoryNameStyle(category.color)}>
                          {category.name}
                        </span>
                      )}
                    </td>
                    <td>
                      <div className="category-color-cell">
                        <span
                          className="category-color-swatch"
                          style={{ backgroundColor: category.color }}
                          aria-hidden="true"
                        />
                        {isEditing ? (
                          <span className="category-color-picker" style={getColorButtonStyle(editColor)}>
                            <span className="category-color-picker-trigger" aria-hidden="true">
                              {editColor}
                            </span>
                            <input
                              type="color"
                              value={editColor}
                              onChange={(event) => setEditColor(event.target.value)}
                              aria-label={`Choose color for ${category.name}`}
                            />
                          </span>
                        ) : (
                          <code>{category.color}</code>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className="row-actions">
                        {isEditing ? (
                          <>
                            <button type="button" onClick={() => saveEdit(category.id)} disabled={isSaving}>
                              Save
                            </button>
                            <button type="button" onClick={cancelEdit} disabled={isSaving}>
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button type="button" onClick={() => startEdit(category)} disabled={isSaving}>
                            Edit
                          </button>
                        )}
                        <button
                          type="button"
                          className="danger-btn"
                          onClick={() => openDeleteConfirm(category)}
                          disabled={isSaving}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredCategories.length === 0 ? (
                <tr>
                  <td colSpan={3}>No categories found.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            Close
          </button>
        </div>
        </section>
      </ModalBackdrop>
      <ConfirmModal
        isOpen={pendingDeleteCategory !== null}
        title="Delete Category?"
        message="This will remove the category from all monsters."
        confirmLabel="Delete"
        confirmButtonClassName="danger-btn"
        onCancel={closeDeleteConfirm}
        onConfirm={confirmDeleteCategory}
      />
    </>
  );
});
