import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { ObjectIcon } from "../ui/components/ObjectIcon";
import { StatusBadge } from "../ui/components/StatusBadge";
import { StatusMark } from "../ui/components/StatusMark";
import { statusBadge } from "../ui/components/status";
import { CloseIcon, HistoryIcon, SearchIcon, TrashIcon } from "../ui/icons";
import { formatRelativeInstant } from "../ui/lib/format";
import { typing } from "../ui/lib/shortcuts";
import { usePanelSearch, usePeek } from "./panel-search";
import { useHistoryGrouping, usePanelHistory, type HistoryEntry } from "./panel-history";
import { serialiseStep } from "./peek";
import { GroupHeading, GroupingSwitch } from "./RecentRecords";
import { KIND_ICON, SEARCH_KINDS, hitIcon, search, type SearchEntry, type SearchIndex, type SearchKind } from "./search";

type Scope = SearchKind | "all";

/** The parts of a text that match the query, marked; case-insensitive. */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLocaleLowerCase();
  if (q === "") return <>{text}</>;
  const lower = text.toLocaleLowerCase();
  const parts: ReactNode[] = [];
  let from = 0;
  for (let at = lower.indexOf(q); at !== -1; at = lower.indexOf(q, from)) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(
      <mark key={at} className="bg-transparent font-semibold text-ink underline decoration-accent underline-offset-2">
        {text.slice(at, at + q.length)}
      </mark>,
    );
    from = at + q.length;
  }
  if (from < text.length) parts.push(text.slice(from));
  return <>{parts}</>;
}

function isMac(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
}

/**
 * Global search of the cluster, from the top bar, as oc3 searches the collector.
 *
 * A compact field in the bar opens a command palette over the current view:
 * Ctrl+K (⌘K on a Mac) or "/" open it from anywhere. The results come grouped by
 * kind (`search.ts`), each with its icon, what tells homonyms apart and its
 * status. Choosing one opens its record in the panel over the current view, as a
 * badge does (`usePeek`), a node included. Up and Down move through the results,
 * Enter opens, Escape closes; a
 * scope narrows the search to one kind and shows more of it.
 *
 * Nothing typed yet, it proposes the records shown recently in this browser tab
 * (`usePanelHistory`), grouped by how long ago or by kind, the record on display
 * said so; picked as a result, one comes back in front. Delete, or the cross of
 * an entry, removes it; the bin clears them all.
 *
 * `loadIndex` reads what is searched, each time the palette opens.
 */
export function GlobalSearch({ loadIndex }: { loadIndex: () => Promise<SearchIndex> }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const shortcut = isMac() ? "⌘K" : "Ctrl K";

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      const combo = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k";
      if (combo || (event.key === "/" && !typing(event.target) && !event.altKey)) {
        // Not over another modal dialog: the help, a confirmation.
        if (!combo && document.querySelector('[aria-modal="true"]') !== null) return;
        event.preventDefault();
        setOpen(true);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="dialog"
        aria-keyshortcuts="Control+K Meta+K /"
        onClick={() => {
          setOpen(true);
        }}
        className="flex h-7 w-64 items-center gap-2 rounded-(--radius-control) border border-line px-2 text-ink-muted hover:bg-surface-sunken hover:text-ink max-md:w-7 max-md:justify-center max-md:px-0"
      >
        <SearchIcon className="h-4 w-4 shrink-0" />
        <span className="truncate max-md:sr-only">{t("search.title")}</span>
        <kbd className="ml-auto shrink-0 rounded-sm border border-line px-1 text-data whitespace-nowrap max-md:hidden">
          {shortcut}
        </kbd>
      </button>
      {/* At the level of the page: the top bar has colours of its own. */}
      {open &&
        createPortal(
          <SearchPalette
            loadIndex={loadIndex}
            onClose={(restoreFocus) => {
              setOpen(false);
              // Closed without choosing: back to where the user was. A chosen
              // result opens a panel, which takes the focus itself.
              if (restoreFocus) window.setTimeout(() => trigger.current?.focus(), 0);
            }}
          />,
          document.body,
        )}
    </>
  );
}

