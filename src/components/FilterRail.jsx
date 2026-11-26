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
 * (`counts`, optional), `onToggle(value)` and `onClear()`. Or, a filter of several
 * fields, its `sections` instead, each one of them ({key, label, options, selected,
 * counts, onToggle}, and, reversible, `reversed` and `onReverse()`), `selected` then all
 * of their values chosen, `onClear` clearing them all.
 *
 * A field typed in (`fields`), beside the words searched: its `label`, `value`,
 * `onChange`, `placeholder`, `invalid` and the `hint` saying what it takes.
 */

/**
 * A facet worth a popover of the toolbar: a choice to make, two values or more; one
 * value chosen shown anyway, for that filter not to act unseen. In the rail, a facet
 * of no value left out. A facet of sections, one of them so.
 */
const sectionHasChoice = ({options, selected}) => options.length > 1 || selected.length > 0;
const sectionHasValues = ({options, selected}) => options.length > 0 || selected.length > 0;
const hasChoice = (facet) => (facet.sections ? facet.sections.some(sectionHasChoice) : sectionHasChoice(facet));
const hasValues = (facet) => (facet.sections ? facet.sections.some(sectionHasChoice) : sectionHasValues(facet));

/** The sections of a facet shown: those with a choice to make; a facet of none, itself. */
const shownSections = (facet) => (facet.sections ? facet.sections.filter(sectionHasChoice) : [facet]);

const RAIL_TITLE = "text-[0.7rem] font-semibold tracking-wide text-ink-muted uppercase";

/**
 * The reversal of a section, once a value is chosen in it: pressed, the section keeps
 * the items of none of its values chosen.
 */
function ReverseToggle({label, selected, reversed, onReverse}) {
    const {t} = useTranslation();
    if (!onReverse || selected.length === 0) return null;
    return (
        <button
            type="button"
            aria-pressed={!!reversed}
            onClick={onReverse}
            aria-label={t("objects.filters.reverseOf", {field: label})}
            title={t("objects.filters.reverseHint")}
            className="ml-auto h-4 rounded-(--radius-control) border border-line px-1.5 text-data leading-none text-ink-muted hover:border-line-strong hover:text-ink aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:text-ink"
        >
            {t("objects.filters.reverse")}
        </button>
    );
}

/** The text of a value chosen in a section reversed: struck, the items of it left out. */
const struck = (reversed, pressed) => (reversed && pressed ? "line-through" : "");

/** Narrower, the filters folded under a button: the toolbar's room to the table. */
const FOLDED_QUERY = "(max-width:899.95px)";
/** Wide, the filters shown at first, folded or not. */
const WIDE_QUERY = "(min-width:1200px)";

/**
 * A facet of the rail: its title, a clear when values are chosen, then its values,
 * each a toggle with its mark and how many objects it would keep; a value keeping
 * none, unchosen, muted. Its title and those of its sections of a height of their
 * own: a clear or a reversal shown, nothing under them moves.
 */
function Facet(facet) {
    const {label, selected, onClear} = facet;
    const {t} = useTranslation();
    const id = useId();
    return (
        <section aria-labelledby={id} data-facet={label} className="space-y-1">
            <div className="flex h-5 items-center gap-2">
                <h2 id={id} className={RAIL_TITLE}>{label}</h2>
                {selected.length > 0 && (
                    <button
                        type="button"
                        onClick={onClear}
                        aria-label={t("objects.filters.clearOf", {filter: label})}
                        className="ml-auto text-data leading-none text-ink-muted hover:text-ink"
                    >
                        {t("objects.filters.clear")}
                    </button>
                )}
            </div>
            {facet.sections
                // A field a section, a rule between each.
                ? <div className="divide-y divide-line">
                    {shownSections(facet).map((section) => <RailSection key={section.key} {...section}/>)}
                </div>
                : <RailValues {...facet}/>}
        </section>
    );
}

/** A section of a facet of the rail, a field of the filter: its name and its reversal, then its values. */
function RailSection({label, ...values}) {
    const id = useId();
    return (
        <div role="group" aria-labelledby={id} data-facet-section={label} className="space-y-0.5 py-1.5 first:pt-0.5 last:pb-0">
            <div className="flex h-5 items-center gap-2 px-2">
                <h3 id={id} className="text-data text-ink-muted">{label}</h3>
                <ReverseToggle label={label} {...values}/>
            </div>
            <RailValues {...values}/>
        </div>
    );
}

