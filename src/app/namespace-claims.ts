/*
 * The claims of a namespace as its configuration writes them (`[claim#N]` of
 * `<namespace>/nscfg/namespace`), and what the claim wizard asks to write one:
 *
 * - a pool: its name, and the size the namespace may take of it ("20g");
 * - a network: its name, and how many addresses ("10");
 * - cpu: how many cpus, in the pg_cpu_quota notation, 100% a cpu ("800%");
 * - memory: a size ("16g").
 *
 * Cpu and memory may also give a default: the cap of a container setting none.
 * om3 does not check a limit when the configuration is written, a typo failing
 * only when the claim is used: the wizard writes nothing it would not read back.
 */
import { parseCpuLimit, parseSize, type Claim } from "./namespace-usage";

export type ClaimType = Claim["type"];

export const CLAIM_TYPES: ClaimType[] = ["pool", "network", "cpu", "memory"];

/** The types claimed of a named pool or network, which the wizard asks the name of. */
export const isNamed = (type: ClaimType) => type === "pool" || type === "network";

/** The units a size is entered in, binary as om3 reads a bare prefix: "20g" is 20 GiB. */
export const SIZE_UNITS = ["m", "g", "t"] as const;
export type SizeUnit = (typeof SIZE_UNITS)[number];

/** A limit as the wizard holds it: an amount, and for a size its unit. */
export interface LimitInput {
  amount: string;
  unit: SizeUnit;
}

const isSize = (type: ClaimType) => type === "pool" || type === "memory";

/** A positive number as typed, a comma for a decimal point too; undefined otherwise. */
function positive(text: string): number | undefined {
  const value = Number(text.trim().replace(",", "."));
  return text.trim() !== "" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** Why a limit cannot be written, as a key of `namespaces.claims.errors`; null when it can. */
export function limitError(type: ClaimType, input: LimitInput): string | null {
  const value = positive(input.amount);
  if (value === undefined) return "positive";
  if (type === "network" && !Number.isInteger(value)) return "integer";
  // A cpu is written in hundredths: less than one of them would be no cpu at all.
  if (type === "cpu" && Math.round(value * 100) < 1) return "cpuMin";
  return null;
}

/** The limit as the configuration writes it: "20g", "10", "800%". */
export function formatLimit(type: ClaimType, input: LimitInput): string {
  const value = positive(input.amount) as number;
  if (type === "cpu") return `${Math.round(value * 100)}%`;
  if (type === "network") return String(value);
  return `${String(value)}${input.unit}`;
}

/** What a limit is, in its unit: bytes for a size, addresses, cpus. Undefined when it is none. */
export function limitValue(type: ClaimType, input: LimitInput): number | undefined {
  if (limitError(type, input) !== null) return undefined;
  const text = formatLimit(type, input);
  return type === "cpu" ? parseCpuLimit(text) : type === "network" ? Number(text) : parseSize(text);
}

/**
 * The limit of a claim as the wizard starts an edit from: "16g" is 16 in GiB,
 * "400%" and "100%@4" are 4 cpus. A size in another unit is taken in MiB, the
 * amount kept exact; what the wizard cannot read starts empty.
 */
export function toInput(type: ClaimType, raw: string | undefined): LimitInput {
  const text = (raw ?? "").trim();
  if (type === "cpu") {
    const cpus = parseCpuLimit(text);
    return { amount: cpus === undefined ? "" : String(Math.round(cpus * 100) / 100), unit: "g" };
  }
  if (type === "network") return { amount: /^\d+$/.test(text) ? text : "", unit: "g" };
  const match = /^(\d+(?:[.,]\d+)?)([mgt])$/i.exec(text);
  if (match) return { amount: match[1], unit: match[2].toLowerCase() as SizeUnit };
  const bytes = parseSize(text);
  return { amount: bytes === undefined ? "" : String(Math.round((bytes / 2 ** 20) * 100) / 100), unit: "m" };
}

/** The section a new claim is written in: the one after the highest of the claims, from claim#1. */
export function nextSection(claims: Claim[]): string {
  const numbers = claims.map((c) => Number(/^claim#(\d+)$/.exec(c.section ?? "")?.[1])).filter(Number.isFinite);
  return `claim#${numbers.length === 0 ? 1 : Math.max(...numbers) + 1}`;
}

/** A claim to write: its section, its type, the name of its pool or network, its limit and default. */
export interface ClaimWrite {
  section: string;
  type: ClaimType;
  name?: string;
  limit: string;
  /** Cpu and memory only; an empty one is removed. */
  defaultLimit?: string;
}

/**
 * The keyword operations writing a claim (`set=` of PATCH .../config, POST
 * .../config/file): all of its section, so that an edit rewrites what it shows.
 */
export function claimOps(claim: ClaimWrite): { set: string[]; unset: string[] } {
  const set = [`${claim.section}.type=${claim.type}`];
  if (isNamed(claim.type) && claim.name) set.push(`${claim.section}.name=${claim.name}`);
  set.push(`${claim.section}.limit=${claim.limit}`);
  const unset: string[] = [];
  if (!isNamed(claim.type)) {
    if (claim.defaultLimit) set.push(`${claim.section}.default=${claim.defaultLimit}`);
    else unset.push(`${claim.section}.default`);
  }
  return { set, unset };
}

/** The query string of keyword operations: set, unset and delete, each repeated. */
export function opsQuery(ops: { set?: string[]; unset?: string[]; delete?: string[] }): string {
  const params = new URLSearchParams();
  for (const op of ops.set ?? []) params.append("set", op);
  for (const op of ops.unset ?? []) params.append("unset", op);
  for (const op of ops.delete ?? []) params.append("delete", op);
  return params.toString();
}

/**
 * Whether the user may write the claims: root, or the squatter grant, which the
 * daemon asks to write a namespace configuration (`assertNamespaceConfigWriter`).
 * An admin of the namespace may not.
 */
export const canWriteClaims = (grants: Record<string, unknown>) =>
  Object.prototype.hasOwnProperty.call(grants, "root") || Object.prototype.hasOwnProperty.call(grants, "squatter");
