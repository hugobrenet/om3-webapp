/*
 * An object configuration designed rather than written: its sections, each its
 * keys and values, DEFAULT and env first, then the resources, each of a driver
 * (`fs.flag`: the group fs, the type flag). Turned into the file om reads, the
 * type of a resource first in its section.
 */

/** A keyword as the daemon documents it (GET .../config/keywords). */
export interface DesignKeyword {
  section: string;
  option: string;
  types?: string[];
  text?: string;
  required?: boolean;
  default?: string;
  defaultText?: string;
  candidates?: string[];
  converter?: string;
  scopable?: boolean;
  deprecated?: string;
  replacedBy?: string;
  /** The grant setting it needs: "" when any user may (om3, when it tells). */
  grant?: string;
  /** The grant needed whatever the value, not for some values only. */
  grantAlways?: boolean;
  grantDoc?: string;
  /** Among the keywords of a minimal configuration of its driver. */
  minimal?: boolean;
  /** Read by the provision of its resource: what om creates on the system. */
  provisioning?: boolean;
  /** Needed by the provision, which fails without it (a size to create a volume of). */
  provisioningRequired?: boolean;
  /** The id of the group it belongs to, among the groups of the answer it came with. */
  group?: string;
  /**
   * The resources of the object its value names: of these driver groups (any when
   * none), one (`rid`), several (`rids`), or with the states a requirement waits for
   * (`requires`, `container#db(up) fs#1(down,stdby down)`).
   */
  references?: { groups?: string[]; shape?: "rid" | "rids" | "requires" };
  /** The conditions it applies under: `topology=flex`, `.mode=ovs` (of its own section). */
  depends?: string[];
}

/** A way to set a group of keywords, exclusive of the other ways of the group. */
export interface KeywordStrategy {
  id: string;
  name?: string;
  text?: string;
  /** The options of the keywords it sets. */
  uses?: string[];
  /** The options of the keywords it leaves unset, another strategy's. */
  excludes?: string[];
  /** The conditions on a selector keyword choosing it; none when the keywords set tell. */
  when?: unknown[];
  /** The options a section following it must set too, of another group maybe (`dev` of a static address). */
  requires?: string[];
}

/** A group of keywords, as the daemon sorts them: of a driver, or "" for every resource. */
export interface KeywordGroup {
  id: string;
  driver?: string;
  name?: string;
  text?: string;
  order?: number;
  strategies?: KeywordStrategy[];
  /** A section of the driver must follow one of its strategies (the addressing of an ip). */
  required?: boolean;
}

/** The groups each list of keywords came with: the list read as the designer keeps it. */
const KEYWORD_GROUPS = new WeakMap<object, KeywordGroup[]>();

/**
 * The keywords of an answer of GET .../config/keywords, its groups kept beside them:
 * `keywordGroupsOf` the list gives them back. An older daemon tells none.
 */
export function keywordItems(answer: { items?: DesignKeyword[]; groups?: KeywordGroup[] } | null | undefined): DesignKeyword[] {
  const items = answer?.items ?? [];
  if (Array.isArray(answer?.groups)) KEYWORD_GROUPS.set(items, answer.groups);
  return items;
}

export const keywordGroupsOf = (items: DesignKeyword[]): KeywordGroup[] => KEYWORD_GROUPS.get(items) ?? [];

/** The keywords of a group, under it. A group of none, a list from an older daemon: one, untitled. */
export interface GroupedKeywords {
  group?: KeywordGroup;
  keywords: DesignKeyword[];
}

const OTHER_GROUP: KeywordGroup = { id: "other", name: "Other", order: 1000 };

/**
 * Keywords under their groups, in the order the daemon gives the groups, a driver's
 * before the ones every resource has at the same order; a keyword of no group known
 * under "other". The groups with none of the keywords left out.
 */
export function groupKeywords(keywords: DesignKeyword[], groups: KeywordGroup[]): GroupedKeywords[] {
  if (groups.length === 0) return keywords.length === 0 ? [] : [{ keywords }];
  const sorted = [...groups].sort((a, b) => (a.order ?? 1000) - (b.order ?? 1000) || Number(Boolean(b.driver)) - Number(Boolean(a.driver)));
  const buckets = new Map<string, GroupedKeywords>();
  for (const group of sorted) if (!buckets.has(group.id)) buckets.set(group.id, { group, keywords: [] });
  for (const keyword of keywords) {
    let bucket = keyword.group === undefined ? undefined : buckets.get(keyword.group);
    if (bucket === undefined) {
      bucket = buckets.get(OTHER_GROUP.id);
      if (bucket === undefined) {
        bucket = { group: OTHER_GROUP, keywords: [] };
        buckets.set(OTHER_GROUP.id, bucket);
      }
    }
    bucket.keywords.push(keyword);
  }
  return [...buckets.values()].filter((b) => b.keywords.length > 0);
}

/** The value a design sets for an option: the section's, else its DEFAULT's. */
export type DesignLookup = (option: string) => string | undefined;

export function designLookup(section: DesignSection, sections: DesignSection[]): DesignLookup {
  // A value of any scope; an entry left empty, a keyword added without its value yet, sets none.
  const of = (s: DesignSection | undefined, option: string) =>
    s?.entries.find((e) => e.key.split("@")[0] === option && e.value.trim() !== "")?.value;
  const defaults = sections.find((s) => s.name === "DEFAULT");
  return (option) => of(section, option) ?? of(defaults, option);
}

