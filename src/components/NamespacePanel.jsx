import React from "react";
import {useTranslation} from "react-i18next";
import useEventStore from "../hooks/useEventStore.js";
import {nscfgOf} from "../app/namespace-usage";
import {Section} from "./NodePanel";
import NamespaceMetrics from "./NamespaceMetrics";
import ObjectConfig from "./ObjectConfig";

/**
 * The first tab of a namespace: the cpu and memory its objects use, object by object
 * (NamespaceMetrics). Its claims, and what it takes of each, are the second tab
 * (NamespaceClaims).
 */
export function NamespaceUsage({namespace}) {
    const {t} = useTranslation();
    return (
        <div className="space-y-6">
            <Section id={`namespace-objects-${namespace}`} title={t("namespaces.panel.byObject")}>
                <NamespaceMetrics namespace={namespace}/>
            </Section>
        </div>
    );
}

/**
 * The third tab of a namespace: its configuration object, the file and the tools
 * of an object configuration (ObjectConfig). A namespace without one starts from an
 * empty file: the first change written creates it, its claims and pg settings in it.
 */
export function NamespaceConfig({namespace}) {
    const {path, key} = nscfgOf(namespace);
    const exists = useEventStore((s) => s.objectStatus?.[key] !== undefined || s.objectInstanceStatus?.[key] !== undefined);
    return <ObjectConfig path={path} statusPath={key} absent={!exists}/>;
}
