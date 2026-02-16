import { memo } from "react";

type ConfirmModalProps = {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  confirmButtonClassName?: string;
  onCancel: () => void;
  onConfirm: () => void;
};

export const ConfirmModal = memo(function ConfirmModal({
  isOpen,
  title,
  message,
  confirmLabel,
  confirmButtonClassName,
  onCancel,
  onConfirm,
}: ConfirmModalProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="confirm-modal-title">{title}</h3>
        <p>{message}</p>
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={confirmButtonClassName} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
});
