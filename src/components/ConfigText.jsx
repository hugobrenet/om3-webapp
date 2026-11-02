import React, {useCallback, useEffect, useMemo, useState} from "react";
import {useTranslation} from "react-i18next";
import {getResponseErrorMessage} from "../services/api.jsx";
import {Dialog} from "../ui/components/Dialog";
import {Spinner} from "../ui/components/Spinner";
import {CrossLink} from "../app/CrossLink";
import {KEY_SOURCE, datastorePath, isKeyName} from "../app/key-source";
import KeysSection from "./KeysSection";

/*
 * A configuration file as stored, each keyword it sets documented on demand: its
 * name a button opening a dialog of what the keyword does, as `om <path> config doc`
 * tells it, read from the daemon for that keyword alone.
 */

/** The documentation read, by its address: read once a session. */
const docCache = new Map();

/**
 * The documentation of a key of a section, from the keywords address of what the
 * file configures (`.../config/keywords`): the daemon resolves the keyword of the
 * section's driver from the configuration itself.
 */
function loadDoc(keywordsUrl, section, option) {
    const url = `${keywordsUrl}${keywordsUrl.includes("?") ? "&" : "?"}${new URLSearchParams({section, option})}`;
    if (!docCache.has(url)) {
        const promise = fetch(url, {
            headers: {Authorization: `Bearer ${localStorage.getItem("authToken") || ""}`},
        }).then(async (response) => {
            if (!response.ok) throw new Error((await getResponseErrorMessage(response)) || `HTTP ${response.status}`);
            const data = await response.json();
            return Array.isArray(data?.items) ? data.items : [];
        });
        // A read that failed is tried again the next time.
        promise.catch(() => docCache.delete(url));
        docCache.set(url, promise);
    }
    return docCache.get(url);
}

/** Forgets the documentation read, for the tests. */
export const clearKeywordsCache = () => docCache.clear();

