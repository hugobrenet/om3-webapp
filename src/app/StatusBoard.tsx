import type { CSSProperties, ReactNode } from "react";
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../ui/cn";
import { AlertTriangleIcon, CloseIcon, DrpIcon, HistoryIcon, InfoIcon, PlayIcon, PauseIcon, SnowflakeIcon, TargetIcon } from "../ui/icons";
import { IconButton } from "../ui/components/Button";
import { FrozenMark } from "../ui/components/FrozenMark";
import { NotProvisionedMark } from "../ui/components/StateMarks";
import { StateGlyph } from "../ui/components/StateGlyph";
import type { ObjectState } from "../ui/components/StatusBadge";
import { statusBadge } from "../ui/components/status";
import { Cell, HeaderCell, HeaderRow, Row, Table } from "../ui/components/Table";
import { SYMBOLS_HINT, hideIntro, useHiddenIntros, useIntrosEnabled } from "./page-intro";
import { SymbolHelp } from "./SymbolHelp";
import { Term } from "./Term";
import { HoverCard } from "../ui/components/HoverCard";
import type { Board, BoardRow, Level, NoteFix, RowNote, Span, Text, Tone } from "./statusboard";


/** The rows of the board named by a word of the glossary, its key by the kind of row. */
const ROW_TERMS: Partial<Record<string, string>> = {
  monitor: "monitor",
  expect: "expect",
  provisioned: "provisioned",
  orchestration: "orchestration",
};

/** The inks of the webapp for om's colors. */
const TONES: Record<Tone, string> = {
  optimal: "text-state-up",
  error: "text-state-down",
  warning: "text-state-warn",
  secondary: "text-ink-muted",
  primary: "text-ink",
  frozen: "text-icon-network",
};


/** Depth of the first column: written out, Tailwind does not see names built at runtime. */
const INDENT = ["pl-2", "pl-6", "pl-10", "pl-14"];

const LEVELS: Record<Level, { ink: string; Icon: typeof InfoIcon }> = {
  error: { ink: "text-state-down", Icon: AlertTriangleIcon },
  warn: { ink: "text-state-warn", Icon: AlertTriangleIcon },
  info: { ink: "text-ink-muted", Icon: InfoIcon },
};

const GLYPH_INK: Record<ObjectState, string> = {
  up: "text-state-up",
  warn: "text-state-warn",
  down: "text-state-down",
  na: "text-state-unknown",
  unknown: "text-state-unknown",
};

/**
 * A status as the other views draw it: the glyph of its state, gray when no issue; n/a
 * as om writes it, "/". Unknown, a red "?" as om draws it: an instance of the object
 * that tells nothing, its node gone or not heard from.
 */
function Status({ span }: { span: Span }) {
  const badge = statusBadge(span.status);
  if (span.status === "undef") {
    return (
      <span data-state="unknown" className="inline-flex w-4 shrink-0 items-center justify-center font-semibold text-state-down">
        <span aria-hidden="true">?</span>
        <span className="sr-only">{badge.label ?? span.status}</span>
      </span>
    );
  }
  // om grays a down where the object misses no instance: it is no issue.
  const muted = span.tone === "secondary" && badge.state !== "unknown" && badge.state !== "na";
  return (
    <span data-state={badge.state} className={cn("inline-flex w-4 shrink-0 items-center justify-center", muted ? "text-ink-muted" : GLYPH_INK[badge.state])}>
      <StateGlyph state={badge.state} />
      <span className="sr-only">{badge.label ?? span.status}</span>
    </span>
  );
}

/** The key of the meaning of an instance mark, under `statusBoard.marks`. */
function markKey(span: Span): string {
  switch (span.mark) {
    case "*":
      return "frozen";
    case "=":
      return "stopped";
    case "L":
      return "rpoBreached";
    case "!":
      return "overallWarn";
    case "R":
      return "running";
    case "#":
      return "drp";
    case "^":
      return span.tone === "error" ? "leaderNonOptimal" : "leader";
    default:
      return "notProvisioned";
  }
}

/** An instance mark of om mon, as an icon telling it. */
function Mark({ span }: { span: Span }) {
  const { t } = useTranslation();
  const label = t(`statusBoard.marks.${markKey(span)}`);
  const glyph = (() => {
    switch (span.mark) {
      case "*":
        return [<SnowflakeIcon className="h-3.5 w-3.5" />, "text-icon-network"] as const;
      case "=":
        // The pause bars, not the stop square: a gray square is a down that is no issue.
        return [<PauseIcon className="h-3.5 w-3.5" />, "text-ink-muted"] as const;
      case "L":
        return [<HistoryIcon className="h-3.5 w-3.5" />, "text-state-warn"] as const;
      case "!":
        return [<StateGlyph state="warn" />, "text-state-warn"] as const;
      case "R":
        return [<PlayIcon className="h-3.5 w-3.5" />, "text-icon-network"] as const;
      case "#":
        return [<DrpIcon className="h-3.5 w-3.5" />, "text-ink-muted"] as const;
      case "^":
        return [<TargetIcon className="h-3.5 w-3.5" />, span.tone === "error" ? "text-state-down" : "text-ink-muted"] as const;
      default:
        return null;
    }
  })();
  // Not provisioned: the "P" pill of the unprovisioned resources, the same mark.
  if (span.mark === "P") return <NotProvisionedMark label={label} />;
  if (glyph === null) return null;
  return (
    <span role="img" aria-label={label} className={cn("inline-flex", glyph[1])}>
      {glyph[0]}
    </span>
  );
}

