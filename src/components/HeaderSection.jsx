import React from 'react';
import {createPortal} from 'react-dom';
import {useTranslation} from 'react-i18next';
import {usePanelHeader} from '../app/panel-header';
import {MenuButton} from '../ui/components/MenuButton';
import {StatusBadge} from '../ui/components/StatusBadge';
import {statusBadge} from '../ui/components/status';
import {FrozenMark} from '../ui/components/FrozenMark';
import {ObjectIcon, om3ObjectKind} from '../ui/components/ObjectIcon';
import {BoltIcon} from '../ui/icons';
import {NotProvisionedMark} from '../ui/components/StateMarks';
import {KEY_KINDS, OBJECT_ACTIONS, actionLabel, objectActionsFor} from '../constants/actions';
import {OrchestrationBadge} from './OrchestrationBadge';
import {isActionAllowedForSelection} from '../utils/objectUtils';

/** Icon of an action in a menu: the action icons are sized to the menu line. */
const ICON = "flex h-4 w-4 items-center justify-center text-ink-muted [&>svg]:h-4! [&>svg]:w-4!";
const DANGER_ICON = "flex h-4 w-4 items-center justify-center text-state-down [&>svg]:h-4! [&>svg]:w-4!";

/**
 * Record header of the object page: the kind icon and the object name, then its
 * global state, frozen and provisioning marks, the orchestration in progress (its
 * logs and its abort), and the object actions menu at the right edge. `embedded`
 * in a record panel, whose title already names the object: the state and the
 * actions only, the actions and the orchestration in the title bar of the panel, as
 * the other records have them. A configuration, a secret or a user is on all the
 * nodes and has no status: its actions only.
 */
const HeaderSection = ({
                           decodedObjectName,
                           kind,
                           globalStatus,
                           actionInProgress,
                           handleObjectActionClick,
                           getObjectStatus,
                           embedded = false,
                           onOrchestrationLogs,
                       }) => {
    const {t} = useTranslation();
    const header = usePanelHeader();
    if (!globalStatus) return null;

    const isNotProvisioned = globalStatus?.provisioned === "false" || globalStatus?.provisioned === false;
    const {avail, frozen, globalExpect, orchestrationId} = getObjectStatus();
    const badge = statusBadge(avail);
    const hasStatus = !KEY_KINDS.includes(kind);
    // Some actions only apply to some kinds (enable and disable to services).
    const allowedActions = objectActionsFor(kind, OBJECT_ACTIONS);

    const inHeader = embedded && header.actions !== null;
    const orchestration = (
        <OrchestrationBadge
            globalExpect={globalExpect}
            orchestrationId={orchestrationId}
            onLogs={onOrchestrationLogs}
            onAbort={() => handleObjectActionClick("abort")}
            disabled={actionInProgress}
        />
    );
    const menu = (
        <MenuButton
            // In the title bar of a panel, solid: "Actions" in a wide window, the bolt
            // alone in a narrow one; on the page, a solid pill.
            prominent={!inHeader}
            solid
            icon={<BoltIcon className="h-3.5 w-3.5"/>}
            label={inHeader ? t("statusBoard.actions.object") : t("objects.header.actionsMenu")}
            align="end"
            disabled={actionInProgress}
            items={allowedActions.map(({name, icon, color}) => {
                const isAllowed = isActionAllowedForSelection(name, [decodedObjectName]);
                return {
                    key: name,
                    label: actionLabel(name),
                    icon: (
                        <span aria-hidden="true" className={color === "red" && isAllowed ? DANGER_ICON : ICON}>
                            {icon}
                        </span>
                    ),
                    disabled: !isAllowed || actionInProgress,
                    onSelect: () => handleObjectActionClick(name),
                };
            })}
        />
    );

    return (
        <div className="flex min-w-0 flex-wrap items-center gap-3">
            {inHeader && createPortal(<>{orchestration}{menu}</>, header.actions)}
            {!embedded && (
                <div className="flex min-w-0 flex-1 items-center gap-2">
                    <ObjectIcon kind={om3ObjectKind(kind)} className="h-5 w-5"/>
                    <h1 className="truncate text-title font-semibold">{decodedObjectName}</h1>
                </div>
            )}

            <div className="flex items-center gap-3">
                {!inHeader && orchestration}
                {hasStatus && (
                    <span data-state={badge.state} title={t("objects.header.statusTitle", {status: avail || t("objects.header.unknown")})} className="inline-flex">
                        <StatusBadge state={badge.state} label={badge.label ?? (avail || undefined)} className="w-auto"/>
                    </span>
                )}
                <FrozenMark frozen={frozen === 'frozen'}/>
                {hasStatus && isNotProvisioned && (
                    <NotProvisionedMark label={t("objects.header.notProvisionedLabel")} title={t("objects.header.notProvisionedTitle")}/>
                )}
                {!inHeader && menu}
            </div>
        </div>
    );
};

export default HeaderSection;
