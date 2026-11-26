import {createContext, memo, useContext} from "react";
import {useTranslation} from "react-i18next";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {cn} from "../ui/cn";
import {CopyButton} from "../ui/components/CopyButton";
import {TargetBadge} from "./AiSteps.jsx";

const plugins = [remarkGfm];
const elements = [
    "p", "strong", "em", "del", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li",
    "blockquote", "pre", "code", "hr", "br", "a", "table", "thead", "tbody", "tr", "th", "td",
];

// Model text is untrusted. Only explicit web links are navigable, never
// relative URLs, protocol-relative URLs or URLs containing credentials.
const safeUrl = (value) => {
    if (!/^https?:\/\//i.test(value) || /[\u0000- \u007f]/.test(value)) return "";
    try {
        const url = new URL(value);
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return "";
        return url.href;
    } catch {
        return "";
    }
};

// The paths of the objects the cluster holds, by path, for the code spans of
// the text that name one; and whether a code is in a block, never linked.
const ObjectsContext = createContext(null);
const InBlock = createContext(false);
// A code in a link stays code: a badge is a button, never inside an anchor.
const InLink = createContext(false);
// While the answer streams, a code block may not be closed yet: it runs to the
// end of the text, and grows. Its blocks are copied once the answer is
// complete; an answer resumed after a confirmation streams again, its buttons
// gone until it ends.
const Streaming = createContext(false);
// The text of the answer, to tell a block its closing fence ends from one left
// unclosed: a text cut short, stopped, failed or past the length the model may
// write, leaves one, and nothing else tells it from a complete one.
const Source = createContext("");

// The text of a node of the syntax tree, as written.
const textOf = (node) => {
    if (!node) return "";
    if (node.type === "text") return node.value;
    return (node.children ?? []).map(textOf).join("");
};

// The characters a reader does not see, or sees otherwise than a terminal takes
// them: the controls, the escape of the terminal sequences included, the marks of
// format (direction, no width, tags), the separators of lines and paragraphs, and
// the fillers of the Hangul script, blank. The tab and the line ends are text.
const HIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u115f\u1160\u3164\uffa0]/u;
const hidesCharacters = (text) => HIDDEN.test(text.replace(/[\t\n\r]/g, ""));

