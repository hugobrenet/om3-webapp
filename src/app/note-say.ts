/*
 * The notes the status board makes of a status (statusboard.ts), said in the
 * language of the page: each its sentence of the catalog (statusBoard.said), its
 * values, and its text in English beside, the notes of a same text grouped by it.
 * The notes a resource logged are the daemon's: said as it wrote them.
 */
import { untrustedT } from "../utils/untrustedText.js";

/**
 * A note in words of the catalog: its key under statusBoard.said, its values, a
 * value a list of other notes said each, then joined. `count`, a number, chooses
 * the plural, not a value.
 */
export interface Say {
  key: string;
  values?: Record<string, string | number | Say[]>;
  count?: number;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** The sentence of `say`, its values as they are (node names, rids: never read as placeholders). */
export function sayIt(t: Translate, say: Say): string {
  const values = Object.fromEntries(
    Object.entries(say.values ?? {}).map(([name, value]) => [
      name,
      Array.isArray(value) ? value.map((part) => sayIt(t, part)).join(t("statusBoard.said.separator")) : value,
    ]),
  );
  return untrustedT(t, `statusBoard.said.${say.key}`, values, say.count === undefined ? {} : { count: say.count });
}

/** A note said: in the catalog's words when it has them, else its text, the daemon's. */
export const noteText = (t: Translate, note: { text: string; say?: Say }): string =>
  note.say === undefined ? note.text : sayIt(t, note.say);

/** A reason of a list (object-reason): its subject said before its note, as the board says them. */
export const reasonText = (t: Translate, reason: { text: string; say?: Say; subject?: string }): string => {
  if (reason.say === undefined) return reason.text;
  const said = sayIt(t, reason.say);
  if (reason.subject === undefined) return said;
  return untrustedT(t, "statusBoard.said.withSubject", { subject: subjectText(t, reason.subject), note: said });
};

/** The subjects of the notes about the object and its instances; the others are rids, said as they are. */
const SUBJECTS: Record<string, string> = {
  children: "children",
  instances: "instances",
  placement: "placement",
  overall: "overall",
  agents: "agents",
  monitor: "monitor",
  frozen: "frozen",
  "node frozen": "nodeFrozen",
  stopped: "stopped",
  provisioned: "provisioned",
};

/** What a note is about, in words of the page: a rid as it is. */
export const subjectText = (t: Translate, subject: string): string => {
  const key = SUBJECTS[subject];
  return key === undefined ? subject : t(`statusBoard.noteSubjects.${key}`);
};
