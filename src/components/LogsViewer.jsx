import React, {useEffect, useState, useRef, useCallback, useMemo, useId} from "react";
import {Button, IconButton} from "../ui/components/Button";
import {StateGlyph} from "../ui/components/StateGlyph";
import {Input, Checkbox} from "../ui/components/Field";
import {Alert} from "../ui/components/Alert";
import {Spinner} from "../ui/components/Spinner";
import {CaretRightIcon, ChevronDownIcon, CloseIcon, DownloadIcon, PauseIcon, SearchIcon, TrashIcon} from "../ui/icons";
import {cn} from "../ui/cn";
import {useFollowScroll} from "../hooks/useFollowScroll";
import {FollowOverlay} from "../ui/components/FollowOverlay";
import {NodeMarker} from "../ui/components/NodeMarker";
import {useClusterNodeOrder} from "../hooks/useClusterNodeOrder";
import {splitPrefixes} from "./logPrefixes";
import {URL_NODE} from "../config/apiPath.js";
import logger from '../utils/logger.js';
import {useTranslation} from "react-i18next";

/** The lines a stream starts with, as the daemon sends them by default. */
const STREAM_LINES = 50;
// A stream lost (ended, its connection cut) is read again a second later, then
// twice as late each time it is lost again without bringing anything, up to 30s.
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;
/** The older lines asked for at once, on demand. */
const BACKLOG_STEP = 200;
/** Past this many nodes, the marker would be wider than it helps: their names alone. */
const MARKER_MAX_NODES = 8;


const byTime = (a, b) => Number(a.__REALTIME_TIMESTAMP) - Number(b.__REALTIME_TIMESTAMP);

/**
 * The logs of a node, or of an object instance on a node, followed. Given several
 * `nodenames`, the logs of the instances of the object on each, one stream a node,
 * merged in the order of their time, as `ox <path> logs` does: each line then says
 * its node.
 *
 * Read as a terminal: the newest at the end, followed while the view is at the end.
 * Scrolled up, the view stays where it is, the lines read kept in place as the oldest
 * go, the new lines counted on a button taking back to the end. Older lines are read
 * on demand: the journal of each node read again, further back.
 */