/** Whether a condition of `when` holds: "option=value" or "option!=value", or the {Key, Op, Value} of om. */
function conditionHolds(condition: unknown, lookup: DesignLookup): boolean {
  let option: string | undefined;
  let op = "=";
  let value = "";
  if (typeof condition === "string") {
    const m = /^([^!=]+?)(!=|=)(.*)$/.exec(condition);
    if (m === null) return false;
    [, option, op, value] = m;
  } else if (condition !== null && typeof condition === "object") {
    const c = condition as { Key?: unknown; Op?: unknown; Value?: unknown };
    const key = c.Key;
    option = typeof key === "string" ? key.split(".").pop() : (key as { Option?: string; option?: string } | undefined)?.Option ?? (key as { option?: string } | undefined)?.option;
    op = typeof c.Op === "string" ? c.Op : "=";
    value = typeof c.Value === "string" ? c.Value : "";
  }
  if (!option) return false;
  const set = lookup(option.trim()) ?? "";
  if (op === "!=") return set !== value;
  if (op === "=") return set === value;
  return false;
}

/**
 * The strategy of a group a section follows, as the daemon tells it: the one its
 * selector keyword chooses (`when`), else the one whose keywords it sets. Undefined
 * while none is told, the choice still to make.
 */
export function impliedStrategy(group: KeywordGroup, section: DesignSection, lookup: DesignLookup): KeywordStrategy | undefined {
  const strategies = group.strategies ?? [];
  const selected = strategies.filter((s) => (s.when ?? []).length > 0);
  // The one its selector keyword chooses, `method = cli` say.
  const chosen = selected.find((s) => (s.when ?? []).every((c) => conditionHolds(c, lookup)));
  if (chosen) return chosen;
  // Else the one whose keywords are set, among those no selector chooses. A keyword
  // left empty sets nothing, as the daemon counts it: no strategy told by it.
  const plain = strategies.filter((s) => (s.when ?? []).length === 0);
  const set = new Set(section.entries.filter((e) => e.value.trim() !== "").map((e) => e.key.split("@")[0]));
  const told = plain.find((s) => (s.uses ?? []).some((o) => set.has(o)));
  if (told) return told;
  // The selector choosing none of the others: the one it leaves, by default.
  return selected.length > 0 && plain.length === 1 ? plain[0] : undefined;
}

/**
 * Every strategy of a group a section follows: those its selector keywords choose,
 * those whose keywords are set, and the one picked by `chosen`, as strategies that
 * exclude nothing of each other may be followed together (the certificates of an
 * acme task: from secs, and of domains); else the one a selector leaves, by default.
 */
export function followedStrategies(group: KeywordGroup, section: DesignSection, lookup: DesignLookup, chosen?: string): KeywordStrategy[] {
  const strategies = group.strategies ?? [];
  const set = new Set(section.entries.filter((e) => e.value.trim() !== "").map((e) => e.key.split("@")[0]));
  const followed = strategies.filter((s) =>
    (s.when ?? []).length > 0
      ? (s.when ?? []).every((c) => conditionHolds(c, lookup))
      : (s.uses ?? []).some((o) => set.has(o)));
  const picked = strategies.find((s) => s.id === chosen);
  if (picked && !followed.includes(picked) && !followed.some((f) => strategiesClash(f, picked))) followed.push(picked);
  if (followed.length > 0) return followed;
  const implied = impliedStrategy(group, section, lookup);
  return implied ? [implied] : [];
}

/** Whether two strategies exclude each other: one leaves a keyword the other sets. */
export function strategiesClash(a: KeywordStrategy, b: KeywordStrategy): boolean {
  if (a.id === b.id) return false;
  const leaves = (x: KeywordStrategy, y: KeywordStrategy) => (x.excludes ?? []).some((o) => (y.uses ?? []).includes(o));
  return leaves(a, b) || leaves(b, a);
}

/** How the strategy a section follows is told: by a selector keyword, by the keywords set, or by default. */
export function strategyReason(strategy: KeywordStrategy, section: DesignSection): "selector" | "keywords" | "default" {
  if ((strategy.when ?? []).length > 0) return "selector";
  const set = new Set(section.entries.filter((e) => e.value.trim() !== "").map((e) => e.key.split("@")[0]));
  return (strategy.uses ?? []).some((o) => set.has(o)) ? "keywords" : "default";
}

/** What a strategy still needs of a section: its choice, a keyword it uses, one it requires. */
export interface StrategyRequirement {
  group: KeywordGroup;
  /** Undefined while the strategy is still to choose. */
  strategy?: KeywordStrategy;
  /** The option to set; undefined for the choice itself. */
  option?: string;
}

/**
 * What the required strategy groups of a section still need, as the daemon refuses
 * a write without it: a strategy to choose; the strategy followed (told, or picked
 * by `chosen`), one of the keywords it uses when none is set, and each it requires.
 * A keyword counts set with a value of the section, in any scope, or of DEFAULT.
 */
export function strategyRequirements(groups: KeywordGroup[], section: DesignSection, lookup: DesignLookup, chosen: Record<string, string> = {}): StrategyRequirement[] {
  const isSet = (option: string) => (lookup(option) ?? "").trim() !== "";
  const needs: StrategyRequirement[] = [];
  for (const group of groups) {
    if (!group.required || (group.strategies ?? []).length === 0) continue;
    const followed = followedStrategies(group, section, lookup, chosen[group.id]);
    if (followed.length === 0) {
      needs.push({ group });
      continue;
    }
    const needed = new Set<string>();
    for (const strategy of followed) {
      const uses = strategy.uses ?? [];
      if (uses.length > 0 && !uses.some(isSet) && !needed.has(uses[0])) {
        needed.add(uses[0]);
        needs.push({ group, strategy, option: uses[0] });
      }
      for (const option of strategy.requires ?? []) {
        if (isSet(option) || needed.has(option)) continue;
        needed.add(option);
        needs.push({ group, strategy, option });
      }
    }
  }
  return needs;
}

/**
 * The entries a strategy chosen leaves behind in its group: those of the other
 * strategies of the group, their keywords used or required, the strategy chosen not
 * using nor requiring them, left without a value, as a former choice added them to
 * fill in. Those given a value stay: what the user wrote is not dropped by a choice.
 */
