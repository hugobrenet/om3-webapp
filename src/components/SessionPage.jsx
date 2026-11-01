import React, {useEffect} from "react";
import {useTranslation} from "react-i18next";
import {Navigate, useParams, useSearchParams} from "react-router-dom";
import {Button} from "../ui/components/Button";
import {parseObjectPath} from "../utils/objectUtils.jsx";
import {takeOpening} from "../app/resource-sessions";
import {SESSIONS, useSession} from "./ResourceConsole";

/**
 * A session on a resource in a browser tab of its own, with nothing of the webapp
 * around it: as many as wanted, each ending with its tab, whatever the webapp goes
 * on to show. Opened by a click it connects at once (`takeOpening`); by its URL, a
 * reload or a restored tab, it asks for Connect: a link opens no shell. Its tab is
 * named after it, to tell one from another, and leaving it live is asked first.
 */
export default function SessionPage() {
    const {t} = useTranslation();
    const {kind} = useParams();
    const [params] = useSearchParams();
    const path = params.get("path");
    const rid = params.get("rid");
    const node = params.get("node");
    const valid = Boolean(SESSIONS[kind] && path && rid && node);
    const {session, live, setStatus, connect, disconnect} = useSession();
    const label = t("console.tabTitle", {rid, node, path});
    const open = () => connect({node, ...parseObjectPath(path), rid});

    useEffect(() => {
        if (valid) document.title = label;
    }, [valid, label]);

    useEffect(() => {
        if (valid && takeOpening(`?${params}`)) open();
        // Once, as the tab opens.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!live) return undefined;
        const ask = (event) => event.preventDefault();
        window.addEventListener("beforeunload", ask);
        return () => window.removeEventListener("beforeunload", ask);
    }, [live]);

    if (!valid) return <Navigate to="/" replace/>;
    const Session = SESSIONS[kind];
    return (
        <div className="flex h-dvh flex-col gap-2 p-2 text-ink">
            <div className="flex items-center gap-3">
                <h1 className="min-w-0 truncate font-medium">{label}</h1>
                {live ? (
                    <Button size="sm" className="ml-auto" onClick={disconnect}>{t("console.disconnect")}</Button>
                ) : (
                    <Button size="sm" variant="change" className="ml-auto" onClick={open}>{t("console.connect")}</Button>
                )}
            </div>
            {session === null && (
                <p className="text-ink-muted">{t(kind === "display" ? "console.display.idle" : "console.idle", {node})}</p>
            )}
            {session !== null && (
                <div className="min-h-0 flex-1">
                    <Session key={session.id} target={session.target} onStatus={setStatus}/>
                </div>
            )}
        </div>
    );
}
