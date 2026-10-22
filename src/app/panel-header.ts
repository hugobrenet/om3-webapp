import { createContext, useContext } from "react";

/**
 * The places in the title bar of a record panel where its content puts what
 * belongs to the whole record: by its name, what qualifies it (`title`), and on
 * the right, the actions on it (`actions`). The content renders there in portals,
 * keeping its state and its dialogs with it. Null outside a panel, or before the
 * title bar is drawn.
 */
export interface PanelHeaderSlots {
  title: HTMLElement | null;
  actions: HTMLElement | null;
}

export const PanelHeaderContext = createContext<PanelHeaderSlots>({ title: null, actions: null });

export function usePanelHeader(): PanelHeaderSlots {
  return useContext(PanelHeaderContext);
}