export function strategyLeftovers(group: KeywordGroup, strategy: string, section: DesignSection): string[] {
  const of = (s: KeywordStrategy) => [...(s.uses ?? []), ...(s.requires ?? [])];
  const kept = new Set((group.strategies ?? []).filter((s) => s.id === strategy).flatMap(of));
  const others = new Set((group.strategies ?? []).filter((s) => s.id !== strategy).flatMap(of).filter((o) => !kept.has(o)));
  return section.entries
    .filter((e) => others.has(e.key.split("@")[0]) && e.value.trim() === "")
    .map((e) => e.key);
}

/** Whether the strategy of a group is chosen by a selector keyword rather than by a choice. */
export const strategyBySelector = (group: KeywordGroup) => (group.strategies ?? []).some((s) => (s.when ?? []).length > 0);

/**
 * The options a strategy of the group sets: held back while none is chosen. Those a
 * strategy only excludes, the hardware of a guest virt-install builds, belong to none:
 * offered until a choice leaves them out.
 */
export function strategyOptions(group: KeywordGroup): Set<string> {
  return new Set((group.strategies ?? []).flatMap((s) => s.uses ?? []));
}

/**
 * The options not to offer a section: those the strategy it follows excludes, and,
 * for a group whose strategy is still to choose, those of every strategy of it.
 * `chosen`, the strategy picked by group id.
 */
export function withheldOptions(groups: KeywordGroup[], section: DesignSection, lookup: DesignLookup, chosen: Record<string, string> = {}): Set<string> {
  const withheld = new Set<string>();
  for (const group of groups) {
    if ((group.strategies ?? []).length === 0) continue;
    const followed = followedStrategies(group, section, lookup, chosen[group.id]);
    const options = followed.length > 0 ? followed.flatMap((s) => s.excludes ?? []) : [...strategyOptions(group)];
    for (const o of options) withheld.add(o);
  }
  return withheld;
}

export interface DesignEntry {
  key: string;
  value: string;
}

/** A section of the design: its name in the file, its driver for a resource. */
export interface DesignSection {
  name: string;
  /** "fs" of fs#1; none for DEFAULT and env. */
  group?: string;
  /** "flag" of fs.flag. */
  type?: string;
  entries: DesignEntry[];
}

/** The sections every design starts with: DEFAULT; and env, the free keys of a service or a volume, with `env`. */
export const designStart = (env = true): DesignSection[] => [
  { name: "DEFAULT", entries: [] },
  ...(env ? [{ name: "env", entries: [] }] : []),
];

/** The sections whose keys are free, no keyword of them. */
export const FREE_SECTIONS = ["env", "labels"];

/** The sections a design leaves as they are, neither shown nor written: the keys of a datastore. */
const KEPT_SECTIONS = ["data"];

/** The keys a design leaves as they are: the id of the object. */
const KEPT_KEYS = ["DEFAULT.id"];

/** A line continuing the value above it, as om reads one: starting with a space, a tab or a form feed. */
const isContinuation = (line: string) => line.length > 0 && (line[0] === " " || line[0] === "\t" || line[0] === "\f");

/** A value in quotes of `quote` alone, none inside: om reads it without them. */
const surrounded = (s: string, quote: string) =>
  s.length >= 2 && s[0] === quote && s[s.length - 1] === quote && s.indexOf(quote, 1) === s.length - 1;

/**
 * The value of a key as om reads it (util/ini, readValue, with the options of the
 * object configurations): `rest`, its key line after the `=`, then `following`,
 * the lines after it, none when the key line ends the file. Returns the value and
 * how many of the following lines it took.
 *
 * In backticks or triple quotes, it is as written, on several lines if they close
 * below. Otherwise a ` #` or a ` ;` starts a comment, the spaces around it go, and
 * one pair of quotes around it too; a trailing backslash continues it on the next
 * line, joined, and the lines below starting with a space or a tab continue it,
 * their indentation kept.
 */
export function readValue(rest: string, following: readonly string[]): { value: string; taken: number } {
  const terminated = following.length > 0;
  const continued = (value: string) => {
    let taken = 0;
    while (taken < following.length && isContinuation(following[taken] as string)) {
      value += `\n${following[taken]}`;
      taken++;
    }
    return { value, taken };
  };
  const line = rest.trimStart();
  if (line === "") return terminated ? continued("") : { value: "", taken: 0 };
  const quote = line.length > 3 && line.startsWith('"""') ? '"""' : line[0] === "`" ? "`" : "";
  if (quote !== "") {
    const body = line.slice(quote.length);
    const pos = body.lastIndexOf(quote);
    if (pos > -1) return { value: body.slice(0, pos), taken: 0 };
    // Closed on a line below: the line breaks between are the value's.
    let value = terminated ? `${body}\n` : body;
    for (let n = 0; n < following.length; n++) {
      const next = n < following.length - 1 ? `${following[n]}\n` : (following[n] as string);
      const end = next.lastIndexOf(quote);
      if (end > -1) return { value: value + next.slice(0, end), taken: n + 1 };
      value += next;
    }
    // Never closed: om refuses the file.
    return { value, taken: following.length };
  }
  let seg = line.trimEnd();
  if (seg.endsWith("\\")) {
    let value = seg.slice(0, -1);
    let taken = 0;
    while (taken < following.length) {
      const next = (following[taken] as string).trim();
      taken++;
      if (next === "") break;
      value += next;
      if (!value.endsWith("\\")) break;
      value = value.slice(0, -1);
    }
    return { value, taken };
  }
  let comment = seg.indexOf(" #");
  if (comment === -1) comment = seg.indexOf(" ;");
  if (comment > -1) seg = seg.slice(0, comment).trimEnd();
  if (surrounded(seg, "'") || surrounded(seg, '"')) return { value: seg.slice(1, -1), taken: 0 };
  return terminated ? continued(seg) : { value: seg, taken: 0 };
}

