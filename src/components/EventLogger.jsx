import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {Button, IconButton} from "../ui/components/Button";
import {Checkbox, Input} from "../ui/components/Field";
import {SlideOver} from "../ui/components/SlideOver";
import {Spinner} from "../ui/components/Spinner";
import {useAnyPanelOpen} from "../ui/components/slide-over-open";
import {CaretRightIcon, ChevronDownIcon, CloseIcon, DownloadIcon, GearIcon, PauseIcon, RssIcon, SearchIcon, TrashIcon} from "../ui/icons";
import {StateGlyph} from "../ui/components/StateGlyph";
import {cn} from "../ui/cn";
import useEventLogStore from "../hooks/useEventLogStore";
import logger from "../utils/logger.js";
import {startLoggerReception, closeLoggerEventSource} from "../eventSourceManager";
import {parseObjectPath} from "../utils/objectUtils.jsx";
import {useTranslation} from "react-i18next";
import {useFollowScroll} from "../hooks/useFollowScroll";
import {FollowOverlay} from "../ui/components/FollowOverlay";

const CONNECTION_EVENTS = [
    'CONNECTION_OPENED',
    'CONNECTION_ERROR',
    'RECONNECTION_ATTEMPT',
    'MAX_RECONNECTIONS_REACHED',
    'CONNECTION_CLOSED'
];

const ALL_EVENT_TYPES = [
    'NodeStatusUpdated',
    'NodeMonitorUpdated',
    'NodeStatsUpdated',
    'DaemonHeartbeatUpdated',
    'ObjectStatusUpdated',
    'InstanceStatusUpdated',
    'ObjectDeleted',
    'InstanceMonitorUpdated',
    'InstanceConfigUpdated'
];

export const hashCode = (str) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
};

/** Larger tap targets on narrow screens. */
const TOOL = "max-md:h-9 max-md:w-9";

const SubscriptionDialog = ({
                                open,
                                onClose,
                                subscribedEventTypes,
                                setManualSubscriptions,
                                filteredEventTypes,
                                eventStats,
                                clearLogs
                            }) => {
    const {t} = useTranslation();
    const [tempSubscribedEventTypes, setTempSubscribedEventTypes] = useState(subscribedEventTypes);

    useEffect(() => {
        if (open) {
            setTempSubscribedEventTypes(subscribedEventTypes);
        }
    }, [open, subscribedEventTypes]);

    const otherEventTypes = useMemo(() => {
        return ALL_EVENT_TYPES.filter(type => !filteredEventTypes.includes(type)).sort();
    }, [filteredEventTypes]);

    const handleSubscribeAll = () => {
        setTempSubscribedEventTypes([...ALL_EVENT_TYPES]);
    };

    const handleSubscribePageEvents = () => {
        const currentOther = tempSubscribedEventTypes.filter(
            type => !filteredEventTypes.includes(type)
        );
        setTempSubscribedEventTypes(
            [...new Set([...currentOther, ...filteredEventTypes])]
        );
    };

    const handleUnsubscribeAll = () => {
        setTempSubscribedEventTypes([]);
    };

    const renderEventTypeList = (eventTypes, isPageEvents = false) => (
        <section className="space-y-1">
            <h3 className={cn("font-semibold", isPageEvents ? "text-accent" : "text-ink-muted")}>
                {isPageEvents
                    ? t("events.subscriptions.pageEvents", {total: eventTypes.length})
                    : t("events.subscriptions.additionalEvents", {total: eventTypes.length})}
            </h3>
            {eventTypes.sort().map(eventType => (
                <div key={String(eventType)} className="py-0.5 pl-2">
                    <Checkbox
                        checked={tempSubscribedEventTypes.includes(eventType)}
                        onChange={(e) => {
                            const checked = e.target.checked;
                            setTempSubscribedEventTypes(prev =>
                                checked
                                    ? [...new Set([...prev, eventType])]
                                    : prev.filter(et => et !== eventType)
                            );
                        }}
                        label={
                            <span className="flex flex-col leading-tight">
                                <span>{eventType}</span>
                                <span className="text-data text-ink-muted">
                                    {t("events.subscriptions.received", {count: eventStats[eventType] || 0})}
                                </span>
                            </span>
                        }
                    />
                </div>
            ))}
        </section>
    );

    return (
        // Above the bottom panel of the event logger.
        <div className="relative z-[1250]">
            <SlideOver
                open={open}
                onClose={onClose}
                title={t("events.subscriptions.title")}
                closeLabel={t("events.subscriptions.close")}
            >
                <div className="flex min-h-full flex-col gap-4">
                    <p className="text-ink-muted">
                        {t("events.subscriptions.intro")}
                    </p>
                    <div className="flex flex-wrap gap-2">
                        <Button size="sm" onClick={handleSubscribeAll}>
                            {t("events.subscriptions.subscribeAll")}
                        </Button>
                        <Button
                            size="sm"
                            onClick={handleSubscribePageEvents}
                            disabled={filteredEventTypes.length === 0}
                        >
                            {t("events.subscriptions.subscribePage")}
                        </Button>
                        <Button size="sm" className="text-state-down" onClick={handleUnsubscribeAll}>
                            {t("events.subscriptions.unsubscribeAll")}
                        </Button>
                    </div>
                    <div className="space-y-4">
                        {filteredEventTypes.length > 0 && renderEventTypeList(filteredEventTypes, true)}
                        {otherEventTypes.length > 0 && renderEventTypeList(otherEventTypes, false)}
                        {tempSubscribedEventTypes.length === 0 && (
                            <p className="py-8 text-center text-ink-muted">
                                {t("events.subscriptions.noneSelected")}
                            </p>
                        )}
                    </div>
                    <div className="sticky bottom-0 mt-auto bg-surface-raised pt-2">
                        <Button
                            className="w-full"
                            onClick={() => {
                                setManualSubscriptions(tempSubscribedEventTypes);
                                clearLogs();
                                onClose();
                            }}
                        >
                            {t("events.subscriptions.apply", {total: tempSubscribedEventTypes.length})}
                        </Button>
                    </div>
                </div>
            </SlideOver>
        </div>
    );
};

