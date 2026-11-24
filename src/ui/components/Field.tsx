import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { AlertTriangleIcon } from "../icons";
import { cn } from "../cn";

/** The oc3 form controls: a line border on the page surface, 3px corners. */
const CONTROL =
  "rounded-(--radius-control) border border-line bg-surface px-2 text-ink placeholder:text-ink-muted aria-invalid:border-state-down disabled:opacity-60";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(CONTROL, "h-8 w-full", className)} {...props} />;
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cn(CONTROL, "w-full py-1", className)} {...props} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, ...props }, ref) {
    return <select ref={ref} className={cn(CONTROL, "h-8 px-1", className)} {...props} />;
  },
);

/** Native checkbox in the accent colour, its label beside it. */
export const Checkbox = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label?: ReactNode }
>(function Checkbox({ label, className, ...props }, ref) {
  const box = (
    // Disabled, dimmed: the native box barely changes in dark mode, a disabled one looking enabled.
    <input
      ref={ref}
      type="checkbox"
      className={cn("h-4 w-4 accent-(--accent) disabled:cursor-not-allowed disabled:opacity-40", className)}
      {...props}
    />
  );
  if (label === undefined) return box;
  return (
    <label className="inline-flex items-center gap-2">
      {box}
      {label}
    </label>
  );
});

/**
 * Labelled field: the label above the control, a hint and an error under it, tied
 * to the control for screen readers. `children` receives the ids to put on it.
 */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: (control: {
    id: string;
    "aria-describedby"?: string;
    "aria-invalid"?: boolean;
  }) => ReactNode;
}) {
  const id = useId();
  const described = [hint !== undefined ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(" ");
  return (
    <div>
      <label htmlFor={id} className="mb-1 block font-medium">
        {label}
      </label>
      {children({
        id,
        "aria-describedby": described === "" ? undefined : described,
        "aria-invalid": error ? true : undefined,
      })}
      {hint !== undefined && (
        <p id={`${id}-hint`} className="mt-1 text-data text-ink-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1 flex items-center gap-1 text-data text-state-down">
          <AlertTriangleIcon className="shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}
