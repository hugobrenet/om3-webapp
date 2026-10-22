import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {useTranslation} from "react-i18next";
import {Button, IconButton} from "../ui/components/Button";
import {StateGlyph} from "../ui/components/StateGlyph";
import {Input, Select} from "../ui/components/Field";
import {Alert} from "../ui/components/Alert";
import {FollowOverlay} from "../ui/components/FollowOverlay";
import {CaretRightIcon, DownloadIcon, PauseIcon, SearchIcon, TrashIcon} from "../ui/icons";
import {useFollowScroll} from "../hooks/useFollowScroll";
import {URL_NODE} from "../config/apiPath.js";
import {parseObjectPath} from "../utils/objectUtils.jsx";

// The last lines of the container read on opening; the lines kept, the oldest dropped.
const TAIL_LINES = 200;
const KEEP_LINES = 2000;
// A stream lost while the container runs is read again a second later, then twice
// as late each time it is lost again before it lasted STABLE_MS, up to 30s.
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const STABLE_MS = 10000;
// What the runtime answers, as the daemon passes it on (an HTTP 200), when there is
// no container to read: docker "No such container: x", podman "no container with name or ID".
const NO_CONTAINER = /no such container|no container with (name|id)/i;

/** A resource is a container by its type (`container.docker`…), else by its section. */
export const isContainerResource = (rid, type) => (type ? type.startsWith("container") : rid.startsWith("container#"));

/**
 * What a container writes, on one node, as `om <path> container logs` reads it: the
 * lines of its process, its own text, followed. The daemon serves them to root only
 * (GET …/instance/path/…/container/log). One node at a time, chosen among the nodes
 * of the resource; the first where it is up at first. Not up on that node (its
 * status, `upNodes`), a stream ended is not read again until it is: a container
 * stopped, or removed as it stopped (`rm`), has nothing more to say.
 */
