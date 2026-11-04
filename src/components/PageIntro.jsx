import React, {useState} from "react";
import {Link, useLocation} from "react-router-dom";
import {useTranslation} from "react-i18next";
import {hideIntro, introPage, useHiddenIntros, useIntrosEnabled} from "../app/page-intro";
import {IconButton} from "../ui/components/Button";
import {ChevronDownIcon, CloseIcon, InfoIcon} from "../ui/icons";
import {cn} from "../ui/cn";
import {NARROW_QUERY, useMediaQuery} from "../ui/lib/media";

/**
 * What the page shown is about, for someone who does not know OpenSVC: a sentence
 * or two under the header, the glossary a click away. Hidden for the browser on
 * demand, page by page; the Glossary page and the user page show them all again,
 * the user page turns them all off. Nothing on a page with none. In a narrow
 * window, a line cut short, the rest and the glossary a tap away: the page keeps
 * its room.
 */
export function PageIntro() {
    const {t} = useTranslation();
    const location = useLocation();
    const hidden = useHiddenIntros();
    const enabled = useIntrosEnabled();
    const narrow = useMediaQuery(NARROW_QUERY);
    // The page whose intro is read in full, in a narrow window: another page, cut again.
    const [readPage, setReadPage] = useState(null);
    const page = introPage(location.pathname, location.search);
    if (!enabled || page === null || hidden.includes(page)) return null;
    const text = t(`pageIntro.pages.${page}`);
    const expanded = !narrow || readPage === page;
    const glossary = (
        <Link to="/glossary" className="whitespace-nowrap text-accent underline-offset-2 hover:underline">{t("pageIntro.glossary")}</Link>
    );
    return (
        <aside
            aria-label={t("pageIntro.label")}
            data-page-intro={page}
            className="mx-4 mt-3 flex items-start gap-2 rounded-(--radius-panel) border border-line bg-surface-raised px-3 py-2 text-ink max-md:mx-2 max-md:mt-2 max-md:py-1.5"
        >
            <InfoIcon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-accent"/>
            {narrow ? (
                <div className="min-w-0 flex-1">
                    <button
                        type="button"
                        aria-expanded={expanded}
                        onClick={() => setReadPage(expanded ? null : page)}
                        className="flex w-full items-start gap-1 text-left"
                    >
                        <span className={cn("min-w-0 flex-1", !expanded && "truncate")}>{text}</span>
                        <ChevronDownIcon aria-hidden="true" className={cn("mt-1 h-3.5 w-3.5 shrink-0 text-ink-muted", expanded && "rotate-180")}/>
                    </button>
                    {expanded && <p className="mt-1">{glossary}</p>}
                </div>
            ) : (
                <p className="min-w-0 flex-1">
                    {text}
                    {" "}
                    {glossary}
                </p>
            )}
            <IconButton label={t("pageIntro.hide")} size="sm" onClick={() => hideIntro(page)}>
                <CloseIcon className="h-3.5 w-3.5"/>
            </IconButton>
        </aside>
    );
}
