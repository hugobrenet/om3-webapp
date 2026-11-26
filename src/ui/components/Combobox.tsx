import { useEffect, useId, useRef, useState, type Ref } from "react";

export interface ComboboxOption {
  value: string;
  label: string;
}

/**
 * Dropdown list filtered from the keyboard, following the "combobox" pattern of the
 * ARIA Authoring Practices: a text field that filters a list of options.
 *
 * Written here rather than imported: a few dozen lines are enough for a substring
 * filter, and a native `<select>` cannot be filtered beyond the first letter.
 *
 * As long as nothing is typed, the field shows the chosen option and the list shows
 * everything; taking the focus selects that text, so that the first keystroke
 * filters instead of lengthening the value. Typing filters case-insensitively and
 * clears the current choice, which is restored only by choosing an option: with the
 * mouse, or with the arrows and Enter, which only chooses; the list opens on the
 * chosen option, Enter keeping it, the arrows moving from it. Escape closes the list
 * without reaching the parent panel; with the list closed, Enter submits the
 * surrounding form as in any field.
 */
export function Combobox({
  options,
  value,
  onChange,
  label,
  placeholder,
  emptyText,
  className = "",
  inputRef,
  accent = false,
}: {
  options: ComboboxOption[];
  /** Value of the chosen option, "" when none. */
  value: string;
  onChange: (value: string) => void;
  /** Accessible name of the field. */
  label: string;
  placeholder?: string;
  /** Shown in the list when the filter leaves nothing in it. */
  emptyText: string;
  className?: string;
  inputRef?: Ref<HTMLInputElement>;
  /** Accent border and weight: the choice is one in force, worth noticing. */
  accent?: boolean;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  // null: nothing typed since the last choice, the field shows the chosen option.
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const list = useRef<HTMLUListElement>(null);

  const selectedLabel = options.find((option) => option.value === value)?.label ?? "";
  const needle = (query ?? "").trim().toLowerCase();
  const filtered =
    needle === ""
      ? options
      : options.filter((option) => option.label.toLowerCase().includes(needle));
  const activeIndex = Math.min(active, filtered.length - 1);
  const activeOption = open && activeIndex >= 0 ? filtered[activeIndex] : undefined;

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    list.current?.children[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  // The list opened on the chosen option, nothing typed: Enter keeps it, the arrows
  // move from it. Already open, the option the pointer or the arrows reached stays.
  function openList() {
    if (open) return;
    if (query === null) setActive(Math.max(options.findIndex((option) => option.value === value), 0));
    setOpen(true);
  }

  function choose(option: ComboboxOption) {
    onChange(option.value);
    setQuery(null);
    setOpen(false);
  }

  function optionId(index: number) {
    return `${listId}-${String(index)}`;
  }

  return (
    <div className={`relative ${className}`}>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeOption === undefined ? undefined : optionId(activeIndex)}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        value={query ?? selectedLabel}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
          if (value !== "") onChange("");
        }}
        onFocus={(event) => {
          // The field arrives filled with the chosen option: selecting it straight away
          // allows filtering by typing, instead of lengthening the existing value.
          event.currentTarget.select();
          openList();
        }}
        onMouseUp={(event) => {
          // A click puts the caret in the text and undoes the selection made on focus:
          // without this, typing would stick the filter onto the option already chosen,
          // and the list would have nothing left to show. Reselecting must happen on
          // release, once the caret is placed.
          if (query === null) event.currentTarget.select();
        }}
        onClick={() => {
          openList();
        }}
        onBlur={() => {
          setOpen(false);
        }}
        onKeyDown={(event) => {
          switch (event.key) {
            case "ArrowDown":
            case "ArrowUp": {
              event.preventDefault();
              if (!open) {
                openList();
                return;
              }
              const step = event.key === "ArrowDown" ? 1 : -1;
              setActive((filtered.length + activeIndex + step) % Math.max(filtered.length, 1));
              return;
            }
            case "Enter":
              if (activeOption !== undefined) {
                // This first Enter chooses, and nothing more: a form around the field
                // must not take it for a submission. The next one, with the list
                // closed, belongs to the form.
                event.preventDefault();
                event.stopPropagation();
                choose(activeOption);
              }
              return;
            case "Escape":
              if (open) {
                event.stopPropagation();
                setOpen(false);
              }
              return;
          }
        }}
        className={`h-7 w-full rounded-(--radius-control) border bg-surface px-2 ${accent ? "border-accent font-medium" : "border-line"}`}
      />
      <ul
        ref={list}
        id={listId}
        role="listbox"
        aria-label={label}
        hidden={!open}
        className="absolute top-full right-0 left-0 z-10 mt-1 max-h-60 overflow-y-auto rounded-(--radius-control) border border-line bg-surface-raised py-1 shadow-lg"
      >
        {filtered.length === 0 ? (
          <li className="px-2 py-1 text-ink-muted">{emptyText}</li>
        ) : (
          filtered.map((option, index) => (
            <li
              key={option.value}
              id={optionId(index)}
              role="option"
              aria-selected={option.value === value}
              // Before the blur of the field, which would close the list under the click.
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onMouseEnter={() => {
                setActive(index);
              }}
              onClick={() => {
                choose(option);
              }}
              className={`cursor-pointer px-2 py-1 ${index === activeIndex ? "bg-accent-soft text-ink" : ""} ${option.value === value ? "font-semibold" : ""}`}
            >
              {option.label}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