export function ContainerLogs({path, rid, nodes, upNodes = []}) {
    const {t, i18n} = useTranslation();
    const {namespace, kind, name} = parseObjectPath(path);
    // The node picked, while the resource is on it; else the first where it is up,
    // known once the instances are (the panel may open before them).
    const [picked, setNode] = useState(null);
    const node = picked !== null && nodes.includes(picked) ? picked : upNodes.find((n) => nodes.includes(n)) ?? nodes[0];
    const [lines, setLines] = useState([]);
    const [connected, setConnected] = useState(false);
    const [error, setError] = useState("");
    const [lost, setLost] = useState(false);
    // No container on the node: the runtime said so.
    const [absent, setAbsent] = useState(false);
    const nodeUp = upNodes.includes(node);
    const [paused, setPaused] = useState(false);
    const [search, setSearch] = useState("");
    const containerRef = useRef(null);
    const nextId = useRef(0);

    const shown = useMemo(() => {
        const term = search.toLowerCase();
        return term ? lines.filter((line) => line.text.toLowerCase().includes(term)) : lines;
    }, [lines, search]);
    // Read as a terminal: followed at the end; scrolled up, kept in place, the new lines counted.
    const shownKey = useMemo(() => ({}), [shown]);
    const {following, follow, newCount, countNew, resetNew, handleScroll, toEnd, scrollAge} = useFollowScroll({
        containerRef,
        items: shownKey,
        lineSelector: ".container-log-line",
        locale: i18n.language,
    });

    const url = useCallback((tail) => `${URL_NODE}/${encodeURIComponent(node)}/instance/path/${[namespace, kind, name].map(encodeURIComponent).join("/")}/container/log?rid=${encodeURIComponent(rid)}&follow=true&lines=${tail}`,
        [node, namespace, kind, name, rid]);

    // The stream of the node chosen, while not paused; read again when lost, its
    // last lines then not read twice (`lines=0`).
    useEffect(() => {
        if (!node || paused) return undefined;
        const controller = new AbortController();
        const {signal} = controller;
        let timer = null;

        const read = async (tail, attempt) => {
            const started = Date.now();
            let missing = false;
            try {
                const response = await fetch(url(tail), {
                    headers: {Authorization: `Bearer ${localStorage.getItem("authToken") || ""}`, Accept: "text/event-stream"},
                    signal,
                });
                if (!response.ok) {
                    setConnected(false);
                    setError(response.status === 403 ? t("containerLogs.forbidden") : t("logs.errors.http", {status: response.status}));
                    return;
                }
                setConnected(true);
                setLost(false);
                setAbsent(false);
                setError("");
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = "";
                while (true) {
                    const {value, done} = await reader.read();
                    if (signal.aborted) break;
                    buffer += done ? decoder.decode() : decoder.decode(value, {stream: true});
                    const parts = buffer.split("\n");
                    // The line begun kept for the next chunk; ended, the last one whole, if any.
                    const rest = parts.pop() ?? "";
                    buffer = done ? "" : rest;
                    if (done && rest !== "") parts.push(rest);
                    // The runtime saying there is no container: said apart, not a line of it.
                    const said = parts.map((text) => text.replace(/\r$/, "")).filter((text) => {
                        if (!NO_CONTAINER.test(text)) return true;
                        missing = true;
                        return false;
                    });
                    if (said.length > 0) {
                        const at = Date.now();
                        const fresh = said.map((text) => ({id: nextId.current++, text, at}));
                        countNew(fresh.length);
                        setLines((prev) => [...prev, ...fresh].slice(-KEEP_LINES));
                    }
                    if (done) break;
                }
            } catch (err) {
                if (signal.aborted) return;
            }
            if (signal.aborted) return;
            setConnected(false);
            setAbsent(missing);
            // Not up there: nothing to read until it is (the effect reads again then).
            if (!nodeUp) {
                setLost(false);
                return;
            }
            // Up, yet ended or cut (the daemon restarted, the status behind): read again,
            // later each time the stream did not last.
            setLost(!missing);
            const next = Date.now() - started >= STABLE_MS ? 0 : attempt + 1;
            timer = setTimeout(() => void read(0, next), Math.min(RECONNECT_BASE_MS * 2 ** Math.min(next, 5), RECONNECT_MAX_MS));
        };

        void read(lines.length === 0 ? TAIL_LINES : 0, 0);
        return () => {
            controller.abort();
            if (timer) clearTimeout(timer);
            setConnected(false);
        };
        // The lines read already only decide how much to read back: not a reason to read again.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [node, nodeUp, paused, url, t, countNew]);

    const choose = (next) => {
        setLines([]);
        setLost(false);
        setAbsent(false);
        setError("");
        resetNew();
        setNode(next);
    };

    const clear = () => {
        setLines([]);
        resetNew();
    };

    const download = () => {
        const blob = new Blob([shown.map((line) => line.text).join("\n")], {type: "text/plain"});
        const href = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = href;
        a.download = `${node}-${path.replaceAll("/", "_")}-${rid.replace("#", "_")}-${new Date().toISOString()}.log`;
        a.click();
        URL.revokeObjectURL(href);
    };

    if (nodes.length === 0) return <p className="py-4 text-center text-ink-muted">{t("panel.logs.noNode")}</p>;

    return (
        <div className="flex h-[calc(100dvh-10rem)] flex-col gap-2 text-ink">
            <div className="flex flex-wrap items-center gap-3">
                {nodes.length > 1 ? (
                    <label className="flex items-center gap-1 text-ink-muted">
                        {t("common.node")}
                        <Select className="h-7" value={node} onChange={(e) => choose(e.target.value)} aria-label={t("containerLogs.node")}>
                            {nodes.map((n) => <option key={n} value={n}>{n}</option>)}
                        </Select>
                    </label>
                ) : (
                    <span className="text-ink-muted">{node}</span>
                )}
                <span className="inline-flex items-center gap-1" data-state={connected ? "up" : "down"}>
                    <span className={connected ? "text-state-up" : "text-state-down"}>
                        <StateGlyph state={connected ? "up" : "down"}/>
                    </span>
                    <span>{connected ? t("logs.connected") : t("logs.disconnected")}</span>
                </span>
                <div className="ml-auto flex items-center gap-2">
                    <Button
                        size="sm"
                        aria-pressed={following}
                        onClick={() => (following ? follow(false) : toEnd())}
                    >
                        {following ? t("logs.following") : t("logs.follow")}
                    </Button>
                    <Button
                        size="sm"
                        onClick={() => setPaused((p) => !p)}
                        aria-pressed={paused}
                        icon={paused ? <CaretRightIcon/> : <PauseIcon/>}
                    >
                        {paused ? t("logs.resume") : t("logs.pause")}
                    </Button>
                    <IconButton label={t("logs.clear")} onClick={clear} disabled={lines.length === 0}>
                        <TrashIcon/>
                    </IconButton>
                    <IconButton label={t("logs.download")} onClick={download} disabled={shown.length === 0}>
                        <DownloadIcon/>
                    </IconButton>
                </div>
            </div>
            {error && <Alert tone="error">{error}</Alert>}
            {lost && !error && <Alert tone="warning">{t("containerLogs.lost", {node})}</Alert>}
            {!error && !lost && !connected && !paused && (absent || !nodeUp) && (
                <Alert tone="info">
                    {absent ? t("containerLogs.absent", {rid, node}) : t("containerLogs.stopped", {rid, node})}
                </Alert>
            )}
            <div className="flex flex-wrap items-center gap-3">
                <label className="flex min-w-[200px] flex-1 items-center gap-1 text-ink-muted">
                    <SearchIcon className="shrink-0"/>
                    <span className="sr-only">{t("common.search")}</span>
                    <Input className="h-7" placeholder={t("logs.searchPlaceholder")} value={search} onChange={(e) => setSearch(e.target.value)}/>
                </label>
                <span className="ml-auto text-data text-ink-muted">
                    {t("containerLogs.count", {shown: shown.length, total: lines.length})}
                </span>
            </div>
            <div className="relative flex min-h-0 flex-1 flex-col">
                <div
                    ref={containerRef}
                    onScroll={handleScroll}
                    role="log"
                    aria-live="off"
                    aria-label={t("containerLogs.lines")}
                    tabIndex={0}
                    className="min-h-0 flex-1 overflow-auto rounded-(--radius-control) border border-line bg-surface-sunken px-2 py-1 font-mono text-data"
                >
                    {shown.length === 0 ? (
                        <p className="py-4 text-center font-sans text-ink-muted">
                            {lines.length === 0 ? t("containerLogs.empty") : t("logs.noMatch")}
                        </p>
                    ) : shown.map((line) => (
                        <div key={line.id} id={`container-log-${line.id}`} data-at={line.at} className="container-log-line whitespace-pre-wrap break-all">
                            {line.text}
                        </div>
                    ))}
                </div>
                <FollowOverlay
                    scrollAge={scrollAge}
                    following={following}
                    shown={shown.length > 0}
                    onEnd={toEnd}
                    label={newCount > 0 ? t("logs.newLines", {count: newCount}) : t("logs.latest")}
                />
            </div>
        </div>
    );
}
