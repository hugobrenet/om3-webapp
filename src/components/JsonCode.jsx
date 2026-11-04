import React, {useMemo, useState} from "react";
import {useTranslation} from "react-i18next";
import {IconButton} from "../ui/components/Button";
import {CopyButton} from "../ui/components/CopyButton";
import {Dialog} from "../ui/components/Dialog";
import {CodeIcon} from "../ui/icons";

/** Text of the JSON, or what the value says of itself when it cannot be serialised. */
export const toJSON = (data, indent) => {
    try {
        return JSON.stringify(data, null, indent) ?? String(data);
    } catch {
        return String(data);
    }
};

const JSON_TOKEN = /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g;

/** Class names written out in full, for Tailwind. */
const TOKEN_CLASSES = {
    key: "text-code-key font-semibold",
    string: "text-code-string",
    number: "text-code-number",
    boolean: "text-code-keyword font-semibold",
    null: "text-code-keyword font-semibold",
};

/** Splits a JSON text into coloured tokens; between them, only punctuation and spaces. */
const highlightJSON = (json) => {
    const parts = [];
    let last = 0;
    for (const match of json.matchAll(JSON_TOKEN)) {
        const text = match[0];
        if (match.index > last) {
            parts.push({kind: "punct", text: json.slice(last, match.index)});
        }
        if (text.startsWith('"')) {
            if (match[3]) {
                const colon = text.length - match[3].length;
                parts.push({kind: "key", text: text.slice(0, colon)});
                parts.push({kind: "punct", text: text.slice(colon)});
            } else {
                parts.push({kind: "string", text});
            }
        } else if (text === "true" || text === "false") {
            parts.push({kind: "boolean", text});
        } else if (text === "null") {
            parts.push({kind: "null", text});
        } else {
            parts.push({kind: "number", text});
        }
        last = match.index + text.length;
    }
    if (last < json.length) parts.push({kind: "punct", text: json.slice(last)});
    return parts;
};

/** A value as JSON, indented, its syntax coloured. */
export function JsonCode({data}) {
    const parts = useMemo(() => highlightJSON(toJSON(data, 2)), [data]);
    return (
        <pre className="m-0 font-mono text-data leading-snug break-words whitespace-pre-wrap text-ink">
            {parts.map((part, i) => (
                <span
                    key={i}
                    data-token={part.kind}
                    className={part.kind === "punct" ? "text-code-punct" : TOKEN_CLASSES[part.kind]}
                >
                    {part.text}
                </span>
            ))}
        </pre>
    );
}

/**
 * A `</>` button, for a section title, opening the data the section shows as JSON:
 * all of it, what the section leaves out too. The data is live: the dialog follows
 * its updates while open.
 */
export function RawDataButton({title, data}) {
    const {t} = useTranslation();
    const [open, setOpen] = useState(false);
    if (data === undefined || data === null) return null;
    return (
        <>
            <IconButton size="sm" label={t("rawData.show", {title})} onClick={() => setOpen(true)}>
                <CodeIcon className="h-3 w-3"/>
            </IconButton>
            <Dialog
                open={open}
                title={t("rawData.title", {title})}
                onClose={() => setOpen(false)}
                size="lg"
                footer={<CopyButton text={toJSON(data, 2)} label={t("rawData.copy")}/>}
            >
                <div className="max-h-[70dvh] overflow-auto">
                    <JsonCode data={data}/>
                </div>
            </Dialog>
        </>
    );
}
