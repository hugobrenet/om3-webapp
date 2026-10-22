import { useTranslation } from "react-i18next";
import { ClockIcon, ShapesIcon } from "../ui/icons";
import { ObjectIcon } from "../ui/components/ObjectIcon";
import type { HistoryGroup, HistoryGrouping } from "./panel-history";

/**
 * The switch between the two groupings of the records shown recently: by time, by
 * kind. Two pressed-or-not buttons, an icon each, named by their tooltip.
 */
export function GroupingSwitch({
  value,
  onChange,
}: {
  value: HistoryGrouping;
  onChange: (next: HistoryGrouping) => void;
}) {
  const { t } = useTranslation();
  const options: [HistoryGrouping, typeof ClockIcon][] = [
    ["time", ClockIcon],
    ["kind", ShapesIcon],
  ];
  return (
    <div
      role="group"
      aria-label={t("panelHistory.grouping.label")}
      className="flex shrink-0 rounded-(--radius-control) border border-line"
    >
      {options.map(([option, Icon]) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          title={t(`panelHistory.grouping.${option}`)}
          onClick={() => {
            onChange(option);
          }}
          className="flex h-6 w-6 items-center justify-center text-ink-muted first:rounded-l-(--radius-control) last:rounded-r-(--radius-control) hover:text-ink aria-pressed:bg-accent-soft aria-pressed:text-ink"
        >
          <Icon className="h-3.5 w-3.5" />
          <span className="sr-only">{t(`panelHistory.grouping.${option}`)}</span>
        </button>
      ))}
    </div>
  );
}

/** The heading of a group: its period, or its kind with its icon and count. */
export function GroupHeading({ group, id }: { group: HistoryGroup; id: string }) {
  const { t } = useTranslation();
  if (group.by === "time")
    return (
      <span id={id} className="font-medium tracking-wide uppercase">
        {t(`panelHistory.sections.${group.section}`)}
      </span>
    );
  return (
    <>
      <ObjectIcon kind={group.icon} className="h-3.5 w-3.5" />
      <span id={id} className="font-medium tracking-wide uppercase">
        {t(`panelHistory.types.${group.kind}`)}
      </span>
      <span className="tabular-nums">{group.entries.length}</span>
    </>
  );
}
