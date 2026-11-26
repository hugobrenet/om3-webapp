/*
 * Whether the webapp may ask GitHub for its latest release: a request leaving the
 * cluster, the address of the user with it, so made only when the user opts in, from
 * the About page. Kept in the local storage of the browser; off by default. Turned
 * off, the release told before is forgotten too.
 */
import { useSyncExternalStore } from "react";

const KEY = "om3.releaseCheck";
const CACHED = ["appVersion", "appVersionTime"];
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "on";
  } catch {
    return false;
  }
}

/** Whether the user opted in to the release check. */
export const releaseCheckEnabled = read;

/** Opts in or out; out, the release told before forgotten. */
export function setReleaseCheck(on: boolean): void {
  try {
    if (on) {
      localStorage.setItem(KEY, "on");
    } else {
      localStorage.removeItem(KEY);
      for (const key of CACHED) localStorage.removeItem(key);
    }
  } catch {
    // No storage: the check stays off.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** The opt-in, kept in step with its changes, in this tab and the others. */
export function useReleaseCheck(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}

/** A version in parts: its numbers, and the parts of its pre-release (rc17: "rc", 17), if any. */
function parts(version: string): { main: number[]; pre: (string | number)[] } | null {
  const match = /^v?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?$/.exec(version.trim());
  if (!match) return null;
  const pre = (match[2] ?? "").match(/\d+|[A-Za-z]+/g) ?? [];
  return { main: match[1].split(".").map(Number), pre: pre.map((p) => (/^\d+$/.test(p) ? Number(p) : p)) };
}

/**
 * Compares two release versions, v or not: 1.0.0-rc9 before 1.0.0-rc17, before
 * 1.0.0. One not a version comes before any that is.
 */
export function compareVersions(a: string, b: string): number {
  const pa = parts(a);
  const pb = parts(b);
  if (!pa || !pb) return (pa ? 1 : 0) - (pb ? 1 : 0);
  for (let i = 0; i < Math.max(pa.main.length, pb.main.length); i += 1) {
    const d = (pa.main[i] ?? 0) - (pb.main[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  // A pre-release before its release.
  if (pa.pre.length === 0 || pb.pre.length === 0) return (pa.pre.length === 0 ? 1 : 0) - (pb.pre.length === 0 ? 1 : 0);
  for (let i = 0; i < Math.max(pa.pre.length, pb.pre.length); i += 1) {
    const x = pa.pre[i];
    const y = pb.pre[i];
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return Math.sign(x - y);
    // A number before a word, as semver orders them.
    if (typeof x === "number") return -1;
    if (typeof y === "number") return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/** The release a build is of, or past: v1.0.0-rc16 of v1.0.0-rc16-39-g451770638-dirty. */
export const releaseOf = (version: string) => version.replace(/-\d+-g[0-9a-f]+(?:-dirty)?$|-dirty$/, "");

/**
 * The latest release of those GitHub lists, without its v: the highest version
 * published, not the first listed, GitHub ordering them by the date of their tag,
 * not by when they were published. "" for none.
 */
export function latestRelease(releases: unknown): string {
  if (!Array.isArray(releases)) return "";
  let latest = "";
  for (const release of releases as { tag_name?: unknown; draft?: unknown }[]) {
    const tag = typeof release?.tag_name === "string" ? release.tag_name : "";
    if (tag === "" || release.draft === true) continue;
    if (latest === "" || compareVersions(tag, latest) > 0) latest = tag;
  }
  return latest.replace(/^v/, "");
}
