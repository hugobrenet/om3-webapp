import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { CaretRightIcon, ChevronDownIcon } from "../icons";
import { cn } from "../cn";

export interface MenuItem {
  key: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  /** Separator line before this entry, to mark a group. */
  separatorBefore?: boolean;
  /** The title of the group this entry opens, over it, as a separator saying its name. */
  heading?: string;
  /** What the entry does, in a light line under its label. */
  description?: string;
  /** An entry that harms: its label and icon in the tint of down. */
  danger?: boolean;
  /** Its column, from 1, in a menu of `columns` in a wide window: its group's. */
  column?: number;
  /** Entries of a submenu: the entry then opens it rather than being chosen. */
  items?: MenuItem[];
  onSelect?: () => void;
}

const ITEM =
  "flex w-full items-center gap-2 rounded-(--radius-control) px-2 py-1.5 text-left text-ink hover:bg-surface focus:bg-surface focus:outline-none disabled:text-ink-muted/60 disabled:hover:bg-transparent";

/**
 * Button opening an action menu, following the "menu button" pattern of the ARIA
 * APG, like the account menu whose behaviour it reuses: the button announces the
 * menu and its state, opening from the keyboard puts the focus on the first entry,
 * the arrows, Home and End walk through the entries, Escape closes and gives the
 * focus back to the button. A click outside the menu, Tab or choosing an entry close
 * it too.
 *
 * An entry with `items` opens a submenu beside it, by the mouse, Enter, Space or
 * the right arrow; within it the arrows walk its own entries, and the left arrow
 * or Escape give the focus back to the entry that opened it.
 *
 * `prominent` draws a menu the page is used for, such as the actions: outlined, as
 * every button that neither creates nor deletes (`Button`), in the ink rather than
 * muted, its label and chevron in a wide window, its `icon` alone in a narrow one,
 * the label then its accessible name and tooltip.
 *
 * om3 additions: `icon` without `prominent` makes the trigger an icon alone, `label`
 * staying its accessible name and tooltip; with `solid`, drawn as the actions, its
 * `text` (the label without) shown in a wide window, its icon alone in a narrow one;
 * `compact` makes it small, for a table
 * row; `align="end"` lines the menu up with the right edge of the trigger. The menu
 * is placed against the window, so that a scrolling container (a table) cannot cut
 * it, and closes when the page scrolls or resizes rather than drift from its button.
 */
