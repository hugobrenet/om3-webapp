import { useEffect, useRef, useSyncExternalStore } from "react";

/**
 * Keyboard shortcuts of the interface: single characters, which act only when no
 * field has the focus and no modal dialog is open, so that they never stand in
 * the way of typing. They leave the Ctrl, Alt and Meta combinations to the browser.
 */

/** Whether a key press happens while typing, where a character is not a shortcut. */
export function typing(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.matches("input, textarea, select"))
  );
}

/**
 * Runs `handler` when the character is typed outside a field. Nothing happens
 * while a modal dialog is open — the search palette, the list of shortcuts — nor
 * when another handler already took the key. Several components may listen for
 * the same key, each acting in its own state: a handler that had nothing to do
 * returns false, and leaves the key to the others.
 */
export function useShortcut(key: string, handler: () => boolean | undefined): void {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== key || event.defaultPrevented) return;
      if (event.ctrlKey || event.metaKey || event.altKey || typing(event.target)) return;
      if (document.querySelector('[aria-modal="true"]') !== null) return;
      if (latest.current() !== false) event.preventDefault();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [key]);
}

/** The shortcuts, as the help lists them. `keys` are alternatives. */
export const SHORTCUTS: readonly { keys: readonly string[]; labelKey: string }[] = [
  { keys: ["/", "Ctrl K"], labelKey: "shortcuts.search" },
  { keys: ["p"], labelKey: "shortcuts.panel" },
  { keys: ["n"], labelKey: "shortcuts.menu" },
  { keys: ["a"], labelKey: "shortcuts.assistant" },
  { keys: ["↑ ↓"], labelKey: "shortcuts.menuMove" },
  { keys: ["Esc"], labelKey: "shortcuts.escape" },
  { keys: ["?"], labelKey: "shortcuts.help" },
];

// Whether the list of shortcuts is on display: opened by "?" or from the account menu.
let helpOpen = false;
const listeners = new Set<() => void>();

export function setShortcutsHelp(open: boolean): void {
  if (helpOpen === open) return;
  helpOpen = open;
  for (const listener of listeners) listener();
}

export function useShortcutsHelp(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => helpOpen,
  );
}
