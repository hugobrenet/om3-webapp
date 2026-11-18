/*
 * The words of OpenSVC the webapp shows, said for someone who does not know the
 * product: a term and its definition each (`glossary.terms.<key>` in the catalog),
 * by group on the Glossary page, and on demand where a label uses one (`Term`).
 */

export const GLOSSARY_GROUPS = [
  {
    key: "concepts",
    terms: ["cluster", "node", "object", "instance", "resource", "namespace", "kinds", "heartbeat", "relay", "network", "pool", "array", "store", "snapshot", "label"],
  },
  {
    key: "kinds",
    terms: ["kindSvc", "kindVol", "kindCfg", "kindSec", "kindUsr", "kindNscfg", "kindCcfg"],
  },
  {
    key: "states",
    terms: [
      "avail",
      "overall",
      "provisioned",
      "frozen",
      "monitor",
      "expect",
      "globalExpect",
      "localExpect",
      "orchestration",
      "standby",
      "encap",
      "optional",
      "monitored",
      "leader",
      "score",
      "overloaded",
    ],
  },
  {
    key: "policies",
    terms: ["topology", "orchestrate", "placement", "flex"],
  },
  {
    key: "actions",
    terms: [
      "actionProvision",
      "actionUnprovision",
      "actionFreeze",
      "actionUnfreeze",
      "actionSwitch",
      "actionTakeover",
      "actionGiveback",
      "actionDrain",
      "actionPurge",
      "actionAbort",
      "actionClear",
    ],
  },
] as const;

export type GlossaryKey = (typeof GLOSSARY_GROUPS)[number]["terms"][number];

export const GLOSSARY_KEYS: readonly string[] = GLOSSARY_GROUPS.flatMap((g) => g.terms);

export const isGlossaryKey = (key: string): key is GlossaryKey => GLOSSARY_KEYS.includes(key);

/** The id of a term on the Glossary page, its anchor. */
export const termAnchor = (key: string) => `term-${key}`;

/** The address of a term on the Glossary page. */
export const termUrl = (key: string) => `/glossary#${termAnchor(key)}`;

/** The glossary key of an object kind, `svc` → `kindSvc`; undefined for one it does not define. */
export function kindTerm(kind: string): GlossaryKey | undefined {
  const key = `kind${kind.charAt(0).toUpperCase()}${kind.slice(1)}`;
  return isGlossaryKey(key) ? key : undefined;
}

/** Whether a term matches what is searched: its key, its name or its definition, any case. */
export function termMatches(query: string, ...texts: string[]): boolean {
  const q = query.trim().toLowerCase();
  return q === "" || texts.some((text) => text.toLowerCase().includes(q));
}
