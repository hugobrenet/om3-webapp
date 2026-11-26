import {answerDuration, formatDuration, stepSentence} from "../components/AiSteps.jsx";
import {untrustedT} from "./untrustedText";

/**
 * A conversation of the assistant as a Markdown document, to keep, attach to
 * a ticket or pass along: its title, the cluster, when it was exported and in
 * which time zone, then each prompt and its answer as the agent stored them.
 * Under an answer, its steps, as the transcript says them, with the model,
 * the time and the duration of its turn. Never what a call read, nor its
 * arguments but the target the sentence of its step names.
 *
 * What the user and the model wrote cannot pass for the document: a prompt
 * is a code block, as the transcript shows it, plain; an answer is quoted,
 * its code blocks fenced again, its inline markup escaped: nothing in it
 * loads or leads anywhere, no image, no html, no link but the addresses it
 * writes. The other values, the title, the cluster, the step sentences and
 * the model, are text, their invisible characters dropped.
 *
 * The agent stores the turns that ended: an answer stopped or failed is not
 * in the history, nor in the export, which says so.
 */

/** The messages of a page of the history the agent gives at most. */
const PAGE = 100;
/** The pages read at most: past them, the conversation is too long to export. */
const MAX_PAGES = 64;

export class ExportTooLong extends Error {}

/**
 * All the stored messages of a conversation, the oldest first, read page by
 * page from the most recent, as the transcript loads them.
 */
export async function wholeHistory(client, id, {signal} = {}) {
    const pages = [];
    let before = "";
    for (let read = 0; read < MAX_PAGES; read++) {
        const page = await client.getMessages(id, {limit: PAGE, before, signal});
        pages.unshift(page.messages);
        if (!page.next_cursor) return pages.flat();
        before = page.next_cursor;
    }
    throw new ExportTooLong("The conversation is too long to be exported.");
}

/**
 * The turns of the messages: a prompt and its answer, the texts of the
 * assistant messages of a turn as paragraphs, the steps and the model of the
 * last one, which carries them.
 */
export function turnsOf(messages) {
    const turns = [];
    for (const message of messages) {
        const last = turns.at(-1);
        if (message.role === "user") {
            turns.push({id: message.turn_id, prompt: message, answer: null});
        } else if (last && last.id === message.turn_id) {
            last.answer = last.answer
                ? {...last.answer, ...message, text: [last.answer.text, message.text].filter(Boolean).join("\n\n")}
                : message;
        } else {
            turns.push({id: message.turn_id, prompt: null, answer: message});
        }
    }
    return turns;
}

// The characters a reader does not see: controls, formats such as the
// marks of direction, and the separators of lines and paragraphs.
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

/** A value of the document as it reads, on one line, its invisible characters dropped. */
export const visibleText = (text) => text.replace(/\s+/g, " ").replace(INVISIBLE, "");

// A value as text of the Markdown, on one line: no link, emphasis,
// strikethrough nor html of its own.
const escapeInline = (text) => visibleText(text).replace(/[\\`*_~[\]<>|]/g, (character) => `\\${character}`);

const lines = (text) => text.replace(/\r\n?/g, "\n").split("\n");

/** A prompt as the transcript shows it: plain, in a code block no line of it closes. */
function promptBlock(text) {
    const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
    const fence = "`".repeat(Math.max(3, longest + 1));
    return [fence, ...lines(text.replace(/^(?:[ \t]*\r?\n)+|\s+$/g, "")), fence];
}

// The characters that make the inline markup of Markdown, and the html:
// links, images, autolinks, link definitions, code spans, emphasis,
// strikethrough, tables. Escaped, the answer cannot load anything, nor lead
// anywhere but where it writes an address, nor cut its quote; its blocks,
// paragraphs, lists, headings in the quote, stay.
const escapeMarkup = (text) => text.replace(/[\\`*_[\]<>~|]/g, (character) => `\\${character}`);

/** The longest run of backticks in lines of text, to fence them with a longer one. */
const longestBackticks = (body) => Math.max(0, ...body.flatMap((line) => [...line.matchAll(/`+/g)].map((match) => match[0].length)));

// The opening of a fenced code block as CommonMark takes it: indented by three
// spaces at most, its language a word.
const OPENING = /^ {0,3}(`{3,}|~{3,})\s*([\w+#.-]*)[^`]*$/;

/**
 * An answer, quoted: its fenced code blocks written again, as written, in a
 * fence of their own that no line of them closes, one left open closed; the
 * rest, its inline markup escaped. Nothing it holds passes for a heading, a
 * step or a prompt of the document.
 */
function answerBlock(text) {
    const out = [];
    const all = lines(text.replace(/^(?:[ \t]*\r?\n)+|\s+$/g, ""));
    for (let index = 0; index < all.length; index++) {
        const opening = OPENING.exec(all[index]);
        if (opening === null) {
            out.push(escapeMarkup(all[index]));
            continue;
        }
        const [, marker, language] = opening;
        const body = [];
        for (index++; index < all.length; index++) {
            const closing = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(all[index])?.[1];
            if (closing !== undefined && closing[0] === marker[0] && closing.length >= marker.length) break;
            body.push(all[index]);
        }
        const fence = "`".repeat(Math.max(3, longestBackticks(body) + 1));
        out.push(`${fence}${language}`, ...body, fence);
    }
    return out.map((line) => (line === "" ? ">" : `> ${line}`));
}

