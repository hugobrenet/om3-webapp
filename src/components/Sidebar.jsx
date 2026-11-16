import {useState, useCallback, useEffect} from "react";
import {Link, NavLink, useLocation} from "react-router-dom";
import {useTranslation} from "react-i18next";
import {cn} from "../ui/cn";
import {useMediaQuery} from "../ui/lib/media";
import {AlertMark} from "../ui/components/AlertMark";
import {CaretRightIcon, SparklesIcon} from "../ui/icons";
import {ALL_LIST, OBJECT_LISTS, listUrl} from "../utils/objectLists";
import {getAiAgentConfig} from "../config/ai-agent.js";
import {useAuthSession} from "../context/AuthProvider.jsx";
import useClusterConfig from "../hooks/useClusterConfig.js";
import AiActivityBadge from "./AiActivityBadge.jsx";

/**
 * The menu, in two sections. The cluster: its links (the heartbeats), nodes,
 * namespaces, networks, pools and the resources of all its objects. The objects: their title opens all of them, then
 * a list per kind. Names alone, no icon, but the assistant's, as oc3 shows it. The
 * cluster overview and the user page are reached from the top bar: the logo and
 * the user button. `id` keys the alert of an entry; `labelKey` is the catalog key
 * of its name; `list`, the list of the Objects page it opens; `assistant`, the
 * entry of the assistant, shown to whom can use it. A section with `to` is an
 * entry itself, its title the link.
 */
export const NAV_SECTIONS = [
    {
        key: "cluster",
        labelKey: "nav.sections.cluster",
        // Its title, the overview of the cluster: the default view.
        id: "cluster",
        to: "/cluster",
        entries: [
            {id: "links", to: "/heartbeats", labelKey: "nav.routes.heartbeats"},
            {id: "nodes", to: "/nodes", labelKey: "nav.routes.nodes"},
            {id: "namespaces", to: "/namespaces", labelKey: "nav.routes.namespaces"},
            {id: "networks", to: "/network", labelKey: "nav.routes.networks"},
            {id: "pools", to: "/pools", labelKey: "nav.routes.pools"},
            {id: "stores", to: "/stores", labelKey: "nav.routes.stores"},
            {id: "resources", to: "/resources", labelKey: "nav.routes.resources"},
        ],
    },
    {
        // The relay this cluster is, when it is one: a site has one relay cluster, usually.
        key: "relay",
        labelKey: "nav.sections.relay",
        id: "relay",
        to: "/relay",
        entries: [],
    },
    {
        key: "objects",
        labelKey: "nav.sections.objects",
        id: "objects-any",
        to: listUrl(ALL_LIST),
        list: ALL_LIST,
        entries: OBJECT_LISTS.map((list) => ({
            id: `objects-${list}`,
            to: listUrl(list),
            labelKey: `objects.lists.${list}`,
            list,
        })),
    },
    {
        // The assistant, then the words of OpenSVC, said plainly.
        key: "help",
        labelKey: "nav.sections.help",
        entries: [
            {id: "ai", to: "/ai", labelKey: "nav.routes.ai", assistant: true},
            {id: "glossary", to: "/glossary", labelKey: "nav.routes.glossary"},
            {id: "about", to: "/about", labelKey: "nav.routes.about"},
        ],
    },
];

/**
 * The alert of an entry, when something calls for attention: a round badge over
 * the right end of its link, orange or red, what it is about for screen
 * readers. None while all is well: the menu counts nothing.
 */
function AlertBadge({id, alert}) {
    return (
        <AlertMark
            level={alert.level}
            text={alert.text}
            testId={`alert-${id}`}
            className="pointer-events-auto absolute top-1/2 right-2 -translate-y-1/2"
        />
    );
}

const SIDEBAR_KEY = "om3.sidebar";

/** Folding the menu is a display comfort, specific to the browser: it does not go in the URL. */
function readSidebarOpen() {
    try {
        return localStorage.getItem(SIDEBAR_KEY) !== "closed";
    } catch {
        // Private browsing or storage refused: the menu opens, as by default.
        return true;
    }
}

