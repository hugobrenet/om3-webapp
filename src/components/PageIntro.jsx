import React from "react";
import {Link, useLocation} from "react-router-dom";
import {useTranslation} from "react-i18next";
import {hideIntro, introPage, useHiddenIntros, useIntrosEnabled} from "../app/page-intro";
import {IconButton} from "../ui/components/Button";
import {CloseIcon, InfoIcon} from "../ui/icons";
import {NARROW_QUERY, useMediaQuery} from "../ui/lib/media";

/**
 * What the page shown is about, for someone who does not know OpenSVC: a sentence
 * or two under the header, the glossary a click away. Hidden for the browser on
 * demand, page by page; the Glossary page and the user page show them all again,
 * the user page turns them all off. Nothing on a page with none.
 */
export function PageIntro() {
    const {t} = useTranslation();
    const location = useLocation();
    const hidden = useHiddenIntros();
    const enabled = useIntrosEnabled();
    const narrow = useMediaQuery(NARROW_QUERY);
    const page = introPage(location.pathname, location.search);
    if (narrow || !enabled || page === null || hidden.includes(page)) return null;
    return (
        <aside
            aria-label={t("pageIntro.label")}
            data-page-intro={page}
            className="mx-4 mt-3 flex items-start gap-2 rounded-(--radius-panel) border border-line bg-surface-raised px-3 py-2 text-ink"
        >
            <InfoIcon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-accent"/>
            <p className="min-w-0 flex-1">
                {t(`pageIntro.pages.${page}`)}
                {" "}
                <Link to="/glossary" className="whitespace-nowrap text-accent underline-offset-2 hover:underline">{t("pageIntro.glossary")}</Link>
            </p>
            <IconButton label={t("pageIntro.hide")} size="sm" onClick={() => hideIntro(page)}>
                <CloseIcon className="h-3.5 w-3.5"/>
            </IconButton>
        </aside>
    );
}