/** The values of a facet of the rail, each a toggle with its mark and how many it keeps. */
function RailValues({options, selected, counts, onToggle, reversed}) {
    return (
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
                            <span className={`min-w-0 flex-1 truncate ${struck(reversed, pressed)}`}>{option.text}</span>
                            <span className="text-data text-ink-muted tabular-nums">{n}</span>
                        </button>
                    </li>
                );
            })}
        </ul>
    );
}

/** A field typed in, in the rail: its title over it, red while what is typed is not one, what it takes said. */
function RailField({label, value, onChange, placeholder, invalid, hint}) {
    const id = useId();
    // What it takes under the field, out of its label: its name alone names it.
    return (
        <div className="flex flex-col gap-1">
            <label className="flex flex-col gap-1">
                <span className={RAIL_TITLE}>{label}</span>
                <Input className={`h-7 w-full ${invalid ? "border-state-down" : ""}`} value={value} onChange={onChange}
                       placeholder={placeholder} aria-invalid={invalid || undefined} aria-describedby={hint ? id : undefined}/>
            </label>
            {hint && <span id={id} className={`text-data ${invalid ? "text-state-down" : "text-ink-muted"}`}>{hint}</span>}
        </div>
    );
}

/**
 * The filters of a list beside its table, on a screen wide enough: `head` first, what
 * stood over the table (its actions, its pager), its rows given to the table; then the
 * words searched, if the list is, and the fields typed in, then each filter a facet, its values counted.
 * The same filters as the popovers of the toolbar on a narrower screen (FilterToolbar).
 */
