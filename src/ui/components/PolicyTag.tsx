import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { FactName } from "../../app/statusboard";

/**
 * A policy of an object as a tag: its value alone, no icon. The policy is named in
 * the tooltip and for screen readers, "ha" or "nodes order" alone not saying what
 * they are about.
 */
export function PolicyTag({ name, value, children }: { name: FactName; value: string; children?: ReactNode }) {
  const { t } = useTranslation();
  const label = t(`ui.policies.${name}`);
  return (
    <span
      title={`${label}: ${value}`}
      data-policy={name}
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-line bg-surface px-2 text-data text-ink-muted"
    >
      <span className="sr-only">{label}: </span>
      {value}
      {children}
    </span>
  );
}