const SECTION = /^\s*\[([^\]]+)\]\s*$/;
// A key at the start of its line, not a comment nor the continuation of a value.
const KEY = /^([^\s#;=[][^=]*?)\s*=/;
// As `om <path> config show` tells them (core/rawconfig): a scope, `{a.reference}`.
const SCOPE = /(@[\w.-_]+)/;
const REFERENCE = /({[\w#.-_:]+})/;
const COMMENT = /^\s*[#;]/;
/** The sections of free keys, no keyword of them: the data of a secret or a configuration, the env and labels. */
const FREE_SECTIONS = new Set(["data", "env", "labels"]);

/**
 * The lines of the file, a section with `heading`, a comment with `comment`; a key
 * line with where the key as written stands in the line, and with its section and
 * its key without the scope (`nodes@n1` is `nodes`), a key of a section of free keys
 * having none of those two. `prose`, a value said to be read, not one om takes: of a
 * section of free keys, or of a comment.
 */
export function parseConfig(text) {
    let section = "DEFAULT";
    let prose = false;
    return text.split("\n").map((line) => {
        const s = line.match(SECTION);
        if (s) {
            section = s[1].trim();
            prose = false;
            return {line, heading: true};
        }
        if (COMMENT.test(line)) return {line, comment: true};
        const k = line.match(KEY);
        if (!k) return {line, prose};
        const written = k[1].trim();
        const start = line.indexOf(written);
        const end = start + written.length;
        const key = written.split("@")[0];
        prose = FREE_SECTIONS.has(section) || key === "comment";
        if (FREE_SECTIONS.has(section)) return {line, start, end, prose};
        return {line, section, key, start, end, prose};
    });
}

/** A text split on a pattern capturing what `paint` draws, each piece matched painted. */
const painted = (text, pattern, paint) => text.split(pattern)
    .map((piece, index) => (index % 2 === 1 ? <React.Fragment key={index}>{paint(piece)}</React.Fragment> : piece));

/** A key as written, its scope said apart. */
const keyName = (text) => painted(text, SCOPE, (scope) => <span data-config-token="scope" className="text-state-down">{scope}</span>);

/** A text, its references said apart. */
const references = (text) => painted(text, REFERENCE, (ref) => <span data-config-token="reference" className="text-state-up">{ref}</span>);

/**
 * A value, its references said apart; with `self`, the object the file configures,
 * its `from <datastore> key <name>` a way there: the datastore its keys, the name the
 * content of the key, by `onKey`, the file staying on display. What is not resolved
 * here, a pattern say, stays as written.
 */
function value(text, self, onKey) {
    const source = self === undefined ? null : text.match(KEY_SOURCE);
    if (source === null) return references(text);
    const [whole, lead, from, gap1, store, gap2, key, gap3, name] = source;
    const path = datastorePath(store, self);
    const at = source.index + whole.length;
    return (
        <>
            {references(text.slice(0, source.index))}
            {lead}{from}{gap1}
            {path ? <CrossLink kind="object" id={path} tab="keys">{store}</CrossLink> : references(store)}
            {gap2}{key}{gap3}
            {path && isKeyName(name) ? (
                <button
                    type="button"
                    onClick={() => onKey({path, name})}
                    data-key-link=""
                    className="cursor-pointer rounded-sm text-accent underline decoration-dotted underline-offset-2 focus-visible:outline-2 focus-visible:outline-(--focus-ring)"
                >
                    {name}
                </button>
            ) : references(name)}
            {references(text.slice(at))}
        </>
    );
}

/**
 * The keyword a key of a section sets, in a list of keywords: of the kind of the
 * section (`fs` for `fs#1`), else of any section (`comment`), the one of `type`
 * when the keyword differs by driver.
 */
export function findKeyword(keywords, {section, key, type}) {
    const kind = section === "DEFAULT" ? "DEFAULT" : section.split("#")[0];
    const named = (k) => k.option === key || (k.aliases ?? []).includes(key);
    const ofSection = keywords.filter((k) => named(k) && (k.section === kind || (kind === "DEFAULT" && k.section === "")));
    const candidates = ofSection.length > 0 ? ofSection : keywords.filter((k) => named(k) && k.section === "");
    if (candidates.length === 0) return null;
    return candidates.find((k) => type && (k.types ?? []).includes(type))
        ?? candidates.find((k) => (k.types ?? []).length === 0)
        ?? candidates[0];
}

/** The facts of a keyword, those it has: its default, its values, an example, its type, scopable, deprecated. */
export function KeywordFacts({keyword}) {
    const {t} = useTranslation();
    const facts = [
        ["default", keyword.default || keyword.defaultText],
        ["candidates", (keyword.candidates ?? []).join(", ")],
        ["example", keyword.example],
        ["converter", keyword.converter],
        ["scopable", keyword.scopable ? t("common.yes") : ""],
        ["deprecated", keyword.deprecated && (keyword.replacedBy ? t("config.keywordHelp.replacedBy", {keyword: keyword.replacedBy}) : keyword.deprecated)],
    ].filter(([, value]) => value);
    if (facts.length === 0) return null;
    return (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-0.5">
            {facts.map(([fact, value]) => (
                <React.Fragment key={fact}>
                    <dt className="text-ink-muted">{t(`config.keywordHelp.${fact}`)}</dt>
                    <dd className="font-mono text-data break-all">{value}</dd>
                </React.Fragment>
            ))}
        </dl>
    );
}

/**
 * What a keyword does, in a dialog, read from the daemon on opening: its text and
 * its facts; several keywords answered (an option of the drivers of a section of no
 * type), each under its section and types. None answered, said.
 */
function KeywordDocDialog({keywordsUrl, section, option, name, onClose}) {
    const {t} = useTranslation();
    const [state, setState] = useState({items: null, error: null});
    useEffect(() => {
        let live = true;
        loadDoc(keywordsUrl, section, option).then(
            (items) => live && setState({items, error: null}),
            (err) => live && setState({items: null, error: err.message}),
        );
        return () => {
            live = false;
        };
    }, [keywordsUrl, section, option]);
    const {items, error} = state;
    return (
        <Dialog open title={<span className="font-mono">{name}</span>} onClose={onClose} size="md">
            <div data-keyword-doc={name} className="space-y-3">
                {error ? (
                    <p role="alert" className="text-state-down">{t("config.keywordHelp.loadError", {message: error})}</p>
                ) : items === null ? (
                    <div className="flex justify-center py-4"><Spinner label={t("config.keywordHelp.loading")}/></div>
                ) : items.length === 0 ? (
                    <p className="text-ink-muted">{t("config.keywordHelp.none")}</p>
                ) : items.map((keyword, index) => (
                    <section key={index} className="space-y-2">
                        {items.length > 1 && (
                            <h3 className="font-mono font-semibold">
                                {[keyword.section, keyword.option].filter(Boolean).join(".")}
                                {(keyword.types ?? []).filter(Boolean).length > 0 && <span className="font-normal text-ink-muted"> ({keyword.types.filter(Boolean).join(", ")})</span>}
                            </h3>
                        )}
                        {keyword.text && <p className="whitespace-pre-line">{keyword.text.trim()}</p>}
                        <KeywordFacts keyword={keyword}/>
                    </section>
                ))}
            </div>
        </Dialog>
    );
}

/**
 * The file, coloured as `om <path> config show` does: the sections, the keys, their
 * scopes, the references in the values; the comments left plain. The name of each
 * key a button opening the documentation of its keyword, read from `keywordsUrl` for
 * that keyword alone. `lineNumbers` numbers the lines, as a file to confirm is read
 * by them. `path`, the object it configures, for what a relative datastore is
 * relative to: its `from <datastore> key <name>` then lead to the datastore and
 * show the key, what cannot be read told to `openSnackbar`.
 */
export function ConfigText({text, keywordsUrl, label, lineNumbers = false, path, openSnackbar}) {
    const {t} = useTranslation();
    const lines = useMemo(() => parseConfig(text), [text]);
    const [open, setOpen] = useState(null);
    const [keyShown, setKeyShown] = useState(null);
    const closeKey = useCallback(() => setKeyShown(null), []);
    const opened = open === null ? null : lines[open];
    const nameOf = (l) => `${l.section === "DEFAULT" ? "" : `${l.section}.`}${l.key}`;

    return (
        <div className="overflow-x-auto rounded-(--radius-control) border border-line bg-surface-sunken p-2">
            <div role="group" aria-label={label} className="font-mono text-data whitespace-pre-wrap text-ink [&_[data-cross-link]]:text-accent [&_[data-cross-link]]:underline [&_[data-cross-link]]:decoration-dotted">
                {lines.map((l, index) => {
                    const self = l.prose ? undefined : path;
                    const name = l.start === undefined ? null : <span data-config-token="key" className="text-ink-muted">{keyName(l.line.slice(l.start, l.end))}</span>;
                    const content = l.heading ? <span data-config-token="section" className="text-code-keyword">{l.line}</span>
                        : l.comment ? l.line
                        : l.key && keywordsUrl ? (
                        <>
                            {l.line.slice(0, l.start)}
                            <button
                                type="button"
                                aria-label={t("config.keywordHelp.open", {keyword: nameOf(l)})}
                                onClick={() => setOpen(index)}
                                className="cursor-pointer rounded-sm underline decoration-line-strong decoration-dotted underline-offset-2 hover:text-accent hover:decoration-accent focus-visible:outline-2 focus-visible:outline-accent"
                            >
                                {name}
                            </button>
                            {value(l.line.slice(l.end), self, setKeyShown)}
                        </>
                    ) : name ? (
                        <>
                            {l.line.slice(0, l.start)}
                            {name}
                            {value(l.line.slice(l.end), self, setKeyShown)}
                        </>
                    ) : value(l.line, self, setKeyShown);
                    return lineNumbers ? (
                        <div key={index} data-line={index} className="flex min-h-[1lh] items-start gap-2 hover:bg-surface">
                            <span aria-hidden="true" data-testid="config-line-number" className="w-8 shrink-0 text-right text-ink-muted tabular-nums select-none">
                                {index + 1}
                            </span>
                            <span className="min-w-0 flex-1">{content}</span>
                        </div>
                    ) : (
                        <div key={index} data-line={index} className="min-h-[1lh] hover:bg-surface">{content}</div>
                    );
                })}
            </div>
            {keyShown && (
                <KeysSection
                    key={`${keyShown.path}:${keyShown.name}`}
                    decodedObjectName={keyShown.path}
                    keyOnly={keyShown.name}
                    onKeyClosed={closeKey}
                    openSnackbar={openSnackbar}
                />
            )}
            {opened && (
                <KeywordDocDialog
                    keywordsUrl={keywordsUrl}
                    section={opened.section}
                    option={opened.key}
                    name={nameOf(opened)}
                    onClose={() => setOpen(null)}
                />
            )}
        </div>
    );
}
