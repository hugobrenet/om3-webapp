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
                    <div className="mt-2 max-h-[60vh] space-y-3 overflow-y-auto">
                        {groups.map(([key, tools]) => (
                            <section key={key} aria-labelledby={`ai-tools-${key}`}>
                                <h3 id={`ai-tools-${key}`} className="font-semibold">{t(`ai.tools.groups.${key}`)}</h3>
                                <ul className="mt-1 space-y-1.5">
                                    {tools.map((tool) => (
                                        <li key={tool.name}>
                                            <span className="font-medium text-ink">{tool.title}</span>{" "}
                                            <code className="text-ink-muted">{tool.name}</code>
                                            {tool.summary && <p className="text-ink-muted [overflow-wrap:anywhere]">{tool.summary}</p>}
                                        </li>
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
