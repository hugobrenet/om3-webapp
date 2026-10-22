import { createContext, useContext } from "react";

/** The edge of the window the side panels stand against. */
export type PanelSide = "left" | "right";

export interface PanelSideSetting {
  side: PanelSide;
}

/**
 * Where the side panels open: on the right. No control moves them; a provider may
 * place them on the left.
 */
export const PanelSideContext = createContext<PanelSideSetting>({ side: "right" });

export function usePanelSide(): PanelSideSetting {
  return useContext(PanelSideContext);
}
