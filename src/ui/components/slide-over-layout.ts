/**
 * Where a side panel has room for a zone on the left of its record, the history
 * say: the window must be wider than the record zone by that much. Below, the
 * record takes the whole width and the zone gives way to a fallback placed in the
 * header. The classes are written out in full: Tailwind does not see names built
 * at runtime.
 */
export type SlideOverSize = "default" | "wide" | "wider";

/** Shown only where the rail fits beside the record. */
export const RAIL_VISIBLE: Record<SlideOverSize, string> = {
  default: "hidden md:flex",
  wide: "hidden lg:flex",
  wider: "hidden xl:flex",
};

/**
 * Where a panel can be resized by its left edge: the same windows as the rail, a
 * narrower one being filled by the panel anyway. The handle shows there only.
 */
export const RESIZE_VISIBLE: Record<SlideOverSize, string> = {
  default: "hidden md:block",
  wide: "hidden lg:block",
  wider: "hidden lg:block",
};

/**
 * Width of the record zone of a resized panel, read from `--panel-width`, in those
 * same windows. It never takes the room of the rail on its left, whatever the
 * window became since the width was chosen.
 */
export const RESIZED_WIDTH: Record<SlideOverSize, string> = {
  default: "md:max-w-[min(var(--panel-width),calc(100vw_-_12rem))]",
  wide: "lg:max-w-[min(var(--panel-width),calc(100vw_-_12rem))]",
  wider: "lg:max-w-[min(var(--panel-width),calc(100vw_-_12rem))]",
};