/** What a resource flag means, its restarts counted. */
function flagMeaning(span: Span, t: (key: string, options?: Record<string, unknown>) => string): string {
  const key = /^[0-9+]$/.test(span.text) ? "restarts" : span.text;
  return t(`statusBoard.flags.${key}`, { count: span.text === "+" ? 10 : Number(span.text) });
}

/** A resource flag, a small pill naming it. */
function Flag({ span }: { span: Span }) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        "inline-flex h-4 min-w-4 items-center justify-center rounded-sm border px-0.5 text-[0.6875rem] leading-none font-medium",
        span.tone === "error" ? "border-state-down text-state-down" : "border-line text-ink-muted",
      )}
    >
      <span aria-hidden="true">{span.text}</span>
      <span className="sr-only">{flagMeaning(span, t)}</span>
    </span>
  );
}

/** The statuses of the legend: as the board draws them, a grey down apart. */
const LEGEND_STATES: { key: string; span: Span }[] = [
  { key: "up", span: { text: "O", status: "up" } },
  { key: "warn", span: { text: "!", status: "warn" } },
  { key: "down", span: { text: "X", status: "down" } },
  { key: "downQuiet", span: { text: "X", status: "down", tone: "secondary" } },
  { key: "na", span: { text: "/", status: "n/a" } },
  { key: "undef", span: { text: "?", status: "undef" } },
];

/** The instance marks of the legend, in the order the board puts them. */
const LEGEND_MARKS: { key: string; span: Span }[] = [
  { key: "overallWarn", span: { text: "!", mark: "!", tone: "warning" } },
  { key: "running", span: { text: "R", mark: "R" } },
  { key: "rpoBreached", span: { text: "L", mark: "L", tone: "error" } },
  { key: "drp", span: { text: "#", mark: "#" } },
  { key: "leader", span: { text: "^", mark: "^" } },
  { key: "leaderNonOptimal", span: { text: "^", mark: "^", tone: "error" } },
  { key: "frozen", span: { text: "*", mark: "*" } },
  { key: "stopped", span: { text: "=", mark: "=" } },
  { key: "notProvisioned", span: { text: "P", mark: "P", tone: "error" } },
];

/** The resource flags of the legend, the restarts left by example. */
const LEGEND_FLAGS: { key: string; span: Span }[] = [
  { key: "R", span: { text: "R", flag: true } },
  { key: "M", span: { text: "M", flag: true } },
  { key: "D", span: { text: "D", flag: true } },
  { key: "O", span: { text: "O", flag: true } },
  { key: "E", span: { text: "E", flag: true } },
  { key: "S", span: { text: "S", flag: true } },
  { key: "P", span: { text: "P", flag: true, tone: "error" } },
  { key: "X", span: { text: "X", flag: true } },
  { key: "restarts", span: { text: "3", flag: true } },
  { key: "noRestart", span: { text: "0", flag: true } },
  { key: "manyRestarts", span: { text: "+", flag: true } },
];

/**
 * What every symbol of the status board means, drawn as the board draws it: the
 * statuses, the marks of an instance, the flags of a resource. On the board on
 * demand, and on the Glossary page.
 */
export function SymbolLegend() {
  const { t } = useTranslation();
  const group = (key: string, items: { key: string; span: Span }[], Piece: (props: { span: Span }) => ReactNode) => (
    <section aria-labelledby={`legend-${key}`} className="space-y-1">
      <h3 id={`legend-${key}`} className="font-medium">{t(`legend.groups.${key}`)}</h3>
      <dl className="grid grid-cols-[2.5rem_1fr] items-baseline gap-x-2 gap-y-1">
        {items.map((item) => (
          <Fragment key={item.key}>
            <dt className="flex justify-center" data-legend={`${key}-${item.key}`}>
              <Piece span={item.span} />
            </dt>
            <dd>{t(`legend.${key}.${item.key}`)}</dd>
          </Fragment>
        ))}
      </dl>
    </section>
  );
  return (
    <div className="grid gap-4 text-data md:grid-cols-3">
      {group("states", LEGEND_STATES, Status)}
      {group("marks", LEGEND_MARKS, Mark)}
      {group("flags", LEGEND_FLAGS, Flag)}
    </div>
  );
}

/**
 * Notes, by each its level, its marker, its text, the nodes it is about: in the card
 * of a resource, or in the panel of one (`className`, its width there).
 */
