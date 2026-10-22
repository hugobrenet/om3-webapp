import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { usePanelSide } from "../ui/components/panel-side";
import { useAnyPanelOpen } from "../ui/components/slide-over-open";
import { HistoryIcon } from "../ui/icons";
import { useShortcut } from "../ui/lib/shortcuts";
import { usePeek } from "./panel-search";
import { isPeekStep, stepLabel } from "./peek";
import { readLastRecord, useRecordHistory } from "./record-history";

/**
 * The right edge of the side menu, in pixels from the left of the window, followed
 * as the menu folds and unfolds; 0 without a menu.
 */
function useMenuEdge(active: boolean): number {
  const [edge, setEdge] = useState(0);
  useEffect(() => {
    const menu = document.getElementById("app-sidebar");
    if (!active || menu === null) return;
    const measure = () => {
      setEdge(Math.max(0, menu.getBoundingClientRect().right));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(menu);
    return () => {
      observer.disconnect();
    };
  }, [active]);
  return edge;
}

/**
 * Anchor on the edge of the window the panels open against while no side panel is
 * open, as in oc3: it brings back the record panel, on the record shown last, or on the first of the history when that one is no longer listed.
 * Nothing to reopen, no anchor. The "p" key does the same from the keyboard; with a
 * record panel open, it closes it (`SlideOver`). On the left, it stands against the
 * side menu, not over it. In a narrow window, where no gutter is spared for it, it is
 * a button of the header bar (`inBar`).
 */
export function PanelAnchor({ inBar = false }: { inBar?: boolean }) {
  const { t } = useTranslation();
  const { side } = usePanelSide();
  const anyOpen = useAnyPanelOpen();
  // On the left, the anchor stands against the side menu rather than over it.
  const menuEdge = useMenuEdge(!inBar && side === "left" && !anyOpen);
  const history = useRecordHistory();
  const peek = usePeek();
  const steps = history.entries.filter(isPeekStep);
  const last = readLastRecord();
  const target = steps.find((step) => step.kind === last?.kind && step.id === last.id) ?? steps[0];

  useShortcut("p", () => {
    if (anyOpen || target === undefined) return false;
    peek(target.kind, target.id);
    return true;
  });

  if (anyOpen || target === undefined) return null;
  const label = `${t("panelHistory.reopen", { name: stepLabel(target) })} (p)`;
  const content = (
    <>
      <HistoryIcon className="h-4 w-4" />
      <span className="sr-only">{label}</span>
    </>
  );

  if (inBar) {
    return (
      <button
        type="button"
        title={label}
        aria-keyshortcuts="p"
        onClick={() => {
          peek(target.kind, target.id);
        }}
        className="flex h-7 shrink-0 items-center gap-1 rounded-(--radius-control) border border-line px-1.5 text-ink-muted hover:bg-surface-sunken hover:text-ink"
      >
        {content}
      </button>
    );
  }

  return (
    <button
      type="button"
      title={label}
      aria-keyshortcuts="p"
      onClick={() => {
        peek(target.kind, target.id);
      }}
      // On the edge the panels open against.
      style={side === "left" ? { left: `${String(menuEdge)}px` } : undefined}
      className={`fixed top-14 z-10 flex items-center gap-1 border border-line bg-surface-raised py-1.5 text-ink-muted shadow-lg hover:text-ink ${
        side === "left"
          ? "rounded-r-(--radius-panel) border-l-0 pr-2 pl-1.5"
          : "right-0 rounded-l-(--radius-panel) border-r-0 pr-1.5 pl-2"
      }`}
    >
      {content}
    </button>
  );
}
