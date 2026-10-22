import {
  AlertTriangleIcon,
  AsteriskIcon,
  CodeIcon,
  PieChartIcon,
  LineChartIcon,
  CpuIcon,
  CubeIcon,
  DatabaseIcon,
  FilterIcon,
  GearIcon,
  HistoryIcon,
  InstanceIcon,
  LifeRingIcon,
  NetworkIcon,
  PuzzleIcon,
  ServerIcon,
  StackIcon,
  SwitchIcon,
  TagIcon,
  TagsIcon,
  UserIcon,
  UsersIcon,
  ClusterIcon,
  FileIcon,
  FolderIcon,
  LockIcon,
  RssIcon,
} from "../icons";

/** Collector object kinds that have a visual identity of their own. */
export type ObjectKind =
  | "dashboard"
  | "node"
  | "cluster"
  | "service"
  | "instance"
  | "network"
  | "disk"
  | "app"
  | "tag"
  | "tags"
  | "group"
  | "user"
  | "obsolescence"
  | "log"
  | "filter"
  | "filterset"
  | "form"
  | "package"
  | "hardware"
  | "switch"
  | "metric"
  | "report"
  | "chart"
  | "moduleset"
  | "ruleset"
  | "complianceLog"
  | "designer"
  // om3 kinds, absent from the collector.
  | "namespace"
  | "kind"
  | "pool"
  | "heartbeat"
  | "config"
  | "secret"
  | "account";

/**
 * Pictogram and tint of an object kind. The same vocabulary in the menu, in panel
 * headers and everywhere it will be necessary to say what is being talked about:
 * this is what ties a table row to the menu entry it comes from.
 *
 * The classes are written out in full: Tailwind does not see names built at runtime.
 */
const KINDS: Record<ObjectKind, { Icon: typeof ServerIcon; className: string }> = {
  dashboard: { Icon: AlertTriangleIcon, className: "text-icon-dashboard" },
  node: { Icon: ServerIcon, className: "text-icon-node" },
  // The tint of the nodes it groups, as the cluster column family.
  cluster: { Icon: ClusterIcon, className: "text-icon-node" },
  service: { Icon: StackIcon, className: "text-icon-service" },
  // Service tint: an instance is a service seen from a node.
  instance: { Icon: InstanceIcon, className: "text-icon-service" },
  network: { Icon: NetworkIcon, className: "text-icon-network" },
  disk: { Icon: DatabaseIcon, className: "text-icon-disk" },
  app: { Icon: AsteriskIcon, className: "text-icon-app" },
  // The collector's dark cyan label (`tag16`); the Tags menu entry and view show a pair.
  tag: { Icon: TagIcon, className: "text-icon-tag" },
  tags: { Icon: TagsIcon, className: "text-icon-tag" },
  group: { Icon: UsersIcon, className: "text-icon-group" },
  // Same tint as groups: the historical collector paints `guy16` and `guys16` in the
  // same salmon, both speak of people.
  user: { Icon: UserIcon, className: "text-icon-group" },
  // Cornflower blue in the historical collector: the tint of nodes, which it is about.
  obsolescence: { Icon: LifeRingIcon, className: "text-icon-node" },
  metric: { Icon: CodeIcon, className: "text-icon-metric" },
  // The same sandy brown as the metrics: the historical collector gives it to all
  // its statistics objects.
  report: { Icon: PieChartIcon, className: "text-icon-metric" },
  chart: { Icon: LineChartIcon, className: "text-icon-metric" },
  // `log16` has no colour of its own in the historical collector: neutral tint.
  log: { Icon: HistoryIcon, className: "text-icon-dashboard" },
  // `filter16` has no colour of its own either: neutral tint.
  filter: { Icon: FilterIcon, className: "text-icon-dashboard" },
  // Same icon as the filter: the historical collector marks both of them `filter16`.
  filterset: { Icon: FilterIcon, className: "text-icon-dashboard" },
  form: { Icon: PuzzleIcon, className: "text-icon-form" },
  package: { Icon: CubeIcon, className: "text-icon-package" },
  // Cornflower blue in the historical collector (`hw16`): the tint of nodes.
  hardware: { Icon: CpuIcon, className: "text-icon-node" },
  // Network tint: the historical menu gives the SAN switches the network icon; the
  // glyph differs so that the two menu entries do not look alike.
  switch: { Icon: SwitchIcon, className: "text-icon-network" },
  // The cogs of the historical collector (`modset16`), in its compliance crimson.
  moduleset: { Icon: GearIcon, className: "text-icon-compliance" },
  // The cube of the historical collector (`rset16`), in its compliance crimson.
  ruleset: { Icon: CubeIcon, className: "text-icon-compliance" },
  // The history clock of the historical compliance log (`complog`), in its crimson.
  complianceLog: { Icon: HistoryIcon, className: "text-icon-compliance" },
  // The puzzle piece of the historical designer (`designer16`), in the compliance crimson.
  designer: { Icon: PuzzleIcon, className: "text-icon-compliance" },
  // om3 kinds, drawn from the same set, never in a red or pink tint: a tab or an
  // entry of these must not catch the eye as an issue would. A namespace: the
  // folder, in the node blue.
  namespace: { Icon: FolderIcon, className: "text-icon-node" },
  // An object kind is a label on objects: the tag.
  kind: { Icon: TagIcon, className: "text-icon-tag" },
  // A pool provides the volumes: the disk icon and tint.
  pool: { Icon: DatabaseIcon, className: "text-icon-disk" },
  // Heartbeats are streams between the nodes: the broadcast waves, in the network tint.
  heartbeat: { Icon: RssIcon, className: "text-icon-network" },
  // Configuration objects: the file, in the network teal; secrets: the lock, and
  // om3 users: the person, both in the neutral ink, kept apart from the service tint.
  config: { Icon: FileIcon, className: "text-icon-network" },
  secret: { Icon: LockIcon, className: "text-icon-dashboard" },
  // An om3 user object, not the collector's people in their salmon.
  account: { Icon: UserIcon, className: "text-icon-dashboard" },
};

/**
 * The pictogram of an om3 object kind, as written in object paths ("svc", "vol",
 * "cfg"…). A kind with none of its own shows as a service.
 */
const OM3_KINDS: Record<string, ObjectKind> = {
  svc: "service",
  vol: "disk",
  cfg: "config",
  sec: "secret",
  usr: "account",
  ccfg: "cluster",
  nscfg: "namespace",
};

export function om3ObjectKind(kind: string | undefined): ObjectKind {
  return (kind !== undefined ? OM3_KINDS[kind] : undefined) ?? "service";
}

export function ObjectIcon({ kind, className }: { kind: ObjectKind; className?: string }) {
  const { Icon, className: hue } = KINDS[kind];
  return <Icon className={`shrink-0 ${hue} ${className ?? ""}`} />;
}
