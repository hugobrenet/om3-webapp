import { describe, expect, test } from "vitest";
import i18n from "../../i18n";
import { noteText, reasonText, sayIt, subjectText } from "../note-say";
import { buildBoard, type ObjectData, resourceNotes } from "../statusboard";
import dns from "./fixtures/system-svc-dns.json";

const en = i18n.getFixedT("en");
const fr = i18n.getFixedT("fr");

describe("the notes of the status board, in the language of the page", () => {
  test("in English, every note the board says as its text: the catalog and the board agree", () => {
    const board = buildBoard({ path: "system/svc/dns", object: dns as unknown as ObjectData });
    const notes = [...board.notes, ...board.rows.flatMap((r) => [...r.rowNotes, ...r.cellNotes.flat()])];
    expect(notes.some((n) => n.say !== undefined)).toBe(true);
    for (const n of notes) expect(noteText(en, n)).toBe(n.text);
  });

  test("in French, said in French; its values as they are", () => {
    expect(sayIt(fr, { key: "frozen" })).toBe("le démon ne prend aucune initiative sur l'instance");
    expect(sayIt(fr, { key: "gaveUp", values: { state: "start failed" } })).toBe(
      "start failed : l'orchestration a abandonné, réinitialisez l'instance pour réessayer",
    );
    // A node named as a placeholder is said as it is, never filled again.
    expect(sayIt(fr, { key: "childUp", values: { child: "{{child}}" } })).toBe(
      "down alors que son enfant {{child}} est up : l'enfant a besoin du vol",
    );
  });

  test("a mix of states, each part said, then joined", () => {
    const say = {
      key: "mixed",
      values: { parts: [{ key: "mixedUp", values: { rids: "fs#1" } }, { key: "mixedUnsynced", values: { rids: "sync#1" } }] },
    };
    expect(sayIt(en, say)).toBe("mixed resource states: fs#1 up, sync#1 down, the data not replicated");
    expect(sayIt(fr, say)).toBe("états de ressources mêlés : fs#1 up, sync#1 down, les données non répliquées");
  });

  test("a note a resource logged, the daemon's: said as it wrote it", () => {
    expect(noteText(fr, { text: "fs#1: mount failed" })).toBe("fs#1: mount failed");
    const notes = resourceNotes([["n1", { status: "down", log: [{ level: "warn", message: "no such device" }] }]]);
    expect(notes.map((n) => noteText(fr, n))).toEqual(["no such device"]);
  });

  test("the subjects of the object said; a rid as it is", () => {
    expect(subjectText(fr, "node frozen")).toBe("nœud gelé");
    expect(subjectText(fr, "children")).toBe("enfants");
    expect(subjectText(fr, "fs#1")).toBe("fs#1");
  });

  test("a reason of the lists, its subject before it, as French writes a colon", () => {
    const reason = { text: "frozen: the daemon takes no initiative on the instance", say: { key: "frozen" }, subject: "frozen" };
    expect(reasonText(en, reason)).toBe(reason.text);
    expect(reasonText(fr, reason)).toBe("gelé : le démon ne prend aucune initiative sur l'instance");
    expect(reasonText(fr, { text: "fs#1 down", say: { key: "resourcesDown", values: { rids: "fs#1" } } })).toBe("fs#1 down");
    // A resource's note, the daemon's: its text, its rid in it.
    expect(reasonText(fr, { text: "fs#1: no such device", subject: "fs#1" })).toBe("fs#1: no such device");
  });
});
