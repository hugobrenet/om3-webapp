import {
    ArrowLeftIcon,
    BanIcon,
    CaretRightIcon,
    CheckIcon,
    CloseIcon,
    CpuIcon,
    CubeIcon,
    DatabaseIcon,
    DownloadIcon,
    DropIcon,
    FileIcon,
    GearIcon,
    InfoIcon,
    PauseIcon,
    PlayIcon,
    PowerIcon,
    PowerOffIcon,
    PuzzleIcon,
    RefreshIcon,
    ResetIcon,
    SearchIcon,
    SignOutIcon,
    SnowflakeIcon,
    StateIcon,
    StepBackwardIcon,
    StepForwardIcon,
    StopIcon,
    SunIcon,
    SwapIcon,
    TerminalIcon,
    ToggleOffIcon,
    ToggleOnIcon,
    TrashIcon,
    UploadIcon,
} from "../ui/icons";
import i18n from "../i18n";

// Action icons of the oc3 icon set (src/ui/icons), sized by the menus that show
// them. `color: "red"` marks the destructive actions, tinted by those menus.
// `endpoint` is the API path of the action; `kinds` limits it to some object kinds.
// The `name` of an action is its identifier (API, menus): show actionLabel(name) instead.
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const labelKey = (name) => name.replace(/\s+(\w)/g, (_, c) => c.toUpperCase());

/** The translated label of an action name ("restart daemon" → "Restart daemon"), the capitalized name if unknown. */
export const actionLabel = (name) => {
    if (typeof name !== "string" || !name) return "";
    return i18n.t(`actions.labels.${labelKey(name)}`, {defaultValue: capitalize(name)});
};

const icon = (Icon) => <Icon className="h-4 w-4"/>;

export const OBJECT_ACTIONS = [
    {name: "start", icon: icon(PlayIcon), endpoint: "action/start"},
    {name: "stop", icon: icon(StopIcon), endpoint: "action/stop"},
    {name: "restart", icon: icon(RefreshIcon), endpoint: "action/restart"},
    {name: "freeze", icon: icon(SnowflakeIcon), endpoint: "action/freeze"},
    {name: "unfreeze", icon: icon(SunIcon), endpoint: "action/unfreeze"},
    {name: "provision", icon: icon(GearIcon), endpoint: "action/provision"},
    {name: "unprovision", icon: icon(BanIcon), endpoint: "action/unprovision"},
    {name: "switch", icon: icon(SwapIcon), endpoint: "action/switch"},
    {name: "giveback", icon: icon(ArrowLeftIcon), endpoint: "action/giveback"},
    {name: "abort", icon: icon(CloseIcon), endpoint: "action/abort"},
    {name: "enable", icon: icon(ToggleOnIcon), endpoint: "enable", kinds: ["svc"]},
    {name: "disable", icon: icon(ToggleOffIcon), endpoint: "disable", kinds: ["svc"]},
    {name: "delete", icon: icon(TrashIcon), endpoint: "action/delete", color: "red"},
    {name: "purge", icon: icon(TrashIcon), endpoint: "action/purge", color: "red"},
];

/** Kinds holding keys, on all the nodes: no status, nothing to start or place. */
export const KEY_KINDS = ["cfg", "sec", "usr"];

/**
 * What `om sec`, `om cfg` and `om usr` do to the object as a whole, as the webapp
 * offers it: a secret is deleted, not purged.
 */
const KEY_KIND_ACTIONS = {cfg: ["delete", "purge"], sec: ["delete"], usr: ["delete", "purge"]};

/** Whether the action `name` is offered on an object of the key `kind`. */
export const isKeyKindAction = (kind, name) => (KEY_KIND_ACTIONS[kind] ?? []).includes(name);

/**
 * Of the object `actions`, the ones of the menu of an object of `kind`: the ones
 * of its kind, without abort, which the badge of the orchestration in progress
 * offers instead.
 */
export const objectActionsFor = (kind, actions = OBJECT_ACTIONS) => actions.filter((a) => a.name !== "abort"
    && (!a.kinds || a.kinds.includes(kind))
    && (!KEY_KINDS.includes(kind) || isKeyKindAction(kind, a.name)));

