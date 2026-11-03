import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { CloseIcon } from "../icons";
import { cn } from "../cn";
import { useVisualViewport } from "../lib/media";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** `xl` for a wide content, such as a console terminal. */
const WIDTHS = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl", xl: "max-w-6xl" } as const;

/**
 * Modal dialog, after the oc3 impersonation dialog: a raised panel over a light
 * veil, its title and a close cross in a header strip. Escape, the cross or a
 * click on the veil close it; `dirty`, holding what the user typed, the cross or
 * its Cancel alone, never a stray Escape or click beside it; the focus goes to the first control (or to
 * `initialFocus`), stays inside while it is open, and goes back where it was.
 *
 * Rendered in `document.body`: an ancestor that clips or scrolls cannot cut it.
 */
export function Dialog({
  open,
  title,
  onClose,
  closeLabel,
  size = "sm",
  initialFocus,
  footer,
  children,
  dirty = false,
}: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  closeLabel?: string;
  size?: keyof typeof WIDTHS;
  /** Element to focus when the dialog opens, instead of its first control. */
  initialFocus?: RefObject<HTMLElement | null>;
  /** Actions at the foot of the dialog, right aligned. */
  footer?: ReactNode;
  /** Holding changes not saved: closed by its cross or its buttons only. */
  dirty?: boolean;
  children?: ReactNode;
}) {
  const id = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();
  const close = closeLabel ?? t("common.close");
  // Held in the part of the page in sight: on a phone, the keyboard open does not
  // hide its foot, nor the field typed in.
  const viewport = useVisualViewport();
  // The dialog shortened by the keyboard rising: the field typed in brought back in
  // sight, or it falls under the foot and the phone pans the page to find it.
  const viewportHeight = viewport?.height;
  useEffect(() => {
    const field = document.activeElement;
    if (!(field instanceof HTMLElement) || !dialog.current?.contains(field)) return;
    if (!field.matches("input, textarea, select, [contenteditable]")) return;
    field.scrollIntoView?.({ block: "nearest" });
  }, [viewportHeight]);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement;
    const target =
      initialFocus?.current ??
      dialog.current?.querySelector("[data-dialog-body]")?.querySelector<HTMLElement>(FOCUSABLE) ??
      dialog.current;
    target?.focus();
    return () => {
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus();
    };
  }, [open, initialFocus]);

  if (!open) return null;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      // A side panel listens for Escape too: it stays open under the dialog.
      event.stopPropagation();
      event.preventDefault();
      if (!dirty) onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = [...(dialog.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (first === undefined || last === undefined) {
      event.preventDefault();
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return createPortal(
    <div
      data-testid="dialog-backdrop"
      className="fixed inset-0 z-[1300] flex items-start justify-center bg-ink/20 px-4 pt-[15vh] max-md:p-2"
      style={viewport ? { top: viewport.top, bottom: "auto", height: viewport.height } : undefined}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !dirty) onClose();
      }}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={cn(
          "flex max-h-[75vh] w-full flex-col max-md:max-h-full rounded-(--radius-panel) border border-line bg-surface-raised text-ink shadow-xl",
          WIDTHS[size],
        )}
      >
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <h2 id={`${id}-title`} className="text-title font-semibold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto flex h-7 w-7 items-center justify-center rounded-(--radius-control) border border-line text-ink-muted hover:text-ink"
          >
            <CloseIcon />
            <span className="sr-only">{close}</span>
          </button>
        </div>
        <div data-dialog-body className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
          {children}
        </div>
        {footer !== undefined && (
          <div className="flex justify-end gap-2 border-t border-line px-3 py-2">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}
