import React, {useEffect, useId, useRef, useState} from "react";
import {useTranslation} from "react-i18next";
import {Button} from "../ui/components/Button";
import {Checkbox, Input} from "../ui/components/Field";
import {useMediaQuery} from "../ui/lib/media";
import {ChevronDownIcon, FilterIcon, SearchIcon} from "../ui/icons";

/*
 * The filters of a list, one look on every list: on a screen wide enough, a rail of
 * facets beside the table (FilterRail); narrower, a toolbar over it (FilterToolbar),
 * each facet a popover of the same values, counted the same, the words searched in a
 * field of the same look; on a phone, the toolbar folded under a Filters button.
 *
 * A facet, the same object for both: its `label`, its `options` ({value, text, mark}),
 * the values `selected` (none keeps every item), how many items each value keeps
 * (`counts`, optional), `onToggle(value)` and `onClear()`.
 */

/**
 * A facet worth a popover of the toolbar: a choice to make, two values or more; one
 * value chosen shown anyway, for that filter not to act unseen. In the rail, a facet
 * of no value left out.
 */
const hasChoice = ({options, selected}) => options.length > 1 || selected.length > 0;
const hasValues = ({options, selected}) => options.length > 0 || selected.length > 0;

/** Narrower, the filters folded under a button: the toolbar's room to the table. */
const FOLDED_QUERY = "(max-width:899.95px)";
/** Wide, the filters shown at first, folded or not. */
const WIDE_QUERY = "(min-width:1200px)";

/**
 * A facet of the rail: its title, a clear when values are chosen, then its values,
 * each a toggle with its mark and how many objects it would keep; a value keeping
 * none, unchosen, muted.
 */
