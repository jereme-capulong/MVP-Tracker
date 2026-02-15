import { memo } from "react";

type SoundToggleProps = {
  enabled: boolean;
  onToggle: () => void;
};

export const SoundToggle = memo(function SoundToggle({ enabled, onToggle }: SoundToggleProps) {
  return (
    <button type="button" onClick={onToggle}>
      {enabled ? "Disable Sound" : "Enable Sound"}
    </button>
  );
});