/** Text of the JSON, or what the value says of itself when it cannot be serialised. */
const toJSON = (data, indent) => {
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

const FullJSONView = ({data}) => {
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
};

const formatTimestamp = (ts, language) => {
    try {
        return new Date(ts).toLocaleTimeString(language, {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            fractionalSecondDigits: 3
        });
    } catch {
        return "INVALID_DATE";
    }
};

/** Tone of an event type: the label itself tells the type, the colour only doubles it. */
const getEventTone = (eventType = "") => {
    if (eventType.includes("ERROR")) return "error";
    if (eventType.includes("UPDATED")) return "primary";
    if (eventType.includes("DELETED")) return "warning";
    if (eventType.includes("CONNECTION")) return "info";
    return "default";
};

const TONE_CLASSES = {
    error: "text-state-down",
    primary: "text-accent",
    warning: "text-state-warn",
    info: "text-ink-muted",
    default: "text-ink",
};

const LogRow = React.memo(({log, isOpen, onToggle}) => {
    const {i18n} = useTranslation();
    const tone = getEventTone(log.eventType);
    const preview = useMemo(() => (isOpen ? "" : toJSON(log.data, 0)), [isOpen, log.data]);
    return (
        <li className={cn("border-b border-line", isOpen && "bg-surface-sunken")}>
            <button
                type="button"
                onClick={onToggle}
                aria-expanded={isOpen}
                className="flex h-[30px] w-full touch-manipulation items-center gap-2 px-3 text-left text-data hover:bg-surface-sunken"
            >
                <span className="shrink-0 tabular-nums text-ink-muted">{formatTimestamp(log.timestamp, i18n.language)}</span>
                <span data-tone={tone} className={cn("shrink-0 font-semibold", TONE_CLASSES[tone])}>
                    {log.eventType}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-ink-muted">{preview}</span>
                <ChevronDownIcon
                    className={cn("ml-auto shrink-0 text-ink-muted transition-transform", isOpen && "rotate-180")}
                />
            </button>
            {isOpen && (
                <div className="border-t border-line bg-surface px-3 py-2">
                    <FullJSONView data={log.data}/>
                </div>
            )}
        </li>
    );
}, (prevProps, nextProps) => {
    return prevProps.log === nextProps.log &&
        prevProps.isOpen === nextProps.isOpen;
});

/** The events a feed shows at first, and more at once, of those kept. */
const FEED_PAGE = 100;

/**
 * An event in a feed, as a log line: its time, its type under it in its tone; its
 * node on a column of its own, as the logs of several nodes; past a line, what it is
 * about, a small badge (its object), then its data in a line. A click opens its data
 * in full under it.
 */
const FeedRow = React.memo(({log, isOpen, onToggle}) => {
    const {t, i18n} = useTranslation();
    const tone = getEventTone(log.eventType);
    const preview = useMemo(() => (isOpen ? "" : toJSON(log.data, 0)), [isOpen, log.data]);
    const path = logPath(log);
    const node = log.data?.node ?? log.data?.labels?.node;
    const id = log.id ?? `${log.timestamp}-${log.eventType}`;
    return (
        <div
            id={`event-${id}`}
            data-at={new Date(log.timestamp).getTime()}
            className={cn("event-line col-span-full grid grid-cols-subgrid border-b border-line/40", isOpen && "bg-surface-sunken")}
        >
            <div
                role="button"
                tabIndex={0}
                aria-expanded={isOpen}
                title={isOpen ? t("events.hideData") : t("events.showData")}
                onClick={onToggle}
                onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    onToggle();
                }}
                className="col-span-full grid cursor-pointer grid-cols-subgrid items-baseline px-2 py-0.5 hover:bg-surface-sunken focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--focus-ring)"
            >
                {/* A caret before the time says the line opens, turned once open; the
                    time, the type under it in its tone. */}
                <span className="flex items-start gap-1">
                    <CaretRightIcon
                        aria-hidden="true"
                        data-caret=""
                        className={cn("mt-px h-4 w-4 shrink-0 text-ink transition-transform", isOpen && "rotate-90")}
                    />
                    <span className="flex flex-col">
                        <span className="text-ink-muted">{formatTimestamp(log.timestamp, i18n.language)}</span>
                        <span data-tone={tone} className={TONE_CLASSES[tone]}>{log.eventType}</span>
                    </span>
                </span>
                <span className="text-ink-muted" data-node="">{node ?? ""}</span>
                {/* What it is about apart, by a line: its object, a small badge; its data under. */}
                <span className="flex min-w-0 flex-col border-l border-line pl-2">
                    {path && (
                        <span className="flex flex-wrap gap-1 font-sans" data-meta="">
                            <span className="rounded-full border border-line/60 px-1.5 text-[0.6875rem] leading-4 text-ink-muted">{path}</span>
                        </span>
                    )}
                    <span className="truncate text-ink-muted" data-text="">{preview}</span>
                </span>
            </div>
            {isOpen && (
                <div className="col-span-full border-t border-line bg-surface px-3 py-2 font-sans">
                    <FullJSONView data={log.data}/>
                </div>
            )}
        </div>
    );
}, (prev, next) => prev.log === next.log && prev.isOpen === next.isOpen);

