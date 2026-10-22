import React from "react";
import {usePanelSearch} from "../app/panel-search";
import {NamespaceDetailPanel, NetworkDetailPanel, ObjectDetailPanel} from "./RecordPanels";
import {NodeDetailPanel} from "./NodePanel";
import {InstanceDetailPanel, ResourceDetailPanel} from "./InstanceRecord";

/**
 * Record looked at from any view, as oc3 does it.
 *
 * A badge (`CrossLink`), the panel history and the anchor open here the record they
 * name, without leaving the view nor losing its filters or its scroll. Placed in the
 * application shell: every view benefits from it, and there is only one panel of
 * this kind on screen. The record lives in the URL (`peek`), its tab too (`peektab`):
 * a shared link reopens it, and Escape or the cross closes the panel. The row panel
 * of a view and this one do not coexist (`panel-search.ts`).
 */
export function PeekPanel() {
    const {peek, peektab, setPeekTab, closePeek} = usePanelSearch();
    const id = (kind) => (peek?.kind === kind ? peek.id : undefined);
    return (
        <>
            <NodeDetailPanel node={id("node")} tab={peektab} onTabChange={setPeekTab} onClose={closePeek}/>
            <ObjectDetailPanel path={id("object")} tab={peektab} onTabChange={setPeekTab} onClose={closePeek}/>
            <NetworkDetailPanel name={id("network")} onClose={closePeek}/>
            <NamespaceDetailPanel name={id("namespace")} tab={peektab} onTabChange={setPeekTab} onClose={closePeek}/>
            <InstanceDetailPanel id={id("instance")} tab={peektab} onTabChange={setPeekTab} onClose={closePeek}/>
            <ResourceDetailPanel id={id("resource")} tab={peektab} onTabChange={setPeekTab} onClose={closePeek}/>
        </>
    );
}
