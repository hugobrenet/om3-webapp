/*
 * A storage array, a `[array#<name>]` section of the cluster configuration
 * (`section-config.ts`): how the nodes reach it, by its API, its management host or
 * its CLI, and with which credentials. The pools of the array types (pure, hoc,
 * freenas…) name the one they make their disks on by their `array` keyword.
 */
import type { SectionRules } from "./section-config";
import { sectionValues } from "./heartbeat-config";
import { sectionHeaders } from "./ini";
import { extractSection } from "../utils/configSections";

/** What an array asks beyond its keywords: where it is reached first, then as whom, then how. */
export const ARRAY_RULES: SectionRules = {
  order: [
    "api",
    "url",
    "manager",
    "symcli_connect",
    "symcli_path",
    "name",
    "model",
    "username",
    "password",
    "client_id",
    "key_id",
    "issuer",
    "private_key",
    "secret",
    "key",
    "pwf",
    "cli",
    "method",
    "bin",
    "jre_path",
    "insecure",
    "timeout",
    "delay",
    "retry",
    "http_proxy",
    "https_proxy",
    "wwid_prefix",
    "schedule",
  ],
};

/** The keys telling where an array is reached, the first set said: its API, its URL, its manager, its CLI connection. */
const ENDPOINT_KEYS = ["api", "url", "manager", "symcli_connect"];

/** Where an array is reached, as its section says; undefined, none of the keys set. */
export function arrayEndpoint(values: Record<string, string>): string | undefined {
  for (const key of ENDPOINT_KEYS) {
    if (values[key]) return values[key];
  }
  return undefined;
}

/** The names of the `<section>#<name>` sections of a configuration file, in their order. */
export function sectionNames(text: string, section: string): string[] {
  const prefix = `${section}#`;
  return sectionHeaders(text.split("\n"))
    .filter((header): header is string => header !== null && header.startsWith(prefix))
    .map((header) => header.slice(prefix.length));
}

/** The values of each `[array#<name>]` section of a configuration file, by name. */
export function arraySections(text: string): Record<string, Record<string, string>> {
  return Object.fromEntries(sectionNames(text, "array").map((name) => [name, sectionValues(extractSection(text, `array#${name}`))]));
}

/**
 * The pools making their disks on an array, sorted: those whose `array` keyword names
 * it, on every node or on one (`array@<node>`).
 */
export function poolsOfArray(text: string, array: string): string[] {
  return sectionNames(text, "pool")
    .filter((pool) => {
      const values = sectionValues(extractSection(text, `pool#${pool}`));
      return Object.entries(values).some(([key, value]) => (key === "array" || key.startsWith("array@")) && value.trim() === array);
    })
    .sort();
}
