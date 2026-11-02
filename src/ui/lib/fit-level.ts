import { useLayoutEffect, useState } from "react";

/**
 * The layout a table takes in the room of its scroller, among `count` of them, from
 * the widest (0) down: one step down while its table is wider than the room, the
 * width it needed there kept, one step up again once the room is that wide. A step
 * down may need no less room than the one above, its table being laid out again: it
 * then goes down again. Without a ResizeObserver, the widest.
 */
export function useFitLevel(count: number, scroller: { current: HTMLElement | null }): number {
  const [state, setState] = useState<{ level: number; needed: number[] }>({ level: 0, needed: [] });
  useLayoutEffect(() => {
    const box = scroller.current;
    const table = box?.querySelector("table");
    if (!box || !table || typeof ResizeObserver !== "function") return;
    const check = () => {
      const room = box.clientWidth;
      setState((was) => {
        const { level, needed } = was;
        if (table.scrollWidth > room && level < count - 1) {
          const next = [...needed];
          next[level] = table.scrollWidth;
          return { level: level + 1, needed: next };
        }
        const above = needed[level - 1];
        if (level > 0 && above !== undefined && room >= above) return { level: level - 1, needed };
        return was;
      });
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(box);
    observer.observe(table);
    return () => {
      observer.disconnect();
    };
  }, [count, scroller, state.level]);
  return state.level;
}
