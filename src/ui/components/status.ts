import type { ObjectState } from "./StatusBadge";

/**
 * Translates a collector status into an OpenSVC object state.
 * The database stores "up", "warn", "down", "n/a", and an empty string for a service
 * that has never reported a status: n/a is a state of its own, the status does not
 * apply; the empty string is an unknown state.
 */
/**
 * A down instance that is no issue: its object is up, or standby up, so the
 * instance it misses is not wanted. Drawn gray rather than red.
 */
export function isQuietDown(instanceAvail: string | undefined, objectAvail: string | undefined): boolean {
  return instanceAvail === "down" && (objectAvail === "up" || objectAvail === "stdby up");
}

export function toObjectState(value: string | undefined): ObjectState {
  switch (value) {
    case "up":
    case "warn":
    case "down":
      return value;
    case "n/a":
      return "na";
    default:
      return "unknown";
  }
}

/**
 * Badge for a collector status, standby values included. As in the historical
 * collector (`cell_decorator_status`), "stdby up" takes the colour of "up" and
 * "stdby down" that of "down", and "undef" that of an unknown state; those values
 * keep their own label, which says more than the state alone.
 */
export function statusBadge(value: string | undefined): { state: ObjectState; label?: string } {
  switch (value) {
    case "stdby up":
      return { state: "up", label: value };
    case "stdby down":
      return { state: "down", label: value };
    case "undef":
      return { state: "unknown", label: value };
    default:
      return { state: toObjectState(value) };
  }
}