function Facet({label, options, selected, counts, onToggle, onClear}) {
    const {t} = useTranslation();
    const id = useId();
    return (
        <section aria-labelledby={id} data-facet={label} className="space-y-1">
            <div className="flex items-center gap-2">
                <h2 id={id} className="text-[0.7rem] font-semibold tracking-wide text-ink-muted uppercase">{label}</h2>
                {selected.length > 0 && (
                    <button
                        type="button"
                        onClick={onClear}
                        aria-label={t("objects.filters.clearOf", {filter: label})}
                        className="ml-auto text-data text-ink-muted hover:text-ink"
                    >
                        {t("objects.filters.clear")}
                    </button>
                )}
            </div>
            <ul className="space-y-0.5">
                {options.map((option) => {
                    const pressed = selected.includes(option.value);
                    const n = counts?.[option.value] ?? 0;
                    return (
                        <li key={option.value}>
                            <button
                                type="button"
                                aria-pressed={pressed}
                                onClick={() => onToggle(option.value)}
                                className={`flex w-full items-center gap-1.5 rounded-(--radius-control) border border-transparent px-2 py-0.5 text-left hover:bg-surface-sunken aria-pressed:border-accent aria-pressed:bg-accent-soft ${n === 0 && !pressed ? "text-ink-muted" : ""}`}
                            >
                                {option.mark && <span aria-hidden="true" className="inline-flex">{option.mark}</span>}
                                <span className="min-w-0 flex-1 truncate">{option.text}</span>
                                <span className="text-data text-ink-muted tabular-nums">{n}</span>
                            </button>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}

/**
 * The filters of a list beside its table, on a screen wide enough: `head` first, what
 * stood over the table (its actions, its pager), its rows given to the table; then the
 * words searched, if the list is, then each filter a facet, its values counted. The same filters as the
 * popovers of the toolbar on a narrower screen (FilterToolbar).
 */
export function FilterRail({label, head, search, onSearch, searchLabel, facets}) {
    return (
        <aside aria-label={label} className="flex w-64 shrink-0 flex-col gap-4 overflow-auto pt-0.5">
            {head && <div data-rail-head="" className="flex flex-col gap-3 border-b border-line pb-4">{head}</div>}
            {/* The words searched, on a list searched by words. */}
            {onSearch && (
                <label className="flex flex-col gap-1">
                    <span className="text-[0.7rem] font-semibold tracking-wide text-ink-muted uppercase">{searchLabel}</span>
                    <span className="relative flex items-center">
                        <SearchIcon className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-ink-muted"/>
                        <Input type="search" className="h-7 w-full pl-7" value={search} onChange={onSearch}/>
                    </span>
                </label>
            )}
            {facets.filter(hasValues).map((facet) => <Facet key={facet.label} {...facet}/>)}
        </aside>
    );
}

/**
 * A facet of the toolbar: a popover of checkboxes, as oc3 does for its column picker.
 * The summary tells the facet and what it keeps; open, each value its mark and, given
 * `counts`, how many items it keeps, as in the rail; a clear when values are chosen.
 * A click outside or Escape closes it.
 */
export function FilterPopover({label, options, selected, counts, onToggle, onClear}) {
    const {t} = useTranslation();
    const ref = useRef(null);

    useEffect(() => {
        const onPointerDown = (event) => {
            const details = ref.current;
            if (details?.open && !details.contains(event.target)) details.open = false;
        };
        document.addEventListener("pointerdown", onPointerDown);
        return () => document.removeEventListener("pointerdown", onPointerDown);
    }, []);

    const onKeyDown = (event) => {
        const details = ref.current;
        if (event.key !== "Escape" || !details?.open) return;
        event.preventDefault();
        event.stopPropagation();
        details.open = false;
        details.querySelector("summary")?.focus();
    };

    const labelOf = (value) => options.find((option) => option.value === value)?.text ?? value;
    const summary = selected.length === 0 ? t("common.all") : selected.map(labelOf).join(", ");

    return (
        <details ref={ref} data-filter={label} className="relative" onKeyDown={onKeyDown}>
            <summary
                className={`flex h-7 cursor-pointer list-none items-center gap-1 rounded-(--radius-control) border bg-surface px-2 whitespace-nowrap text-ink-muted hover:border-line-strong [&::-webkit-details-marker]:hidden ${selected.length > 0 ? "border-accent" : "border-line"}`}>
                {label}
                <span className="max-w-40 truncate text-ink">{summary}</span>
                <ChevronDownIcon className="h-3.5 w-3.5"/>
            </summary>
            <div
                role="group"
                aria-label={label}
                className="absolute top-full left-0 z-30 mt-1 flex max-h-72 min-w-44 flex-col gap-1 overflow-auto rounded-(--radius-panel) border border-line bg-surface-raised p-2 shadow-lg"
            >
                {selected.length > 0 && onClear && (
                    <button
                        type="button"
                        onClick={onClear}
                        aria-label={t("objects.filters.clearOf", {filter: label})}
                        className="self-end text-data text-ink-muted hover:text-ink"
                    >
                        {t("objects.filters.clear")}
                    </button>
                )}
                {options.length === 0 && <span className="text-ink-muted">{t("common.none")}</span>}
                {options.map((option) => (
                    <span key={option.value} className="flex items-center gap-3">
                        <Checkbox
                            checked={selected.includes(option.value)}
                            onChange={() => onToggle(option.value)}
                            label={
                                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                                    {option.mark && <span aria-hidden="true" className="inline-flex">{option.mark}</span>}
                                    {option.text}
                                </span>
                            }
                        />
                        {counts && <span aria-hidden="true" className="ml-auto text-data text-ink-muted tabular-nums">{counts[option.value] ?? 0}</span>}
                    </span>
                ))}
            </div>
        </details>
    );
}

/** The words searched over a list, in the toolbar: its label, then the field. */
export function SearchField({label, value, onChange}) {
    return (
        <label className="flex items-center gap-1 text-ink-muted">
            {label}
            <span className="relative flex items-center">
                <SearchIcon className="pointer-events-none absolute left-2 h-3.5 w-3.5"/>
                <Input type="search" className="h-7 w-48 pl-7" value={value} onChange={onChange}/>
            </span>
        </label>
    );
}

/**
 * The filters of a list over its table, narrower than the rail: each facet a popover
 * (FilterPopover), then the words searched, then `children`, what else filters (a
 * checkbox, a clear of them all). On a phone, folded under a Filters button.
 */
export function FilterToolbar({facets, search, onSearch, searchLabel, children, compactAction}) {
    const {t} = useTranslation();
    const id = useId();
    const folded = useMediaQuery(FOLDED_QUERY);
    const wide = useMediaQuery(WIDE_QUERY);
    // Folded, closed at first; open on a wide screen, as the lists had it.
    const [open, setOpen] = useState(() => wide || !folded);
    return (
        <>
            {folded && (
                <>
                    <Button
                        size="sm"
                        icon={<FilterIcon className="h-4 w-4"/>}
                        onClick={() => setOpen((v) => !v)}
                        aria-label={open ? t("objects.filters.hide") : t("objects.filters.show")}
                        aria-expanded={open}
                        aria-controls={id}
                    >
                        <span className="hidden sm:inline">{t("common.filters")}</span>
                        <ChevronDownIcon className={open ? "h-4 w-4 rotate-180" : "h-4 w-4"}/>
                    </Button>
                    {compactAction}
                </>
            )}
            {(!folded || open) && (
                <div id={id} data-filter-toolbar="" className="flex flex-wrap items-center gap-3">
                    {facets.filter(hasChoice).map((facet) => <FilterPopover key={facet.label} {...facet}/>)}
                    {onSearch && <SearchField label={searchLabel} value={search} onChange={onSearch}/>}
                    {children}
                </div>
            )}
            {!folded && compactAction}
        </>
    );
}