/**
 * A value written as om writes it (util/ini, encodeKeyLine): the first of as is,
 * in quotes, in backticks, in triple quotes, that om reads back as the value, the
 * line below it starting no continuation. As is when none does, which om reads
 * otherwise, or refuses.
 */
export function writeValue(value: string): string {
  const candidates = [value];
  if (!value.includes('"')) candidates.push(`"${value}"`);
  if (!value.includes("`")) candidates.push(`\`${value}\``);
  if (!value.includes('"""')) candidates.push(`"""${value}"""`);
  for (const candidate of candidates) {
    const [first, ...more] = candidate.split("\n");
    const read = readValue(first as string, [...more, ""]);
    if (read.taken === more.length && read.value === value) return candidate;
  }
  return value;
}

/**
 * The design of a configuration file, on the sections of `start`: a section each,
 * a resource its driver (its group from its name, its type from its `type` key),
 * each value as om reads it (`readValue`), its continuation lines kept as they
 * are; the comments, the kept sections and keys left out.
 */
export function parseDesign(text: string, start: DesignSection[] = designStart()): DesignSection[] {
  const sections: DesignSection[] = start.map((section) => ({ ...section, entries: [...section.entries] }));
  const at = (name: string) => {
    let section = sections.find((x) => x.name === name);
    if (!section) {
      section = name === "DEFAULT" || FREE_SECTIONS.includes(name) ? { name, entries: [] } : { name, group: name.split("#")[0], type: "", entries: [] };
      sections.push(section);
    }
    return section;
  };
  let current: DesignSection | null = null;
  let kept = false;
  const lines = text.replace(/\r/g, "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    // A section as om reads it (util/ini parse): its name up to the last "]" of the
    // line, a comment after it left out.
    const trimmed = line.trimStart();
    if (trimmed.startsWith("[")) {
      const close = trimmed.lastIndexOf("]");
      const name = close > 0 ? trimmed.slice(1, close).trim() : "";
      if (name === "") continue;
      kept = KEPT_SECTIONS.includes(name);
      current = kept ? null : at(name);
      continue;
    }
    // A comment, a blank line, or an indented one no key is above: nothing of the design.
    if (/^\s*([#;]|$)/.test(line) || isContinuation(line)) continue;
    // Its key up to the first "=" or ":", as om reads it (readKeyName).
    const delimiter = line.search(/[=:]/);
    const key = delimiter > 0 ? line.slice(0, delimiter).trim() : "";
    if (key === "") continue;
    // Its value, and the lines below that continue it, as om reads them.
    const { value, taken } = readValue(line.slice(delimiter + 1), lines.slice(i + 1));
    i += taken;
    if (kept) continue;
    const section = current ?? at("DEFAULT");
    if (key === "type" && section.group !== undefined && !NEEDS_GROUPS.includes(section.group)) {
      section.type = value;
    } else if (!KEPT_KEYS.includes(`${section.name}.${key}`)) {
      section.entries.push({ key, value });
    }
  }
  return sections;
}

/** The changes a design makes to the one it started from, as om config update takes them. */
export interface DesignChanges {
  set: { keyword: string; value: string }[];
  unset: string[];
  delete: string[];
}

/**
 * What turns the configuration of `before` into that of `after`: the sections gone
 * deleted, the keys gone unset, the keys new or changed set, a section new its type
 * first; a key new without a value not written. A keyword of DEFAULT is its key alone.
 */
export function designChanges(before: DesignSection[], after: DesignSection[]): DesignChanges {
  const keyword = (section: string, key: string) => (section === "DEFAULT" ? key : `${section}.${key}`);
  const names = new Set(after.map((section) => section.name));
  const changes: DesignChanges = {
    set: [],
    unset: [],
    delete: before.filter((section) => !names.has(section.name)).map((section) => section.name),
  };
  for (const section of after) {
    const old = before.find((x) => x.name === section.name);
    const was = new Map((old?.entries ?? []).map((e) => [e.key.trim(), e.value]));
    if (section.type && section.type !== old?.type) changes.set.push({ keyword: keyword(section.name, "type"), value: section.type });
    const keys = new Set<string>();
    for (const entry of section.entries) {
      const key = entry.key.trim();
      if (key === "") continue;
      keys.add(key);
      const changed = was.has(key) ? was.get(key) !== entry.value : entry.value.trim() !== "";
      if (changed) changes.set.push({ keyword: keyword(section.name, key), value: entry.value });
    }
    for (const key of was.keys()) if (key !== "" && !keys.has(key)) changes.unset.push(keyword(section.name, key));
  }
  return changes;
}

/**
 * A driver of a resource: its group and type, `fs.flag` its name. From the catalog of
 * a node (`/drivers`): what it is in a line, what it does (`features`, words of the
 * catalog's vocabulary), and for a virtual one the drivers it picks among on a node.
 */
export interface DesignDriver {
  group: string;
  type: string;
  name: string;
  doc?: string;
  features?: string[];
  selects?: string[];
  /** The grant needed to use it at all ("root"), or only to provision it; "" when any user may. */
  grant?: string;
  provisionGrant?: string;
}

/** A driver as the catalog of a node tells it (`GET /api/node/name/{node}/drivers`). */
export interface CatalogDriver {
  name: string;
  group: string;
  type: string;
  doc?: string;
  features?: string[];
  selects?: string[];
  aliasOf?: string;
  available?: boolean;
  grant?: string;
  provisionGrant?: string;
}

/**
 * The driver groups each kind's objects take, as om3 keys their keywords: a volume no
 * app nor container, a user no resource; a namespace configuration its claims.
 */
const KIND_GROUPS: Record<string, string[]> = {
  svc: ["app", "container", "disk", "fs", "ip", "share", "sync", "task", "volume"],
  vol: ["disk", "fs", "ip", "share", "sync", "task", "volume"],
  nscfg: ["claim"],
};

/** The claims of a namespace configuration, of no node's drivers: a claim of a pool, of a network. */
const CLAIM_DRIVERS: DesignDriver[] = ["network", "pool"].map((type) => ({ group: "claim", type, name: `claim.${type}` }));

/**
 * The drivers an object of `kind` may take, from the capabilities of a node
 * (`drivers.resource.<group>.<type>`, a feature of a driver a fifth word, left out):
 * those of the groups of its kind, in the order of their names.
 */
export function kindDrivers(kind: string, capabilities: string[]): DesignDriver[] {
  const groups = KIND_GROUPS[kind] ?? [];
  if (groups.includes("claim")) return CLAIM_DRIVERS;
  return capabilities
    .map((name) => name.split("."))
    .filter((words) => words[0] === "drivers" && words[1] === "resource" && groups.includes(words[2]))
    // A group of needs is a driver alone, its types those of the pools; any other a driver a type.
    .filter((words) => words.length === (NEEDS_GROUPS.includes(words[2]) ? 3 : 4))
    .map(([, , group, type = ""]) => ({ group, type, name: type ? `${group}.${type}` : group }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The drivers an object of `kind` may take, from the catalog of a node: those of the
 * groups of its kind the node has, a deprecated alias left out, in the order of their
 * names; a namespace configuration its claims.
 */
export function catalogDrivers(kind: string, catalog: CatalogDriver[]): DesignDriver[] {
  const groups = KIND_GROUPS[kind] ?? [];
  if (groups.includes("claim")) return CLAIM_DRIVERS;
  return catalog
    .filter((d) => groups.includes(d.group) && !d.aliasOf && d.available !== false)
    .map(({ name, group, type, doc, features, selects, grant, provisionGrant }) => ({ name, group, type, doc, features, selects, grant, provisionGrant }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Whether an object of `kind` takes resources: a user none. */
export const takesResources = (kind: string) => (KIND_GROUPS[kind] ?? []).length > 0;

/** Whether a section of an object of `kind` is one of its resources: not the heartbeats nor the node of the cluster's. */
export const isResource = (kind: string, section: { group?: string }) => !!section.group && (KIND_GROUPS[kind] ?? []).includes(section.group);

/**
 * The sections of the cluster configuration a design may hold several of, each by a
 * name (`pool#ceph`, `hb#1`): those choosing a driver by a type, and the arbitrators,
 * the hooks and the stonith of a node, and the unix groups granted (`uxgroup#ops`), as
 * om reads them. The keywords do not say it: kept here, as om's code knows it.
 */
const INDEXED_CLUSTER_SECTIONS = ["array", "arbitrator", "hb", "hook", "network", "pool", "stonith", "store", "switch", "uxgroup"];

export interface ClusterSectionChoice {
  /** The section, `ai`; for those of several, the kind of them, `pool`. */
  section: string;
  indexed: boolean;
  /** Whether it chooses its driver by a type; `types`, those the keyword `type` lists, if any. */
  typed: boolean;
  types: string[];
}

/**
 * The sections a design of the cluster configuration may add, from the keywords of
 * the cluster: each section once, those there already left out; the kinds of the
 * sections of several, with the types they choose among; by name.
 */
export function clusterSectionChoices(keywords: DesignKeyword[], sections: DesignSection[]): ClusterSectionChoice[] {
  const there = new Set(sections.map((s) => s.name));
  const names = [...new Set(keywords.map((k) => k.section))].filter((n) => n && n !== "DEFAULT" && !FREE_SECTIONS.includes(n));
  return names
    .map((section) => ({
      section,
      indexed: INDEXED_CLUSTER_SECTIONS.includes(section),
      typed: keywords.some((k) => k.section === section && k.option === "type"),
      types: [...new Set(keywords.filter((k) => k.section === section && k.option === "type").flatMap((k) => k.candidates ?? []))].sort(),
    }))
    .filter((c) => c.indexed || !there.has(c.section))
    .sort((a, b) => Number(a.indexed) - Number(b.indexed) || a.section.localeCompare(b.section));
}

/** Whether only root writes the objects of `kind`, every keyword of theirs root's: the cluster configuration. */
export const rootOnlyKind = (kind: string) => kind === "ccfg";

/**
 * The groups whose resources choose no type: a volume says what it needs (its size,
 * shared, access, a type of pool even, as a keyword like any) and the pool lookup
 * picks one matching. Its `type` a need, not its driver.
 */
export const NEEDS_GROUPS = ["volume"];

/**
 * The type a resource of no `type` gets, as its keywords tell it: the one type its
 * keywords of a type are of (`host` for an ip), "" when they tell none or several.
 */
export function impliedType(keywords: DesignKeyword[]): string {
  const types = new Set(keywords.flatMap((k) => k.types ?? []).filter((t) => t !== ""));
  return types.size === 1 ? [...types][0] : "";
}

/**
 * The types of pool a volume may ask for, from the capabilities of a node
 * (`drivers.resource.volume.<type>`).
 */
export function poolTypes(capabilities: string[]): string[] {
  return capabilities
    .map((name) => name.split("."))
    .filter((words) => words.length === 4 && words[0] === "drivers" && words[1] === "resource" && NEEDS_GROUPS.includes(words[2]))
    .map((words) => words[3])
    .sort();
}

/**
 * The drivers of a group in the order offered: each a choice, a virtual one first (it
 * picks among others on the node, `selects`: container.oci, docker else podman), the
 * drivers it stands for as its second choices (`alternatives`) rather than choices of
 * their own.
 */
export function offeredTypes(drivers: DesignDriver[]): { driver: DesignDriver; alternatives: DesignDriver[] }[] {
  const virtual = (d: DesignDriver) => (d.selects ?? []).length > 0;
  const standing = new Set(drivers.filter(virtual).flatMap((d) => d.selects ?? []));
  const offered = drivers
    .filter((d) => !standing.has(d.name))
    .map((driver) => ({ driver, alternatives: (driver.selects ?? []).flatMap((name) => drivers.filter((d) => d.name === name)) }));
  return [...offered.filter((o) => virtual(o.driver)), ...offered.filter((o) => !virtual(o.driver))];
}

/**
 * The drivers a design may offer: with `hideRoot` (a user not root, or root not
 * asking for what only root may set), not those only root may use (`grant`), which it
 * could never complete; those only root may provision offered still, usable with their
 * provision left to the user.
 */
export function usableDrivers(drivers: DesignDriver[], hideRoot: boolean): DesignDriver[] {
  return hideRoot ? drivers.filter((d) => d.grant !== "root") : drivers;
}

/**
 * Whether a resource's driver provisions anything: not when the catalog says it does
 * not (fs.nfs, mounted only); yes when unknown.
 */
export function provisions(drivers: DesignDriver[] | null, section: DesignSection): boolean {
  if (!section.group || drivers === null) return !!section.group;
  const driver = drivers.find((d) => d.name === (section.type ? `${section.group}.${section.type}` : section.group));
  return driver?.features === undefined || driver.features.includes("provision");
}

/** A driver as written: "fs.flag", its group and type; the group alone without a dot. */
export function parseDriver(driver: string): { group: string; type: string } {
  const [group, ...rest] = driver.trim().split(".");
  return { group: group ?? "", type: rest.join(".") };
}

/**
 * The name of a new section of a group: the group and the lowest index none of the
 * sections takes, from 1 (fs#1, then fs#2…).
 */
export function nextSectionName(sections: DesignSection[], group: string): string {
  const taken = new Set(sections.map((s) => s.name));
  let i = 1;
  while (taken.has(`${group}#${i}`)) i += 1;
  return `${group}#${i}`;
}

/** The keywords of a section of a driver: those of its group, of every type or of its own. */
export function sectionKeywords(keywords: DesignKeyword[], section: DesignSection): DesignKeyword[] {
  const group = section.group ?? section.name;
  return keywords.filter(
    (k) =>
      (k.section === group || (group === "DEFAULT" && k.section === "")) &&
      (!section.type || !k.types || k.types.length === 0 || k.types.includes(section.type)),
  );
}

/** The keywords a section must set, the type of a resource aside (the design writes it). */
export function requiredKeywords(keywords: DesignKeyword[], section: DesignSection): DesignKeyword[] {
  // A resource om provisions: what its provision fails without (the size of a volume, of a lv), required.
  const provisioned = !!section.group && !isUnmanaged(section);
  return sectionKeywords(keywords, section).filter(
    (k) => (k.required || (provisioned && k.provisioningRequired)) && k.option !== "type" && k.option !== "provision",
  );
}

/**
 * Whether the provision of a resource is left to the user (`provision = false`): om
 * skips its provision and unprovision, the user creates and removes what it manages.
 */
export function isUnmanaged(section: DesignSection): boolean {
  return !!section.group && section.entries.some((e) => e.key === "provision" && /^(false|no|0|off)$/i.test(e.value.trim()));
}

/**
 * A resource whose provision is left to the user, or to om again: `provision = false`
 * set, the provisioning keywords left without a value dropped; or `provision` unset.
 */
export function withUnmanaged(keywords: DesignKeyword[], section: DesignSection, unmanaged: boolean): DesignSection {
  const entries = section.entries.filter((e) => e.key !== "provision");
  if (!unmanaged) return { ...section, entries };
  const provisioning = new Set(sectionKeywords(keywords, section).filter((k) => k.provisioning).map((k) => k.option));
  return {
    ...section,
    entries: [...entries.filter((e) => !(provisioning.has(e.key) && e.value.trim() === "")), { key: "provision", value: "false" }],
  };
}

/**
 * The keywords of a section offered, those its entries do not set yet, in the order
 * of their names: with `hideRoot`, not those needing the root grant whatever the
 * value, those needing it for some values only offered (an image named `-x`).
 */
export function offeredKeywords(keywords: DesignKeyword[], section: DesignSection, hideRoot = false): DesignKeyword[] {
  const set = new Set(section.entries.map((e) => e.key));
  return sectionKeywords(keywords, section)
    .filter((k) => (k.option !== "type" || NEEDS_GROUPS.includes(section.group ?? "")) && !set.has(k.option) && !k.deprecated)
    // The provision of a resource: by its own box, not as a keyword.
    .filter((k) => !(section.group && k.option === "provision"))
    .filter((k) => !hideRoot || !(k.grant === "root" && k.grantAlways !== false))
    .sort((a, b) => a.option.localeCompare(b.option));
}

/** A section with its required keywords, each with an empty value, after the entries it has. */
export function withRequired(keywords: DesignKeyword[], section: DesignSection): DesignSection {
  const set = new Set(section.entries.map((e) => e.key));
  const missing = requiredKeywords(keywords, section).filter((k) => !set.has(k.option));
  return { ...section, entries: [...section.entries, ...missing.map((k) => ({ key: k.option, value: "" }))] };
}

/**
 * The file of a design, as om reads it: a section each, the type of a resource first,
 * then its entries with a key; an empty DEFAULT or env left out, an entry with no key too.
 */
export function designText(sections: DesignSection[]): string {
  const blocks: string[] = [];
  for (const section of sections) {
    const entries = section.entries.filter((e) => e.key.trim() !== "");
    // Each value as om writes it: in quotes when, as is, om would read it otherwise.
    const lines = [...(section.type ? [`type = ${section.type}`] : []), ...entries.map((e) => `${e.key.trim()} = ${writeValue(e.value)}`)];
    if (lines.length === 0 && !section.group) continue;
    blocks.push([`[${section.name}]`, ...lines].join("\n"));
  }
  return blocks.length === 0 ? "" : `${blocks.join("\n\n")}\n`;
}

/**
 * The keywords most set, by driver group, in the order they are offered: those om
 * calls minimal follow, then those every resource takes.
 */
const POPULAR: Record<string, string[]> = {
  // A guest is what it runs on, rather than the command of a container.
  "container.kvm": ["vcpus", "memory", "disk", "network", "image", "cloud_init"],
  DEFAULT: ["nodes", "orchestrate", "topology", "placement", "parents", "children"],
  app: ["start", "stop", "check", "info", "environment", "user"],
  container: ["image", "command", "rm", "environment", "volume_mounts", "netns", "hostname"],
  disk: ["size", "file", "name", "pool", "vg"],
  fs: ["mnt", "dev", "size", "mnt_opt", "user", "perm"],
  ip: ["name", "network", "netns", "netmask", "dev", "expose"],
  share: ["path", "opts"],
  sync: ["target", "src", "dst", "schedule"],
  task: ["command", "schedule", "user", "confirmation"],
  volume: ["size", "install", "name", "pool", "format", "shared"],
  claim: ["pool", "network", "size", "limit"],
};
const POPULAR_RESOURCE = ["tags", "subset", "standby", "optional", "monitor"];

/**
 * The keywords of a section offered at once, at most `max`: those most set of its
 * group, those its provision reads, those om calls minimal, then those every
 * resource takes; of the keywords
 * offered (`offeredKeywords`) alone.
 */
export function popularKeywords(keywords: DesignKeyword[], section: DesignSection, hideRoot = false, max = 6): DesignKeyword[] {
  const offered = offeredKeywords(keywords, section, hideRoot);
  const names = [
    ...(POPULAR[`${section.group}.${section.type}`] ?? POPULAR[section.group ?? section.name] ?? []),
    // What its provision reads, at hand for a resource om provisions.
    ...(section.group && !isUnmanaged(section) ? offered.filter((k) => k.provisioning).map((k) => k.option) : []),
    ...offered.filter((k) => k.minimal).map((k) => k.option),
    ...(section.group ? POPULAR_RESOURCE : []),
  ];
  const picked: DesignKeyword[] = [];
  for (const name of names) {
    const keyword = offered.find((k) => k.option === name);
    if (keyword && !picked.includes(keyword)) picked.push(keyword);
  }
  // None of them known to be set most, a section of a few keywords (ai, its agent_url): all of them at hand.
  if (picked.length === 0 && offered.length <= max) return offered;
  return picked.slice(0, max);
}

/** The words of a list value: those done, and the one being typed, empty after a space. */
export function listWords(value: string): { done: string[]; typed: string } {
  const words = value.split(/\s+/);
  const typed = words.pop() ?? "";
  return { done: words.filter((w) => w !== ""), typed };
}

/**
 * The first condition of a keyword's `depends` that does not hold, undefined when
 * all do: the keyword applies only where it holds, ignored elsewhere. `valueOf` gives
 * a value as the daemon judges it, set or inherited, else its default; a condition on
 * an option of no value at all is skipped, as the daemon does.
 */
export function unmetDepends(keyword: DesignKeyword | undefined, valueOf: (option: string, own: boolean) => string | undefined): string | undefined {
  for (const condition of keyword?.depends ?? []) {
    const c = parseCondition(condition);
    if (c === undefined) continue;
    const { own, option, op, want } = c;
    const have = valueOf(option, own);
    if (have === undefined) continue;
    const equal = have.trim().toLowerCase() === want.trim().toLowerCase();
    if (op === "=" ? !equal : equal) return condition.replace(/^\./, "");
  }
  return undefined;
}

/** A condition as om writes it, `topology=flex`, `.mode!=ovs`: its option, of the section itself or not, and its test. */
export function parseCondition(condition: unknown): { own: boolean; option: string; op: "=" | "!="; want: string } | undefined {
  if (typeof condition === "string") {
    const m = /^(\.)?([^!=]+?)(!=|=)(.*)$/.exec(condition);
    if (m === null) return undefined;
    return { own: m[1] === ".", option: m[2].trim(), op: m[3] as "=" | "!=", want: m[4].trim() };
  }
  if (condition !== null && typeof condition === "object") {
    const c = condition as { Key?: unknown; Op?: unknown; Value?: unknown };
    const key = c.Key;
    const option = typeof key === "string" ? key.split(".").pop() : (key as { Option?: string; option?: string } | undefined)?.Option ?? (key as { option?: string } | undefined)?.option;
    const op = c.Op === "!=" ? "!=" : c.Op === "=" || c.Op === undefined ? "=" : undefined;
    if (!option || op === undefined) return undefined;
    return { own: false, option, op, want: typeof c.Value === "string" ? c.Value : "" };
  }
  return undefined;
}

/** A keyword a selector strategy writes: its value, or none to remove it, falling to its default. */
export interface SelectorWrite {
  option: string;
  value: string | null;
}

/**
 * The writes that make the conditions of a strategy chosen by a selector keyword hold,
 * `quiesce = pause` for its pause: an equality sets the value; an inequality leaves it
 * alone when it holds, else removes the value set when the default then holds, else
 * sets a candidate that does. Undefined when a condition cannot be made to hold so.
 * `valueOf` gives the value as the daemon judges it; `set` whether one is written;
 * `keywordOf` the keyword of an option, for its default and candidates.
 */
export function strategySelectorWrites(
  strategy: KeywordStrategy,
  valueOf: (option: string, own: boolean) => string | undefined,
  set: (option: string, own: boolean) => boolean,
  keywordOf: (option: string, own: boolean) => DesignKeyword | undefined,
): SelectorWrite[] | undefined {
  const writes: SelectorWrite[] = [];
  const same = (a: string | undefined, b: string) => (a ?? "").trim().toLowerCase() === b.trim().toLowerCase();
  for (const condition of strategy.when ?? []) {
    const c = parseCondition(condition);
    if (c === undefined) return undefined;
    const have = valueOf(c.option, c.own);
    if (c.op === "=") {
      if (!same(have, c.want)) writes.push({ option: c.option, value: c.want });
      continue;
    }
    if (!same(have, c.want)) continue;
    const keyword = keywordOf(c.option, c.own);
    const fallback = keyword?.default === undefined ? undefined : String(keyword.default);
    if (set(c.option, c.own) && !same(fallback, c.want)) {
      writes.push({ option: c.option, value: null });
      continue;
    }
    const other = (keyword?.candidates ?? []).find((v) => v !== "" && !same(v, c.want));
    if (other === undefined) return undefined;
    writes.push({ option: c.option, value: other });
  }
  return writes;
}

/** The options a strategy group stands on: its keywords, and those its selectors read. */
export function strategyGroupOptions(group: KeywordGroup, keywords: DesignKeyword[]): Set<string> {
  const options = new Set(keywords.filter((k) => k.group === group.id).map((k) => k.option));
  for (const strategy of group.strategies ?? []) {
    for (const option of [...(strategy.uses ?? []), ...(strategy.excludes ?? []), ...(strategy.requires ?? [])]) options.add(option);
    for (const condition of strategy.when ?? []) {
      const c = parseCondition(condition);
      if (c) options.add(c.option);
    }
  }
  return options;
}

/**
 * Whether a strategy group comes first on its section, its choice in sight: required;
 * a keyword of it set there (its selector included); or one of it the section needs
 * or most sets (`important`). Else the choice waits in the keywords to add.
 */
export function prominentStrategyGroup(group: KeywordGroup, section: DesignSection, keywords: DesignKeyword[], important: Set<string>): boolean {
  if (group.required) return true;
  const options = strategyGroupOptions(group, keywords);
  if (section.entries.some((e) => e.value.trim() !== "" && options.has(e.key.split("@")[0]))) return true;
  return [...important].some((o) => options.has(o));
}

/**
 * The summary of a keyword's documentation, on its line in the keywords to add: its
 * first paragraph, its lines wrapped at 80 columns joined again, its markdown marks
 * dropped; ended by "…" when the documentation goes on past it (a list after "the
 * object instance:"), a line too long for its row cut by its row.
 */
export function keywordSummary(text: string | undefined): string {
  const doc = (text ?? "").trim();
  if (doc === "") return "";
  const unmark = (t: string) => t.replace(/`([^`]*)`/g, "$1").replace(/(\*\*|\*|__)(\S(?:.*?\S)?)\1/g, "$2").trim();
  // A documentation opening on a list, the values of a keyword: those values.
  if (/^[*-] /.test(doc)) {
    return doc.split("\n").filter((l) => /^[*-] /.test(l)).map((l) => unmark(l.slice(2))).join(", ");
  }
  const [first, ...rest] = doc.split(/\n\s*\n/);
  const plain = first
    .replace(/\s*\n\s*/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|\*|__)(\S(?:.*?\S)?)\1/g, "$2")
    .trim();
  const more = rest.some((r) => r.trim() !== "");
  return more ? `${plain.replace(/[:;,.]$/, "")}…` : plain;
}

/** A pick of a value: the value, what helps choose it, a word at its end. */
export interface ValuePick {
  value: string;
  info?: string[];
  side?: string;
}

/**
 * The values a keyword naming resources of the object takes: the resources of the
 * design of its groups, each told by its driver, the section itself left out; then
 * the special values it takes besides (`none`, `host`), said so.
 */
export function referencePicks(keyword: DesignKeyword | undefined, sections: DesignSection[], section: DesignSection, kind: string, special = "special"): ValuePick[] {
  const ref = keyword?.references;
  if (!ref) return [];
  const groups = ref.groups ?? [];
  const resources = sections
    .filter((s) => s.name !== section.name && isResource(kind, s) && (groups.length === 0 || groups.includes(s.group as string)))
    .map((s) => ({ value: s.name, info: [s.type ? `${s.group}.${s.type}` : (s.group as string)] }));
  const others = (keyword?.candidates ?? []).filter((c) => c !== "").map((c) => ({ value: c, info: [special] }));
  return [...resources, ...others];
}

/**
 * The words of a value naming several resources: those done, and the one being
 * typed. A requirement's states in parentheses belong to its resource, their
 * spaces included (`fs#1(down,stdby down)`).
 */
export function referenceWords(value: string): { done: string[]; typed: string } {
  const words = value.match(/[^\s(]+(\([^)]*\)?)?/g) ?? [];
  const open = /\([^)]*$/.test(value);
  if (value === "" || /\s$/.test(value) && !open) return { done: words, typed: "" };
  const typed = words.pop() ?? "";
  return { done: words, typed };
}

/** The resource a word of a requirement names, its states left out. */
export const referenceRid = (word: string) => word.replace(/\(.*$/, "");

/** The resources of a design a guest takes as its disks, each told by its driver. */
export function guestDiskChoices(sections: DesignSection[]): { value: string; info: string[] }[] {
  return sections
    .filter((s) => s.group === "disk" || s.group === "volume")
    .map((s) => ({ value: s.name, info: [s.type ? `${s.group}.${s.type}` : (s.group as string)] }));
}

/** The required entries of the sections left without a value: none, the design is complete. */
export function missingValues(sections: DesignSection[], keywords: DesignKeyword[]): { section: string; key: string }[] {
  return sections.flatMap((section) => {
    const required = new Set(requiredKeywords(keywords, section).map((k) => k.option));
    return section.entries.filter((e) => required.has(e.key) && e.value.trim() === "").map((e) => ({ section: section.name, key: e.key }));
  });
}