/** Open state of the sidebar, remembered in local storage. */
/** A window short of room, below lg (1200px): the menu takes too much of it to stay open. */
export const COMPACT_QUERY = "(max-width:1199.95px)";

/**
 * Open state of the sidebar, and what toggles it. A wide window remembers it in
 * local storage. A window short of room (`compact`) has it folded: by default, on
 * becoming so, and once an entry is chosen (`fold`), unfolded the time to choose,
 * a choice not remembered.
 */
export function useSidebarOpen() {
    const compact = useMediaQuery(COMPACT_QUERY);
    const [open, setOpen] = useState(readSidebarOpen);
    const [compactOpen, setCompactOpen] = useState(false);
    useEffect(() => {
        if (compact) setCompactOpen(false);
    }, [compact]);
    const toggle = useCallback(() => {
        if (compact) {
            setCompactOpen((previous) => !previous);
            return;
        }
        setOpen((previous) => {
            const next = !previous;
            try {
                localStorage.setItem(SIDEBAR_KEY, next ? "open" : "closed");
            } catch {
                // Preference not remembered: without consequence for the current session.
            }
            return next;
        });
    }, [compact]);
    const fold = useCallback(() => setCompactOpen(false), []);
    return [compact ? compactOpen : open, toggle, {compact, fold}];
}

const LEVELS = ["warn", "down"];

/**
 * The alert of the folded menu, on its button: the worst of the alerts of its
 * entries, all of them said for screen readers. None while all is well.
 */
export function menuAlert(alerts) {
    const raised = Object.values(alerts ?? {}).map((entry) => entry?.alert).filter(Boolean);
    if (raised.length === 0) return null;
    const level = raised.reduce((worst, a) => (LEVELS.indexOf(a.level) > LEVELS.indexOf(worst) ? a.level : worst), "warn");
    return {level, text: raised.map((a) => a.text).join("\n")};
}

const LINK = "flex items-center gap-2 rounded-(--radius-control) px-2 py-1 text-ink-muted hover:text-ink";
const CURRENT = "bg-accent-soft text-ink";
const TITLE = "px-2 pt-1 pb-1 text-[0.6875rem] font-semibold tracking-wider text-ink-muted uppercase";

/** The list of the Objects page shown, the services one when the URL names none it knows. */
function shownList(location) {
    if (location.pathname !== "/objects") return null;
    const list = new URLSearchParams(location.search).get("list");
    return [ALL_LIST, ...OBJECT_LISTS].includes(list) ? list : OBJECT_LISTS[0];
}

/**
 * A section of the menu: its title, then its entries. An entry of the objects, or
 * their title, is current when its list is the one shown, the page being the same
 * for all of them.
 */
function NavSection({section, alerts, onNavigate, assistant}) {
    const {t} = useTranslation();
    const location = useLocation();
    const shown = shownList(location);
    const titleId = `nav-section-${section.key}`;
    // The title of a list current when its list is shown; of a page, when it is.
    const current = section.list !== undefined ? shown === section.list : location.pathname === section.to;
    return (
        <section aria-labelledby={titleId} className="mb-3">
            {section.to === undefined ? (
                <h2 id={titleId} className={TITLE}>{t(section.labelKey)}</h2>
            ) : (
                // The title opens the section's whole list, as an entry does its own.
                <h2 id={titleId} className="relative">
                    <Link
                        to={section.to}
                        onClick={onNavigate}
                        aria-current={current ? "page" : undefined}
                        className={cn(TITLE, "group flex items-center gap-0.5 rounded-(--radius-control) hover:text-ink", current && CURRENT)}
                    >
                        {t(section.labelKey)}
                        {/* A caret after its name: a page it opens, not a heading alone (the help's), even
                            with no entry under it (the relay's). */}
                        <CaretRightIcon aria-hidden="true" data-title-caret="" className="h-3 w-3 shrink-0 opacity-70 group-hover:opacity-100"/>
                    </Link>
                    {alerts[section.id]?.alert && <AlertBadge id={section.id} alert={alerts[section.id].alert}/>}
                </h2>
            )}
            {/* Its entries indented under its title, along a line that ties them to it; none, no line. */}
            {section.entries.length > 0 && <ul className="ml-2 border-l border-line pl-1">
                {section.entries.filter((entry) => assistant || !entry.assistant).map(({id, to, labelKey, list, assistant: isAssistant}) => {
                    const link = list === undefined ? (
                        <NavLink
                            to={to}
                            onClick={onNavigate}
                            className={({isActive}) => cn(LINK, isAssistant && "flex items-center gap-1.5", isActive && CURRENT)}
                        >
                            {/* Its logo keeps its tint: it names the assistant, as in oc3. */}
                            {isAssistant && <SparklesIcon width={14} height={14} className="shrink-0 text-accent"/>}
                            {t(labelKey)}
                            {/* A turn of the assistant goes on while the user is on another page. */}
                            {isAssistant && <AiActivityBadge/>}
                        </NavLink>
                    ) : (
                        <Link to={to} onClick={onNavigate} aria-current={shown === list ? "page" : undefined} className={cn(LINK, shown === list && CURRENT)}>
                            {t(labelKey)}
                        </Link>
                    );
                    return (
                        <li key={id}>
                            <div className="relative">
                                {link}
                                {alerts[id]?.alert && <AlertBadge id={id} alert={alerts[id].alert}/>}
                            </div>
                        </li>
                    );
                })}
            </ul>}
        </section>
    );
}

