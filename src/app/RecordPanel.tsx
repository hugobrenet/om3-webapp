import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { SlideOver } from "../ui/components/SlideOver";
import { TabList, type TabItem } from "../ui/components/Tabs";
import { tabPanelProps, useTabsId } from "../ui/components/tabs-ids";
import { type SlideOverSize } from "../ui/components/slide-over-layout";
import { ObjectIcon } from "../ui/components/ObjectIcon";
import { recordKey } from "./panel-history";
import { isPeekStep, stepIcon, type PeekKind } from "./peek";
import { rememberLastRecord, useRecordHistory } from "./record-history";
import { PanelHeaderContext } from "./panel-header";
import { TableCardsContext } from "../ui/components/table-cards";

/**
 * Title of a record panel: the icon of its kind and its name.
 *
 * The title also records the record it shows in the history, whatever opened it —
 * a list row, a badge, the search palette: it enters, or comes back, in front.
 */
export function PanelTitle({
  kind,
  title,
  recordId,
  open,
  slotRef,
}: {
  kind: PeekKind;
  title: string;
  recordId: string | undefined;
  open: boolean;
  /** The place by the name where the content of the panel qualifies the record. */
  slotRef?: (element: HTMLElement | null) => void;
}) {
  const history = useRecordHistory();
  const currentKey = recordKey(kind, recordId);
  const record = useRef(history.record);
  record.current = history.record;

  useEffect(() => {
    if (!open || recordId === undefined) return;
    const step = { kind, id: recordId };
    if (!isPeekStep(step)) return;
    record.current(step.kind, step.id);
    rememberLastRecord(step);
    // The step is derived from currentKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentKey]);

  const icon = recordId === undefined ? "service" : stepIcon({ kind, id: recordId });
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <ObjectIcon kind={icon} />
      <h2 className="truncate text-title font-semibold">{title}</h2>
      {slotRef !== undefined && <div ref={slotRef} className="flex shrink-0 items-center gap-1" />}
    </div>
  );
}

/**
 * Detail panel of a record, the shape every record takes, as oc3 gives it: a side
 * panel over the view, its title, its tabs under the title. The records shown are
 * proposed again by the search palette (`GlobalSearch`). The open tab is held by the view, in the URL (`tab`
 * or `peektab`), so that a link, a reload or the Back button reopen it; an unknown
 * tab falls back to the first one. The caller renders the content of the active tab.
 */
export function RecordPanel({
  open,
  kind,
  recordId,
  title,
  onClose,
  tabs,
  tab,
  onTabChange,
  size = "wider",
  closeOnOutsideClick,
  children,
}: {
  open: boolean;
  kind: PeekKind;
  recordId: string | undefined;
  title: string;
  onClose: () => void;
  /** The tabs, the first one being the default; none or one, no tab bar. */
  tabs?: TabItem[];
  tab?: string;
  onTabChange?: (tab: string | undefined) => void;
  size?: SlideOverSize;
  closeOnOutsideClick?: boolean;
  /** The content of the active tab, given its key. */
  children: (active: string) => ReactNode;
}) {
  const { t } = useTranslation();
  const tabsId = useTabsId();
  const items = tabs ?? [];
  const first = items[0]?.key ?? "";
  const active = items.some((item) => item.key === tab) ? (tab as string) : first;
  // The place in the title bar the content puts what concerns the whole record.
  const [titleSlot, setTitleSlot] = useState<HTMLElement | null>(null);
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);

  return (
    <SlideOver
      open={open}
      size={size}
      title={title}
      onClose={onClose}
      closeLabel={t("common.close")}
      resizeLabel={t("panel.resize")}
      closeOnOutsideClick={closeOnOutsideClick}
      heading={<PanelTitle kind={kind} title={title} recordId={recordId} open={open} slotRef={setTitleSlot} />}
      reopenable
      actions={<div ref={setActionsSlot} className="flex items-center gap-2" />}
      subheader={
        open && items.length > 1 ? (
          <TabList
            tabs={items}
            active={active}
            onChange={(key) => {
              onTabChange?.(key === first ? undefined : key);
            }}
            label={t("panel.tabs", { name: title })}
            idPrefix={tabsId}
          />
        ) : undefined
      }
    >
      {open && (
        <PanelHeaderContext.Provider value={{ title: titleSlot, actions: actionsSlot }}>
          {/* Short of room, the tables of a panel stack their rows as cards. */}
          <TableCardsContext.Provider value>
            <div {...(items.length > 1 ? tabPanelProps(tabsId, active) : {})} className="outline-none">
              {children(active)}
            </div>
          </TableCardsContext.Provider>
        </PanelHeaderContext.Provider>
      )}
    </SlideOver>
  );
}