function SearchPalette({
  loadIndex,
  onClose,
}: {
  loadIndex: () => Promise<SearchIndex>;
  onClose: (restoreFocus: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const peek = usePeek();
  const grouping = useHistoryGrouping();
  const { peek: shown } = usePanelSearch();
  const recent = usePanelHistory(shown === null ? "" : serialiseStep(shown), grouping.value);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const [active, setActive] = useState(0);
  const [index, setIndex] = useState<SearchIndex | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    let live = true;
    loadIndex().then(
      (loaded) => {
        if (live) setIndex(loaded);
      },
      (error: unknown) => {
        if (live) setFailure(error instanceof Error ? error.message : String(error));
      },
    );
    return () => {
      live = false;
    };
  }, [loadIndex]);

  const trimmed = query.trim();
  const groups = useMemo(() => (index === null ? [] : search(index, trimmed, scope)), [index, trimmed, scope]);
  // Nothing typed: the records shown recently, of the kind in scope.
  const proposing = trimmed === "";
  const recentGroups = recent.groups
    .map((group) => ({ ...group, entries: group.entries.filter((entry) => scope === "all" || entry.step.kind === scope) }))
    .filter((group) => group.entries.length > 0);
  const options: Option[] = proposing
    ? recentGroups.flatMap((group) => group.entries.map((entry) => ({ type: "recent" as const, key: entry.key, entry })))
    : groups.flatMap((group) => group.hits.map((hit) => ({ type: "hit" as const, key: `${hit.kind}:${hit.id}`, hit })));
  const current = options[Math.min(active, options.length - 1)];
  const optionId = (option: Option) => `${id}-${option.type}-${option.key}`;

  // A new result list starts on its first result.
  useEffect(() => {
    setActive(0);
  }, [trimmed, scope]);

  const currentId = current === undefined ? undefined : optionId(current);
  useEffect(() => {
    if (currentId === undefined) return;
    document.getElementById(currentId)?.scrollIntoView?.({ block: "nearest" });
  }, [currentId]);

  function choose(option: Option) {
    onClose(false);
    if (option.type === "hit") peek(option.hit.kind, option.hit.id);
    else peek(option.entry.step.kind, option.entry.step.id);
  }

  /**
   * The option at `at` in the list: chosen by a click, made the active one by the
   * pointer. Told active by its place: the options are built anew at each render.
   */
  const optionProps = (option: Option, at: number) => {
    const selected = at === Math.min(active, options.length - 1);
    return {
      id: optionId(option),
      role: "option",
      "aria-selected": selected,
      onPointerMove: () => {
        if (!selected) setActive(at);
      },
      onClick: () => {
        choose(option);
      },
      className: `group mx-1 flex cursor-pointer items-center gap-3 rounded-(--radius-control) px-2 py-1.5 ${
        selected ? "bg-accent-soft" : ""
      }`,
    };
  };

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        // The side panel listens for Escape too: it stays open under the search.
        event.stopPropagation();
        onClose(true);
        return;
      case "ArrowDown":
      case "ArrowUp": {
        if (options.length === 0) return;
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActive((i) => (Math.min(i, options.length - 1) + step + options.length) % options.length);
        return;
      }
      case "Delete":
        // A record shown recently, forgotten; the next one becomes the active one.
        if (event.target !== input.current || current?.type !== "recent") return;
        event.preventDefault();
        recent.remove(current.entry);
        return;
      case "Enter":
        if (event.target !== input.current || current === undefined) return;
        event.preventDefault();
        choose(current);
        return;
      case "Tab": {
        // The palette is modal: the focus stays inside it.
        const focusable = dialog.current?.querySelectorAll<HTMLElement>("input, button:not([disabled]):not([tabindex='-1'])");
        if (focusable === undefined || focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
        return;
      }
    }
  }

  const scopes: Scope[] = ["all", ...SEARCH_KINDS];

  return (
    <div
      className="fixed inset-0 z-[1300] flex items-start justify-center bg-ink/20 px-4 pt-[10vh]"
      onPointerDown={(event) => {
        // A click on the backdrop, not inside the palette, closes it.
        if (event.target === event.currentTarget) onClose(true);
      }}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={t("search.title")}
        onKeyDown={onKeyDown}
        className="flex max-h-[75vh] w-full max-w-2xl flex-col overflow-hidden rounded-(--radius-panel) border border-line bg-surface-raised text-ink shadow-xl"
      >
        <div className="flex items-center gap-2 border-b border-line px-3">
          <SearchIcon className="h-5 w-5 shrink-0 text-ink-muted" />
          <input
            ref={input}
            // Not "search": its own clear button would double the close button.
            type="text"
            role="combobox"
            aria-expanded={options.length > 0}
            aria-controls={`${id}-results`}
            aria-autocomplete="list"
            aria-activedescendant={currentId}
            aria-label={t("search.title")}
            placeholder={t("search.placeholder")}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            className="h-12 min-w-0 flex-1 bg-transparent text-title outline-none placeholder:text-ink-muted"
          />
          {index === null && failure === null && (
            <span role="status" className="shrink-0 text-ink-muted">
              {t("search.searching")}
            </span>
          )}
          <button
            type="button"
            onClick={() => {
              onClose(true);
            }}
            title={t("search.close")}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-(--radius-control) border border-line text-ink-muted hover:bg-surface-sunken hover:text-ink"
          >
            <CloseIcon />
            <span className="sr-only">{t("search.close")}</span>
          </button>
        </div>

        <div role="group" aria-label={t("search.scopes")} className="flex flex-wrap gap-1 border-b border-line px-3 py-2">
          {scopes.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={scope === value}
              onClick={() => {
                setScope(value);
                input.current?.focus();
              }}
              className={`flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-data ${
                scope === value
                  ? "border-accent bg-accent-soft text-ink"
                  : "border-line text-ink-muted hover:border-line-strong hover:text-ink"
              }`}
            >
              {value !== "all" && <ObjectIcon kind={KIND_ICON[value]} className="h-3.5 w-3.5" />}
              {value === "all" ? t("search.all") : t(`search.kinds.${value}`)}
            </button>
          ))}
        </div>

        <div id={`${id}-results`} role="listbox" aria-label={t("search.results")} className="min-h-0 flex-1 overflow-y-auto py-1">
          {failure !== null ? (
            <p role="alert" className="px-3 py-6 text-center text-state-down">
              ■ {failure}
            </p>
          ) : proposing ? (
            recent.entries.length === 0 ? (
              <p className="px-3 py-6 text-center text-ink-muted">{t("search.hint")}</p>
            ) : (
              <>
                <div className="flex items-center gap-2 px-3 py-1 text-ink-muted">
                  <HistoryIcon className="h-4 w-4 shrink-0" />
                  <span id={`${id}-recent`} className="min-w-0 flex-1 truncate">
                    {t("search.recent.title")}
                  </span>
                  <GroupingSwitch value={grouping.value} onChange={grouping.set} />
                  <button
                    type="button"
                    title={t("panelHistory.clear")}
                    onClick={() => {
                      recent.clear();
                      input.current?.focus();
                    }}
                    // It deletes the records: the down fill.
                    className="flex h-6 items-center gap-1 rounded-(--radius-control) bg-state-down px-1.5 text-data font-medium text-surface-raised hover:brightness-110"
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                    {t("search.recent.clear")}
                  </button>
                </div>
                {recentGroups.length === 0 && (
                  <p className="px-3 py-6 text-center text-ink-muted">{t("search.recent.noneOfKind")}</p>
                )}
                {recentGroups.map((group) => {
                  const headingId = `${id}-recent-${group.key}`;
                  return (
                    <div key={group.key} role="group" aria-labelledby={headingId} className="py-1">
                      <div className="flex items-center gap-2 px-3 py-1 text-data text-ink-muted">
                        <GroupHeading group={group} id={headingId} />
                      </div>
                      {group.entries.map((entry) => {
                        const option: Option = { type: "recent", key: entry.key, entry };
                        const at = options.findIndex((o) => o.key === entry.key);
                        return (
                          <RecentRow
                            key={entry.key}
                            entry={entry}
                            kindShown={group.by === "time"}
                            when={formatRelativeInstant(entry.at, i18n.language)}
                            optionProps={optionProps(option, at)}
                            onRemove={() => {
                              recent.remove(entry);
                              input.current?.focus();
                            }}
                          />
                        );
                      })}
                    </div>
                  );
                })}
              </>
            )
          ) : index === null ? (
            <p className="px-3 py-6 text-center text-ink-muted">{t("search.searching")}</p>
          ) : groups.length === 0 ? (
            <p className="px-3 py-6 text-center text-ink-muted">{t("search.none", { query: trimmed })}</p>
          ) : (
            groups.map((group) => {
              const headingId = `${id}-${group.kind}`;
              return (
                <div key={group.kind} role="group" aria-labelledby={headingId} className="py-1">
                  <div className="flex items-center gap-2 px-3 py-1 text-data text-ink-muted">
                    <ObjectIcon kind={KIND_ICON[group.kind]} className="h-3.5 w-3.5" />
                    <span id={headingId} className="font-medium tracking-wide uppercase">
                      {t(`search.kinds.${group.kind}`)}
                    </span>
                    {group.more && scope === "all" && (
                      <button
                        type="button"
                        onClick={() => {
                          setScope(group.kind);
                          input.current?.focus();
                        }}
                        className="ml-auto text-accent hover:underline"
                      >
                        {t("search.more")}
                      </button>
                    )}
                  </div>
                  {group.error && <p className="px-3 py-1 text-state-down">■ {t("search.kindError")}</p>}
                  {group.hits.map((hit) => {
                    const option: Option = { type: "hit", key: `${hit.kind}:${hit.id}`, hit };
                    const at = options.findIndex((o) => o.type === "hit" && o.key === option.key);
                    return (
                      <div key={option.key} {...optionProps(option, at)}>
                        <ObjectIcon kind={hitIcon(hit)} className="h-4 w-4 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">
                            <Highlight text={hit.label} query={trimmed} />
                          </div>
                          {hit.context.length > 0 && (
                            <div className="truncate text-data text-ink-muted">
                              <Highlight text={hit.context.join(" · ")} query={trimmed} />
                            </div>
                          )}
                        </div>
                        {hit.status !== undefined &&
                          (hit.status === "n/a" ? (
                            <StatusMark state="na" label="n/a" />
                          ) : (
                            <StatusBadge {...statusBadge(hit.status)} className="w-auto" />
                          ))}
                      </div>
                    );
                  })}
                  {group.more && scope !== "all" && <p className="px-3 py-1 text-data text-ink-muted">{t("search.refine")}</p>}
                </div>
              );
            })
          )}
        </div>

        <div className="flex flex-wrap gap-4 border-t border-line px-3 py-1.5 text-data text-ink-muted">
          <span>
            <kbd className="rounded-sm border border-line px-1">↑</kbd> <kbd className="rounded-sm border border-line px-1">↓</kbd>{" "}
            {t("search.keys.move")}
          </span>
          <span>
            <kbd className="rounded-sm border border-line px-1">↵</kbd> {t("search.keys.open")}
          </span>
          {proposing && recent.entries.length > 0 && (
            <span>
              <kbd className="rounded-sm border border-line px-1">Del</kbd> {t("search.keys.remove")}
            </span>
          )}
          <span>
            <kbd className="rounded-sm border border-line px-1">Esc</kbd> {t("search.keys.close")}
          </span>
        </div>
      </div>
    </div>
  );
}