export function FilterRail({label, head, search, onSearch, searchLabel, facets, fields = []}) {
    return (
        <aside aria-label={label} className="flex w-64 shrink-0 flex-col gap-4 overflow-auto pt-0.5">
            {head && <div data-rail-head="" className="flex flex-col gap-3 border-b border-line pb-4">{head}</div>}
            {/* The words searched, on a list searched by words. */}
            {onSearch && (
                <label className="flex flex-col gap-1">
                    <span className={RAIL_TITLE}>{searchLabel}</span>
                    <span className="relative flex items-center">
                        <SearchIcon className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-ink-muted"/>
                        <Input type="search" className="h-7 w-full pl-7" value={search} onChange={onSearch}/>
                    </span>
                </label>
            )}
            {fields.map((field) => <RailField key={field.label} {...field}/>)}
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
export function FilterPopover(facet) {
    const {label, selected, onClear} = facet;
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

    // What it keeps: the values chosen; of a filter of several fields, each after its field, those reversed said not.
    const textsOf = ({options, selected: chosen}) => chosen.map((value) => options.find((option) => option.value === value)?.text ?? value);
    const sectionText = (section) => {
        const values = textsOf(section).join(", ");
        return `${section.label}: ${section.reversed ? t("objects.filters.notValues", {values}) : values}`;
    };
    const summary = selected.length === 0 ? t("common.all") : facet.sections
        ? facet.sections.filter((section) => section.selected.length > 0).map(sectionText).join(" · ")
        : textsOf(facet).join(", ");

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
                // A filter of several fields, taller: its sections in view, not scrolled one by one.
                className={`absolute top-full left-0 z-30 mt-1 flex ${facet.sections ? "max-h-[70vh]" : "max-h-72"} min-w-44 flex-col gap-1 overflow-auto rounded-(--radius-panel) border border-line bg-surface-raised p-2 shadow-lg`}
            >
                {/* The clear on a line of its own, there before a value is chosen: the values stay where they are. */}
                {onClear && (
                    <span className="flex h-5 shrink-0 items-center justify-end">
                        {selected.length > 0 && (
                            <button
                                type="button"
                                onClick={onClear}
                                aria-label={t("objects.filters.clearOf", {filter: label})}
                                className="text-data leading-none text-ink-muted hover:text-ink"
                            >
                                {t("objects.filters.clear")}
                            </button>
                        )}
                    </span>
                )}
                {facet.sections
                    ? shownSections(facet).map((section) => (
                        // A field of the filter: its name over its values, a group of its own.
                        <div key={section.key} role="group" aria-label={section.label} data-filter-section={section.label}
                             className="flex flex-col gap-1 border-t border-line pt-1 first-of-type:border-t-0 first-of-type:pt-0">
                            <span className="flex h-5 items-center gap-2">
                                <span aria-hidden="true" className="text-data text-ink-muted">{section.label}</span>
                                <ReverseToggle {...section}/>
                            </span>
                            <PopoverValues {...section}/>
                        </div>
                    ))
                    : <PopoverValues {...facet}/>}
            </div>
        </details>
    );
}

/** The values of a popover, a checkbox each, its mark and, given `counts`, how many it keeps. */
function PopoverValues({options, selected, counts, onToggle, reversed}) {
    const {t} = useTranslation();
    if (options.length === 0) return <span className="text-ink-muted">{t("common.none")}</span>;
    return options.map((option) => (
        <span key={option.value} className="flex items-center gap-3">
            <Checkbox
                checked={selected.includes(option.value)}
                onChange={() => onToggle(option.value)}
                label={
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                        {option.mark && <span aria-hidden="true" className="inline-flex">{option.mark}</span>}
                        <span className={struck(reversed, selected.includes(option.value))}>{option.text}</span>
                    </span>
                }
            />
            {counts && <span aria-hidden="true" className="ml-auto text-data text-ink-muted tabular-nums">{counts[option.value] ?? 0}</span>}
        </span>
    ));
}

/** A field typed in, in the toolbar: its label, then the field, red while what is typed is not one, what it takes on hover. */
export function TypedField({label, value, onChange, placeholder, invalid, hint}) {
    return (
        <label className="flex items-center gap-1 text-ink-muted">
            {label}
            <Input className={`h-7 w-24 ${invalid ? "border-state-down" : ""}`} value={value} onChange={onChange}
                   placeholder={placeholder} title={hint} aria-invalid={invalid || undefined}/>
        </label>
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
 * The button folding filters, said filtering while any is on: in the accent, how many
 * on beside its word and in its name. Folded, the filters on are seen nowhere else,
 * the list looking whole.
 */
export const filtersOnClass = (active) => (active > 0 ? "border-accent bg-accent-soft" : undefined);

/** The name of a button folding filters: show or hide, then how many are on. */
export const filtersButtonLabel = (t, open, active) => [
    open ? t("objects.filters.hide") : t("objects.filters.show"),
    active > 0 ? t("objects.filters.active", {count: active}) : null,
].filter(Boolean).join(" · ");

/**
 * The filters of a list over its table, narrower than the rail: each facet a popover
 * (FilterPopover), then the words searched and the fields typed in, then `children`, what else filters (a
 * checkbox, a clear of them all), `active` how many of those are on. On a phone,
 * folded under a Filters button saying how many filters are on.
 */
export function FilterToolbar({facets, search, onSearch, searchLabel, fields = [], children, compactAction, active: others = 0}) {
    const {t} = useTranslation();
    const id = useId();
    const folded = useMediaQuery(FOLDED_QUERY);
    const wide = useMediaQuery(WIDE_QUERY);
    // Folded, closed at first; open on a wide screen, as the lists had it.
    const [open, setOpen] = useState(() => wide || !folded);
    const active = facets.filter((facet) => facet.selected.length > 0).length
        + (onSearch && search?.trim() ? 1 : 0)
        + fields.filter((field) => field.value?.trim()).length
        + others;
    return (
        <>
            {folded && (
                <>
                    <Button
                        size="sm"
                        icon={<FilterIcon className="h-4 w-4"/>}
                        onClick={() => setOpen((v) => !v)}
                        aria-label={filtersButtonLabel(t, open, active)}
                        aria-expanded={open}
                        aria-controls={id}
                        className={filtersOnClass(active)}
                    >
                        <span className="hidden sm:inline">{t("common.filters")}</span>
                        {active > 0 && <span aria-hidden="true" className="text-accent tabular-nums">{active}</span>}
                        <ChevronDownIcon className={open ? "h-4 w-4 rotate-180" : "h-4 w-4"}/>
                    </Button>
                    {compactAction}
                </>
            )}
            {(!folded || open) && (
                <div id={id} data-filter-toolbar="" className="flex flex-wrap items-center gap-3">
                    {facets.filter(hasChoice).map((facet) => <FilterPopover key={facet.label} {...facet}/>)}
                    {onSearch && <SearchField label={searchLabel} value={search} onChange={onSearch}/>}
                    {fields.map((field) => <TypedField key={field.label} {...field}/>)}
                    {children}
                </div>
            )}
            {!folded && compactAction}
        </>
    );
}
