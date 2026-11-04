import React, {useEffect, useState} from "react";
import {useLocation} from "react-router-dom";
import {useTranslation} from "react-i18next";
import {GLOSSARY_GROUPS, termAnchor, termMatches} from "../app/glossary";
import {showAllIntros, useHiddenIntros} from "../app/page-intro";
import {SymbolLegend} from "../app/StatusBoard";
import {Button} from "../ui/components/Button";
import {Input} from "../ui/components/Field";
import {SearchIcon} from "../ui/icons";

/**
 * What the symbols of the status boards mean, then the words of OpenSVC the
 * webapp shows, each said plainly, by group: what the
 * cluster is made of, the kinds of objects, their states and flags, their
 * policies, the actions. Searched by name or definition; a term linked to by its
 * anchor (`/glossary#term-<key>`) brought into view, marked. The intros of the
 * pages hidden, shown again from here.
 */
export function Glossary() {
    const {t} = useTranslation();
    const location = useLocation();
    const hidden = useHiddenIntros();
    const [query, setQuery] = useState("");

    useEffect(() => {
        const id = decodeURIComponent(location.hash.replace(/^#/, ""));
        if (id) document.getElementById(id)?.scrollIntoView?.({block: "center"});
    }, [location.hash]);

    const term = (key) => t(`glossary.terms.${key}.term`);
    const definition = (key) => t(`glossary.terms.${key}.definition`);
    const groups = GLOSSARY_GROUPS
        .map((group) => ({...group, shown: group.terms.filter((key) => termMatches(query, term(key), definition(key)))}))
        .filter((group) => group.shown.length > 0);
    const target = decodeURIComponent(location.hash.replace(/^#/, ""));

    return (
        <div className="mx-auto max-w-3xl space-y-4 p-4">
            <div className="space-y-1">
                <h1 className="text-lg font-semibold">{t("glossary.title")}</h1>
                <p className="text-ink-muted">{t("glossary.intro")}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
                {/* Room to type kept: the button goes under it rather than over it. */}
                <span className="relative flex min-w-48 flex-1 items-center">
                    <SearchIcon className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-ink-muted"/>
                    <Input
                        type="search"
                        aria-label={t("glossary.search")}
                        placeholder={t("glossary.search")}
                        className="h-8 w-full pl-7"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                    />
                </span>
                {hidden.length > 0 && (
                    <Button size="sm" onClick={showAllIntros}>{t("glossary.showIntros", {count: hidden.length})}</Button>
                )}
            </div>
            {/* The symbols of the status boards, searched by nobody: always shown, first. */}
            {query.trim() === "" && (
                <section aria-labelledby="glossary-symbols" className="space-y-2">
                    <h2 id="glossary-symbols" className="font-semibold">{t("legend.title")}</h2>
                    <div className="rounded-(--radius-panel) border border-line bg-surface-raised p-3">
                        <SymbolLegend/>
                    </div>
                </section>
            )}
            {groups.length === 0 && <p className="text-ink-muted">{t("glossary.noMatch")}</p>}
            {groups.map((group) => (
                <section key={group.key} aria-labelledby={`glossary-${group.key}`} className="space-y-2">
                    <h2 id={`glossary-${group.key}`} className="font-semibold">{t(`glossary.groups.${group.key}`)}</h2>
                    <dl className="divide-y divide-line rounded-(--radius-panel) border border-line bg-surface-raised">
                        {group.shown.map((key) => (
                            <div
                                key={key}
                                id={termAnchor(key)}
                                data-target={target === termAnchor(key) || undefined}
                                className="scroll-mt-4 px-3 py-2 data-target:bg-surface-sunken"
                            >
                                <dt className="font-medium">{term(key)}</dt>
                                <dd className="text-ink-muted">{definition(key)}</dd>
                            </div>
                        ))}
                    </dl>
                </section>
            ))}
        </div>
    );
}

export default Glossary;
