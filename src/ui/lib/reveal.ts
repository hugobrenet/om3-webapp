import { useEffect, useRef, useState } from "react";
import i18n from "../../i18n";

/** How long a revealed secret stays on screen before it is masked again. */
export const SECRET_REVEAL_MS = 10_000;

/**
 * Masks a revealed secret again on its own: `delay` after `shown` turns true,
 * `hide` is called. Hiding it by hand, or leaving, cancels the timer; revealing
 * it again starts a new one.
 *
 * Returns the whole seconds left before the secret is masked, updated every
 * second while shown, or null while hidden.
 */
export function useAutoHide(shown: boolean, hide: () => void, delay: number = SECRET_REVEAL_MS): number | null {
  const latestHide = useRef(hide);
  latestHide.current = hide;
  const [remaining, setRemaining] = useState<number | null>(null);
  useEffect(() => {
    if (!shown) return;
    const deadline = Date.now() + delay;
    const timer = setTimeout(() => {
      latestHide.current();
    }, delay);
    const ticker = setInterval(() => {
      setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    }, 1000);
    return () => {
      clearTimeout(timer);
      clearInterval(ticker);
      setRemaining(null);
    };
  }, [shown, delay]);
  if (!shown) return null;
  return remaining ?? Math.ceil(delay / 1000);
}

/** "1 second", "7 seconds", in the current language. */
export function formatSeconds(seconds: number): string {
  return i18n.t("ui.seconds", { count: seconds });
}
