import {useEffect, useRef, useState} from "react";
import {createPortal} from "react-dom";
import {useTranslation} from "react-i18next";
import AiMarkdown from "./AiMarkdown.jsx";
import {exportDates, exportFileName, messageMeta, stepText, turnsOf, visibleText} from "../utils/conversationExport.js";
import {untrustedT} from "../utils/untrustedText";

/**
 * A conversation of the assistant made ready to print, to save it as a PDF:
 * the same document as the Markdown export, drawn by the components of the
 * transcript, in a frame of its own out of sight. An answer goes through
 * AiMarkdown, which shows no html, no image and links to the web only; a
 * prompt is plain text, as the transcript shows it.
 *
 * The frame takes the styles of the page and not its dark theme, and the
 * name of the file as its title: printing it leaves the page as it is. Safari
 * prints only on a click of the user: the frame is made beforehand, and
 * `onReady` gives its window once the document is in it, for the click to
 * print it at once (`window.print()`). `doc`: {title, clusterName, messages,
 * exportedAt, timeZone}.
 */
const FRAME_DOCUMENT = "<!DOCTYPE html><html><head></head><body></body></html>";

export default function AiPrintView({doc, onReady}) {
    const frame = useRef(null);
    const [body, setBody] = useState(null);
    const ready = useRef(onReady);
    ready.current = onReady;

    // The document of the frame, once loaded: the styles of the page, its
    // language, the light theme, its title the name of the file. A frame
    // without a source loads as it is inserted, before an effect could
    // listen: it is given a document of its own, loaded after, and the load
    // is listened to from its creation (onLoad).
    const take = () => {
        const frameDocument = frame.current?.contentDocument;
        if (!frameDocument?.body || frameDocument.body === body) return;
        frameDocument.documentElement.lang = document.documentElement.lang;
        frameDocument.head.replaceChildren(
            ...[...document.querySelectorAll('style, link[rel="stylesheet"]')].map((style) => style.cloneNode(true))
        );
        setBody(frameDocument.body);
    };

    useEffect(() => {
        const frameDocument = body?.ownerDocument;
        if (!frameDocument) return;
        frameDocument.title = exportFileName(visibleText(doc.title), doc.exportedAt, "");
        ready.current(frameDocument.defaultView);
    }, [body, doc]);

    // The sheet before the frame: it goes first, while its document holds it.
    return (
        <>
            {body && createPortal(<PrintSheet doc={doc}/>, body)}
            {createPortal(
                <iframe
                    ref={frame}
                    srcDoc={FRAME_DOCUMENT}
                    onLoad={take}
                    title={doc.title}
                    aria-hidden="true"
                    tabIndex={-1}
                    // Out of sight, but laid out: a frame not displayed prints nothing.
                    className="pointer-events-none fixed top-0 -left-[10000px] h-[297mm] w-[210mm] border-0"
                />,
                document.body
            )}
        </>
    );
}

/** The document printed. */
function PrintSheet({doc}) {
    const {t, i18n} = useTranslation();
    const dates = exportDates(i18n, doc.timeZone);

    const about = [];
    if (doc.clusterName) about.push(untrustedT(t, "ai.export.cluster", {name: visibleText(doc.clusterName)}));
    about.push(t("ai.export.exportedAt", {date: dates.format(doc.exportedAt)}));
    about.push(t("ai.export.timeZone", {zone: dates.zone}));

    return (
        <article className="ai-print">
            <h1 className="mb-1 text-title font-semibold">{visibleText(doc.title).trim() || t("ai.conversations.untitled")}</h1>
            <p className="mb-4 text-ink-muted">{about.join(" · ")}</p>
            {turnsOf(doc.messages).map((turn, index) => (
                <section key={turn.id || index} className="ai-print-turn border-t border-line pt-3 pb-1">
                    {turn.prompt && (
                        <>
                            <h2 className="ai-print-meta mb-1 font-semibold">{messageMeta(t("ai.message.you"), turn.prompt, dates)}</h2>
                            <p className="mb-3 rounded-(--radius-control) border border-line bg-surface-sunken px-3 py-2 whitespace-pre-wrap [overflow-wrap:anywhere]">
                                {turn.prompt.text.trim()}
                            </p>
                        </>
                    )}
                    {turn.answer && (
                        <>
                            <h2 className="ai-print-meta mb-1 font-semibold">{messageMeta(t("ai.message.assistant"), turn.answer, dates)}</h2>
                            {turn.answer.text.trim() && <AiMarkdown text={turn.answer.text}/>}
                            <PrintSteps history={turn.answer.history}/>
                            {turn.answer.model_id && (
                                <p className="mb-2 text-data text-ink-muted italic">
                                    {untrustedT(t, "ai.export.model", {model: visibleText(turn.answer.model_id)})}
                                </p>
                            )}
                        </>
                    )}
                </section>
            ))}
            <p className="mt-3 border-t border-line pt-3 text-data text-ink-muted italic">{t("ai.export.unstored")}</p>
        </article>
    );
}


/** The steps of an answer, as the Markdown export lists them. */
function PrintSteps({history}) {
    const {t, i18n} = useTranslation();
    const steps = history?.steps || [];
    const omitted = history?.stepsOmitted || 0;
    if (!steps.length && !omitted) return null;
    return (
        <div className="mb-2">
            <p className="font-semibold">{t("ai.export.steps")}</p>
            <ul className="ml-5 list-disc">
                {steps.map((step) => (
                    <li key={step.id}>{visibleText(stepText(step, t, i18n))}</li>
                ))}
                {omitted > 0 && <li>{t("ai.export.stepsOmitted", {count: omitted})}</li>}
            </ul>
        </div>
    );
}