/** The path of the object an event is about, wherever the event carries it. */
const logPath = (log) => {
    const data = log.data || {};
    if (log.eventType === "ObjectDeleted" && data._rawEvent) {
        try {
            const raw = JSON.parse(data._rawEvent);
            const path = raw.path ?? raw.labels?.path;
            if (path) return path;
        } catch {
        }
    }
    return data.path ?? data.labels?.path ?? data.data?.path ?? data.data?.labels?.path;
};

const STREAM_EVENT_TYPES = [
    "CONNECTION_OPENED",
    "CONNECTION_ERROR",
    "RECONNECTION_ATTEMPT",
    "MAX_RECONNECTIONS_REACHED",
    "CONNECTION_CLOSED",
];

/** The events of a node: its own, its heartbeats', and the connection of their stream. */
export const NODE_EVENT_TYPES = [
    "NodeStatusUpdated",
    "NodeMonitorUpdated",
    "NodeStatsUpdated",
    "DaemonHeartbeatUpdated",
    ...STREAM_EVENT_TYPES,
];

/** The events of an object, or of the objects of a namespace, and the connection of their stream. */
export const OBJECT_EVENT_TYPES = [
    "ObjectStatusUpdated",
    "InstanceStatusUpdated",
    "ObjectDeleted",
    "InstanceMonitorUpdated",
    "InstanceConfigUpdated",
    "InstanceConfigDeleted",
    ...STREAM_EVENT_TYPES,
];