const LogsViewer = ({
                        nodename,
                        nodenames,
                        type = "node",
                        namespace = "root",
                        kind = "svc",
                        instanceName,
                        maxLogs = 1000,
                        height = "500px",
                        bottomSpacing = 30,
                        filters = [],
                    }) => {
    const {t, i18n} = useTranslation();
    const [logs, setLogs] = useState([]);
    const [isPaused, setIsPaused] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const [levelFilter, setLevelFilter] = useState([]);
    // The lines asked for of each journal, more as older ones are read; the lines kept, as many more.
    const backlogRef = useRef(STREAM_LINES);
    const keepRef = useRef(maxLogs);
    const [loadingOlder, setLoadingOlder] = useState(false);
    const [noOlder, setNoOlder] = useState(false);
    const [isConnected, setIsConnected] = useState(false);
    const [errorMessage, setErrorMessage] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [selectedLogId, setSelectedLogId] = useState(null);
    const [shouldScrollToLog, setShouldScrollToLog] = useState(false);
    const logsEndRef = useRef(null);
    const logsContainerRef = useRef(null);
    const isPausedRef = useRef(false);
    const abortControllerRef = useRef(null);
    // The nodes whose stream is open: connected, all of them.
    const streamingRef = useRef(new Set());
    const nodesRef = useRef([]);
    const fetchLogsRef = useRef(null);
    const logBufferRef = useRef([]);
    const seenLogsRef = useRef(new Set());
    const scrollToLogTimeoutRef = useRef(null);
    const highlightTimeoutRef = useRef(null);
    const [highlightedLogId, setHighlightedLogId] = useState(null);
    const levelsLabelId = useId();
    // Read as a terminal: followed at the end; scrolled up, kept in place, the new lines counted.
    const shownKey = useMemo(() => ({}), [logs, searchTerm, levelFilter]);
    const {following, follow, newCount, countNew, resetNew, handleScroll, toEnd, scrollAge} = useFollowScroll({
        containerRef: logsContainerRef,
        items: shownKey,
        lineSelector: ".log-line",
        locale: i18n.language,
    });
    const nodesKey = (nodenames?.length ? nodenames : nodename ? [nodename] : []).join(",");
    const nodes = useMemo(() => (nodesKey === "" ? [] : nodesKey.split(",")), [nodesKey]);
    nodesRef.current = nodes;
    const merged = nodes.length > 1;
    // The nodes merged, in the order of the cluster, as om numbers them: each its column in the marker.
    const clusterOrder = useClusterNodeOrder(merged);
    const nodeIndex = useMemo(() => {
        const rank = (node) => {
            const i = clusterOrder?.indexOf(node) ?? -1;
            return i === -1 ? Number.MAX_SAFE_INTEGER : i;
        };
        const ordered = [...nodes].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
        return new Map(ordered.map((node, i) => [node, i]));
    }, [nodes, clusterOrder]);
    const marked = merged && nodes.length <= MARKER_MAX_NODES;
    // The columns of the lines, shared, for their texts to start at the same place:
    // the time with the level under it, the marker and the node merged, the text.
    const columns = [
        "max-content",
        ...(marked ? ["max-content"] : []),
        ...(merged ? ["max-content"] : []),
        "minmax(0, 1fr)",
    ].join(" ");

    useEffect(() => {
        isPausedRef.current = isPaused;
    }, [isPaused]);

    useEffect(() => {
        // Other logs: followed from their end, none older read yet.
        follow(true);
        backlogRef.current = STREAM_LINES;
        keepRef.current = maxLogs;
        setNoOlder(false);
        setSelectedLogId(null);
        setShouldScrollToLog(false);
    }, [nodesKey, type, namespace, kind, instanceName, maxLogs, follow]);

    /** The address of the logs of a node: followed, or `lines` of them read once. */
    const buildLogUrl = useCallback((node, {lines} = {}) => {
        let baseUrl;
        if (type === "instance" && instanceName && instanceName.trim() !== "") {
            baseUrl = `${URL_NODE}/${node}/instance/path/${namespace}/${kind}/${instanceName}/log`;
        } else {
            baseUrl = `${URL_NODE}/${node}/log`;
        }
        // The journal fields to match, `ORCHESTRATION_ID=…` for the logs of one orchestration.
        const filterQuery = filters.map((f) => `&filter=${encodeURIComponent(f)}`).join("");
        const read = lines === undefined ? "follow=true" : `follow=false&lines=${lines}`;
        return `${baseUrl}?${read}${filterQuery}`;
    }, [type, namespace, kind, instanceName, filters.join("\n")]);

    const buildSubtitle = useCallback(() => {
        const where = nodes.join(", ");
        if (type === "instance" && instanceName && instanceName.trim() !== "") {
            return t("logs.subtitle", {instance: instanceName, node: where});
        }
        return where;
    }, [type, nodes, instanceName, t]);

    const buildDownloadFilename = useCallback(() => {
        const timestamp = new Date().toISOString();
        const where = nodes.join("+");
        if (type === "instance" && instanceName && instanceName.trim() !== "") {
            return `${where}-${instanceName}-logs-${timestamp}.txt`;
        }
        return `${where}-logs-${timestamp}.txt`;
    }, [type, nodes, instanceName]);

    const parseLogMessage = useCallback(
        (logData, nodename) => {
            try {
                if (logData.JSON) {
                    const jsonData = JSON.parse(logData.JSON);
                    const message = jsonData.message || logData.MESSAGE || "";
                    return {
                        timestamp: new Date(jsonData.time || logData.__REALTIME_TIMESTAMP / 1000),
                        level: jsonData.level || "info",
                        message,
                        // The prefixes split once, as the entry is read.
                        ...splitPrefixes(message),
                        method: jsonData.method || logData.METHOD || "",
                        path: jsonData.path || logData.PATH || "",
                        node: jsonData.node || logData.NODE || nodename,
                        requestUuid: jsonData.request_uuid || logData.REQUEST_UUID || "",
                        pkg: jsonData.pkg || logData.PKG || "",
                        raw: logData,
                        __REALTIME_TIMESTAMP: logData.__REALTIME_TIMESTAMP,
                    };
                }
                const message = logData.MESSAGE || JSON.stringify(logData);
                return {
                    timestamp: new Date(parseInt(logData.__REALTIME_TIMESTAMP) / 1000),
                    level: "info",
                    message,
                    ...splitPrefixes(message),
                    node: logData.NODE || nodename,
                    raw: logData,
                    __REALTIME_TIMESTAMP: logData.__REALTIME_TIMESTAMP,
                };
            } catch (e) {
                logger.warn("Failed to parse log:", e);
                return {
                    timestamp: new Date(),
                    level: "info",
                    message: JSON.stringify(logData),
                    node: nodename,
                    raw: logData,
                    __REALTIME_TIMESTAMP: Date.now() * 1000,
                };
            }
        },
        []
    );

    const updateLogs = useCallback(() => {
        if (logBufferRef.current.length === 0 || isPausedRef.current) return;
        const fresh = logBufferRef.current;
        logBufferRef.current = [];
        // Scrolled up: the new lines counted, for the button taking back to the end.
        countNew(fresh.length);
        setLogs((prev) => {
            const all = [...prev, ...fresh];
            // The streams of several nodes, merged in the order of their time.
            if (merged) all.sort(byTime);
            return all.slice(-keepRef.current);
        });
    }, [merged, countNew]);

    /** The stream of a node open or not, said by the reading still current alone. */
    const markStream = useCallback((signal, nodename, open) => {
        if (abortControllerRef.current?.signal !== signal) return;
        if (open) streamingRef.current.add(nodename);
        else streamingRef.current.delete(nodename);
        setIsConnected(nodesRef.current.length > 0 && nodesRef.current.every((node) => streamingRef.current.has(node)));
    }, []);

    const fetchLogs = useCallback(
        async (signal, nodename, attempt = 0) => {
            if (isPausedRef.current || !nodename) return;
            // The stream lost, said and read again, the reading not stopped meanwhile.
            const reconnect = (next) => {
                markStream(signal, nodename, false);
                if (signal.aborted) return;
                setErrorMessage(t("logs.errors.reconnecting", {node: nodename}));
                const timer = setTimeout(() => {
                    if (!signal.aborted) void fetchLogsRef.current(signal, nodename, next);
                }, Math.min(RECONNECT_BASE_MS * 2 ** Math.min(next, 5), RECONNECT_MAX_MS));
                signal.addEventListener("abort", () => clearTimeout(timer), {once: true});
            };
            if (type === "instance" && (!instanceName || instanceName.trim() === "")) {
                setErrorMessage(t("logs.errors.instanceRequired"));
                return;
            }
            const token = localStorage.getItem("authToken");
            if (!token) {
                setErrorMessage(t("logs.errors.tokenNotFound"));
                markStream(signal, nodename, false);
                return;
            }
            // Lines brought by this connection: lost after, it is read again at once.
            let received = false;
            try {
                const url = buildLogUrl(nodename);
                const response = await fetch(url, {
                    method: "GET",
                    headers: {
                        Authorization: `Bearer ${token}`,
                        Accept: "text/event-stream",
                    },
                    signal,
                });
                if (!response.ok) {
                    setErrorMessage(t("logs.errors.http", {status: response.status}));
                    markStream(signal, nodename, false);
                    return;
                }
                if (!response.body) {
                    setErrorMessage(t("logs.errors.noStream"));
                    markStream(signal, nodename, false);
                    return;
                }
                markStream(signal, nodename, true);
                setErrorMessage("");
                setIsLoading(false);
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = "";
                while (true) {
                    const {value, done} = await reader.read();
                    if (done) break;
                    if (signal.aborted) {
                        reader.releaseLock();
                        return;
                    }
                    received = true;
                    buffer += decoder.decode(value, {stream: true});
                    const lines = buffer.split("\n");
                    buffer = lines.pop() || "";
                    for (const line of lines) {
                        if (line.startsWith("data: ") && !isPausedRef.current) {
                            try {
                                const jsonStr = line.slice(6).trim();
                                if (jsonStr) {
                                    const logData = JSON.parse(jsonStr);
                                    const parsedLog = parseLogMessage(logData, nodename);
                                    const timestamp = parsedLog.__REALTIME_TIMESTAMP;
                                    // Two nodes may log at the same instant: a line is its node's.
                                    const key = `${nodename}:${timestamp}`;
                                    if (timestamp && !seenLogsRef.current.has(key)) {
                                        seenLogsRef.current.add(key);
                                        // The node read, not the one an entry may name: its marker and its block.
                                        logBufferRef.current.push({...parsedLog, key, stream: nodename});
                                    }
                                }
                            } catch (e) {
                                logger.warn("Failed to parse log line:", e, line);
                            }
                        }
                    }
                    updateLogs();
                }
                updateLogs();
                reader.releaseLock();
                // Ended by the daemon (restarted, a proxy closing it idle): not followed any more.
                reconnect(received ? 0 : attempt + 1);
            } catch (error) {
                if (error.name === "AbortError" || signal.aborted) return;
                logger.error("Failed to fetch logs:", error);
                // The connection cut (the daemon or the network gone): read again.
                if (error instanceof TypeError) {
                    reconnect(received ? 0 : attempt + 1);
                    return;
                }
                markStream(signal, nodename, false);
                if (error.message.includes("401")) {
                    setErrorMessage(t("logs.errors.authFailed"));
                } else if (error.message.includes("404")) {
                    if (type === "instance") {
                        setErrorMessage(t("logs.errors.instanceNotFound", {instance: instanceName, node: nodename}));
                    } else {
                        setErrorMessage(t("logs.errors.nodeNotFound", {node: nodename}));
                    }
                } else {
                    setErrorMessage(t("logs.errors.fetchFailed", {message: error.message}));
                }
            } finally {
                setIsLoading(false);
            }
        },
        [type, instanceName, buildLogUrl, parseLogMessage, updateLogs, markStream, t]
    );
    fetchLogsRef.current = fetchLogs;

    const startStreaming = useCallback(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        setIsLoading(true);
        setErrorMessage("");
        const controller = new AbortController();
        abortControllerRef.current = controller;
        streamingRef.current = new Set();
        setIsConnected(false);
        for (const node of nodes) void fetchLogs(controller.signal, node);
    }, [fetchLogs, nodes]);

    /** The entries of a log read once, not followed: the whole answer, then its lines. */
    const readOnce = useCallback(async (node, lines) => {
        const token = localStorage.getItem("authToken");
        const response = await fetch(buildLogUrl(node, {lines}), {
            headers: {Authorization: `Bearer ${token}`, Accept: "text/event-stream"},
        });
        if (!response.ok) throw new Error(t("logs.errors.http", {status: response.status}));
        const text = await response.text();
        return text.split("\n")
            .filter((line) => line.startsWith("data: ") && line.slice(6).trim() !== "")
            .map((line) => parseLogMessage(JSON.parse(line.slice(6)), node));
    }, [buildLogUrl, parseLogMessage, t]);

    /**
     * Reads older lines: each journal again, as many more lines further back, as the
     * daemon counts them from the newest; the ones not shown yet put in their place in
     * time, kept on top of the lines kept. None, the beginning of the journals.
     */
    const loadOlder = useCallback(async () => {
        const lines = backlogRef.current + BACKLOG_STEP;
        setLoadingOlder(true);
        try {
            const batches = await Promise.all(nodes.map((node) => readOnce(node, lines)));
            // Keyed by the node read, as the stream keys its lines: a line shown is not again.
            const older = batches.flatMap((batch, i) => batch
                .map((log) => ({...log, key: `${nodes[i]}:${log.__REALTIME_TIMESTAMP}`, stream: nodes[i]}))
                .filter((log) => {
                    if (!log.__REALTIME_TIMESTAMP || seenLogsRef.current.has(log.key)) return false;
                    seenLogsRef.current.add(log.key);
                    return true;
                }));
            backlogRef.current = lines;
            if (older.length === 0) {
                setNoOlder(true);
                return;
            }
            keepRef.current += older.length;
            // Read from the top: not following, the view kept on the lines it shows.
            follow(false);
            setLogs((prev) => [...older, ...prev].sort(byTime).slice(-keepRef.current));
        } catch (error) {
            setErrorMessage(t("logs.errors.fetchFailed", {message: error.message}));
        } finally {
            setLoadingOlder(false);
        }
    }, [nodes, readOnce, follow, t]);

    const isFiltered = useMemo(() => {
        return levelFilter.length > 0 || searchTerm !== "";
    }, [levelFilter, searchTerm]);

    const filteredLogs = useMemo(() => {
        let filtered = logs;
        if (levelFilter.length > 0) {
            filtered = filtered.filter((log) => levelFilter.includes(log.level));
        }
        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            filtered = filtered.filter(
                (log) =>
                    log.message.toLowerCase().includes(term) ||
                    log.method?.toLowerCase().includes(term) ||
                    log.path?.toLowerCase().includes(term) ||
                    log.pkg?.toLowerCase().includes(term)
            );
        }
        return filtered;
    }, [logs, searchTerm, levelFilter]);

    useEffect(() => {
        if (shouldScrollToLog && selectedLogId) {
            if (scrollToLogTimeoutRef.current) {
                clearTimeout(scrollToLogTimeoutRef.current);
            }
            scrollToLogTimeoutRef.current = setTimeout(() => {
                const logElement = document.getElementById(`log-${selectedLogId}`);
                if (logElement && logsContainerRef.current) {
                    follow(false);
                    const container = logsContainerRef.current;
                    const elementRect = logElement.getBoundingClientRect();
                    const scrollTop =
                        logElement.offsetTop - container.clientHeight / 2 + elementRect.height / 2;
                    container.scrollTo({
                        top: scrollTop,
                        behavior: "smooth",
                    });
                    setHighlightedLogId(selectedLogId);
                    if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
                    highlightTimeoutRef.current = setTimeout(() => setHighlightedLogId(null), 2000);
                }
                setShouldScrollToLog(false);
            }, 100);
        }
        return () => {
            if (scrollToLogTimeoutRef.current) clearTimeout(scrollToLogTimeoutRef.current);
        };
    }, [shouldScrollToLog, selectedLogId, follow]);

    useEffect(() => () => {
        if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
    }, []);

    useEffect(() => {
        if (nodes.length === 0) return;
        if (type === "instance" && (!instanceName || instanceName.trim() === "")) {
            setErrorMessage(t("logs.errors.instanceRequired"));
            return;
        }
        if (!isPaused) startStreaming();
        return () => {
            if (abortControllerRef.current) abortControllerRef.current.abort();
        };
    }, [nodes, type, instanceName, startStreaming, isPaused, t]);

    useEffect(() => {
        if (isPaused) {
            if (abortControllerRef.current) abortControllerRef.current.abort();
        } else {
            startStreaming();
        }
    }, [isPaused, startStreaming]);

    const formatTime = (timestamp) =>
        timestamp.toLocaleTimeString(i18n.language, {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            fractionalSecondDigits: 3,
        });

    // The level in a state colour, its name doubling the colour.
    const getLevelClass = (level) => {
        switch (level) {
            case "error":
                return "text-state-down";
            case "warn":
            case "warning":
                return "text-state-warn";
            case "debug":
                return "text-ink-muted";
            default:
                return "text-ink";
        }
    };

    const handleLogClick = (log) => {
        if (isFiltered) {
            setSearchTerm("");
            setLevelFilter([]);
            setSelectedLogId(log.key ?? log.__REALTIME_TIMESTAMP);
            setShouldScrollToLog(true);
        }
    };

    const getLogId = (log) => `log-${log.key ?? log.__REALTIME_TIMESTAMP}`;

    const handleDownload = () => {
        const content = filteredLogs
            .map(
                (log) => `[${log.timestamp.toISOString()}] [${log.level.toUpperCase()}] ${log.message}`
            )
            .join("\n");
        const blob = new Blob([content], {type: "text/plain"});
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = buildDownloadFilename();
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleManualReconnect = () => {
        setErrorMessage("");
        setLogs([]);
        seenLogsRef.current.clear();
        startStreaming();
    };

    const handleClearLogs = () => {
        setLogs([]);
        logBufferRef.current = [];
        seenLogsRef.current.clear();
        resetNew();
    };

    const levelSummary = levelFilter.length === 0 ? t("logs.allLevels") : levelFilter.join(", ");

    return (
        <div className="flex h-full flex-col gap-2 text-ink">
            {/* Header: what is shown, the connection, the actions */}
            <div className="flex flex-wrap items-center gap-3">
                <span className="text-ink-muted">{buildSubtitle()}</span>
                <span
                    className="inline-flex items-center gap-1"
                    data-state={isConnected ? "up" : "down"}
                >
                    <span className={isConnected ? "text-state-up" : "text-state-down"}>
                        <StateGlyph state={isConnected ? "up" : "down"}/>
                    </span>
                    <span>{isConnected ? t("logs.connected") : t("logs.disconnected")}</span>
                </span>
                {isLoading && <Spinner label={t("logs.loading")}/>}
                <div className="ml-auto flex items-center gap-2">
                    {/* Following is about the view, the pause about the stream. */}
                    <Button
                        size="sm"
                        aria-pressed={following}
                        onClick={() => (following ? follow(false) : toEnd())}
                    >
                        {following ? t("logs.following") : t("logs.follow")}
                    </Button>
                    <Button
                        size="sm"
                        onClick={() => setIsPaused(!isPaused)}
                        aria-pressed={isPaused}
                        icon={isPaused ? <CaretRightIcon/> : <PauseIcon/>}
                    >
                        {isPaused ? t("logs.resume") : t("logs.pause")}
                    </Button>
                    <IconButton label={t("logs.clear")} onClick={handleClearLogs} disabled={logs.length === 0}>
                        <TrashIcon/>
                    </IconButton>
                    <IconButton label={t("logs.download")} onClick={handleDownload} disabled={filteredLogs.length === 0}>
                        <DownloadIcon/>
                    </IconButton>
                </div>
            </div>
            {errorMessage && (
                <Alert
                    tone="error"
                    action={
                        <Button size="sm" onClick={handleManualReconnect}>
                            {t("common.retry")}
                        </Button>
                    }
                >
                    {errorMessage}
                </Alert>
            )}
            {isLoading && !errorMessage && <Alert tone="info">{t("logs.loadingEllipsis")}</Alert>}
            {/* Filters, as the oc3 list toolbar */}
            <div className="flex flex-wrap items-center gap-3">
                <label className="flex min-w-[200px] flex-1 items-center gap-1 text-ink-muted">
                    <SearchIcon className="shrink-0"/>
                    <span className="sr-only">{t("common.search")}</span>
                    <Input
                        className="h-7"
                        placeholder={t("logs.searchPlaceholder")}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </label>
                <div className="flex items-center gap-1 text-ink-muted">
                    <span id={levelsLabelId}>{t("logs.levels")}</span>
                    <details className="relative">
                        <summary
                            aria-describedby={levelsLabelId}
                            className="flex h-7 cursor-pointer list-none items-center gap-1 rounded-(--radius-control) border border-line bg-surface px-2 text-ink [&::-webkit-details-marker]:hidden"
                        >
                            {levelSummary}
                            <ChevronDownIcon className="h-3 w-3 text-ink-muted"/>
                        </summary>
                        <div
                            role="group"
                            aria-label={t("logs.levelsGroup")}
                            className="absolute left-0 z-10 mt-1 flex min-w-[8rem] flex-col gap-1 rounded-(--radius-control) border border-line bg-surface-raised p-2 text-ink shadow-lg"
                        >
                            {["debug", "error", "info", "warn"].map((level) => (
                                <Checkbox
                                    key={level}
                                    label={level.charAt(0).toUpperCase() + level.slice(1)}
                                    checked={levelFilter.includes(level)}
                                    onChange={(e) =>
                                        setLevelFilter((prev) =>
                                            e.target.checked
                                                ? [...prev.filter((l) => l !== level), level]
                                                : prev.filter((l) => l !== level)
                                        )
                                    }
                                />
                            ))}
                        </div>
                    </details>
                </div>
                {isFiltered ? (
                    <span className="inline-flex items-center gap-1 rounded-(--radius-control) border border-line bg-surface-sunken pl-2 text-data">
                        {t("logs.filtersActive")}
                        <IconButton
                            size="sm"
                            label={t("logs.resetFilters")}
                            onClick={() => {
                                setSearchTerm("");
                                setLevelFilter([]);
                            }}
                        >
                            <CloseIcon className="h-3 w-3"/>
                        </IconButton>
                    </span>
                ) : null}
                <span className="ml-auto text-data text-ink-muted">
                    {t("logs.count", {shown: filteredLogs.length, total: logs.length})}
                </span>
            </div>
            {/* Log lines */}
            <div className="relative flex min-h-0 flex-1 flex-col">
                <div
                    ref={logsContainerRef}
                    onScroll={handleScroll}
                    role="log"
                    aria-live="off"
                    aria-label={t("logs.lines")}
                    tabIndex={0}
                    className="relative min-h-0 flex-1 overflow-auto py-1 font-mono text-data"
                    style={{height}}
                >
                    {/* The older lines, read on demand at the top. */}
                    {logs.length > 0 && (
                        <div className="flex justify-center py-1 font-sans">
                            {noOlder ? (
                                <span className="text-data text-ink-muted">{t("logs.noOlder")}</span>
                            ) : (
                                <Button size="sm" onClick={loadOlder} disabled={loadingOlder}>
                                    {loadingOlder ? t("logs.loadingOlder") : t("logs.loadOlder")}
                                </Button>
                            )}
                        </div>
                    )}
                    {filteredLogs.length === 0 ? (
                        <p className="pt-4 text-center font-sans text-ink-muted">
                            {logs.length === 0 && !isLoading
                                ? t("logs.empty")
                                : t("logs.noMatch")}
                        </p>
                    ) : (
                        <div className="grid gap-x-2" style={{gridTemplateColumns: columns}}>
                            {filteredLogs.map((log, i) => {
                                // Merged, a block a node: its marker and name on its first line, a
                                // faint marker after; a plainer line where the next node begins.
                                const node = log.stream ?? log.node;
                                const opens = i === 0 || (filteredLogs[i - 1].stream ?? filteredLogs[i - 1].node) !== node;
                                const next = filteredLogs[i + 1];
                                const closes = merged && next !== undefined && (next.stream ?? next.node) !== node;
                                return (
                                <div
                                    key={log.key ?? log.__REALTIME_TIMESTAMP}
                                    data-block-start={merged && opens ? "" : undefined}
                                    className={cn(
                                        // A very light line between entries, no frame around them.
                                        "log-line col-span-full grid grid-cols-subgrid items-baseline border-b px-2 py-0.5 transition-colors",
                                        closes ? "border-line" : "border-line/40",
                                        isFiltered && "cursor-pointer hover:bg-surface-raised",
                                        highlightedLogId === (log.key ?? log.__REALTIME_TIMESTAMP) && "bg-accent-soft"
                                    )}
                                    id={getLogId(log)}
                                    data-at={log.timestamp.getTime()}
                                    onClick={() => handleLogClick(log)}
                                >
                                    {/* The time, the level under it in its colour, the word alone. */}
                                    <span className="flex flex-col">
                                        <span className="text-ink-muted">{formatTime(log.timestamp)}</span>
                                        <span className={getLevelClass(log.level)}>{log.level.toUpperCase()}</span>
                                    </span>
                                    {marked && <NodeMarker count={nodes.length} index={nodeIndex.get(node) ?? 0} faint={!opens}/>}
                                    {merged && (
                                        // The name on the first line of its block; after, kept for assistive tools.
                                        <span className="text-ink-muted" data-node>
                                            {opens ? node : <span className="sr-only">{node}</span>}
                                        </span>
                                    )}
                                    {/* The message apart from what tells where and when, by a line: on
                                        a first line, what it is about, small badges; on the next, its text. */}
                                    <span className="flex min-w-0 flex-col border-l border-line pl-2">
                                        {(log.prefixes?.length > 0 || log.method || log.path) && (
                                            <span className="flex flex-wrap gap-1 font-sans" data-meta="">
                                                {[...(log.prefixes ?? []), log.method, log.path].filter(Boolean).map((meta, j) => (
                                                    <span
                                                        key={`${j}-${meta}`}
                                                        className="rounded-full border border-line/60 px-1.5 text-[0.6875rem] leading-4 text-ink-muted"
                                                    >
                                                        {meta}
                                                    </span>
                                                ))}
                                            </span>
                                        )}
                                        <span className="break-words whitespace-pre-wrap" data-text="">{log.text ?? log.message}</span>
                                    </span>
                                </div>
                                );
                            })}
                        </div>
                    )}
                    <div ref={logsEndRef} style={{height: bottomSpacing}}/>
                </div>
                <FollowOverlay
                    scrollAge={scrollAge}
                    following={following}
                    shown={filteredLogs.length > 0}
                    onEnd={toEnd}
                    label={newCount > 0 ? t("logs.newLines", {count: newCount}) : t("logs.latest")}
                />
            </div>
        </div>
    );
};

export default LogsViewer;
