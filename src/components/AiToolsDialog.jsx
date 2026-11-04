import {useEffect, useMemo, useState} from "react";
import {useTranslation} from "react-i18next";
import {Alert} from "../ui/components/Alert";
import {Dialog} from "../ui/components/Dialog";
import {Input} from "../ui/components/Field";
import {Spinner} from "../ui/components/Spinner";

// The groups of the tools: what reads, what acts once confirmed, what acts.
const GROUPS = [
    ["read", (tool) => tool.readOnly],
    ["confirmed", (tool) => !tool.readOnly && tool.needsConfirmation],
    ["act", (tool) => !tool.readOnly && !tool.needsConfirmation],
];

// The description past its summary, the first sentence the list shows
// already; the whole description when it does not start with it.
const restOf = (tool) => {
    const description = tool.description || "";
    const summary = (tool.summary || "").replace(/…$/, "");
    return (description.startsWith(summary) ? description.slice(summary.length) : description).trim();
};

// A tool of the list: its title, its name and its summary; one with more to
// tell unfolds in place, the rest of its description and its arguments, so
// that several read side by side and nothing is hidden.
function ToolItem({tool}) {
    const {t} = useTranslation();
    const rest = restOf(tool);
    const args = Object.entries(tool.arguments || {}).sort(([a], [b]) => a.localeCompare(b));
    const heading = (
        <>
            <span className="font-medium text-ink">{tool.title}</span>{" "}
            <code className="text-ink-muted">{tool.name}</code>
            {tool.summary && <span className="block text-ink-muted [overflow-wrap:anywhere]">{tool.summary}</span>}
        </>
    );
    if (!rest && args.length === 0) return <li>{heading}</li>;
    return (
        <li>
            <details>
                <summary className="cursor-pointer">{heading}</summary>
                <div className="mt-1 space-y-1 border-l-2 border-line pl-3">
                    {rest && <p className="whitespace-pre-line [overflow-wrap:anywhere]">{rest}</p>}
                    {args.length > 0 && (
                        <>
                            <p className="font-medium">{t("ai.tools.arguments")}</p>
                            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5">
                                {args.map(([name, description]) => (
                                    <div key={name} className="contents">
                                        <dt><code>{name}</code></dt>
                                        <dd className="min-w-0 text-ink-muted [overflow-wrap:anywhere]">{description}</dd>
                                    </div>
                                ))}
                            </dl>
                        </>
                    )}
                </div>
            </details>
        </li>
    );
}

const fold = (text) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/**
 * What the assistant can do: the tools the agent lists for the user, read
 * when the dialog opens, grouped by what they do and filtered by a text.
 */
export default function AiToolsDialog({open, client, onClose}) {
    const {t} = useTranslation();
    // error: the code of the failure, put in words when shown.
    const [state, setState] = useState({tools: null, error: "", loading: false});
    const [filter, setFilter] = useState("");

    useEffect(() => {
        if (!open || !client) return;
        const controller = new AbortController();
        setState({tools: null, error: "", loading: true});
        client.listTools({signal: controller.signal}).then(
            (tools) => setState({tools, error: "", loading: false}),
            (error) => {
                if (error?.name === "AbortError") return;
                setState({tools: null, error: error?.code === "tools_unavailable" ? "unavailable" : "failed", loading: false});
            }
        );
        return () => controller.abort();
    }, [open, client]);

    const groups = useMemo(() => {
        const words = fold(filter).split(/\s+/).filter(Boolean);
        const shown = (state.tools || []).filter((tool) => {
            const text = fold(`${tool.title} ${tool.name} ${tool.summary}`);
            return words.every((word) => text.includes(word));
        });
        return GROUPS.map(([key, belongs]) => [key, shown.filter(belongs).sort((a, b) => a.title.localeCompare(b.title))]).filter(([, tools]) => tools.length);
    }, [state.tools, filter]);

    return (
        <Dialog open={open} size="lg" title={t("ai.tools.title")} onClose={onClose}>
            <p className="mb-2 text-ink-muted">{t("ai.tools.intro")}</p>
            {state.loading && <Spinner label={t("ai.tools.loading")}/>}
            {state.error && <Alert>{t(`ai.tools.${state.error}`)}</Alert>}
            {state.tools && (
                <>
                    <Input
                        type="search"
                        aria-label={t("ai.tools.filter")}
                        placeholder={t("ai.tools.filter")}
                        value={filter}
                        onChange={(event) => setFilter(event.target.value)}
                    />
                    <p className="mt-1 text-ink-muted" aria-live="polite">
                        {t("ai.tools.count", {count: groups.reduce((total, [, tools]) => total + tools.length, 0)})}
                    </p>
                    <div className="mt-2 max-h-[60dvh] space-y-3 overflow-y-auto">
                        {groups.map(([key, tools]) => (
                            <section key={key} aria-labelledby={`ai-tools-${key}`}>
                                <h3 id={`ai-tools-${key}`} className="font-semibold">{t(`ai.tools.groups.${key}`)}</h3>
                                <ul className="mt-1 space-y-1.5">
                                    {tools.map((tool) => (
                                        <ToolItem key={tool.name} tool={tool}/>
                                    ))}
                                </ul>
                            </section>
                        ))}
                    </div>
                </>
            )}
        </Dialog>
    );
}