/**
 * A step as the export says it, plain text: the sentence of the call as it
 * ran, with the changes of the user when they made some, and how it ended
 * when it did not complete.
 */
export function stepText(step, t, i18n) {
    const sentence = stepSentence({...step, arguments: step.editedArgs ?? step.arguments}, t, i18n);
    const edited = step.editedArgs ? t("ai.message.withChanges") : "";
    const status = ["failed", "rejected", "interrupted"].includes(step.status) ? ` (${t(`ai.steps.status.${step.status}`)})` : "";
    return `${sentence}${edited}${status}`;
}

/**
 * The dates of an export, in the language of the user and the time zone
 * given, the user's by default: `format(date)`, and `zone`, to be said.
 */
export function exportDates(i18n, timeZone) {
    const language = i18n.resolvedLanguage ?? i18n.language;
    const format = new Intl.DateTimeFormat(language, {dateStyle: "medium", timeStyle: "short", ...(timeZone ? {timeZone} : {})});
    return {language, format: (date) => format.format(date), zone: format.resolvedOptions().timeZone};
}

/**
 * The words over a message: who, when, and for an answer the duration of
 * its turn.
 */
export function messageMeta(who, message, dates) {
    const time = Number.isFinite(Date.parse(message.created_at)) ? dates.format(new Date(message.created_at)) : "";
    const duration = message.role === "assistant" ? answerDuration({runs: message.history?.runs || []}) : 0;
    return [who, time, duration > 0 ? formatDuration(duration, dates.language) : ""].filter(Boolean).join(" · ");
}

/**
 * The Markdown of a conversation: `title`, `clusterName`, the stored
 * `messages`, `exportedAt` a Date, `timeZone` that of the dates, the user's
 * by default; `t` and `i18n` the translation, its language the dates'.
 */
export function conversationMarkdown({title, clusterName, messages, exportedAt, timeZone, t, i18n}) {
    const dates = exportDates(i18n, timeZone);
    const out = [];
    // A blank line between blocks, one only: the lines of the messages stay as they are.
    const blank = () => {
        if (out.length && out.at(-1) !== "") out.push("");
    };
    out.push(`# ${escapeInline(title).trim() || t("ai.conversations.untitled")}`);
    blank();
    const about = [];
    if (clusterName) about.push(untrustedT(t, "ai.export.cluster", {name: escapeInline(clusterName)}));
    about.push(t("ai.export.exportedAt", {date: dates.format(exportedAt)}));
    about.push(t("ai.export.timeZone", {zone: dates.zone}));
    out.push(about.join(" · "));
    for (const turn of turnsOf(messages)) {
        blank();
        out.push("---");
        blank();
        if (turn.prompt) {
            out.push(`### ${messageMeta(t("ai.message.you"), turn.prompt, dates)}`);
            blank();
            out.push(...promptBlock(turn.prompt.text));
            blank();
        }
        if (!turn.answer) continue;
        const answer = turn.answer;
        const history = answer.history;
        out.push(`### ${messageMeta(t("ai.message.assistant"), answer, dates)}`);
        blank();
        if (answer.text.trim()) {
            out.push(...answerBlock(answer.text));
            blank();
        }
        const steps = history?.steps || [];
        const omitted = history?.stepsOmitted || 0;
        if (steps.length || omitted) {
            out.push(`**${t("ai.export.steps")}**`);
            blank();
            for (const step of steps) out.push(`- ${escapeInline(stepText(step, t, i18n))}`);
            if (omitted) out.push(`- ${t("ai.export.stepsOmitted", {count: omitted})}`);
            blank();
        }
        if (answer.model_id) out.push(`_${untrustedT(t, "ai.export.model", {model: escapeInline(answer.model_id)})}_`);
    }
    blank();
    out.push("---");
    blank();
    out.push(`_${t("ai.export.unstored")}_`);
    return `${out.join("\n")}\n`;
}

// The letters NFKD does not take apart, as their base letters.
const LIGATURES = {œ: "oe", æ: "ae", ß: "ss", ø: "o", ł: "l", đ: "d", ð: "d", þ: "th"};

/**
 * The name of the file of a conversation: its title, its letters without
 * accents, the other characters as dashes, and the date of the export.
 */
export function exportFileName(title, exportedAt, extension = "md") {
    const name =
        title
            .toLowerCase()
            .replace(/[œæßøłđðþ]/g, (letter) => LIGATURES[letter])
            .normalize("NFKD")
            .replace(/\p{M}/gu, "")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 60)
            .replace(/-+$/, "") || "conversation";
    const pad = (n) => String(n).padStart(2, "0");
    const day = `${exportedAt.getFullYear()}-${pad(exportedAt.getMonth() + 1)}-${pad(exportedAt.getDate())}`;
    return extension ? `${name}-${day}.${extension}` : `${name}-${day}`;
}

/** Gives the browser a text to save as a file. */
export function downloadText(text, fileName, type = "text/markdown") {
    const url = URL.createObjectURL(new Blob([text], {type: `${type};charset=utf-8`}));
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    // A browser may read the address after the click returns, once the user
    // confirmed the download.
    setTimeout(() => URL.revokeObjectURL(url), 30000);
}