/** An option of the palette: a result of the search, or a record shown recently. */
type Option =
  | { type: "hit"; key: string; hit: SearchEntry }
  | { type: "recent"; key: string; entry: HistoryEntry };

/**
 * A record shown recently, as an option of the palette: its icon and name, under it
 * its kind when grouped by time, on the right how long ago it was shown and, for the
 * record on display, that it is. The cross, shown with the pointer over the entry or
 * on the active one, removes it; Delete does so from the keyboard.
 */
function RecentRow({
  entry,
  kindShown,
  when,
  optionProps,
  onRemove,
}: {
  entry: HistoryEntry;
  kindShown: boolean;
  when: string;
  optionProps: Record<string, unknown>;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div {...optionProps} aria-current={entry.current ? "true" : undefined}>
      <ObjectIcon kind={entry.icon} className="h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{entry.label}</div>
        {kindShown && <div className="truncate text-data text-ink-muted">{t(`search.recent.types.${entry.type}`)}</div>}
      </div>
      {entry.current && (
        <span className="shrink-0 rounded-full border border-accent px-1.5 text-data text-ink">{t("search.recent.current")}</span>
      )}
      <span className="shrink-0 text-data text-ink-muted tabular-nums">{when}</span>
      <button
        type="button"
        // The keyboard removes it with Delete: the cross is for the pointer.
        tabIndex={-1}
        title={t("panelHistory.remove", { name: entry.label })}
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
        className="shrink-0 rounded-full p-1 text-ink-muted opacity-0 group-hover:opacity-100 group-aria-selected:opacity-100 hover:bg-surface-sunken hover:text-ink"
      >
        <CloseIcon className="h-3 w-3" />
        <span className="sr-only">{t("panelHistory.remove", { name: entry.label })}</span>
      </button>
    </div>
  );
}
