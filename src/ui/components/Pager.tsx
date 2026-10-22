import { useId } from "react";
import { useTranslation } from "react-i18next";
import { PAGE_SIZES, type Paging } from "../../app/paging";
import { Select } from "./Field";

/** The page buttons of oc3: outlined, the height of the list toolbars; a glyph alone in a narrow window. */
const PAGE_BUTTON =
  "h-7 min-w-7 rounded-(--radius-control) border border-line px-2 text-ink-muted hover:text-ink disabled:opacity-50 disabled:hover:text-ink-muted max-md:px-1.5";

/** The name of a page button, its glyph in its place in a narrow window. */
function PageLabel({ text, glyph }: { text: string; glyph: string }) {
  return (
    <>
      <span className="max-md:hidden">{text}</span>
      <span aria-hidden="true" className="hidden max-md:inline">
        {glyph}
      </span>
    </>
  );
}

/**
 * The pages of a list, as oc3 draws them over its tables: the rows a page to choose,
 * the rows shown out of how many, and the way to the first, previous, next and last
 * pages. In a narrow window, scaled down: the size without its label shown, the
 * buttons a glyph each, the page shown as "2/5"; their names kept for assistive tools.
 */
export function Pager({ paging }: { paging: Paging }) {
  const { t, i18n } = useTranslation();
  const sizeId = useId();
  const { offset, limit, total, setOffset, setLimit } = paging;
  const format = (n: number) => n.toLocaleString(i18n.language);
  const pageCount = Math.max(1, Math.ceil(total / limit));
  const pageIndex = Math.floor(offset / limit);
  const lastOffset = (pageCount - 1) * limit;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-3 max-md:gap-2">
      <label className="flex items-center gap-1 text-ink-muted" htmlFor={sizeId}>
        <span className="max-md:sr-only">{t("pager.perPage")}</span>
        <Select
          id={sizeId}
          className="h-7"
          value={limit}
          onChange={(event) => setLimit(Number(event.target.value))}
        >
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </Select>
      </label>
      <span aria-live="polite" className="ml-auto text-ink-muted tabular-nums">
        {t("pager.rangeOf", { from: format(from), to: format(to), total: format(total) })}
      </span>
      <nav aria-label={t("pager.label")} className="flex items-center gap-1">
        <button
          type="button"
          className={PAGE_BUTTON}
          aria-label={t("pager.first")}
          disabled={offset === 0}
          onClick={() => setOffset(0)}
        >
          <PageLabel text={t("pager.first")} glyph="«" />
        </button>
        <button
          type="button"
          className={PAGE_BUTTON}
          aria-label={t("pager.previous")}
          disabled={offset === 0}
          onClick={() => setOffset(Math.max(0, offset - limit))}
        >
          <PageLabel text={t("pager.previous")} glyph="‹" />
        </button>
        <span className="px-1 text-ink-muted tabular-nums" aria-current="page">
          <span className="max-md:sr-only">
            {t("pager.page", { page: format(pageIndex + 1), pages: format(pageCount) })}
          </span>
          <span aria-hidden="true" className="hidden max-md:inline">
            {`${format(pageIndex + 1)}/${format(pageCount)}`}
          </span>
        </span>
        <button
          type="button"
          className={PAGE_BUTTON}
          aria-label={t("pager.next")}
          disabled={pageIndex >= pageCount - 1}
          onClick={() => setOffset(offset + limit)}
        >
          <PageLabel text={t("pager.next")} glyph="›" />
        </button>
        <button
          type="button"
          className={PAGE_BUTTON}
          aria-label={t("pager.last")}
          disabled={pageIndex >= pageCount - 1}
          onClick={() => setOffset(lastOffset)}
        >
          <PageLabel text={t("pager.last")} glyph="»" />
        </button>
      </nav>
    </div>
  );
}
