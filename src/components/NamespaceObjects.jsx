import React, {useCallback, useMemo, useState} from "react";
import {useTranslation} from "react-i18next";
import useEventStore from "../hooks/useEventStore.js";
import {CrossLink} from "../app/CrossLink";
import {parseObjectPath} from "../utils/objectUtils.jsx";
import {listOfKind} from "../utils/objectLists";
import {objectsAlert} from "../hooks/useSidebarAlerts";
import {Table, HeaderRow, HeaderCell, Row, Cell, EmptyRow} from "../ui/components/Table";
import {TabCount} from "../ui/components/Tabs";
import {AlertMark} from "../ui/components/AlertMark";
import {Checkbox} from "../ui/components/Field";
import {MenuButton} from "../ui/components/MenuButton";
import {BoltIcon} from "../ui/icons";
import {useObjectBulkActions} from "./useObjectBulkActions";
import {KeyCells, ObjectStatusCell, PropertyCells} from "./ObjectCells";

/**
 * The kinds a namespace panel lists, a tab each, as the Objects page splits them:
 * the services, the volumes, the configurations and the secrets. No users: they
 * are the cluster's, not a namespace's. The namespace configuration is the tab of
 * its own (NamespaceConfig), not a configuration of the list.
 */
export const NAMESPACE_LISTS = ["services", "volumes", "configs", "secrets"];

/** The lists of the objects that run, whose tabs raise an alert. */
const ACTOR_LISTS = ["services", "volumes"];

const selectObjectStatus = (state) => state.objectStatus;

/** The objects of a namespace by list, in the order of their names; its configuration left out. */
export function useNamespaceObjects(namespace) {
    const objectStatus = useEventStore(selectObjectStatus);
    return useMemo(() => {
        const lists = Object.fromEntries(NAMESPACE_LISTS.map((list) => [list, []]));
        for (const path of Object.keys(objectStatus ?? {}).sort()) {
            const {namespace: ns, kind} = parseObjectPath(path);
            if (ns !== namespace || kind === "nscfg") continue;
            lists[listOfKind(kind)]?.push(path);
        }
        return {lists, status: objectStatus ?? {}};
    }, [objectStatus, namespace]);
}

/**
 * The tabs of the kinds, after the usage and the claims: each its count, the
 * services and volumes the alert of the menu too, their objects only.
 */
export function useNamespaceObjectTabs(namespace) {
    const {t, i18n} = useTranslation();
    const {lists, status} = useNamespaceObjects(namespace);
    return useMemo(() => NAMESPACE_LISTS.map((list) => {
        const alert = ACTOR_LISTS.includes(list)
            ? objectsAlert(Object.fromEntries(lists[list].map((path) => [path, status[path]])))
            : null;
        return {
            key: list,
            label: t(`objects.lists.${list}`),
            badge: (
                <>
                    <TabCount count={lists[list].length}/>
                    {alert && <AlertMark level={alert.level} text={alert.text} testId={`ns-tab-alert-${list}`}/>}
                </>
            ),
        };
        // The alerts are text: computed again when the language changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [lists, status, t, i18n.language]);
}

const stopPropagation = (e) => e.stopPropagation();

/**
 * The objects of one kind in a namespace, as the Objects page lists them: a
 * checkbox to select it, the services and volumes with their status, orchestrate
 * and topology, the configurations and secrets with their keys. The name of an
 * object is a badge opening it; the Actions menu acts on the ones selected, as on
 * the Objects page.
 */
export function NamespaceObjects({namespace, list}) {
    const {t} = useTranslation();
    const {lists} = useNamespaceObjects(namespace);
    const paths = lists[list] ?? [];
    const keys = !ACTOR_LISTS.includes(list);
    const [picked, setPicked] = useState([]);
    // An object gone, deleted say, is no longer selected.
    const selected = useMemo(() => picked.filter((path) => paths.includes(path)), [picked, paths]);
    const clearSelection = useCallback(() => setPicked([]), []);
    const {items, feedback, dialog} = useObjectBulkActions({selectedObjects: selected, onDone: clearSelection});
    const toggle = (path) => (e) => setPicked((prev) => (e.target.checked ? [...prev, path] : prev.filter((p) => p !== path)));
    const allSelected = paths.length > 0 && selected.length === paths.length;
    const columns = keys
        ? [t("objects.columns.object"), t("objects.columns.keys"), t("objects.columns.keysSize")]
        : [t("objects.columns.object"), t("objects.columns.orchestrate"), t("objects.columns.topology"), t("common.status")];

    return (
        <div className="space-y-3">
            {/* Nothing selected, nothing to act on: how to select, in the place of the actions. */}
            <div className="flex min-h-7 items-center justify-end gap-3">
                {selected.length > 0 ? (
                    <>
                        <span className="whitespace-nowrap text-ink-muted">{t("common.selected", {count: selected.length})}</span>
                        <MenuButton
                            prominent
                            icon={<BoltIcon className="h-3.5 w-3.5"/>}
                            label={t("objects.actionsMenu")}
                            align="end"
                            items={items}
                        />
                    </>
                ) : (
                    <span className="whitespace-nowrap text-ink-muted">{t("objects.selectHint")}</span>
                )}
            </div>
            {feedback}
            <Table aria-label={t("namespaces.objects.tableLabel", {list: t(`objects.lists.${list}`), namespace})} data-testid={`namespace-objects-${list}`}>
                <thead>
                    <HeaderRow>
                        <HeaderCell className="w-8">
                            <Checkbox
                                checked={allSelected}
                                onChange={(e) => setPicked(e.target.checked ? paths : [])}
                                aria-label={t("namespaces.objects.selectAll", {list: t(`objects.lists.${list}`)})}
                            />
                        </HeaderCell>
                        {columns.map((label, i) => (
                            <HeaderCell key={label} className={keys && i > 0 ? "text-right" : undefined}>{label}</HeaderCell>
                        ))}
                    </HeaderRow>
                </thead>
                <tbody>
                    {paths.map((path) => (
                        <Row key={path} className={selected.includes(path) ? "bg-accent-soft" : undefined}>
                            <Cell className="w-8">
                                <Checkbox
                                    checked={selected.includes(path)}
                                    onChange={toggle(path)}
                                    onClick={stopPropagation}
                                    aria-label={t("objects.selectObject", {name: path})}
                                />
                            </Cell>
                            {/* The name alone: the namespace is the panel's, the kind the tab's. */}
                            <Cell className="whitespace-nowrap" title={path}>
                            <CrossLink kind="object" id={path}>{parseObjectPath(path).name}</CrossLink>
                        </Cell>
                            {keys ? <KeyCells objectName={path}/> : (
                                <>
                                    <PropertyCells objectName={path}/>
                                    <ObjectStatusCell objectName={path}/>
                                </>
                            )}
                        </Row>
                    ))}
                    {paths.length === 0 && (
                        <EmptyRow colSpan={columns.length + 1}>
                            {t("namespaces.objects.empty", {list: t(`objects.lists.${list}`).toLowerCase(), namespace})}
                        </EmptyRow>
                    )}
                </tbody>
            </Table>
            {dialog}
        </div>
    );
}
