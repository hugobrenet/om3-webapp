import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { CloseIcon } from "../ui/icons";
import { SHORTCUTS, setShortcutsHelp, useShortcut, useShortcutsHelp } from "../ui/lib/shortcuts";

/**
 * The list of keyboard shortcuts, over the current view, as oc3 has it: "?" opens
 * it from anywhere outside a field, and the button of the top bar for whoever does
 * not know the key yet. Modal: Escape, "?" again, its cross or a click beside it
 * close it, and the focus goes back where it was.
 */
export function ShortcutsHelp() {
  const { t } = useTranslation();
  const open = useShortcutsHelp();
  const closeButton = useRef<HTMLButtonElement>(null);
  const opener = useRef<Element | null>(null);

  useShortcut("?", () => {
    setShortcutsHelp(true);
    return true;
  });

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    closeButton.current?.focus();
    return () => {
      if (opener.current instanceof HTMLElement && document.contains(opener.current)) opener.current.focus();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[1300] flex items-start justify-center bg-ink/20 px-4 pt-[15vh]"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) setShortcutsHelp(false);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("shortcuts.title")}
        onKeyDown={(event) => {
          if (event.key === "Escape" || event.key === "?") {
            // The side panel listens for Escape too: it stays open under the help.
            event.stopPropagation();
            event.preventDefault();
            setShortcutsHelp(false);
          }
          // One control only: the focus stays on it.
          if (event.key === "Tab") event.preventDefault();
        }}
        className="w-full max-w-md rounded-(--radius-panel) border border-line bg-surface-raised text-ink shadow-xl"
      >
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <h2 className="text-title font-semibold">{t("shortcuts.title")}</h2>
          <button
            ref={closeButton}
            type="button"
            onClick={() => {
              setShortcutsHelp(false);
            }}
            title={t("common.close")}
            className="ml-auto flex h-7 w-7 items-center justify-center rounded-(--radius-control) border border-line text-ink-muted hover:text-ink"
          >
            <CloseIcon />
            <span className="sr-only">{t("common.close")}</span>
          </button>
        </div>
        <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-2 p-3">
          {SHORTCUTS.map((shortcut) => (
            <div key={shortcut.labelKey} className="contents">
              <dt className="flex items-center gap-1 whitespace-nowrap">
                {shortcut.keys.map((key, index) => (
                  <span key={key} className="flex items-center gap-1">
                    {index > 0 && <span className="text-ink-muted">{t("shortcuts.or")}</span>}
                    <kbd className="rounded-sm border border-line bg-surface px-1.5 font-mono text-data">{key}</kbd>
                  </span>
                ))}
              </dt>
              <dd>{t(shortcut.labelKey)}</dd>
            </div>
          ))}
        </dl>
        <p className="border-t border-line px-3 py-2 text-data text-ink-muted">{t("shortcuts.hint")}</p>
      </div>
    </div>,
    document.body,
  );
}
