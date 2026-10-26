import {createContext, memo, useContext} from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {cn} from "../ui/cn";
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
    pre: ({children}) => (
        <InBlock.Provider value={true}>
            <pre>{children}</pre>
        </InBlock.Provider>
    ),
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
    "[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-(--radius-control) [&_pre]:bg-surface-sunken [&_pre]:p-2 [&_pre]:whitespace-pre",
    "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
    "[&_blockquote]:border-l-2 [&_blockquote]:border-line [&_blockquote]:pl-3 [&_blockquote]:text-ink-muted",
    "[&_table]:w-full [&_table]:border-collapse [&_table]:text-data",
    "[&_th]:border [&_th]:border-line [&_th]:bg-surface-sunken [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-semibold",
    "[&_td]:border [&_td]:border-line [&_td]:px-2 [&_td]:py-1",
    "[&_hr]:my-3 [&_hr]:border-line"
);

// objects are the objects of the cluster by path, as the menu pills hold
// them: the code spans naming one become its badge.
const AiMarkdown = memo(function AiMarkdown({text, objects = null}) {
    return (
        <div className={PROSE}>
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
        </div>
    );
});

export default AiMarkdown;