// Whether the code block of node, in the answer source, is left unclosed: no
// closing fence ends it, or, indented, it runs to the end of the text.
const unclosed = (node, source) => {
    const start = node?.position?.start?.offset;
    const end = node?.position?.end?.offset;
    if (start === undefined || end === undefined) return true;
    const lines = source.slice(start, end).split("\n");
    const opening = /^[\s>]*(`{3,}|~{3,})/.exec(lines[0]);
    if (!opening) return end >= source.trimEnd().length;
    if (lines.length < 2) return true;
    const closing = lines.at(-1).replace(/^[\s>]*/, "").trimEnd();
    const fence = opening[1];
    return !(closing.length >= fence.length && [...closing].every((char) => char === fence[0]));
};

// A code block, a command or a script the user may run, copied as it is
// written, never run from the page. No copy is offered of a block a reader
// cannot check: blank, holding hidden characters, or unclosed. The blank lines
// and spaces that end it are left out: pasted in a shell, a line end would run
// the command.
function CodeBlock({node, children}) {
    const {t} = useTranslation();
    const streaming = useContext(Streaming);
    const source = useContext(Source);
    const text = textOf(node).replace(/\s+$/, "");
    const copyable = !streaming && text.trim() !== "" && !hidesCharacters(text) && !unclosed(node, source);
    return (
        <div className="relative my-2">
            <InBlock.Provider value={true}>
                <pre>{children}</pre>
            </InBlock.Provider>
            {copyable && (
                // The box hides the text that scrolls under the button, within
                // the border of the block; the button stands out of the block,
                // as it does elsewhere.
                <div className="absolute top-px right-px rounded-(--radius-control) bg-surface-sunken p-1">
                    <div className="rounded-(--radius-control) bg-surface" title={t("ai.message.copyCode")}>
                        <CopyButton text={text} label={t("ai.message.copyCode")}/>
                    </div>
                </div>
            )}
        </div>
    );
}

// A code span naming an object the cluster holds is its badge; any other
// code, a path the model made up included, stays code.
function Code({children}) {
    const objects = useContext(ObjectsContext);
    const inBlock = useContext(InBlock);
    const inLink = useContext(InLink);
    const block = inBlock || inLink;
    const text = typeof children === "string" ? children : Array.isArray(children) && children.length === 1 && typeof children[0] === "string" ? children[0] : null;
    if (!block && text && objects && Object.hasOwn(objects, text)) return <TargetBadge kind="object" id={text} status={{objects}}/>;
    return <code>{children}</code>;
}

const components = {
    code: Code,
    pre: CodeBlock,
    a: ({href, children}) => (
        <InLink.Provider value={true}>
            {href ? (
                <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent underline hover:brightness-110">
                    {children}
                </a>
            ) : (
                <span>{children}</span>
            )}
        </InLink.Provider>
    ),
    table: ({children}) => (
        <div className="my-2 overflow-x-auto">
            <table>{children}</table>
        </div>
    ),
};

// Markdown elements carry no classes: the container styles them, in the tokens.
const PROSE = cn(
    "break-words [overflow-wrap:anywhere]",
    "[&>:first-child]:mt-0 [&>:last-child]:mb-0",
    "[&_p]:my-2 [&_ul]:my-2 [&_ol]:my-2 [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5",
    "[&_h1]:mt-3 [&_h1]:mb-1 [&_h1]:text-title [&_h1]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1 [&_h2]:text-title [&_h2]:font-semibold",
    "[&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:font-semibold [&_h4]:mt-3 [&_h4]:mb-1 [&_h4]:font-semibold [&_h5]:font-semibold [&_h6]:font-semibold",
    // A code span keeps the ink, in a quote too, whose muted ink would fall
    // under 4.5:1 on its background.
    "[&_code]:rounded-sm [&_code]:bg-code-span [&_code]:px-1 [&_code]:font-mono [&_code]:text-data [&_code]:text-ink",
    // A code block is held in a box with its copy button, which takes its
    // margins; the right of the block is left to the button. Its border and
    // the background of a code span tell code from text in the dark mode too,
    // where the sunken surface hardly differs from the answer's.
    "[&_pre]:overflow-x-auto [&_pre]:rounded-(--radius-control) [&_pre]:border [&_pre]:border-line [&_pre]:bg-surface-sunken [&_pre]:py-2 [&_pre]:pl-2 [&_pre]:pr-9 [&_pre]:whitespace-pre",
    "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
    "[&_blockquote]:border-l-2 [&_blockquote]:border-line [&_blockquote]:pl-3 [&_blockquote]:text-ink-muted",
    "[&_table]:w-full [&_table]:border-collapse [&_table]:text-data",
    "[&_th]:border [&_th]:border-line [&_th]:bg-surface-sunken [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-semibold",
    "[&_td]:border [&_td]:border-line [&_td]:px-2 [&_td]:py-1",
    "[&_hr]:my-3 [&_hr]:border-line"
);

// objects are the objects of the cluster by path, as the menu pills hold
// them: the code spans naming one become its badge. streaming, while the
// answer is written: its code blocks are not offered to copy yet.
const AiMarkdown = memo(function AiMarkdown({text, objects = null, streaming = false}) {
    return (
        <div className={PROSE}>
            <Streaming.Provider value={streaming}>
                <Source.Provider value={text}>
                    <ObjectsContext.Provider value={objects}>
                        <Markdown
                            skipHtml
                            allowedElements={elements}
                            remarkPlugins={plugins}
                            urlTransform={safeUrl}
                            components={components}
                        >
                            {text}
                        </Markdown>
                    </ObjectsContext.Provider>
                </Source.Provider>
            </Streaming.Provider>
        </div>
    );
});

export default AiMarkdown;
