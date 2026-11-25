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
// An answer stopped or failed keeps the text it had: its last block, when
// the text ends in it before its closing fence, is a command cut short.
const Cut = createContext(null);

// The text of a node of the syntax tree, as written.
const textOf = (node) => {
    if (!node) return "";
    if (node.type === "text") return node.value;
    return (node.children ?? []).map(textOf).join("");
};

// The characters a reader does not see, or sees otherwise than a terminal
// takes them: controls but the tab and the line ends, the escape of the
// terminal sequences included, and the marks of direction or of no width.
const HIDDEN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/;

// Whether the code block of node, in the answer source, is cut short: the
// text ends in it, and no closing fence ends it (an indented block has none).
const cutShort = (node, source) => {
    const start = node?.position?.start?.offset;
    const end = node?.position?.end?.offset;
    if (start === undefined || end === undefined) return true;
    if (end < source.trimEnd().length) return false;
    const lines = source.slice(start, end).split("\n");
    const opening = /^[\s>]*(`{3,}|~{3,})/.exec(lines[0]);
    if (!opening || lines.length < 2) return true;
    const closing = lines.at(-1).replace(/^[\s>]*/, "").trimEnd();
    const fence = opening[1];
    return !(closing.length >= fence.length && [...closing].every((char) => char === fence[0]));
};

// A code block, a command or a script the user may run, copied as it is
// written, never run from the page. No copy is offered of a block a reader
// cannot check: blank, holding hidden characters, or cut short. The lines
// that end it are left out: pasted in a shell, they would run the command.
function CodeBlock({node, children}) {
    const {t} = useTranslation();
    const streaming = useContext(Streaming);
    const cut = useContext(Cut);
    const text = textOf(node).replace(/\n+$/, "");
    const copyable = !streaming && text.trim() !== "" && !HIDDEN.test(text) && !(cut !== null && cutShort(node, cut));
    return (
        <div className="relative my-2">
            <InBlock.Provider value={true}>
                <pre>{children}</pre>
            </InBlock.Provider>
            {copyable && (
                // The box hides the text that scrolls under the button; the
                // button stands out of the block, as it does elsewhere.
                <div className="absolute top-0 right-0 rounded-(--radius-control) bg-surface-sunken p-1">
                    <div className="rounded-(--radius-control) bg-surface">
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
    "[&_code]:rounded-sm [&_code]:bg-surface-sunken [&_code]:px-1 [&_code]:font-mono [&_code]:text-data",
    // A code block is held in a box with its copy button, which takes its
    // margins; the right of the block is left to the button.
    "[&_pre]:overflow-x-auto [&_pre]:rounded-(--radius-control) [&_pre]:bg-surface-sunken [&_pre]:py-2 [&_pre]:pl-2 [&_pre]:pr-9 [&_pre]:whitespace-pre",
    "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
    "[&_blockquote]:border-l-2 [&_blockquote]:border-line [&_blockquote]:pl-3 [&_blockquote]:text-ink-muted",
    "[&_table]:w-full [&_table]:border-collapse [&_table]:text-data",
    "[&_th]:border [&_th]:border-line [&_th]:bg-surface-sunken [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-semibold",
    "[&_td]:border [&_td]:border-line [&_td]:px-2 [&_td]:py-1",
    "[&_hr]:my-3 [&_hr]:border-line"
);

// objects are the objects of the cluster by path, as the menu pills hold
// them: the code spans naming one become its badge. streaming, while the
// answer is written: its code blocks are not offered to copy yet. cut, for
// an answer stopped or failed: its last block, unclosed, is not offered.
const AiMarkdown = memo(function AiMarkdown({text, objects = null, streaming = false, cut = false}) {
    return (
        <div className={PROSE}>
            <Streaming.Provider value={streaming}>
                <Cut.Provider value={cut ? text : null}>
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
                </Cut.Provider>
            </Streaming.Provider>
        </div>
    );
});

export default AiMarkdown;
