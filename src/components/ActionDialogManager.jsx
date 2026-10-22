import React, {useState, useEffect, useMemo} from 'react';
import {Dialog} from '../ui/components/Dialog';
import {Button} from '../ui/components/Button';
import {
    FreezeDialog,
    StopDialog,
    ShutdownDialog,
    UnprovisionDialog,
    PurgeDialog,
    DeleteDialog,
    SwitchDialog,
    GivebackDialog,
    Subject,
} from './ActionDialogs';
import logger from '../utils/logger.js';
import {useTranslation} from 'react-i18next';

// The translated label of an action, as actionLabel() of constants/actions, kept local
// so that the tests mocking constants/actions still render these dialogs.
const labelOf = (t, action) => t(`actions.labels.${action.replace(/\s+(\w)/g, (_, c) => c.toUpperCase())}`,
    {defaultValue: action.charAt(0).toUpperCase() + action.slice(1)});

export const SimpleConfirmDialog = ({open, onClose, onConfirm, action, target, names, disabled, cancelDisabled}) => {
    const {t} = useTranslation();
    const known = typeof action === 'string' && action;
    // The action name stays as is in the English sentence, French shows its translated label.
    const values = known ? {action, label: labelOf(t, action), target} : {target};
    const dialogTitle = known
        ? t('actionDialogs.simpleConfirm.titleAction', values)
        : t('actionDialogs.simpleConfirm.titleGeneric');
    return (
        <Dialog
            open={open}
            onClose={onClose}
            title={dialogTitle}
            footer={
                <>
                    <Button variant="secondary" onClick={onClose} disabled={cancelDisabled}>
                        {t('common.cancel')}
                    </Button>
                    <Button onClick={onConfirm} disabled={disabled}>
                        {t('common.confirm')}
                    </Button>
                </>
            }
        >
            <p className="text-ink">
                {known
                    ? t('actionDialogs.simpleConfirm.messageAction', values)
                    : t('actionDialogs.simpleConfirm.messageGeneric', values)}
            </p>
            <Subject names={names}/>
        </Dialog>
    );
};
const ActionDialogManager = ({
                                 pendingAction,
                                 handleConfirm,
                                 target,
                                 names,
                                 instances = false,
                                 supportedActions = [],
                                 onClose,
                             }) => {
    const [checkboxState, setCheckboxState] = useState({
        freeze: false,
        stop: false,
        shutdown: {instancesDown: false, peerTakeover: false},
        unprovision: {dataLoss: false, serviceInterruption: false, clusterwide: false},
        purge: {dataLoss: false, configLoss: false, serviceInterruption: false},
        "delete": {configLoss: false, clusterwide: false},
        "switch": false,
        giveback: false,
        simpleConfirm: false,
    });
    const [lastAction, setLastAction] = useState(null);

    const dialogConfig = useMemo(() => ({
        freeze: {
            component: FreezeDialog,
            props: {
                onClose: () => {
                    if (onClose) onClose();
                },
                onConfirm: () => {
                    handleConfirm(pendingAction?.action);
                    if (onClose) onClose();
                },
                checked: checkboxState.freeze,
                setChecked: (value) => {
                    setCheckboxState((prev) => ({...prev, freeze: value}));
                },
                pendingAction,
                target,
                names,
            },
        },
        stop: {
            component: StopDialog,
            props: {
                onClose: () => {
                    if (onClose) onClose();
                },
                onConfirm: () => {
                    handleConfirm(pendingAction?.action);
                    if (onClose) onClose();
                },
                checked: checkboxState.stop,
                setChecked: (value) => {
                    setCheckboxState((prev) => ({...prev, stop: value}));
                },
                pendingAction,
                target,
                names,
            },
        },
        shutdown: {
            component: ShutdownDialog,
            props: {
                onClose: () => {
                    if (onClose) onClose();
                },
                onConfirm: () => {
                    handleConfirm(pendingAction?.action);
                    if (onClose) onClose();
                },
                checkboxes: checkboxState.shutdown,
                setCheckboxes: (value) => {
                    let updates;
                    if (typeof value === 'function') {
                        updates = value(checkboxState.shutdown);
                    } else if (typeof value === 'object' && value !== null) {
                        updates = value;
                    } else {
                        logger.error('setCheckboxes for shutdown received invalid value:', value);
                        return;
                    }
                    const validKeys = ['instancesDown', 'peerTakeover'];
                    const validUpdates = Object.keys(updates).reduce((acc, key) => {
                        if (validKeys.includes(key)) {
                            acc[key] = updates[key];
                        }
                        return acc;
                    }, {});
                    setCheckboxState((prev) => ({
                        ...prev,
                        shutdown: {...prev.shutdown, ...validUpdates},
                    }));
                },
                pendingAction,
                target,
                names,
                instances,
            },
        },
        unprovision: {
            component: UnprovisionDialog,
            props: {
                onClose: () => {
                    if (onClose) onClose();
                },
                onConfirm: () => {
                    handleConfirm(pendingAction?.action);
                    if (onClose) onClose();
                },
                checkboxes: checkboxState.unprovision,
                setCheckboxes: (value) => {
                    let updates;
                    if (typeof value === 'function') {
                        updates = value(checkboxState.unprovision);
                    } else if (typeof value === 'object' && value !== null) {
                        updates = value;
                    } else {
                        logger.error('setCheckboxes for unprovision received invalid value:', value);
                        return;
                    }
                    const validKeys = ['dataLoss', 'serviceInterruption', 'clusterwide'];
                    const validUpdates = Object.keys(updates).reduce((acc, key) => {
                        if (validKeys.includes(key)) {
                            acc[key] = updates[key];
                        }
                        return acc;
                    }, {});
                    setCheckboxState((prev) => ({
                        ...prev,
                        unprovision: {...prev.unprovision, ...validUpdates},
                    }));
                },
                pendingAction,
                target,
                names,
                instances,
            },
        },
        purge: {
            component: PurgeDialog,
            props: {
                onClose: () => {
                    if (onClose) onClose();
                },
                onConfirm: () => {
                    handleConfirm(pendingAction?.action);
                    if (onClose) onClose();
                },
                checkboxes: checkboxState.purge,
                setCheckboxes: (value) => {
                    let updates;
                    if (typeof value === 'function') {
                        updates = value(checkboxState.purge);
                    } else if (typeof value === 'object' && value !== null) {
                        updates = value;
                    } else {
                        logger.error('setCheckboxes for purge received invalid value:', value);
                        return;
                    }
                    const validKeys = ['dataLoss', 'configLoss', 'serviceInterruption'];
                    const validUpdates = Object.keys(updates).reduce((acc, key) => {
                        if (validKeys.includes(key)) {
                            acc[key] = updates[key];
                        }
                        return acc;
                    }, {});
                    setCheckboxState((prev) => ({
                        ...prev,
                        purge: {...prev.purge, ...validUpdates},
                    }));
                },
                pendingAction,
                target,
                names,
            },
        },
        "delete": {
            component: DeleteDialog,
            props: {
                onClose: () => {
                    if (onClose) onClose();
                },
                onConfirm: () => {
                    handleConfirm(pendingAction?.action);
                    if (onClose) onClose();
                },
                checkboxes: checkboxState["delete"],
                setCheckboxes: (value) => {
                    let updates;
                    if (typeof value === 'function') {
                        updates = value(checkboxState["delete"]);
                    } else if (typeof value === 'object' && value !== null) {
                        updates = value;
                    } else {
                        logger.error('setCheckboxes for delete received invalid value:', value);
                        return;
                    }
                    const validKeys = ['configLoss', 'clusterwide'];
                    const validUpdates = Object.keys(updates).reduce((acc, key) => {
                        if (validKeys.includes(key)) {
                            acc[key] = updates[key];
                        }
                        return acc;
                    }, {});
                    setCheckboxState((prev) => ({
                        ...prev,
                        "delete": {...prev["delete"], ...validUpdates},
                    }));
                },
                pendingAction,
                target,
                names,
                instances,
            },
        },
        "switch": {
            component: SwitchDialog,
            props: {
                onClose: () => {
                    if (onClose) onClose();
                },
                onConfirm: () => {
                    handleConfirm(pendingAction?.action);
                    if (onClose) onClose();
                },
                checked: checkboxState["switch"],
                setChecked: (value) => {
                    setCheckboxState((prev) => ({...prev, "switch": value}));
                },
                pendingAction,
                target,
                names,
            },
        },
        giveback: {
            component: GivebackDialog,
            props: {
                onClose: () => {
                    if (onClose) onClose();
                },
                onConfirm: () => {
                    handleConfirm(pendingAction?.action);
                    if (onClose) onClose();
                },
                checked: checkboxState.giveback,
                setChecked: (value) => {
                    setCheckboxState((prev) => ({...prev, giveback: value}));
                },
                pendingAction,
                target,
                names,
            },
        },
        simpleConfirm: {
            component: SimpleConfirmDialog,
            props: {
                onClose: () => {
                    if (onClose) onClose();
                },
                onConfirm: () => {
                    handleConfirm(pendingAction?.action);
                    if (onClose) onClose();
                },
                action: pendingAction?.action,
                target,
                names,
                disabled: false,
                cancelDisabled: false,
            },
        },
    }), [checkboxState, handleConfirm, pendingAction, target, names, instances, onClose]);
    useEffect(() => {
        if (pendingAction === null) {
            setLastAction(null);
            if (onClose) onClose();
            return;
        }
        if (!pendingAction?.action || typeof pendingAction.action !== 'string') {
            if (process.env.NODE_ENV !== 'production') {
                logger.warn('Invalid pendingAction provided:', pendingAction);
            }
            if (onClose) onClose();
            return;
        }
        const action = pendingAction.action.toLowerCase();
        if (!supportedActions.includes(action)) {
            if (process.env.NODE_ENV !== 'production') {
                logger.warn(`Unsupported action: ${action}`);
            }
            if (onClose) onClose();
            return;
        }
        // Initialize checkbox state for the action only if the action has changed
        if (action !== lastAction) {
            const initCheckbox = {
                freeze: () => setCheckboxState((prev) => ({...prev, freeze: false})),
                stop: () => setCheckboxState((prev) => ({...prev, stop: false})),
                shutdown: () => setCheckboxState((prev) => ({
                    ...prev,
                    shutdown: {instancesDown: false, peerTakeover: false},
                })),
                unprovision: () => setCheckboxState((prev) => ({
                    ...prev,
                    unprovision: {dataLoss: false, serviceInterruption: false, clusterwide: false},
                })),
                purge: () => setCheckboxState((prev) => ({
                    ...prev,
                    purge: {dataLoss: false, configLoss: false, serviceInterruption: false},
                })),
                "delete": () => setCheckboxState((prev) => ({
                    ...prev,
                    "delete": {configLoss: false, clusterwide: false},
                })),
                "switch": () => setCheckboxState((prev) => ({...prev, "switch": false})),
                giveback: () => setCheckboxState((prev) => ({...prev, giveback: false})),
                simpleConfirm: () => setCheckboxState((prev) => ({...prev, simpleConfirm: false})),
            };
            if (initCheckbox[action]) {
                initCheckbox[action]();
            } else {
                initCheckbox.simpleConfirm();
            }
            setLastAction(action);
        }
    }, [pendingAction, supportedActions, onClose, lastAction]);

    if (!pendingAction || typeof pendingAction.action !== 'string' || !pendingAction.action) {
        return null;
    }
    const action = pendingAction.action.toLowerCase();
    if (!supportedActions.includes(action)) {
        return null;
    }
    const config = dialogConfig[action] || dialogConfig.simpleConfirm;
    const Component = config.component;
    const props = {...config.props, open: true, disabled: false};
    return <Component key={action} {...props} />;
};

export default ActionDialogManager;
