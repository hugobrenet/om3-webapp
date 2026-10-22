import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Button for an irreversible action: the first click arms it, the second confirms.
 * Two steps rather than a modal window, to stay on the keyboard and without a focus
 * trap. The confirm button takes the focus as soon as it is armed, which reads the
 * question out to screen readers.
 */
export function ConfirmButton({
  label,
  question,
  confirmLabel,
  cancelLabel,
  pendingLabel,
  pending = false,
  icon,
  inline = false,
  onConfirm,
}: {
  label: string;
  question: string;
  confirmLabel: string;
  cancelLabel: string;
  pendingLabel: string;
  pending?: boolean;
  /** Visual placed before the label of the arming button. */
  icon?: ReactNode;
  /**
   * The question and its buttons take the place of the arming button on the same
   * line and at the same height, instead of a question above the buttons: for a
   * strip, a bar at the foot of the page say, which must not grow while it asks.
   */
  inline?: boolean;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);
  const confirm = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (armed) confirm.current?.focus();
  }, [armed]);

  if (!armed) {
    return (
      <button
        type="button"
        onClick={() => {
          setArmed(true);
        }}
        className="flex h-8 items-center gap-2 rounded-(--radius-control) bg-state-down px-3 font-medium text-surface-raised hover:brightness-110"
      >
        {icon}
        {label}
      </button>
    );
  }

  return (
    <div
      role="group"
      aria-label={question}
      className={inline ? "flex items-center gap-2 whitespace-nowrap" : undefined}
    >
      {inline ? <span>{question}</span> : <p className="mb-2">{question}</p>}
      <div className="flex gap-2">
        <button
          ref={confirm}
          type="button"
          disabled={pending}
          onClick={onConfirm}
          className="h-8 rounded-(--radius-control) bg-state-down px-3 font-medium text-surface-raised disabled:opacity-60"
        >
          {pending ? pendingLabel : confirmLabel}
        </button>
        <button
          type="button"
          onClick={() => {
            setArmed(false);
          }}
          className="h-8 rounded-(--radius-control) border border-line px-3"
        >
          {cancelLabel}
        </button>
      </div>
    </div>
  );
}
