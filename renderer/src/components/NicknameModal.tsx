import { FormEvent, memo, useEffect, useMemo, useState } from "react";

type NicknameModalProps = {
  isOpen: boolean;
  email: string | null;
  isSaving: boolean;
  errorMessage: string | null;
  onSave: (nickname: string) => Promise<boolean>;
};

const MIN_NICKNAME_LENGTH = 2;
const MAX_NICKNAME_LENGTH = 20;

export const NicknameModal = memo(function NicknameModal({
  isOpen,
  email,
  isSaving,
  errorMessage,
  onSave,
}: NicknameModalProps) {
  const [nickname, setNickname] = useState("");
  const [showValidation, setShowValidation] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setNickname("");
    setShowValidation(false);
  }, [isOpen]);

  const trimmedNickname = useMemo(() => nickname.trim(), [nickname]);
  const isValid = useMemo(() => {
    return (
      trimmedNickname.length >= MIN_NICKNAME_LENGTH &&
      trimmedNickname.length <= MAX_NICKNAME_LENGTH
    );
  }, [trimmedNickname]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (isSaving) {
      return;
    }
    if (!isValid) {
      setShowValidation(true);
      return;
    }

    const saved = await onSave(trimmedNickname);
    if (!saved) {
      setShowValidation(true);
    }
  }

  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="modal compact-modal nickname-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="nickname-modal-title"
        aria-describedby="nickname-modal-description"
      >
        <h3 id="nickname-modal-title">Choose a Nickname</h3>
        <p id="nickname-modal-description">
          {email ? `Signed in as ${email}.` : "Signed in successfully."} Pick a nickname to continue.
        </p>
        <form className="modal-form" onSubmit={handleSubmit}>
          <label className="form-row" htmlFor="nickname-input">
            <span>Nickname</span>
            <input
              id="nickname-input"
              value={nickname}
              onChange={(event) => {
                setNickname(event.target.value);
                if (showValidation) {
                  setShowValidation(false);
                }
              }}
              minLength={MIN_NICKNAME_LENGTH}
              maxLength={MAX_NICKNAME_LENGTH}
              required
              autoFocus
              disabled={isSaving}
            />
          </label>
          {showValidation && !isValid ? (
            <p className="set-exact-validation" role="alert">
              Nickname must be between 2 and 20 characters.
            </p>
          ) : null}
          {errorMessage ? (
            <p className="set-exact-validation" role="alert">
              {errorMessage}
            </p>
          ) : null}
          <div className="modal-actions">
            <button type="submit" disabled={isSaving}>
              Save Nickname
            </button>
          </div>
        </form>
      </section>
    </div>
  );
});