const EventDrawerContent = ({
                                eventTypes,
                                objectName,
                                nodeName,
                                namespace,
                                onClose,
                                title,
                                feed = false,
                            }) => {
    const {t, i18n} = useTranslation();
    const [selectedEventTypes, setSelectedEventTypes] = useState([]);
    // In a feed, as in the logs: the events whose type, object, node or data hold it.
    const [searchTerm, setSearchTerm] = useState("");
    const [expandedLogIds, setExpandedLogIds] = useState([]);
    const [visibleCount, setVisibleCount] = useState(20);
    const [loadingMore, setLoadingMore] = useState(false);
    const [initialLoading, setInitialLoading] = useState(true);
    const [subscriptionDialogOpen, setSubscriptionDialogOpen] = useState(false);
    const [manualSubscriptions, setManualSubscriptions] = useState([]);
    const logsContainerRef = useRef(null);
    const typesLabelId = React.useId();

    const filteredEventTypes = useMemo(() => {
        return eventTypes.filter(et => !CONNECTION_EVENTS.includes(et));
    }, [eventTypes]);

    const pageKey = useMemo(() => {
        const baseKey = objectName || (nodeName ? `node:${nodeName}` : namespace ? `namespace:${namespace}` : 'global');
        const eventTypesKey = filteredEventTypes.sort().join(',');
        const hash = hashCode(eventTypesKey);
        return `eventLogger_${baseKey}_${hash}`;
    }, [objectName, nodeName, namespace, filteredEventTypes]);

    useEffect(() => {
        setManualSubscriptions([...filteredEventTypes]);
    }, [filteredEventTypes]);

    useEffect(() => {
        const token = localStorage.getItem("authToken");
        if (token) {
            const eventsToSubscribe = [...manualSubscriptions];
            const connectionEvents = eventTypes.filter(et => CONNECTION_EVENTS.includes(et));
            eventsToSubscribe.push(...connectionEvents);
            const uniqueEvents = [...new Set(eventsToSubscribe)];
            if (uniqueEvents.length > 0) {
                logger.log("Starting logger reception (drawer opened):", {
                    pageKey,
                    manualSubscriptions,
                    allEvents: uniqueEvents,
                    objectName
                });
                try {
                    startLoggerReception(token, uniqueEvents, objectName, nodeName);
                } catch (error) {
                    logger.warn("Failed to start logger reception:", error);
                }
            } else {
                logger.log("No events to subscribe to for this page");
                closeLoggerEventSource();
            }
        }
        return () => {
            logger.log("Closing logger reception (drawer closing)");
            closeLoggerEventSource();
        };
    }, [manualSubscriptions, objectName, nodeName, eventTypes, pageKey]);

    const {eventLogs = [], isPaused, setPaused, clearLogs} = useEventLogStore();

    const baseFilteredLogs = useMemo(() => {
        let filtered = Array.isArray(eventLogs) ? eventLogs : [];
        if (manualSubscriptions.length === 0 && filteredEventTypes.length > 0) {
            filtered = filtered.filter(log => filteredEventTypes.includes(log.eventType));
        } else if (manualSubscriptions.length > 0) {
            filtered = filtered.filter(log => manualSubscriptions.includes(log.eventType));
        }
        const connectionEventsFromPage = eventTypes.filter(et => CONNECTION_EVENTS.includes(et));
        if (connectionEventsFromPage.length > 0) {
            filtered = filtered.filter(log =>
                manualSubscriptions.includes(log.eventType) ||
                connectionEventsFromPage.includes(log.eventType)
            );
        }
        if (objectName) {
            filtered = filtered.filter(log => {
                const data = log.data || {};
                if (log.eventType?.includes?.("CONNECTION")) return true;
                if (log.eventType === "ObjectDeleted" && data._rawEvent) {
                    try {
                        const raw = JSON.parse(data._rawEvent);
                        if (raw.path === objectName || raw.labels?.path === objectName) return true;
                    } catch {
                    }
                }
                if (data.path === objectName) return true;
                if (data.labels?.path === objectName) return true;
                if (data.data?.path === objectName) return true;
                return data.data?.labels?.path === objectName;
            });
        }
        if (nodeName) {
            filtered = filtered.filter(log => {
                const data = log.data || {};
                if (log.eventType?.includes?.("CONNECTION")) return true;
                return data.node === nodeName || data.labels?.node === nodeName;
            });
        }
        if (namespace) {
            filtered = filtered.filter(log => {
                if (log.eventType?.includes?.("CONNECTION")) return true;
                const path = logPath(log);
                return path !== undefined && parseObjectPath(path).namespace === namespace;
            });
        }
        return filtered;
    }, [eventLogs, manualSubscriptions, objectName, nodeName, namespace, eventTypes, filteredEventTypes]);

    const availableEventTypes = useMemo(() => {
        const types = new Set();
        baseFilteredLogs.forEach(log => types.add(log.eventType));
        return Array.from(types).sort();
    }, [baseFilteredLogs]);

    const eventStats = useMemo(() => {
        const stats = {};
        baseFilteredLogs.forEach(log => {
            stats[log.eventType] = (stats[log.eventType] || 0) + 1;
        });
        return stats;
    }, [baseFilteredLogs]);

    const filteredLogs = useMemo(() => {
        let result = [...baseFilteredLogs];
        if (selectedEventTypes.length > 0) {
            result = result.filter(log => selectedEventTypes.includes(log.eventType));
        }
        const term = feed ? searchTerm.trim().toLowerCase() : "";
        if (term !== "") {
            result = result.filter((log) => [log.eventType, logPath(log), log.data?.node ?? log.data?.labels?.node, toJSON(log.data, 0)]
                .some((value) => typeof value === "string" && value.toLowerCase().includes(term)));
        }
        return result;
    }, [baseFilteredLogs, selectedEventTypes, feed, searchTerm]);

    const visibleLogs = useMemo(() => {
        return filteredLogs.slice(0, visibleCount);
    }, [filteredLogs, visibleCount]);

    useEffect(() => {
        const timer = setTimeout(() => setInitialLoading(false), 200);
        return () => clearTimeout(timer);
    }, []);

    // A feed, read as a log: the newest at the end, followed there; scrolled up, the
    // events shown kept from the oldest of them, the new ones counted.
    const [showCount, setShowCount] = useState(FEED_PAGE);
    // The lines shown anew, the end of the first loading too: the events read during it
    // only show once it ends, and are then followed to the end, as the logs.
    const feedKey = useMemo(() => ({}), [filteredLogs, showCount, initialLoading]);
    const {following, follow, newCount, countNew, handleScroll: feedScroll, toEnd, scrollAge} = useFollowScroll({
        containerRef: logsContainerRef,
        items: feed ? feedKey : null,
        lineSelector: ".event-line",
        locale: i18n.language,
    });
    const oldestShownRef = useRef(null);
    const shown = useMemo(() => {
        if (!feed) return [];
        const kept = following || oldestShownRef.current === null
            ? 0
            : filteredLogs.findIndex((log) => log.id === oldestShownRef.current) + 1;
        return filteredLogs.slice(0, Math.max(showCount, kept)).reverse();
    }, [feed, filteredLogs, showCount, following]);
    useEffect(() => {
        oldestShownRef.current = shown[0]?.id ?? null;
    }, [shown]);
    const newestRef = useRef(null);
    useEffect(() => {
        if (!feed) return;
        const newest = filteredLogs[0]?.id ?? null;
        const previous = newestRef.current;
        newestRef.current = newest;
        if (previous === null || newest === previous) return;
        countNew(Math.max(0, filteredLogs.findIndex((log) => log.id === previous)));
    }, [feed, filteredLogs, countNew]);
    const showOlder = () => {
        follow(false);
        setShowCount((count) => Math.max(count, shown.length) + FEED_PAGE);
    };

    const handleScroll = useCallback(() => {
        /* istanbul ignore next */
        if (feed || loadingMore) return;
        /* istanbul ignore next */
        const container = logsContainerRef.current;
        if (!container) return;
        const {scrollTop, scrollHeight, clientHeight} = container;
        const scrollPercentage = (scrollTop + clientHeight) / scrollHeight;
        if (scrollPercentage > 0.8 && visibleCount < filteredLogs.length) {
            setLoadingMore(true);
            setTimeout(() => {
                setVisibleCount(prev => Math.min(prev + 20, filteredLogs.length));
                setLoadingMore(false);
            }, 100);
        }
    }, [feed, loadingMore, visibleCount, filteredLogs.length, initialLoading]);

    useEffect(() => {
        const container = logsContainerRef.current;
        if (container) {
            container.addEventListener('scroll', handleScroll);
            return () => container.removeEventListener('scroll', handleScroll);
        }
    }, [handleScroll]);

    useEffect(() => {
        setVisibleCount(20);
    }, [selectedEventTypes]);

    const handleClear = useCallback(() => {
        clearLogs();
        setSelectedEventTypes([]);
        setExpandedLogIds([]);
        setVisibleCount(20);
    }, [clearLogs]);

    const toggleExpand = useCallback((id) => {
        setExpandedLogIds(prev =>
            prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
        );
    }, []);

    const toggleEventTypeFilter = useCallback((eventType) => {
        setSelectedEventTypes(prev =>
            prev.includes(eventType)
                ? prev.filter(et => et !== eventType)
                : [...prev, eventType]
        );
    }, []);

    const connected = useEventLogStore((state) => state.connected);
    const subject = objectName ?? nodeName ?? namespace ?? "";
    const isFiltered = selectedEventTypes.length > 0 || searchTerm.trim() !== "";
    const typesSummary = selectedEventTypes.length === 0 ? t("events.allTypes") : selectedEventTypes.join(", ");

    /** The events shown, saved as JSON lines, one an event, oldest first. */
    const handleDownload = () => {
        const lines = [...filteredLogs].reverse()
            .map((log) => JSON.stringify({timestamp: new Date(log.timestamp).toISOString(), type: log.eventType, data: log.data}));
        const blob = new Blob([lines.join("\n") + "\n"], {type: "application/x-ndjson"});
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const at = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        a.download = `${(subject || "events").replace(/[^\w.-]+/g, "_")}-events-${at}.ndjson`;
        a.click();
        URL.revokeObjectURL(url);
    };

    // A feed reads as the logs: what is followed and the connection, the actions
    // the logs have; under, the search, the types as the levels, the count.
    const feedHeader = (
        <div className="flex shrink-0 flex-col gap-2 pb-2">
            <div className="flex flex-wrap items-center gap-3">
                {subject && <span className="text-ink-muted">{subject}</span>}
                <span className="inline-flex items-center gap-1" data-state={connected ? "up" : "down"}>
                    <span className={connected ? "text-state-up" : "text-state-down"}>
                        <StateGlyph state={connected ? "up" : "down"}/>
                    </span>
                    <span>{connected ? t("events.connected") : t("events.disconnected")}</span>
                </span>
                <div className="ml-auto flex items-center gap-2">
                    {/* Following is about the view, the pause about the stream. */}
                    <Button
                        size="sm"
                        aria-pressed={following}
                        onClick={() => (following ? follow(false) : toEnd())}
                    >
                        {following ? t("events.following") : t("events.follow")}
                    </Button>
                    <Button
                        size="sm"
                        onClick={() => setPaused(!isPaused)}
                        aria-pressed={isPaused}
                        icon={isPaused ? <CaretRightIcon/> : <PauseIcon/>}
                    >
                        {isPaused ? t("events.resume") : t("events.pause")}
                    </Button>
                    <IconButton label={t("events.clear")} onClick={handleClear} disabled={eventLogs.length === 0}>
                        <TrashIcon/>
                    </IconButton>
                    <IconButton label={t("events.download")} onClick={handleDownload} disabled={filteredLogs.length === 0}>
                        <DownloadIcon/>
                    </IconButton>
                    <IconButton label={t("events.manageSubscriptions")} onClick={() => setSubscriptionDialogOpen(true)}>
                        <GearIcon/>
                    </IconButton>
                </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
                <label className="flex min-w-[200px] flex-1 items-center gap-1 text-ink-muted">
                    <SearchIcon className="shrink-0"/>
                    <span className="sr-only">{t("common.search")}</span>
                    <Input
                        className="h-7"
                        placeholder={t("events.searchPlaceholder")}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </label>
                <div className="flex items-center gap-1 text-ink-muted">
                    <span id={typesLabelId}>{t("events.types")}</span>
                    <details className="relative">
                        <summary
                            aria-describedby={typesLabelId}
                            className="flex h-7 max-w-64 cursor-pointer list-none items-center gap-1 rounded-(--radius-control) border border-line bg-surface px-2 text-ink [&::-webkit-details-marker]:hidden"
                        >
                            <span className="truncate">{typesSummary}</span>
                            <ChevronDownIcon className="h-3 w-3 shrink-0 text-ink-muted"/>
                        </summary>
                        <div
                            role="group"
                            aria-label={t("events.filterByType")}
                            className="absolute left-0 z-10 mt-1 flex min-w-[14rem] flex-col gap-1 rounded-(--radius-control) border border-line bg-surface-raised p-2 text-ink shadow-lg"
                        >
                            {availableEventTypes.length === 0 && <span className="text-ink-muted">{t("common.none")}</span>}
                            {availableEventTypes.map((eventType) => (
                                <Checkbox
                                    key={eventType}
                                    label={`${eventType} (${eventStats[eventType] || 0})`}
                                    checked={selectedEventTypes.includes(eventType)}
                                    onChange={() => toggleEventTypeFilter(eventType)}
                                />
                            ))}
                        </div>
                    </details>
                </div>
                {isFiltered && (
                    <span className="inline-flex items-center gap-1 rounded-(--radius-control) border border-line bg-surface-sunken pl-2 text-data">
                        {t("events.filtersActive")}
                        <IconButton
                            size="sm"
                            label={t("events.resetFilters")}
                            onClick={() => {
                                setSearchTerm("");
                                setSelectedEventTypes([]);
                            }}
                        >
                            <CloseIcon className="h-3 w-3"/>
                        </IconButton>
                    </span>
                )}
                <span className="ml-auto text-data text-ink-muted">
                    {t("events.countOf", {shown: filteredLogs.length, total: baseFilteredLogs.length})}
                </span>
            </div>
        </div>
    );

    return (
        <>
            {feed ? feedHeader : (
                <>
                    <div className="flex items-center gap-2 border-b border-line px-3 py-1.5">
                        {title && <h2 className="truncate font-semibold">{title}</h2>}
                        <span className="shrink-0 rounded-full border border-line px-2 text-data text-ink-muted tabular-nums">
                            {t("events.count", {visible: feed ? shown.length : visibleLogs.length, total: filteredLogs.length})}
                        </span>
                        {isPaused && (
                            <span
                                className="inline-flex shrink-0 items-center gap-1 rounded-full border border-state-warn bg-state-warn-soft px-2 text-data font-semibold text-state-warn">
                                <PauseIcon className="h-3 w-3"/>
                                {t("events.paused")}
                            </span>
                        )}
                        <div className="ml-auto flex shrink-0 items-center gap-1">
                            {/* Following is about the view, the pause about the stream. */}
                            {feed && (
                                <Button
                                    size="sm"
                                    aria-pressed={following}
                                    onClick={() => (following ? follow(false) : toEnd())}
                                >
                                    {following ? t("events.following") : t("events.follow")}
                                </Button>
                            )}
                            <IconButton
                                label={t("events.manageSubscriptions")}
                                className={TOOL}
                                onClick={() => setSubscriptionDialogOpen(true)}
                            >
                                <GearIcon/>
                            </IconButton>
                            <IconButton
                                label={isPaused ? t("events.resume") : t("events.pause")}
                                className={cn(TOOL, isPaused && "border-state-warn text-state-warn")}
                                onClick={() => setPaused(!isPaused)}
                            >
                                {isPaused ? <CaretRightIcon/> : <PauseIcon/>}
                            </IconButton>
                            <IconButton
                                label={t("events.clear")}
                                className={TOOL}
                                onClick={handleClear}
                                disabled={eventLogs.length === 0}
                            >
                                <TrashIcon/>
                            </IconButton>
                            {onClose && (
                                <IconButton label={t("common.close")} className={TOOL} onClick={onClose}>
                                    <CloseIcon/>
                                </IconButton>
                            )}
                        </div>
                    </div>

                    {availableEventTypes.length > 0 && (
                        <div
                            role="group"
                            aria-label={t("events.filterByType")}
                            className="flex max-h-24 shrink-0 flex-wrap items-center gap-1.5 overflow-y-auto border-b border-line px-3 py-1.5 text-data"
                        >
                            <span aria-hidden="true" className="mr-1 text-ink-muted">{t("events.filterByTypeColon")}</span>
                            {availableEventTypes.map((eventType) => {
                                const isPageEvent = filteredEventTypes.includes(eventType);
                                const isSelected = selectedEventTypes.includes(eventType);
                                return (
                                    <button
                                        key={eventType}
                                        type="button"
                                        aria-pressed={isSelected}
                                        data-page-event={isPageEvent}
                                        title={isPageEvent ? t("events.pageEvent") : t("events.additionalEvent")}
                                        onClick={() => toggleEventTypeFilter(eventType)}
                                        className={cn(
                                            "inline-flex h-6 items-center rounded-full border px-2 font-medium whitespace-nowrap max-md:h-8",
                                            isPageEvent
                                                ? (isSelected
                                                    ? "border-accent bg-accent text-accent-ink"
                                                    : "border-accent bg-accent-soft text-accent hover:brightness-95")
                                                : (isSelected
                                                    ? "border-ink bg-ink text-surface-raised"
                                                    : "border-dashed border-line-strong bg-surface text-ink hover:bg-surface-sunken")
                                        )}
                                    >
                                        {`${eventType} (${eventStats[eventType] || 0})`}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </>
            )}

            {feed ? (
                <div className="relative flex min-h-0 flex-1 flex-col">
                    <div
                        ref={logsContainerRef}
                        onScroll={feedScroll}
                        role="region"
                        aria-label={t("events.list")}
                        tabIndex={0}
                        className="relative min-h-0 flex-1 overflow-auto py-1 font-mono text-data outline-none"
                    >
                        {initialLoading ? (
                            <div className="flex h-full items-center justify-center">
                                <Spinner label={t("events.loading")}/>
                            </div>
                        ) : shown.length === 0 ? (
                            <p className="p-8 text-center text-ink-muted">
                                {eventLogs.length === 0 ? t("events.empty") : t("events.noMatch")}
                            </p>
                        ) : (
                            <>
                                {/* The older events kept, shown on demand at the top. */}
                                {filteredLogs.length > shown.length && (
                                    <div className="flex justify-center py-1">
                                        <Button size="sm" onClick={showOlder}>{t("events.showOlder")}</Button>
                                    </div>
                                )}
                                <div className="grid gap-x-2" style={{gridTemplateColumns: "max-content max-content minmax(0, 1fr)"}}>
                                    {shown.map((log) => {
                                        const safeId = log.id ?? `log-${log.timestamp}-${log.eventType}`;
                                        return (
                                            <FeedRow
                                                key={safeId}
                                                log={log}
                                                isOpen={expandedLogIds.includes(safeId)}
                                                onToggle={() => toggleExpand(safeId)}
                                            />
                                        );
                                    })}
                                </div>
                            </>
                        )}
                    </div>
                    <FollowOverlay
                        scrollAge={scrollAge}
                        following={following}
                        shown={shown.length > 0}
                        onEnd={toEnd}
                        label={newCount > 0 ? t("events.newEvents", {count: newCount}) : t("events.latest")}
                    />
                </div>
            ) : (
                <div
                    ref={logsContainerRef}
                    onScroll={handleScroll}
                    role="region"
                    aria-label={t("events.list")}
                    tabIndex={0}
                    className="relative min-h-0 flex-1 overflow-auto bg-surface outline-none"
                >
                    {initialLoading ? (
                        <div className="flex h-full items-center justify-center">
                            <Spinner label={t("events.loading")}/>
                        </div>
                    ) : visibleLogs.length === 0 ? (
                        <p className="p-8 text-center text-ink-muted">
                            {eventLogs.length === 0
                                ? t("events.empty")
                                : t("events.noMatch")}
                        </p>
                    ) : (
                        <>
                            <ul>
                                {visibleLogs.map((log) => {
                                    const safeId = log.id ?? `log-${log.timestamp}-${log.eventType}`;
                                    const isOpen = expandedLogIds.includes(safeId);
                                    return (
                                        <LogRow
                                            key={safeId}
                                            log={log}
                                            isOpen={isOpen}
                                            onToggle={() => toggleExpand(safeId)}
                                        />
                                    );
                                })}
                            </ul>
                            {loadingMore && (
                                <div className="flex justify-center py-1">
                                    <Spinner label={t("events.loadingMore")}/>
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}

            <SubscriptionDialog
                open={subscriptionDialogOpen}
                onClose={() => setSubscriptionDialogOpen(false)}
                subscribedEventTypes={manualSubscriptions}
                setManualSubscriptions={setManualSubscriptions}
                filteredEventTypes={filteredEventTypes}
                eventStats={eventStats}
                clearLogs={clearLogs}
            />
        </>
    );
};

const EventLogger = React.memo(({
                                    eventTypes = [],
                                    objectName = null,
                                    title: titleProp,
                                    buttonLabel: buttonLabelProp
                                }) => {
    const {t} = useTranslation();
    const title = titleProp ?? t("events.title");
    const buttonLabel = buttonLabelProp ?? t("events.button");
    const anyPanelOpen = useAnyPanelOpen();
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [drawerHeight, setDrawerHeight] = useState(320);
    const [isResizing, setIsResizing] = useState(false);
    const startYRef = useRef(0);
    const startHeightRef = useRef(0);
    const isDraggingRef = useRef(false);
    const resizeTimeoutRef = useRef(null);

    const handleResizeStart = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsResizing(true);
        isDraggingRef.current = true;
        startYRef.current = e.type.includes('mouse') ? e.clientY : e.touches[0].clientY;
        startHeightRef.current = drawerHeight;
        document.body.style.userSelect = 'none';
        document.body.style.touchAction = 'none';
        document.body.style.overflow = 'hidden';
        if (resizeTimeoutRef.current) {
            clearTimeout(resizeTimeoutRef.current);
            resizeTimeoutRef.current = null;
        }
    }, [drawerHeight]);

    const handleResizeMove = useCallback((e) => {
        if (!isDraggingRef.current) return;
        e.preventDefault();
        e.stopPropagation();
        const clientY = e.type.includes('mouse') ? e.clientY : e.touches[0].clientY;
        const deltaY = startYRef.current - clientY;
        const newHeight = Math.max(220, Math.min(window.innerHeight * 0.8, startHeightRef.current + deltaY));
        if (resizeTimeoutRef.current) {
            clearTimeout(resizeTimeoutRef.current);
        }
        resizeTimeoutRef.current = setTimeout(() => {
            setDrawerHeight(newHeight);
        }, 16);
    }, []);

    const handleResizeEnd = useCallback(() => {
        if (!isDraggingRef.current) return;
        setIsResizing(false);
        isDraggingRef.current = false;
        document.body.style.userSelect = '';
        document.body.style.touchAction = '';
        document.body.style.overflow = '';
        if (resizeTimeoutRef.current) {
            clearTimeout(resizeTimeoutRef.current);
            resizeTimeoutRef.current = null;
        }
    }, []);

    useEffect(() => {
        const handleMouseMove = (e) => handleResizeMove(e);
        const handleTouchMove = (e) => handleResizeMove(e);
        const handleMouseUp = (e) => handleResizeEnd(e);
        const handleTouchEnd = (e) => handleResizeEnd(e);
        const handleTouchCancel = (e) => handleResizeEnd(e);
        if (isResizing) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('touchmove', handleTouchMove, {passive: false});
            document.addEventListener('mouseup', handleMouseUp);
            document.addEventListener('touchend', handleTouchEnd);
            document.addEventListener('touchcancel', handleTouchCancel);
        }
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('touchmove', handleTouchMove);
            document.removeEventListener('mouseup', handleMouseUp);
            document.removeEventListener('touchend', handleTouchEnd);
            document.removeEventListener('touchcancel', handleTouchCancel);
            if (resizeTimeoutRef.current) {
                clearTimeout(resizeTimeoutRef.current);
                resizeTimeoutRef.current = null;
            }
        };
    }, [isResizing, handleResizeMove, handleResizeEnd]);

    return (
        <>
            {/* Hidden while a side panel is open, as oc3 hides its floating controls:
                it would sit over the bottom of the panel. */}
            {!drawerOpen && !anyPanelOpen && (
                <button
                    type="button"
                    title={title}
                    onClick={() => setDrawerOpen(true)}
                    className="fixed right-4 bottom-4 z-[1200] inline-flex h-8 items-center gap-1.5 rounded-(--radius-control) border border-line bg-surface-raised px-3 font-medium text-ink shadow hover:bg-surface-sunken max-md:h-9"
                >
                    <RssIcon className="shrink-0 text-ink-muted"/>
                    {buttonLabel}
                </button>
            )}
            {drawerOpen && (
                <section
                    aria-label={title}
                    style={{height: drawerHeight}}
                    className="fixed inset-x-0 bottom-0 z-[1200] flex max-h-[80vh] touch-none flex-col overflow-hidden rounded-t-(--radius-panel) border-t border-line bg-surface-raised text-ink shadow-lg max-md:max-h-[90vh]"
                >
                    <div
                        role="separator"
                        aria-orientation="horizontal"
                        aria-label={t("events.resizeHandle")}
                        title={t("events.dragToResize")}
                        data-resizing={isResizing}
                        onMouseDown={handleResizeStart}
                        onTouchStart={handleResizeStart}
                        className={cn(
                            "flex h-6 shrink-0 cursor-row-resize touch-none items-center justify-center select-none transition-colors max-md:h-8",
                            isResizing ? "bg-accent-soft" : "hover:bg-surface-sunken"
                        )}
                    >
                        <span
                            aria-hidden="true"
                            className={cn("h-1 w-12 rounded-full", isResizing ? "bg-accent" : "bg-line-strong")}
                        />
                    </div>
                    <EventDrawerContent
                        eventTypes={eventTypes}
                        objectName={objectName}
                        onClose={() => setDrawerOpen(false)}
                        title={title}
                    />
                </section>
            )}
        </>
    );
});

/**
 * The events of a node, an object or a namespace, in place: the list the drawer shows,
 * without its title and close button, for a tab of their panel. An object's are read
 * for its path alone, a node's for its name; a namespace's are those whose path is in it.
 */
export function EventLog({eventTypes = [], nodeName = null, objectName = null, namespace = null, label}) {
    return (
        <section aria-label={label} className="flex h-full flex-col overflow-hidden text-ink">
            <EventDrawerContent eventTypes={eventTypes} nodeName={nodeName} objectName={objectName} namespace={namespace} feed/>
        </section>
    );
}

export default EventLogger;