export const INSTANCE_ACTIONS = [
    // Lifecycle
    {name: "start", icon: icon(PlayIcon), endpoint: "start"},
    {name: "stop", icon: icon(StopIcon), endpoint: "stop"},
    {name: "restart", icon: icon(RefreshIcon), endpoint: "restart"},
    {name: "run", icon: icon(CaretRightIcon), endpoint: "run"},
    {name: "boot", icon: icon(PowerIcon), endpoint: "boot"},
    {name: "shutdown", icon: icon(PowerOffIcon), endpoint: "shutdown"},
    {name: "start standby", icon: icon(PauseIcon), endpoint: "startstandby"},

    // Freeze state
    {name: "freeze", icon: icon(SnowflakeIcon), endpoint: "freeze"},
    {name: "unfreeze", icon: icon(SunIcon), endpoint: "unfreeze"},

    // Provisioning
    {name: "provision", icon: icon(GearIcon), endpoint: "provision"},
    {name: "unprovision", icon: icon(BanIcon), endpoint: "unprovision"},
    // What the volumes and filesystems declare, installed again, nothing started.
    {name: "install", icon: icon(DownloadIcon), endpoint: "install"},

    // Replication, as om <path> sync <action>: the changes copied to the peers, the
    // whole dataset, the synchronization restored or split; the files received ingested.
    {name: "prstart", icon: icon(StepForwardIcon), endpoint: "prstart"},
    {name: "prstop", icon: icon(StepBackwardIcon), endpoint: "prstop"},
    {name: "sync update", icon: icon(UploadIcon), endpoint: "update"},
    {name: "sync full", icon: icon(DatabaseIcon), endpoint: "full"},
    {name: "sync resync", icon: icon(SwapIcon), endpoint: "resync"},
    {name: "sync split", icon: icon(CloseIcon), endpoint: "split"},
    {name: "sync ingest", icon: icon(DownloadIcon), endpoint: "ingest"},

    // Placement groups
    {name: "pg reset", icon: icon(ResetIcon), endpoint: "pg/reset"},
    {name: "pg update", icon: icon(RefreshIcon), endpoint: "pg/update"},

    // Info
    {name: "info", icon: icon(InfoIcon), endpoint: "info"},
    {name: "status", icon: icon(StateIcon), endpoint: "status"},

    // Destructive
    {name: "delete", icon: icon(TrashIcon), endpoint: "delete", color: "red"},
];

export const RESOURCE_ACTIONS = [
    {name: "start", icon: icon(PlayIcon)},
    {name: "stop", icon: icon(StopIcon)},
    {name: "restart", icon: icon(RefreshIcon)},
    {name: "run", icon: icon(CaretRightIcon)},
    {name: 'console', icon: icon(TerminalIcon)},
];

/**
 * The actions on a node, in the groups of its menu, in their order: the node, its
 * inventory pushed to the collector, its daemon. `menu: false`, offered elsewhere (abort,
 * by the badge of the orchestration). `cluster`, an action of the cluster on the node,
 * posted to the api node rather than to it (leave: the cluster evicts it).
 */
export const NODE_ACTION_GROUPS = ["node", "inventory", "daemon"];

export const NODE_ACTIONS = [
    {name: "freeze", group: "node", icon: icon(SnowflakeIcon), endpoint: "action/freeze"},
    {name: "unfreeze", group: "node", icon: icon(SunIcon), endpoint: "action/unfreeze"},
    {name: "abort", icon: icon(CloseIcon), endpoint: "action/abort", menu: false},

    {name: "asset", group: "inventory", icon: icon(CpuIcon), endpoint: "action/push/asset"},
    {name: "capabilities", group: "inventory", icon: icon(PuzzleIcon), endpoint: "action/scan/capabilities"},
    {name: "disk", group: "inventory", icon: icon(DatabaseIcon), endpoint: "action/push/disk"},
    {name: "pkg", group: "inventory", icon: icon(CubeIcon), endpoint: "action/push/pkg"},
    {name: "scsi scan", group: "inventory", icon: icon(SearchIcon), endpoint: "action/scsi/scan"},
    {name: "sysreport", group: "inventory", icon: icon(FileIcon), endpoint: "action/sysreport"},

    {name: "clear", group: "daemon", icon: icon(CheckIcon), endpoint: "action/clear"},
    {name: "restart daemon", group: "daemon", icon: icon(RefreshIcon), endpoint: "daemon/action/restart"},
    {name: "shutdown", group: "daemon", icon: icon(PowerOffIcon), endpoint: "daemon/action/shutdown", color: "red"},
    {name: "stop", group: "daemon", icon: icon(StopIcon), endpoint: "daemon/action/stop", color: "red"},
    {name: "drain", group: "daemon", icon: icon(DropIcon), endpoint: "action/drain", color: "red"},
    {name: "leave", group: "daemon", icon: icon(SignOutIcon), cluster: "evict", color: "red"},
];
