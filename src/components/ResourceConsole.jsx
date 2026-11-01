import React, {useCallback, useEffect, useRef, useState} from "react";
import {useTranslation} from "react-i18next";
import {useHref} from "react-router-dom";
import {Button, buttonClass} from "../ui/components/Button";
import {Select} from "../ui/components/Field";
import {cn} from "../ui/cn";
import {parseObjectPath} from "../utils/objectUtils.jsx";
import {markOpening, sessionPage} from "../app/resource-sessions";
import ConsoleTerminal, {CONSOLE_STATUS} from "./ConsoleTerminal.jsx";
import ConsoleDisplay from "./ConsoleDisplay.jsx";

export const SESSIONS = {console: ConsoleTerminal, display: ConsoleDisplay};
const isLive = (status) => status === CONSOLE_STATUS.connecting || status === CONSOLE_STATUS.open;

/** A session to open and end: each connection one of its own, its target as it was asked. */
export function useSession() {
    const [session, setSession] = useState(null);
    const [status, setStatus] = useState(null);
    const count = useRef(0);
    const connect = useCallback((target) => {
        count.current += 1;
        setStatus(CONSOLE_STATUS.connecting);
        setSession({id: count.current, target});
    }, []);
    const disconnect = useCallback(() => {
        setSession(null);
        setStatus(null);
    }, []);
    return {session, live: session !== null && isLive(status), setStatus, connect, disconnect};
}

/**
 * A session on a resource, on one node, in a tab of its panel: `kind` "console", a
 * terminal, or "display", the screen of a guest. The tab is in the URL, so nothing
 * opens by itself, a link or a reload opening no shell: Connect does. The node is
 * the first where the resource runs (`upNodes`), another one picked among `nodes`,
 * and stays the one of the session whatever its status says after. Mounted as long
 * as the panel is, `hidden` while another tab is shown, the session survives a look
 * at the logs. Its keys are its own, the Escape of an editor closing no panel. A
 * session in a browser tab of its own (SessionPage) is another one, which neither
 * this one nor what the webapp navigates to ends.
 */
export function ResourceConsole({kind, path, rid, nodes, upNodes, hidden = false, onLive}) {
    const {t} = useTranslation();
    const object = parseObjectPath(path);
    const [picked, setPicked] = useState(null);
    const node = picked !== null && nodes.includes(picked) ? picked : upNodes.find((n) => nodes.includes(n)) ?? nodes[0];
    const {session, live, setStatus, connect, disconnect} = useSession();
    const running = upNodes.includes(node);
    const page = sessionPage(kind, {path, rid, node: node ?? ""});
    const pageHref = useHref(page);

    useEffect(() => {
        onLive?.(kind, live);
        return () => onLive?.(kind, false);
    }, [kind, live, onLive]);

    if (nodes.length === 0) {
        return hidden ? null : <p className="py-4 text-center text-ink-muted">{t("panel.logs.noNode")}</p>;
    }

    const Session = SESSIONS[kind];
    const opening = () => markOpening(page.slice(page.indexOf("?")));

    return (
        <div hidden={hidden} className={cn("flex h-[calc(100dvh-10rem)] flex-col gap-2 text-ink", hidden && "hidden")} data-resource-session={kind}>
            <div className="flex flex-wrap items-center gap-3">
                {nodes.length > 1 ? (
                    <label className="flex items-center gap-1 text-ink-muted">
                        {t("common.node")}
                        <Select className="h-7" value={node} disabled={live} onChange={(e) => setPicked(e.target.value)} aria-label={t("console.node")}>
                            {nodes.map((n) => <option key={n} value={n}>{n}</option>)}
                        </Select>
                    </label>
                ) : (
                    <span className="text-ink-muted">{node}</span>
                )}
                {live ? (
                    <Button size="sm" onClick={disconnect}>{t("console.disconnect")}</Button>
                ) : (
                    <Button size="sm" variant="change" disabled={!running} onClick={() => connect({node, ...object, rid})}>{t("console.connect")}</Button>
                )}
                {running ? (
                    <a
                        href={pageHref}
                        target="_blank"
                        rel="noreferrer"
                        onClick={opening}
                        onAuxClick={opening}
                        className={buttonClass("secondary", "sm", "ml-auto")}
                    >
                        {t("console.newTab")}
                    </a>
                ) : (
                    <Button size="sm" className="ml-auto" disabled>{t("console.newTab")}</Button>
                )}
            </div>
            {!running && !live && <p className="text-ink-muted">{t("console.notRunning", {node})}</p>}
            {session === null && running && (
                <p className="text-ink-muted">{t(kind === "display" ? "console.display.idle" : "console.idle", {node})}</p>
            )}
            {session !== null && (
                <div
                    onKeyDown={(event) => event.stopPropagation()}
                    className="min-h-0 flex-1"
                >
                    <Session key={session.id} target={session.target} onStatus={setStatus}/>
                </div>
            )}
        </div>
    );
}