/**
 * From the keyboard, as in oc3: "n" brings the focus to the menu (App), the arrows
 * move from one entry to the next, Home and End go to the ends, and Escape gives
 * the focus back to the page.
 */
function onMenuKeyDown(event) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Escape") {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        return;
    }
    const stops = [...event.currentTarget.querySelectorAll("a")];
    const at = stops.findIndex((element) => element === document.activeElement);
    const next =
        event.key === "ArrowDown" ? stops[Math.min(at + 1, stops.length - 1)]
            : event.key === "ArrowUp" ? stops[Math.max(at - 1, 0)]
                : event.key === "Home" ? stops[0]
                    : event.key === "End" ? stops[stops.length - 1]
                        : undefined;
    if (next === undefined) return;
    event.preventDefault();
    next.focus();
}

/**
 * Side menu, after the oc3 one. Foldable from the button at the top left of the
 * header: folded, it keeps its place in the layout but not its width, and `inert`
 * takes it out of the keyboard path. `overlay`, on a phone, it lies over the page
 * rather than pushing it aside, a veil over the rest: a tap on the veil or Escape
 * folds it (`onClose`).
 */
export function Sidebar({open, alerts = {}, onNavigate, overlay = false, onClose}) {
    const {t} = useTranslation();
    // The assistant, for a cluster whose configuration names an agent, to an
    // OpenID session: the agent takes no other.
    const auth = useAuthSession();
    const {agentUrl} = useClusterConfig();
    const assistant = getAiAgentConfig(agentUrl).enabled && auth?.authChoice === "openid";
    const shown = overlay && open;
    useEffect(() => {
        if (!shown || !onClose) return undefined;
        const onKeyDown = (event) => {
            if (event.key === "Escape") onClose();
        };
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [shown, onClose]);
    return (
        <>
            {shown && (
                <div
                    data-testid="sidebar-veil"
                    aria-hidden="true"
                    className="absolute inset-0 z-20 bg-ink/20"
                    onClick={onClose}
                />
            )}
            <aside
                id="app-sidebar"
                inert={!open}
                className={cn(
                    "shrink-0 overflow-x-hidden overflow-y-auto border-r border-line bg-surface-raised transition-[width] duration-200 ease-out",
                    overlay && "absolute inset-y-0 left-0 z-30 shadow-lg",
                    open ? "w-60" : "w-0 border-r-0"
                )}
            >
                <nav aria-label={t("nav.main")} aria-keyshortcuts="n" onKeyDown={onMenuKeyDown} className="w-60 p-2">
                    {NAV_SECTIONS.map((section) => <NavSection key={section.key} section={section} alerts={alerts} onNavigate={onNavigate} assistant={assistant}/>)}
                </nav>
            </aside>
        </>
    );
}
