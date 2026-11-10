/**
 * An on/off setting, drawn as the design system's switch (docs/DESIGN-SYSTEM.md,
 * Toggle). `word` is what the state is called on this row — 켜짐, 적용 중,
 * 물어봄 — printed beside the knob so the state never rests on colour alone.
 * The setting's own name is the switch's accessible name.
 */
export function Toggle({
  label,
  on,
  word,
  disabled,
  onClick,
}: {
  label: string;
  on: boolean;
  word: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button className="px-toggle" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={onClick}>
      <span className="px-toggle-track" aria-hidden="true" />
      {word}
    </button>
  );
}
