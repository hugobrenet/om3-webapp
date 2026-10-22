import { useTranslation } from "react-i18next";
import { cn } from "../cn";
import { StateGlyph } from "./StateGlyph";

/** `na` is n/a, a status that does not apply: an object with nothing to run, a cfg, a sec. */
export type ObjectState = "up" | "warn" | "down" | "na" | "unknown";

/** Catalog keys of the labels of the states, translated at render. */
export const STATE_LABEL_KEYS: Record<ObjectState, string> = {
  up: "ui.states.up",
  warn: "ui.states.warn",
  down: "ui.states.down",
  na: "ui.states.na",
  unknown: "ui.states.unknown",
};

const styles: Record<ObjectState, { ink: string }> = {
  up: { ink: "text-state-up" },
  warn: { ink: "text-state-warn" },
  down: { ink: "text-state-down" },
  na: { ink: "text-state-unknown" },
  unknown: { ink: "text-state-unknown" },
};

/**
 * State of an OpenSVC object: a shape, a tint and a label, without a coloured
 * background. The shape tells the states apart without colour, to stay readable for
 * colour blindness or greyscale printing.
 *
 * Fixed width, cut for the longest label ("stdby down"): in a column, the badges
 * line up as a regular block, glyphs included, whatever the state. `label` replaces
 * the label of the state when the agent's value is more precise, such as "stdby up"
 * shown with the shape of "up".
 */
export function StatusBadge({
  state,
  label,
  className,
}: {
  state: ObjectState;
  label?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const s = styles[state];
  return (
    <span
      data-state={state}
      className={cn(
        "inline-flex w-[6.5rem] items-center gap-1 text-data leading-5 font-medium whitespace-nowrap",
        s.ink,
        className,
      )}
    >
      <StateGlyph state={state} className="h-2 w-2" />
      {label ?? t(STATE_LABEL_KEYS[state])}
    </span>
  );
}
