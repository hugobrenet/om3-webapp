import {useEffect, useRef} from "react";
import {createPortal} from "react-dom";
import {useTranslation} from "react-i18next";
import AiMarkdown from "./AiMarkdown.jsx";
import {exportDates, exportFileName, messageMeta, stepText, turnsOf, visibleText} from "../utils/conversationExport.js";
import {untrustedT} from "../utils/untrustedText";
import {cachedTheme, isDarkTheme} from "../ui/theme";

/** What the user does on the page once a print that did not block ends. */
const RESUMING = ["focus", "pointerdown", "keydown"];

/**
 * A conversation of the assistant as the browser prints it, to save it as a
 * PDF: the same document as the Markdown export, drawn by the components of
 * the transcript. An answer goes through AiMarkdown, which shows no html, no
 * image and links to the web only; a prompt is plain text, as the transcript
 * shows it.
 *
 * Mounted with its document, it prints it at once, in the light theme, the
 * page under it hidden (`.ai-print` in main.css), its title the name the
 * browser offers for the file; then the page is as it was, and `onDone` is
 * called, with true when the browser could not print. The print ends on
 * `afterprint`; a browser whose print() returns before, without it, keeps the
 * sheet until the user is back on the page. `doc`: {title, clusterName,
 * messages, exportedAt, timeZone}.
 */
export default function AiPrintView({doc, onDone}) {
    const {t, i18n} = useTranslation();
    const done = useRef(onDone);
    done.current = onDone;
    const dates = exportDates(i18n, doc.timeZone);

    useEffect(() => {
        const root = document.documentElement;
        const title = document.title;
        let restored = false;
        const restore = () => {
            if (restored) return;
            restored = true;
            window.removeEventListener("afterprint", finished);
            for (const type of RESUMING) window.removeEventListener(type, finished, true);
            document.title = title;
            // The theme of the user now, which may have followed the system meanwhile.
            root.classList.toggle("dark", isDarkTheme(cachedTheme()));
        };
        const finish = (failed) => {
            restore();
            done.current(failed);
        };
        function finished() {
            finish(false);
        }
        root.classList.remove("dark");
        document.title = exportFileName(visibleText(doc.title), doc.exportedAt, "");
        window.addEventListener("afterprint", finished);
        // Once the document is laid out. print() returns once the dialog
        // closes in most browsers, afterprint told before; in the others,
        // while it is open: the sheet stays until the user is back.
        const timer = setTimeout(() => {
            try {
                window.print();
            } catch {
                // A browser without print, such as some embedded ones.
                finish(true);
                return;
            }
            if (!restored) for (const type of RESUMING) window.addEventListener(type, finished, {capture: true, once: true});
        }, 0);
        // Unmounted before it printed: the page is as it was, nothing told.
        return () => {
            clearTimeout(timer);
            restore();
        };
        // The document printed is the one it mounted with.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const about = [];
    if (doc.clusterName) about.push(untrustedT(t, "ai.export.cluster", {name: visibleText(doc.clusterName)}));
    about.push(t("ai.export.exportedAt", {date: dates.format(doc.exportedAt)}));
    about.push(t("ai.export.timeZone", {zone: dates.zone}));

    return createPortal(
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
        </article>,
        document.body
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