export function NotesList({ notes, className = "max-w-sm" }: { notes: RowNote[]; className?: string }) {
  const { t } = useTranslation();
  return (
    <ul data-notes-card="" className={cn("space-y-1.5", className)}>
      {notes.map((n, i) => {
        const { ink, Icon } = LEVELS[n.level];
        return (
          <li key={i} className="flex items-start gap-1.5">
            <Icon aria-hidden="true" className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", ink)} />
            <span className="sr-only">{t(`statusBoard.levels.${n.level}`)}</span>
            <span className="min-w-0">
              {n.marker !== "" && <sup className={cn("mr-0.5 font-medium", ink)}>{n.marker}</sup>}
              <span className="text-ink">{n.text}</span>
              {n.nodes !== "" && <span className="ml-1.5 text-ink-muted">{n.nodes}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The name of a resource, its notes in a card on hover, from all the room of its
 * name: those of all its instances. Hover alone, the name opening the resource
 * being a link of its own.
 */
function ResourceNotes({ notes, children }: { notes: RowNote[]; children: ReactNode }) {
  if (notes.length === 0) return <>{children}</>;
  return (
    <HoverCard inert className="flex min-w-0 flex-1" card={<NotesList notes={notes} />}>
      <span data-resource-notes="" className="flex min-w-0 flex-1 items-center">{children}</span>
    </HoverCard>
  );
}

/**
 * What a cell holds: the status glyph, the marks, the flags, the markers of the notes.
 * The symbols said on demand, a marker by its note (`notes`, those of the cell);
 * `inert` in a button, the click being the button's.
 */
function Pieces({ text, kind, inert = false, notes = [] }: { text: Text; kind: BoardRow["kind"]; inert?: boolean; notes?: RowNote[] }) {
  const { t } = useTranslation();
  if (text.length === 0) return null;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      {text.map((s, i) => {
        if (s.status !== undefined)
          return (
            <SymbolHelp key={i} inert={inert} meaning={t("statusBoard.details.status", { status: s.status === "n/a" ? "/" : s.status })}>
              <Status span={s} />
            </SymbolHelp>
          );
        if (s.mark !== undefined)
          return (
            <SymbolHelp key={i} inert={inert} meaning={t(`statusBoard.marks.${markKey(s)}`)}>
              <Mark span={s} />
            </SymbolHelp>
          );
        if (s.flag)
          return (
            <SymbolHelp key={i} inert={inert} meaning={flagMeaning(s, t)}>
              <Flag span={s} />
            </SymbolHelp>
          );
        if (s.note) {
          // At the top of the value, not raised by the half of an em of a sup (the
          // preflight's): it would stand out of the badge of the value.
          const marker = (
            <sup key={i} className={cn("static self-start text-[0.6875rem] leading-none font-medium", TONES[s.tone ?? "secondary"])}>
              <span aria-hidden="true">{s.text}</span>
              <span className="sr-only">{t("statusBoard.seeNote", { marker: s.text })}</span>
            </sup>
          );
          const of = notes.filter((n) => n.marker === s.text);
          if (of.length === 0) return marker;
          return (
            <HoverCard key={i} inert={inert} className="self-start" card={<NotesList notes={of} />}>
              {/* Some room around the marker, for the pointer to find it. */}
              <span className="-mx-1 inline-flex cursor-help self-start px-1">{marker}</span>
            </HoverCard>
          );
        }
        if (s.text.trim() === "") return null;
        // A value with no meaning of its own: a monitor state, an expectation…
        if (s.text === "·") return <span key={i} className="text-ink-muted" aria-label={t("statusBoard.none")}>–</span>;
        return (
          <span key={i} className={cn(kind !== "resource" && s.tone && TONES[s.tone])}>
            {s.text}
          </span>
        );
      })}
    </span>
  );
}

/** The tint of a status said in full: the availability states in their colour, n/a muted. */
const STATUS_INK: Record<string, string> = {
  up: "text-state-up",
  "stdby up": "text-state-up",
  down: "text-state-down",
  "stdby down": "text-state-down",
  warn: "text-state-warn",
  "n/a": "text-ink-muted",
};

/** A status of the summary, said in full: the word, bold, in its tint. */
function SummaryStatus({ status }: { status: string | undefined }) {
  const word = status || "n/a";
  return (
    <span data-state={word} className={cn("font-semibold", STATUS_INK[word] ?? "text-state-unknown")}>
      {word}
    </span>
  );
}

/** The nodes a resource row reports the resource on: its cells holding a status. */
export function rowNodes(board: Board, row: BoardRow): string[] {
  return board.nodes.filter((_, i) => row.cells[i]?.some((s) => s.status !== undefined)).map((n) => n.name);
}

/**
 * What is selected on the board, and what changes it: the caller's state. A
 * resource is selected node by node, a cell each; an instance by its node.
 */
export interface BoardSelection {
  isNode: (node: string) => boolean;
  toggleNode: (node: string) => void;
  isCell: (rid: string, node: string) => boolean;
  toggleCell: (rid: string, node: string) => void;
  /** Selects the resource on all its nodes, or unselects it when it is already. */
  toggleRow: (rid: string) => void;
}

/**
 * Selected, a cell is tinted and edged, the cells selected side by side making one
 * block, edged on its outside only (`selectionEdges`).
 */
const SELECTED = "bg-accent-soft";

/**
 * The edge of a selected cell: on each side where its neighbour is not selected,
 * so that cells selected side by side read as one block. `at(row, column)` says
 * whether a cell of the grid is selected; out of the grid, it is not.
 */
export function selectionEdges(at: (row: number, column: number) => boolean, row: number, column: number): CSSProperties | undefined {
  if (!at(row, column)) return undefined;
  const line = "var(--accent)";
  const edges = [
    !at(row, column - 1) && `inset 1px 0 0 ${line}`,
    !at(row, column + 1) && `inset -1px 0 0 ${line}`,
    !at(row - 1, column) && `inset 0 1px 0 ${line}`,
    !at(row + 1, column) && `inset 0 -1px 0 ${line}`,
  ].filter(Boolean);
  return { boxShadow: edges.length === 0 ? "none" : edges.join(", ") };
}

/**
 * The column of the first node in the grid of the selection: after the names, the
 * type and the description, the nodes standing last.
 */
const FIRST_NODE = 3;

/** The line before the nodes, apart from the rest. */
const NODES_START = "border-l border-line";

/**
 * What selects, out of the way until wanted: a checkbox drawn light, that the cell
 * holding it shows in full on hover, or when it has the focus, and keeps so once
 * checked, or partly. A
 * click elsewhere in the cell selects nothing: its badges open their records.
 */
function SelectBox({
  checked,
  indeterminate = false,
  label,
  onToggle,
}: {
  checked: boolean;
  indeterminate?: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <input
      type="checkbox"
      className={cn(
        "h-3.5 w-3.5 shrink-0 cursor-pointer accent-(--accent)",
        !checked && !indeterminate && "opacity-30 group-hover:opacity-100 focus-visible:opacity-100",
      )}
      checked={checked}
      ref={(el) => {
        if (el) el.indeterminate = indeterminate;
      }}
      aria-label={label}
      onChange={onToggle}
      // The click toggles it: not the row around too.
      onClick={(event) => event.stopPropagation()}
    />
  );
}

/** The steps of the board scaled down to its room: past the last one, its nodes one under the other. */
export const BOARD_LAYOUT_STEPS = 2;

/**
 * What the board shows at a step of its scaling down, 0 the whole table: then the
 * type and the description of a row under its name, their columns dropped; then
 * each node a block of its own, its instance and its resources, one under the
 * other, no column left to squeeze.
 */
export const boardLayout = (step: number) => ({
  sideColumns: step < 1,
  nodeColumns: step < 2,
});

/** The rows telling an instance, after its state: the monitor, the expectation… */
const INSTANCE_DETAILS: ReadonlySet<string> = new Set(["monitor", "expect", "provisioned", "orchestration"]);

/** The description of a row: a subset run in parallel said so, its words else; none for the instances. */
function RowDescription({ row }: { row: BoardRow }) {
  const { t } = useTranslation();
  if (row.kind === "instance") return null;
  if (row.kind === "subset" && row.desc.length > 0)
    return <span className="rounded-full border border-line px-2 text-ink-muted">{t("statusBoard.parallel")}</span>;
  return <>{row.desc.map((s) => s.text).join("")}</>;
}

/** The type and the description of a row on one muted line, under its name: none when it has neither. */
function SideText({ row, className }: { row: BoardRow; className?: string }) {
  const desc = row.kind === "instance" ? "" : row.desc.map((s) => s.text).join("").trim();
  if (row.typ === "" && desc === "" && row.kind !== "subset") return null;
  return (
    <span data-side-text="" className={cn("flex flex-wrap items-center gap-x-1.5 text-[0.75rem] font-normal break-all text-ink-muted not-italic", className)}>
      {row.typ !== "" && <span>{row.typ}</span>}
      {row.typ !== "" && desc !== "" && <span aria-hidden="true">·</span>}
      <RowDescription row={row} />
    </span>
  );
}

/**
 * The board with no room for a column a node, on a phone say: each node a block of
 * its own, one under the other. Its head the node, its instance's state, and what
 * selects the instance; then the monitor, the expectation… of the instance; then
 * the resources on that node, each its name, its value there opening the resource on
 * that instance, its type and description under. A resource on several nodes is
 * selected node by node, in each block.
 */
function NodeBlocks({
  board,
  selection,
  linkNode,
  linkResource,
  openCell,
}: {
  board: Board;
  selection?: BoardSelection;
  linkNode?: (node: string) => ReactNode;
  linkResource?: (rid: string) => ReactNode;
  openCell?: (rid: string, node: string) => void;
}) {
  const { t } = useTranslation();
  const instanceRow = board.rows.find((r) => r.kind === "instance");
  const detailRows = board.rows.filter((r) => INSTANCE_DETAILS.has(r.kind));
  const resourceRows = board.rows.filter((r) => r.kind === "resource" || r.kind === "subset" || r.kind === "label");
  return (
    <div role="list" aria-label={t("statusBoard.caption", { path: board.path })} data-node-blocks="" className="space-y-3">
      {board.nodes.map((n, j) => {
        const picked = selection?.isNode(n.name) ?? false;
        // The resources on this node, their subsets and labels with the first of them after.
        const onNode = resourceRows.filter((r, i) => {
          if (r.kind === "resource") return rowNodes(board, r).includes(n.name);
          const next = resourceRows.slice(i + 1).find((x) => x.kind === "resource");
          return next !== undefined && rowNodes(board, next).includes(n.name);
        });
        const count = onNode.filter((r) => r.kind === "resource").length;
        return (
          <section
            key={n.name}
            role="listitem"
            aria-label={t("statusBoard.instanceOn", { node: n.name })}
            data-node-block={n.name}
            className={cn("overflow-hidden rounded-(--radius-panel) border bg-surface-raised text-data", picked ? "border-accent" : "border-line")}
          >
            <div className={cn("group flex items-center gap-2 border-b border-line px-2 py-1.5", picked ? SELECTED : "bg-surface-sunken")}>
              {selection !== undefined && (
                <SelectBox checked={picked} label={t("statusBoard.selectInstance", { node: n.name })} onToggle={() => selection.toggleNode(n.name)} />
              )}
              <span className="font-semibold text-ink">{linkNode ? linkNode(n.name) : n.name}</span>
              {n.frozen && <FrozenMark frozen />}
              {instanceRow && (
                <span className="ml-auto">
                  <span className="inline-flex">
                    <Pieces text={instanceRow.cells[j] ?? []} kind="instance" />
                  </span>
                </span>
              )}
            </div>
            {detailRows.some((r) => (r.cells[j] ?? []).length > 0) && (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 px-2 py-1.5">
                {detailRows.map((r) => (
                  <Fragment key={r.kind}>
                    <dt className="text-ink-muted">
                      {ROW_TERMS[r.kind] ? <Term term={ROW_TERMS[r.kind] as string}>{t(`statusBoard.rows.${r.kind}`)}</Term> : t(`statusBoard.rows.${r.kind}`)}
                    </dt>
                    <dd>
                      <span className="inline-flex">
                        <Pieces text={r.cells[j] ?? []} kind={r.kind} />
                      </span>
                    </dd>
                  </Fragment>
                ))}
              </dl>
            )}
            {count > 0 && (
              <>
                <h4 className="border-t border-line bg-surface-sunken px-2 py-1 font-normal text-ink">
                  {t("statusBoard.rows.resources", { count })}
                </h4>
                <ul aria-label={t("statusBoard.rows.resources", { count })} className="divide-y divide-line/40">
                  {onNode.map((r, i) => {
                    if (r.kind !== "resource")
                      return (
                        <li key={i} className="px-2 py-1 text-ink-muted italic">
                          {r.kind === "subset" ? r.name : null}
                          <SideText row={r} />
                        </li>
                      );
                    const cell = r.cells[j] ?? [];
                    const pickedCell = selection?.isCell(r.name, n.name) ?? false;
                    return (
                      <li key={i} className={cn("group flex items-start gap-2 px-2 py-1", pickedCell && SELECTED)}>
                        {selection !== undefined && (
                          <span className="pt-0.5">
                            <SelectBox
                              checked={pickedCell}
                              label={t("statusBoard.selectCell", { rid: r.name, node: n.name })}
                              onToggle={() => selection.toggleCell(r.name, n.name)}
                            />
                          </span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="flex">
                            <ResourceNotes notes={r.cellNotes[j] ?? []}>
                              <span className="font-medium">{linkResource ? linkResource(r.name) : r.name}</span>
                            </ResourceNotes>
                          </span>
                          <SideText row={r} />
                        </span>
                        <span className="inline-flex">
                          {openCell ? (
                            <button
                              type="button"
                              aria-label={t("statusBoard.openCell", { rid: r.name, node: n.name })}
                              onClick={() => openCell(r.name, n.name)}
                              className="inline-flex min-h-5 min-w-9 cursor-pointer items-center justify-center gap-1 rounded-full border border-line bg-surface px-1.5 py-px hover:border-line-strong hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-(--focus-ring)"
                            >
                              <Pieces text={cell} kind="resource" inert notes={r.cellNotes[j] ?? []} />
                            </button>
                          ) : (
                            <Pieces text={cell} kind="resource" notes={r.cellNotes[j] ?? []} />
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}

/**
 * The status of an object as `om <path> status` tells it (`statusboard.ts`), drawn
 * as the rest of the webapp: its summary, the table of its instances and resources
 * by node, and the notes saying what needs attention.
 *
 * With a `selection`, the resources and the instances are picked by checkboxes,
 * shown on hover of their cell and kept shown once checked: a resource on a node
 * in its cell, on all its nodes by its name, an instance by the header of its
 * node. The caller acts on what is picked, from its `toolbar`. Every node has its
 * instance to pick, reported or not. With `openCell`, the value of a resource on a
 * node opens what the caller shows of it: the resource on that instance alone. The names are the caller's badges
 * (`linkNode`, `linkResource`): a click on one opens its record. `facts`, what the
 * caller adds to the summary, a line each after the count of the instances up.
 * `noteFix`, the caller's button running the action a note asks for, in the note.
 *
 * Scaled down to its room a step at a time while it overflows (`boardLayout`), the
 * least missed first, as the lists are: in a narrow panel, on a phone, its nodes
 * each a block, one under the other.
 */
export function StatusBoard({
  board,
  selection,
  toolbar,
  linkNode,
  linkResource,
  openCell,
  facts = [],
  noteFix,
}: {
  board: Board;
  selection?: BoardSelection;
  /** What acts on the selection, over the table. */
  toolbar?: ReactNode;
  /** The name of a node as a badge opening its record (its instance); plain text without. */
  linkNode?: (node: string) => ReactNode;
  /** The id of a resource as a badge opening its record; plain text without. */
  linkResource?: (rid: string) => ReactNode;
  /** Opens the record of a resource on the instance of a node; its cell plain without. */
  openCell?: (rid: string, node: string) => void;
  /** More lines of the summary, after the count of the instances up. */
  facts?: { label: string; value: ReactNode }[];
  /** The button running the action a note asks for; none without, or where it gives none. */
  noteFix?: (fix: NoteFix) => ReactNode;
}) {
  const { t } = useTranslation();
  const hiddenHints = useHiddenIntros();
  const hintsEnabled = useIntrosEnabled();
  const columns = board.nodes.length + 3;
  const field = (name: string) => board.fields.find((f) => f.name === name)?.value;
  const avail = field("avail")?.[0];
  const overall = field("overall")?.[0];
  const states = (field("state") ?? []).filter((s) => s.text !== ", ");
  const count = board.rows.find((r) => r.kind === "instance")?.desc[0];
  const resources = board.rows.filter((r) => r.kind === "resource").length;
  const instanceRow = board.rows.find((r) => r.kind === "instance");
  const nodeSelected = (node: string) => selection?.isNode(node) ?? false;

  // Scaled down while its table overflows its frame; resized, the whole table tried again.
  const root = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  useLayoutEffect(() => {
    const element = frame.current;
    if (element && step < BOARD_LAYOUT_STEPS && element.scrollWidth > element.clientWidth + 1) setStep((n) => n + 1);
  });
  useEffect(() => {
    const element = root.current;
    if (!element || typeof ResizeObserver !== "function") return undefined;
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === width) return;
      width = element.clientWidth;
      setStep(0);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const layout = boardLayout(step);

  /*
   * The grid of what is selected, as drawn: the header row first, then the rows of
   * the board; the column of the names first, then the nodes. Its neighbours tell
   * a selected cell where its edges go.
   */
  /** The rows as drawn: the instances under the header, which says them; the resources under a heading. */
  const shown: BoardRow[] = board.rows.filter((r) => r.kind !== "blank");
  const instances = board.nodes.filter((_, j) =>
    (instanceRow?.cells[j] ?? []).some((s) => s.status !== undefined && s.status !== "undef"),
  ).length;
  const rowSelectState = (r: BoardRow) => {
    if (selection === undefined || r.kind !== "resource") return "none";
    const nodes = rowNodes(board, r);
    const n = nodes.filter((node) => selection.isCell(r.name, node)).length;
    return n === 0 ? "none" : n === nodes.length ? "all" : "some";
  };
  /** The rows of the instances: their heading, then the state, the monitor and the others. */
  const INSTANCE_ROWS: ReadonlySet<string> = new Set(["instance", "monitor", "expect", "provisioned", "orchestration"]);
  const selectedAt = (v: number, c: number): boolean => {
    if (selection === undefined || c < 0 || c >= FIRST_NODE + board.nodes.length) return false;
    // The type and the description, between the names and the nodes, are never selected.
    if (c > 0 && c < FIRST_NODE) return false;
    const node = board.nodes[c - FIRST_NODE]?.name ?? "";
    if (v === 0) return c >= FIRST_NODE && nodeSelected(node);
    const r = shown[v - 1];
    if (r === undefined) return false;
    // A selected instance: its column, from its header down through the rows of the instances.
    if (INSTANCE_ROWS.has(r.kind)) return c >= FIRST_NODE && nodeSelected(node);
    if (c === 0) return rowSelectState(r) === "all";
    return r.kind === "resource" && rowNodes(board, r).includes(node) && selection.isCell(r.name, node);
  };
  /** The look of a selected cell: its edges, and no line of the rows under it inside a block. */
  const selectedLook = (v: number, c: number) => ({
    style: selectionEdges(selectedAt, v, c),
    className: cn(selectedAt(v, c) && SELECTED),
  });

  return (
    <div ref={root} data-board-step={step} className="space-y-3">
      {/* The summary: the statuses of the object, one a line, and beside them what is
          wrong with it, if anything: a state coming or going (frozen, not provisioned)
          moves nothing below. Short of room, the states go under. */}
      <div className="flex flex-wrap items-start gap-x-10 gap-y-3">
        <dl className="grid w-max grid-cols-[auto_auto] items-center gap-x-3 gap-y-1">
          {avail !== undefined && (
            <>
              <dt className="text-ink-muted"><Term term="avail">{t("statusBoard.avail")}</Term></dt>
              <dd><SummaryStatus status={avail.status} /></dd>
            </>
          )}
          {overall !== undefined && (
            <>
              <dt className="text-ink-muted"><Term term="overall">{t("statusBoard.overall")}</Term></dt>
              <dd><SummaryStatus status={overall.status} /></dd>
            </>
          )}
          {count !== undefined && (
            <>
              <dt className="text-ink-muted">{t("statusBoard.instancesUp")}</dt>
              <dd className={cn("font-medium tabular-nums", count.tone === "error" && "text-state-down")}>{count.text}</dd>
            </>
          )}
          {facts.map(({ label, value }) => (
            <Fragment key={label}>
              <dt className="text-ink-muted">{label}</dt>
              <dd>{value}</dd>
            </Fragment>
          ))}
        </dl>
        {states.length > 0 && (
          <ul aria-label={t("statusBoard.issues")} className="flex flex-col items-start gap-y-1">
            {states.map((s) =>
              s.text === "frozen" || s.text === "mixed-frozen" ? (
                <li key={s.text} className="inline-flex items-center gap-1 text-icon-network">
                  <FrozenMark frozen />
                  {t(`statusBoard.states.${s.text}`)}
                </li>
              ) : (
                <li key={s.text} className={cn("inline-flex items-center gap-1", TONES[s.tone ?? "secondary"])}>
                  <AlertTriangleIcon className="h-3.5 w-3.5" />
                  {t(`statusBoard.states.${s.text}`)}
                </li>
              ),
            )}
          </ul>
        )}
      </div>

      {/* What the symbols below mean, on demand: someone new to OpenSVC reads them here. */}
      {/* A hint as the intros of the pages: closed, back with them from the user page. */}
      {hintsEnabled && !hiddenHints.includes(SYMBOLS_HINT) && (
        <div className="relative">
          <details className="rounded-(--radius-panel) border border-line bg-surface-raised px-3 py-2" data-legend-toggle="">
            <summary className="cursor-pointer pr-8 text-ink-muted hover:text-ink">{t("legend.toggle")}</summary>
            <div className="mt-2">
              <SymbolLegend />
            </div>
          </details>
          <span className="absolute top-1.5 right-2">
            <IconButton label={t("legend.hide")} size="sm" onClick={() => hideIntro(SYMBOLS_HINT)}>
              <CloseIcon className="h-3.5 w-3.5" />
            </IconButton>
          </span>
        </div>
      )}

      {toolbar}

      {/* A light border, a very light line between the rows; the headings on a grey band, as the group lines of the lists. */}
      {/* Its columns are its nodes: the board keeps them, never cards; no room for them, a block each. */}
      {layout.nodeColumns ? (
      <Table
        ref={frame}
        aria-label={t("statusBoard.caption", { path: board.path })}
        className="bg-transparent"
        cards={false}
      >
        <thead>
          {/* The heading of the instances on the line of the nodes, a line under them. */}
          <HeaderRow className="border-b border-line bg-surface-sunken">
            <HeaderCell className="font-normal text-ink">{t("statusBoard.rows.instances", { count: instances })}</HeaderCell>
            {layout.sideColumns && (
              <>
                <HeaderCell>{t("common.type")}</HeaderCell>
                <HeaderCell>{t("statusBoard.description")}</HeaderCell>
              </>
            )}
            {board.nodes.map((n, j) => {
              const pick = selection !== undefined;
              const picked = nodeSelected(n.name);
              const look = selectedLook(0, j + FIRST_NODE);
              return (
                <HeaderCell
                  key={n.name}
                  style={look.style}
                  className={cn(j === 0 && NODES_START, pick && "group", look.className, picked && "text-ink")}
                >
                  <span className="flex w-full items-center gap-1">
                      {pick && (
                        <SelectBox
                          checked={picked}
                          label={t("statusBoard.selectInstance", { node: n.name })}
                          onToggle={() => selection.toggleNode(n.name)}
                        />
                      )}
                      <span className="font-semibold text-ink">{linkNode ? linkNode(n.name) : n.name}</span>
                      {n.frozen && <FrozenMark frozen />}
                  </span>
                </HeaderCell>
              );
            })}
          </HeaderRow>
        </thead>
        <tbody>
          {shown.map((r, i) => {
            if (r.kind === "resources")
              return (
                // A line under the heading of the resources, as under the one of the instances.
                <tr key={i} className="border-b border-line bg-surface-sunken">
                  <th scope="rowgroup" colSpan={layout.sideColumns ? FIRST_NODE : 1} className="h-[1.875rem] px-2 pt-3 text-left font-normal text-ink">
                    {t("statusBoard.rows.resources", { count: resources })}
                  </th>
                  {/* The line before the nodes runs through the heading too. */}
                  <td colSpan={columns - FIRST_NODE} className={NODES_START} />
                </tr>
              );
            // The instance row tells the state of each instance: under the heading of the instances.
            const name =
              r.kind === "resource" || r.kind === "subset"
                ? r.name
                : r.kind === "label"
                  ? ""
                  : r.kind === "instance"
                    ? t("statusBoard.rows.state")
                    : t(`statusBoard.rows.${r.kind}`);
            // A row named by a word of OpenSVC: its definition on demand.
            const rowTerm = ROW_TERMS[r.kind];
            const shownName = rowTerm ? <Term term={rowTerm}>{name}</Term> : name;
            const pickRow = selection !== undefined && r.kind === "resource";
            const nodesOfRow = pickRow ? rowNodes(board, r) : [];
            const rowState = rowSelectState(r);
            // The place of the row in the grid of the selection, the header row first.
            const v = i + 1;
            const nameLook = selectedLook(v, 0);
            return (
              <Row key={i} className="border-line/40">
                <th
                  scope="row"
                  className={cn(
                    "px-2 py-1 text-left whitespace-nowrap",
                    // The state, under its heading, sits with the monitor and the others.
                    INDENT[Math.min(r.kind === "instance" ? 1 : r.indent, INDENT.length - 1)],
                    r.kind === "resource" ? "font-medium" : r.kind === "subset" ? "font-normal text-ink-muted italic" : "font-normal",
                    (r.kind === "monitor" || r.kind === "expect" || r.kind === "provisioned" || r.kind === "orchestration") && "text-ink-muted",
                    pickRow && "group",
                    nameLook.className,
                  )}
                  style={nameLook.style}
                >
                  <span className="flex w-full items-center gap-1">
                    {pickRow && (
                      <SelectBox
                        checked={rowState === "all"}
                        indeterminate={rowState === "some"}
                        label={t("statusBoard.selectResource", { rid: r.name })}
                        onToggle={() => selection.toggleRow(r.name)}
                      />
                    )}
                    <span className="flex w-full">
                      <span className="flex w-full items-center gap-1">
                        {r.kind === "resource" ? (
                          <ResourceNotes notes={r.rowNotes}>{linkResource ? linkResource(r.name) : shownName}</ResourceNotes>
                        ) : (
                          shownName
                        )}
                      </span>
                    </span>
                  </span>
                  {/* No room for their columns, the type and the description under the name. */}
                  {!layout.sideColumns && <SideText row={r} className="mt-0.5 max-w-64 whitespace-normal" />}
                </th>
                {layout.sideColumns && (
                  <>
                    <Cell className="text-ink-muted">{r.typ}</Cell>
                    <Cell className={cn("break-all", r.kind === "label" && "text-ink-muted")}>
                      <RowDescription row={r} />
                    </Cell>
                  </>
                )}
                {r.cells.map((c, j) => {
                  const node = board.nodes[j]?.name ?? "";
                  // A resource cell selects the resource on its node, by its checkbox.
                  const pickCell = pickRow && nodesOfRow.includes(node);
                  const picked = pickCell && selection.isCell(r.name, node);
                  // A resource cell opens the resource on its node, by its value.
                  const openable = openCell !== undefined && r.kind === "resource" && rowNodes(board, r).includes(node);
                  const look = selectedLook(v, j + FIRST_NODE);
                  return (
                    <Cell
                      style={look.style}
                      key={j}
                      className={cn(j === 0 && NODES_START, pickCell && "group", look.className)}
                    >
                      <span className="flex w-full">
                        <span className="flex w-full items-center gap-1">
                          {pickCell ? (
                            <SelectBox
                              checked={picked}
                              label={t("statusBoard.selectCell", { rid: r.name, node })}
                              onToggle={() => selection.toggleCell(r.name, node)}
                            />
                          ) : (
                            // The room of a checkbox: the values of a column in line, those of the
                            // instances under the resources' checkboxes.
                            selection !== undefined && <span aria-hidden="true" data-checkbox-room className="h-3.5 w-3.5 shrink-0" />
                          )}
                          {openable ? (
                            // The value opens the resource on this instance; the checkbox, apart, selects it.
                            // A badge, as the names that open their records: seen as such before a hover.
                            <button
                              type="button"
                              aria-label={t("statusBoard.openCell", { rid: r.name, node })}
                              onClick={() => openCell?.(r.name, node)}
                              className="inline-flex min-h-5 max-w-full min-w-9 cursor-pointer items-center justify-center gap-1 rounded-full border border-line bg-surface px-1.5 py-px text-left hover:border-line-strong hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-(--focus-ring)"
                            >
                              <Pieces text={c} kind={r.kind} inert notes={r.cellNotes[j] ?? []} />
                            </button>
                          ) : (
                            <Pieces text={c} kind={r.kind} notes={r.cellNotes[j] ?? []} />
                          )}
                        </span>
                      </span>
                    </Cell>
                  );
                })}
              </Row>
            );
          })}
        </tbody>
      </Table>
      ) : (
        <NodeBlocks
          board={board}
          selection={selection}
          linkNode={linkNode}
          linkResource={linkResource}
          openCell={openCell}
        />
      )}

      {board.notes.length > 0 && (
        <section aria-labelledby="status-notes" className="space-y-1">
          <h3 id="status-notes" className="px-2 font-semibold">
            {t("statusBoard.notes", { count: board.notes.length })}
          </h3>
          <ul className="space-y-2">
            {board.notes.map((g, i) => {
              const { ink, Icon } = LEVELS[g.level];
              return (
                <li key={i} className="flex gap-2 px-2">
                  <span className={cn("mt-0.5 shrink-0", ink)}>
                    <Icon className="h-4 w-4" />
                    <span className="sr-only">{t(`statusBoard.levels.${g.level}`)}</span>
                  </span>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    {g.heads.map((h, j) => (
                      <p key={j} className="flex flex-wrap items-baseline gap-x-2">
                        {h.marker !== "" && h.marker !== "·" && (
                          <sup className={cn("text-[0.75rem] font-medium", ink)}>{h.marker}</sup>
                        )}
                        <span className="font-medium">{h.subject}</span>
                        {h.nodes !== "" && (
                          <span className="text-ink-muted">
                            {h.nodes === "all" ? t("statusBoard.allNodes") : h.nodes}
                          </span>
                        )}
                      </p>
                    ))}
                    <p className={cn(g.level === "info" ? "text-ink-muted" : "text-ink")}>{g.text}</p>
                    {g.fix !== undefined && noteFix !== undefined && noteFix(g.fix)}
                  </div>
                </li>
              );
            })}
          </ul>
          {board.moreInfos > 0 && (
            <p className="px-2 text-ink-muted">
              {t("statusBoard.moreInfos", { count: board.moreInfos })}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
