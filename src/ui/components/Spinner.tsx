import { useTranslation } from "react-i18next";
import { cn } from "../cn";

/**
 * Loading mark: an accent arc turning on a line ring, with a text for screen
 * readers. The rotation stops under prefers-reduced-motion (global rule).
 */
export function Spinner({ label, className }: { label?: string; className?: string }) {
  const { t } = useTranslation();
  const text = label ?? t("common.loading");
  return (
    <span role="status" aria-label={text} className={cn("inline-flex items-center gap-2 text-ink-muted", className)}>
      <span
        aria-hidden="true"
        className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-accent"
      />
      <span className="sr-only">{text}</span>
    </span>
  );
}