export function MenuButton({
  label,
  items,
  disabled = false,
  className = "",
  prominent = false,
  solid = false,
  text,
  icon,
  compact = false,
  trigger,
  align = "start",
  columns,
}: {
  label: string;
  items: MenuItem[];
  disabled?: boolean;
  className?: string;
  /**
   * A menu the page is used for, such as the actions on the selection: outlined, in
   * the ink, tinted when hovered or open. The plain one, for a secondary menu, is
   * muted. Only a button creating or deleting something is filled (`Button`).
   */
  prominent?: boolean;
  /** Drawn as the actions: its text in a wide window, its icon alone in a narrow one. */
  solid?: boolean;
  /** With `solid`, the word shown in a wide window, shorter than the label naming it. */
  text?: string;
  /**
   * Icon alone in the trigger, instead of the label and the chevron; with
   * `prominent`, so only in a narrow window.
   */
  icon?: ReactNode;
  /** Small borderless trigger, for a table row. */
  compact?: boolean;
  /**
   * Content of the trigger in place of the label, as a cell of a table drawn as
   * itself and opening the actions on what it shows; `label` names it.
   */
  trigger?: ReactNode;
  align?: "start" | "end";
  /**
   * The groups of the entries side by side in a wide window, a column each (the
   * `column` of an entry), as a mega menu; one under the other in a narrow one.
   */
  columns?: 2 | 3;
}) {
  const [open, setOpen] = useState(false);
  const iconOnly = icon !== undefined && !prominent;
  const [position, setPosition] = useState<CSSProperties | null>(null);
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  // Entry to focus on opening: the first one from the keyboard, none with the mouse.
  const focusOnOpen = useRef<"first" | "last" | null>(null);

  // The entries of the top level only: a submenu walks its own.
  function entries(): HTMLElement[] {
    return [
      ...(menu.current?.querySelectorAll<HTMLElement>(":scope > div > [role=menuitem]") ?? []),
    ];
  }

  // Placed against the window, before the menu is painted: under the trigger, or
  // over it when the room below is short, as for the last rows of a list.
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const rect = button.current?.getBoundingClientRect();
    if (rect === undefined) return;
    const horizontal =
      align === "end"
        ? { right: document.documentElement.clientWidth - rect.right }
        : { left: rect.left };
    setPosition({ ...horizontal, ...verticalPlacement(rect, menu.current?.offsetHeight ?? 0) });
    function onMove(event: Event) {
      if (event.target instanceof Node && menu.current?.contains(event.target)) return;
      setOpen(false);
    }
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const target = focusOnOpen.current;
    focusOnOpen.current = null;
    if (target !== null) {
      const list = entries();
      (target === "first" ? list[0] : list[list.length - 1])?.focus();
    }
    function onPointerDown(event: PointerEvent) {
      if (!(event.target instanceof Node)) return;
      // The menu stands apart from the trigger, in its portal: a click in either is in.
      if (root.current?.contains(event.target) || menu.current?.contains(event.target)) return;
      setOpen(false);
    }
    // Escape closes the menu first, wherever the focus is: opened with the mouse, the
    // focus stays on the trigger, and the side panel around would take the key.
    function onEscape(event: globalThis.KeyboardEvent) {
      // In the menu, its own keys apply: a submenu closes alone, the focus goes back.
      if (event.key !== "Escape" || menu.current?.contains(document.activeElement)) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onEscape, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onEscape, true);
    };
  }, [open]);

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) button.current?.focus();
  }

  function onButtonKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const target =
      event.key === "ArrowDown" || event.key === "Enter" || event.key === " "
        ? "first"
        : event.key === "ArrowUp"
          ? "last"
          : null;
    if (target === null) return;
    event.preventDefault();
    if (open) {
      const list = entries();
      (target === "first" ? list[0] : list[list.length - 1])?.focus();
      return;
    }
    focusOnOpen.current = target;
    setOpen(true);
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // A disabled entry cannot take the focus: the arrows, Home and End skip it.
    const list = entries().filter((entry) => !(entry as HTMLButtonElement).disabled);
    const index = list.indexOf(document.activeElement as HTMLElement);
    const move = (next: number) => {
      event.preventDefault();
      list[(next + list.length) % list.length]?.focus();
    };
    switch (event.key) {
      case "ArrowDown":
        move(index + 1);
        break;
      case "ArrowUp":
        move(index - 1);
        break;
      case "Home":
        move(0);
        break;
      case "End":
        move(list.length - 1);
        break;
      case "Escape":
        // The side panel listens for Escape at the document level: close the menu only.
        event.preventDefault();
        event.stopPropagation();
        close(true);
        break;
      case "Tab":
        close(false);
        break;
    }
  }

  return (
    <div ref={root} className={`relative ${className}`}>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        disabled={disabled}
        onClick={() => {
          setOpen((previous) => !previous);
        }}
        onKeyDown={onButtonKeyDown}
        title={iconOnly || (prominent && icon !== undefined) ? label : undefined}
        aria-label={iconOnly || trigger !== undefined ? label : undefined}
        className={
          // A menu acts, it does not create nor delete: outlined, as every such button.
          prominent
            ? `flex h-7 items-center gap-1.5 rounded-(--radius-control) border border-line bg-surface-raised px-2.5 font-medium text-ink hover:bg-surface-sunken disabled:opacity-60 aria-expanded:bg-surface-sunken ${
                icon !== undefined ? "max-md:w-7 max-md:justify-center max-md:px-0" : ""
              }`
            : trigger !== undefined
            ? // Drawn as the other menu triggers, lighter: a border and a chevron say it opens.
              "inline-flex h-6 cursor-pointer items-center gap-1 rounded-(--radius-control) border border-line pr-0.5 pl-1 hover:border-line-strong hover:bg-surface-sunken disabled:cursor-default disabled:opacity-60 aria-expanded:border-line-strong aria-expanded:bg-surface-sunken"
            : compact
            ? "flex h-5 w-5 items-center justify-center rounded-(--radius-control) border border-line text-ink-muted hover:bg-surface-sunken hover:text-ink disabled:opacity-60 aria-expanded:bg-surface-sunken aria-expanded:text-ink"
            : iconOnly && solid
            ? "flex h-7 items-center gap-1.5 rounded-(--radius-control) border border-line bg-surface-raised px-2.5 font-medium text-ink hover:bg-surface-sunken disabled:opacity-60 aria-expanded:bg-surface-sunken max-md:w-7 max-md:justify-center max-md:px-0"
            : `flex h-7 items-center gap-1.5 rounded-(--radius-control) border border-line text-ink-muted hover:border-line-strong hover:text-ink disabled:opacity-60 aria-expanded:text-ink ${
                iconOnly ? "w-7 justify-center" : "px-2"
              }`
        }
      >
        {trigger !== undefined ? (
          <>
            {trigger}
            <ChevronDownIcon aria-hidden="true" className="h-3 w-3 shrink-0 text-ink-muted" />
          </>
        ) : iconOnly && solid ? (
          // Its text and chevron in a wide window, its icon alone in a narrow one.
          <>
            <span aria-hidden="true" className="hidden max-md:inline-flex">
              {icon}
            </span>
            <span aria-hidden="true" className="max-md:hidden">
              {text ?? label}
            </span>
            <ChevronDownIcon aria-hidden="true" className="h-3.5 w-3.5 max-md:hidden" />
          </>
        ) : iconOnly ? (
          icon
        ) : prominent && icon !== undefined ? (
          // The label and chevron in a wide window, the icon alone in a narrow one.
          <>
            <span aria-hidden="true" className="hidden max-md:inline-flex">
              {icon}
            </span>
            <span className="max-md:sr-only">{label}</span>
            <ChevronDownIcon className="h-3.5 w-3.5 max-md:hidden" />
          </>
        ) : (
          <>
            {label}
            <ChevronDownIcon className="h-3.5 w-3.5" />
          </>
        )}
      </button>

      {/* In a portal: placed against the window, which a side panel sliding in with a
          translation would otherwise replace as the reference of a fixed element. */}
      {open && createPortal(
        <div
          ref={menu}
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          style={position ?? { visibility: "hidden" }}
          className={`fixed z-[1200] min-w-56 rounded-(--radius-panel) border border-line bg-surface-raised p-1 text-left text-ui font-normal shadow-lg ${
            columns === undefined ? "" : `max-w-[calc(100vw-1rem)] gap-x-1 md:grid md:grid-flow-dense ${COLUMNS[columns]}`
          }`}
        >
          {items.map((item) => (
            <MenuEntry
              key={item.key}
              item={item}
              columns={columns}
              onChosen={() => {
                close(true);
              }}
            />
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

/** The grid of a mega menu, a column a group, as wide as they need. */
const COLUMNS: Record<2 | 3, string> = {
  2: "md:w-[32rem] md:grid-cols-2",
  3: "md:w-[46rem] md:grid-cols-3",
};
/** The column of an entry: its group's, its entries one under the other (the grid filling dense). */
const COLUMN_START: Record<number, string> = { 1: "md:col-start-1", 2: "md:col-start-2", 3: "md:col-start-3" };

/** Space kept between a menu and the edges of the window. */
const WINDOW_MARGIN = 8;
/** Gap between a menu and its trigger. */
const GAP = 4;

/**
 * Vertical place of a menu of `height` opened from `trigger`: under it when it
 * fits, else over it when it fits there, else on the roomier side, cut to the room
 * left and scrolled.
 */
export function verticalPlacement(trigger: DOMRect, height: number): CSSProperties {
  const below = window.innerHeight - trigger.bottom - GAP - WINDOW_MARGIN;
  const above = trigger.top - GAP - WINDOW_MARGIN;
  if (height <= below) return { top: trigger.bottom + GAP };
  if (height <= above) return { bottom: window.innerHeight - trigger.top + GAP };
  return below >= above
    ? { top: trigger.bottom + GAP, maxHeight: below, overflowY: "auto" }
    : { bottom: window.innerHeight - trigger.top + GAP, maxHeight: above, overflowY: "auto" };
}

/**
 * Shift of a submenu laid out at `rect` that keeps it in the window: up by what
 * passes the bottom edge (never above the top one), and to the other side of its
 * entry when it passes the right edge.
 */
export function submenuShift(rect: DOMRect): { up: number; flip: boolean } {
  const overflow = rect.bottom - (window.innerHeight - WINDOW_MARGIN);
  const up = Math.max(0, Math.min(overflow, rect.top - WINDOW_MARGIN));
  const flip = rect.right > window.innerWidth - WINDOW_MARGIN;
  return { up, flip };
}

/**
 * An entry of a menu: a choice, or the opener of a submenu shown beside it.
 */
function MenuEntry({ item, onChosen, columns }: { item: MenuItem; onChosen: () => void; columns?: number }) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const submenu = useRef<HTMLDivElement>(null);
  const subId = useId();
  // Named by its label, its description describing it: not read as part of its name.
  const labelId = useId();
  const descriptionId = useId();
  const sub = item.items;
  // Shift keeping the submenu in the window, measured before it is painted.
  const [shift, setShift] = useState<{ up: number; flip: boolean } | null>(null);

  useLayoutEffect(() => {
    if (!open || submenu.current === null) {
      setShift(null);
      return;
    }
    setShift(submenuShift(submenu.current.getBoundingClientRect()));
  }, [open]);

  function subEntries(): HTMLElement[] {
    return [
      ...(submenu.current?.querySelectorAll<HTMLElement>(":scope > div > [role=menuitem]") ?? []),
    ];
  }

  function openSub(focus: boolean) {
    setOpen(true);
    if (focus) window.requestAnimationFrame(() => subEntries()[0]?.focus());
  }

  function closeSub() {
    setOpen(false);
    opener.current?.focus();
  }

  function onSubKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const list = subEntries().filter((entry) => !(entry as HTMLButtonElement).disabled);
    const index = list.indexOf(document.activeElement as HTMLElement);
    const move = (next: number) => {
      event.preventDefault();
      list[(next + list.length) % list.length]?.focus();
    };
    switch (event.key) {
      case "ArrowDown":
        move(index + 1);
        break;
      case "ArrowUp":
        move(index - 1);
        break;
      case "Home":
        move(0);
        break;
      case "End":
        move(list.length - 1);
        break;
      case "ArrowLeft":
      case "Escape":
        event.preventDefault();
        closeSub();
        break;
      case "Tab":
        // Leaves the whole menu, as from the top level.
        return;
      default:
        return;
    }
    // The keys a submenu handles do not walk the parent menu too.
    event.stopPropagation();
  }

  return (
    <div
      className={`relative ${columns !== undefined && item.column !== undefined ? COLUMN_START[item.column] ?? "" : ""}`}
      onPointerEnter={() => {
        if (sub !== undefined) setOpen(true);
      }}
      onPointerLeave={() => {
        if (sub !== undefined) setOpen(false);
      }}
    >
      {item.separatorBefore === true && (
        <div role="separator" className="my-1 border-t border-line" />
      )}
      {item.heading !== undefined && (
        <div role="presentation" data-menu-heading="" className="px-2 pt-2 pb-1 text-xs font-semibold tracking-wide text-ink-muted uppercase">
          {item.heading}
        </div>
      )}
      <button
        ref={opener}
        type="button"
        role="menuitem"
        tabIndex={-1}
        disabled={item.disabled}
        aria-haspopup={sub === undefined ? undefined : "menu"}
        aria-expanded={sub === undefined ? undefined : open}
        aria-controls={sub === undefined ? undefined : subId}
        aria-labelledby={item.description === undefined ? undefined : labelId}
        aria-describedby={item.description === undefined ? undefined : descriptionId}
        onClick={() => {
          if (sub !== undefined) {
            openSub(true);
            return;
          }
          onChosen();
          item.onSelect?.();
        }}
        onKeyDown={(event) => {
          if (sub !== undefined && event.key === "ArrowRight") {
            event.preventDefault();
            event.stopPropagation();
            openSub(true);
          }
        }}
        className={cn(ITEM, item.description !== undefined && "items-start", item.danger === true && "text-state-down")}
      >
        {item.icon}
        <span className="flex-1">
          <span id={labelId} className="block">{item.label}</span>
          {item.description !== undefined && <span id={descriptionId} className="block text-data text-ink-muted">{item.description}</span>}
        </span>
        {sub !== undefined && <CaretRightIcon className="h-3.5 w-3.5 text-ink-muted" />}
      </button>
      {sub !== undefined && open && (
        <div
          ref={submenu}
          id={subId}
          role="menu"
          aria-label={item.label}
          onKeyDown={onSubKeyDown}
          style={shift === null ? { visibility: "hidden", top: 0 } : { top: -shift.up }}
          className={`absolute z-40 min-w-56 rounded-(--radius-panel) border border-line bg-surface-raised p-1 shadow-lg ${
            shift?.flip === true ? "right-full mr-1" : "left-full ml-1"
          }`}
        >
          {sub.map((child) => (
            <MenuEntry key={child.key} item={child} onChosen={onChosen} />
          ))}
        </div>
      )}
    </div>
  );
}
