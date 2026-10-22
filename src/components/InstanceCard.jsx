import React from "react";
import {useTranslation} from "react-i18next";
import {Checkbox} from "../ui/components/Field";
import {NotProvisionedMark, StoppedMark, RpoBreachedMark} from "../ui/components/StateMarks";
import {IconButton} from "../ui/components/Button";
import {MenuButton} from "../ui/components/MenuButton";
import {StatusMark} from "../ui/components/StatusMark";
import {isQuietDown, toObjectState} from "../ui/components/status";
import {FrozenMark} from "../ui/components/FrozenMark";
import {FileIcon, MoreIcon} from "../ui/icons";
import logger from '../utils/logger.js';
import {actionLabel} from "../constants/actions";

/** Icon of an action in a menu: the action icons are sized to the menu line. */
const ICON = "flex h-4 w-4 items-center justify-center text-ink-muted [&>svg]:h-4! [&>svg]:w-4!";
const DANGER_ICON = "flex h-4 w-4 items-center justify-center text-state-down [&>svg]:h-4! [&>svg]:w-4!";

/**
 * One instance of the object, on one 30px line: selection, state, node name,
 * stopped, RPO-breached (else frozen) and provisioning marks, monitor state, then its actions menu and its logs.
 * A click on the line (outside its controls) opens the instance view.
 */
const InstanceCard = ({
                          node,
                          nodeData = {},
                          selectedNodes = [],
                          toggleNode = () => logger.warn("toggleNode not provided"),
                          actionInProgress = false,
                          actions = [],
                          onAction = () => logger.warn("onAction not provided"),
                          getNodeState = () => ({
                              avail: "unknown",
                              frozen: "unfrozen",
                              state: null,
                              isStopped: false,
                              isLagging: false,
                          }),
                          instanceName,
                          onOpenLogs = () => logger.warn("onOpenLogs not provided"),
                          onViewInstance,
                          objectAvail,
                      }) => {
    const {t} = useTranslation();
    const resolvedInstanceName = instanceName || nodeData?.instanceName || nodeData?.name || node;

    if (!node) {
        logger.error("Node name is required");
        return null;
    }

    const {avail, frozen, state, isStopped, isLagging} = getNodeState(node);
    const isInstanceNotProvisioned = nodeData?.provisioned === false || nodeData?.provisioned === "false";
    const canView = typeof onViewInstance === 'function';
    const isSelected = selectedNodes.includes(node);

    const stoppedAt = nodeData?.stopped_at;

    const handleCardClick = (e) => {
        if (e.target.closest('button') || e.target.closest('input') || e.target.closest('.no-click')) {
            return;
        }
        if (canView) onViewInstance(node);
    };

    return (
        <div
            role="group"
            aria-label={t("instance.card.group", {node})}
            className={`group flex h-[1.875rem] items-center gap-2 px-3 text-data hover:bg-surface-sunken ${
                canView ? "cursor-pointer" : ""
            } ${isSelected ? "bg-accent-soft" : ""}`}
            onClick={handleCardClick}
        >
            <span className="no-click inline-flex" onClick={(e) => e.stopPropagation()}>
                <Checkbox
                    checked={isSelected}
                    onChange={() => toggleNode(node)}
                    aria-label={t("instance.card.selectNode", {node})}
                />
            </span>
            <StatusMark state={toObjectState(avail)} label={avail || t("instance.unknown")} muted={isQuietDown(avail, objectAvail)}/>
            {canView ? (
                <button
                    type="button"
                    onClick={() => onViewInstance(node)}
                    title={t("instance.card.viewResources")}
                    className="truncate font-medium text-ink hover:underline"
                >
                    {node}
                </button>
            ) : (
                <span className="truncate font-medium">{node}</span>
            )}
            {canView && (
                <span aria-hidden="true" className="hidden whitespace-nowrap text-accent italic group-hover:inline">
                    {t("instance.card.viewResourcesHint")}
                </span>
            )}
            {isStopped && <StoppedMark stoppedAt={stoppedAt} label={t("instance.card.stopped", {node})}/>}
            {/* A breached RPO says more than the freeze: it takes its place. */}
            {isLagging ? (
                <RpoBreachedMark label={t("instance.card.lagging", {node})}/>
            ) : (
                <FrozenMark frozen={frozen === "frozen"}/>
            )}
            {isInstanceNotProvisioned && (
                <NotProvisionedMark label={t("instance.card.notProvisioned", {node})} title={t("instance.notProvisionedTitle")}/>
            )}
            {state && <span className="truncate text-ink-muted">{state}</span>}

            <span className="no-click ml-auto flex items-center gap-1">
                <MenuButton
                    label={t("instance.card.actionsMenu", {node})}
                    icon={<MoreIcon className="h-4 w-4"/>}
                    compact
                    align="end"
                    disabled={actionInProgress}
                    className="inline-flex"
                    items={actions.map(({name, icon, color}) => ({
                        key: name,
                        label: actionLabel(name),
                        icon: (
                            <span aria-hidden="true" className={color === "red" ? DANGER_ICON : ICON}>
                                {icon}
                            </span>
                        ),
                        disabled: actionInProgress,
                        onSelect: () => onAction(node, name),
                    }))}
                />
                <IconButton
                    size="sm"
                    label={t("instance.card.viewLogs", {instance: resolvedInstanceName || node, node})}
                    onClick={(e) => {
                        e.stopPropagation();
                        onOpenLogs(node, resolvedInstanceName);
                    }}
                >
                    <FileIcon className="h-4 w-4"/>
                </IconButton>
            </span>
        </div>
    );
};

export default InstanceCard;
