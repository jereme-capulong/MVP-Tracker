import { MouseEvent, ReactNode, memo, useCallback, useRef } from "react";

type ModalBackdropProps = {
  onClose: () => void;
  children: ReactNode;
};

export const ModalBackdrop = memo(function ModalBackdrop({ onClose, children }: ModalBackdropProps) {
  const didMouseDownOnBackdropRef = useRef(false);

  const handleMouseDown = useCallback((event: MouseEvent<HTMLDivElement>) => {
    didMouseDownOnBackdropRef.current = event.button === 0 && event.target === event.currentTarget;
  }, []);

  const handleMouseUp = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const shouldClose =
        didMouseDownOnBackdropRef.current && event.button === 0 && event.target === event.currentTarget;
      didMouseDownOnBackdropRef.current = false;
      if (shouldClose) {
        onClose();
      }
    },
    [onClose]
  );

  const handleMouseLeave = useCallback(() => {
    didMouseDownOnBackdropRef.current = false;
  }, []);

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
    >
      {children}
    </div>
  );
});
