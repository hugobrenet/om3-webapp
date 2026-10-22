import React, {useRef} from 'react';
import {Dialog} from '../ui/components/Dialog';
import {Button} from '../ui/components/Button';
import {Checkbox, Field, Input, Textarea} from '../ui/components/Field';
import {Trans, useTranslation} from 'react-i18next';

// The translated label of an action, as actionLabel() of constants/actions, kept local
// so that the tests mocking constants/actions still render these dialogs.
const labelOf = (t, action) => t(`actions.labels.${action.replace(/\s+(\w)/g, (_, c) => c.toUpperCase())}`,
    {defaultValue: action.charAt(0).toUpperCase() + action.slice(1)});

// Cancel and confirm buttons at the foot of a dialog.
const DialogFooter = ({onClose, cancelDisabled = false, onConfirm, confirmDisabled, confirmLabel, variant = 'secondary', children}) => {
    const {t} = useTranslation();
    return (
        <>
            <Button variant="secondary" onClick={onClose} disabled={cancelDisabled}>
                {t('common.cancel')}
            </Button>
            <Button variant={variant} onClick={onConfirm} disabled={confirmDisabled} aria-label={confirmLabel}>
                {children}
            </Button>
        </>
    );
};

// What a dialog acts on, in words, and the names one per line when there are several:
// a bulk action on many objects or nodes is confirmed knowing which.
export const Subject = ({target, names}) => {
    const {t} = useTranslation();
    const list = Array.isArray(names) && names.length > 1 ? names : [];
    if (!target && list.length === 0) return null;
    return (
        <div className="flex flex-col gap-2 text-ink">
            {target && (
                <p>
                    <Trans i18nKey="actionDialogs.subject" values={{target}} components={{strong: <strong/>}}/>
                </p>
            )}
            {list.length > 0 && (
                <ul
                    aria-label={t('actionDialogs.subjectNamesAria')}
                    className="max-h-40 overflow-y-auto rounded-(--radius-control) border border-line px-3 py-2 font-mono text-sm"
                >
                    {list.map((name) => <li key={name}>{name}</li>)}
                </ul>
            )}
        </div>
    );
};

// Acknowledgement checkboxes, one per line.
const Acknowledgements = ({children}) => <div className="flex flex-col gap-2 text-ink">{children}</div>;

// Dialog with a single acknowledgement checkbox
const SingleCheckDialog = ({
                               open, onClose, onConfirm, checked, setChecked, disabled,
                               target, names, title, checkboxLabel, checkboxAriaLabel, confirmAriaLabel, confirmText,
                               variant = 'secondary', cancelDisabled = false,
                           }) => (
    <Dialog
        open={open}
        onClose={onClose}
        title={title}
        footer={
            <DialogFooter
                onClose={onClose}
                cancelDisabled={cancelDisabled}
                onConfirm={onConfirm}
                confirmDisabled={!checked || disabled}
                confirmLabel={confirmAriaLabel}
                variant={variant}
            >
                {confirmText}
            </DialogFooter>
        }
    >
        <Subject target={target} names={names}/>
        <Acknowledgements>
            <Checkbox
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
                aria-label={checkboxAriaLabel}
                label={checkboxLabel}
            />
        </Acknowledgements>
    </Dialog>
);

// Hidden file input behind a "Choose File" button, the chosen file name beside it
const FilePicker = ({id, onChange, disabled, file, emptyText}) => {
    const {t} = useTranslation();
    const input = useRef(null);
    return (
        <div>
            <input
                ref={input}
                id={id}
                type="file"
                hidden
                onChange={onChange}
                disabled={disabled}
            />
            <div className="flex items-center gap-3">
                <Button variant="secondary" onClick={() => input.current?.click()} disabled={disabled}>
                    {t('actionDialogs.chooseFile')}
                </Button>
                <span className={file ? 'text-ink' : 'text-ink-muted'}>
                    {file ? file.name : emptyText}
                </span>
            </div>
        </div>
    );
};

// Dialog for the "freeze" action
export const FreezeDialog = ({open, onClose, onConfirm, checked, setChecked, disabled, target, names}) => {
    const {t} = useTranslation();
    return (
        <SingleCheckDialog
            open={open} onClose={onClose} onConfirm={onConfirm}
            checked={checked} setChecked={setChecked} disabled={disabled}
            target={target} names={names}
            title={t('actionDialogs.freeze.title')}
            checkboxAriaLabel={t('actionDialogs.freeze.checkboxAria')}
            checkboxLabel={t('actionDialogs.freeze.checkbox')}
            confirmAriaLabel={t('actionDialogs.freeze.confirmAria')}
            confirmText={t('common.confirm')}
        />
    );
};

// Dialog for the "stop" action
export const StopDialog = ({open, onClose, onConfirm, checked, setChecked, disabled, target, names}) => {
    const {t} = useTranslation();
    return (
        <SingleCheckDialog
            open={open} onClose={onClose} onConfirm={onConfirm}
            checked={checked} setChecked={setChecked} disabled={disabled}
            target={target} names={names}
            title={t('actionDialogs.stop.title')}
            checkboxAriaLabel={t('actionDialogs.acknowledge.mayInterruptAria')}
            checkboxLabel={t('actionDialogs.acknowledge.mayInterrupt')}
            confirmAriaLabel={t('actionDialogs.stop.confirmAria')}
            confirmText={t('actionDialogs.stop.confirm')}
        />
    );
};

// Dialog for the "shutdown" action
// `instances`: the shutdown of instances of an object, its resources stopped on their
// nodes, not of nodes, their daemon stopped.
export const ShutdownDialog = ({open, onClose, onConfirm, checkboxes, setCheckboxes, disabled, target, names, instances = false}) => {
    const {t} = useTranslation();
    const scope = instances ? 'shutdown.instance' : 'shutdown';
    return (
        <Dialog
            open={open}
            onClose={onClose}
            title={t('actionDialogs.shutdown.title')}
            footer={
                <DialogFooter
                    onClose={onClose}
                    onConfirm={onConfirm}
                    confirmDisabled={
                        !checkboxes.instancesDown ||
                        !checkboxes.peerTakeover ||
                        disabled
                    }
                    confirmLabel={t('actionDialogs.shutdown.confirmAria')}
                >
                    {t('actionDialogs.shutdown.confirm')}
                </DialogFooter>
            }
        >
            <Subject target={target} names={names}/>
            <Acknowledgements>
                <Checkbox
                    checked={checkboxes.instancesDown}
                    onChange={(e) =>
                        setCheckboxes((prev) => ({...prev, instancesDown: e.target.checked}))
                    }
                    aria-label={t(`actionDialogs.${scope}.instancesDownAria`)}
                    label={t(`actionDialogs.${scope}.instancesDown`)}
                />
                <Checkbox
                    checked={checkboxes.peerTakeover}
                    onChange={(e) =>
                        setCheckboxes((prev) => ({...prev, peerTakeover: e.target.checked}))
                    }
                    aria-label={t(`actionDialogs.${scope}.peerTakeoverAria`)}
                    label={t(`actionDialogs.${scope}.peerTakeover`)}
                />
            </Acknowledgements>
        </Dialog>
    );
};

// Dialog for the "restart" action
export const RestartDialog = ({open, onClose, onConfirm, checked, setChecked, disabled, target, names}) => {
    const {t} = useTranslation();
    return (
        <SingleCheckDialog
            open={open} onClose={onClose} onConfirm={onConfirm}
            checked={checked} setChecked={setChecked} disabled={disabled}
            target={target} names={names}
            title={t('actionDialogs.restart.title')}
            checkboxAriaLabel={t('actionDialogs.acknowledge.mayInterruptAria')}
            checkboxLabel={t('actionDialogs.acknowledge.mayInterrupt')}
            confirmAriaLabel={t('actionDialogs.restart.confirmAria')}
            confirmText={t('actionDialogs.restart.confirm')}
        />
    );
};

// Dialog for the "clear" action
export const ClearDialog = ({open, onClose, onConfirm, checked, setChecked, disabled, target, names}) => {
    const {t} = useTranslation();
    return (
        <SingleCheckDialog
            open={open} onClose={onClose} onConfirm={onConfirm}
            checked={checked} setChecked={setChecked} disabled={disabled}
            target={target} names={names}
            title={t('actionDialogs.clear.title')}
            checkboxAriaLabel={t('actionDialogs.clear.checkboxAria')}
            checkboxLabel={t('actionDialogs.clear.checkbox')}
            confirmAriaLabel={t('actionDialogs.clear.confirmAria')}
            confirmText={t('common.confirm')}
        />
    );
};

// Dialog for the "drain" action
export const DrainDialog = ({open, onClose, onConfirm, checked, setChecked, disabled, target, names}) => {
    const {t} = useTranslation();
    return (
        <SingleCheckDialog
            open={open} onClose={onClose} onConfirm={onConfirm}
            checked={checked} setChecked={setChecked} disabled={disabled}
            target={target} names={names}
            title={t('actionDialogs.drain.title')}
            checkboxAriaLabel={t('actionDialogs.drain.checkboxAria')}
            checkboxLabel={t('actionDialogs.drain.checkbox')}
            confirmAriaLabel={t('actionDialogs.drain.confirmAria')}
            confirmText={t('common.confirm')}
        />
    );
};

// Dialog for the "unprovision" action
// `instances`: the unprovisioning of instances of an object, on their nodes only.
export const UnprovisionDialog = ({open, onClose, onConfirm, checkboxes, setCheckboxes, disabled, pendingAction, target, names, instances = false}) => {
    const {t} = useTranslation();
    const isNodeAction = instances || pendingAction?.node || pendingAction?.batch === 'nodes';

    return (
        <Dialog
            open={open}
            onClose={onClose}
            title={t('actionDialogs.unprovision.title')}
            footer={
                <DialogFooter
                    onClose={onClose}
                    onConfirm={onConfirm}
                    confirmDisabled={
                        !checkboxes.dataLoss ||
                        !checkboxes.serviceInterruption ||
                        (!isNodeAction && !checkboxes.clusterwide) ||
                        disabled
                    }
                    confirmLabel={t('actionDialogs.unprovision.confirmAria')}
                    variant="delete"
                >
                    {t('common.confirm')}
                </DialogFooter>
            }
        >
            <Subject target={target} names={names}/>
            <Acknowledgements>
                <Checkbox
                    checked={checkboxes.dataLoss}
                    onChange={(e) =>
                        setCheckboxes((prev) => ({...prev, dataLoss: e.target.checked}))
                    }
                    aria-label={t('actionDialogs.acknowledge.dataLossAria')}
                    label={t('actionDialogs.acknowledge.dataLoss')}
                />
                {!isNodeAction && (
                    <Checkbox
                        checked={checkboxes.clusterwide}
                        onChange={(e) =>
                            setCheckboxes((prev) => ({...prev, clusterwide: e.target.checked}))
                        }
                        aria-label={t('actionDialogs.acknowledge.clusterwideAria')}
                        label={t('actionDialogs.acknowledge.clusterwide')}
                    />
                )}
                <Checkbox
                    checked={checkboxes.serviceInterruption}
                    onChange={(e) =>
                        setCheckboxes((prev) => ({
                            ...prev,
                            serviceInterruption: e.target.checked,
                        }))
                    }
                    aria-label={t('actionDialogs.acknowledge.serviceInterruptionAria')}
                    label={t('actionDialogs.acknowledge.serviceInterruption')}
                />
            </Acknowledgements>
        </Dialog>
    );
};

// Dialog for the "purge" action
export const PurgeDialog = ({open, onClose, onConfirm, checkboxes, setCheckboxes, disabled, target, names}) => {
    const {t} = useTranslation();
    return (
        <Dialog
            open={open}
            onClose={onClose}
            title={t('actionDialogs.purge.title')}
            footer={
                <DialogFooter
                    onClose={onClose}
                    onConfirm={onConfirm}
                    confirmDisabled={
                        !checkboxes.dataLoss ||
                        !checkboxes.configLoss ||
                        !checkboxes.serviceInterruption ||
                        disabled
                    }
                    confirmLabel={t('actionDialogs.purge.confirmAria')}
                    variant="delete"
                >
                    {t('common.confirm')}
                </DialogFooter>
            }
        >
            <Subject target={target} names={names}/>
            <Acknowledgements>
                <Checkbox
                    checked={checkboxes.dataLoss}
                    onChange={(e) =>
                        setCheckboxes((prev) => ({...prev, dataLoss: e.target.checked}))
                    }
                    aria-label={t('actionDialogs.acknowledge.dataLossAria')}
                    label={t('actionDialogs.acknowledge.dataLoss')}
                />
                <Checkbox
                    checked={checkboxes.configLoss}
                    onChange={(e) =>
                        setCheckboxes((prev) => ({...prev, configLoss: e.target.checked}))
                    }
                    aria-label={t('actionDialogs.acknowledge.configLossAria')}
                    label={t('actionDialogs.acknowledge.configLoss')}
                />
                <Checkbox
                    checked={checkboxes.serviceInterruption}
                    onChange={(e) =>
                        setCheckboxes((prev) => ({
                            ...prev,
                            serviceInterruption: e.target.checked,
                        }))
                    }
                    aria-label={t('actionDialogs.acknowledge.serviceInterruptionAria')}
                    label={t('actionDialogs.acknowledge.serviceInterruption')}
                />
            </Acknowledgements>
        </Dialog>
    );
};

// Dialog for the "delete" action
// `instances`: the delete of instances of an object, their configuration only, on their
// nodes: not orchestrated on the cluster, and the object kept.
export const DeleteDialog = ({open, onClose, onConfirm, checkboxes, setCheckboxes, disabled, target, names, instances = false}) => {
    const {t} = useTranslation();
    return (
        <Dialog
            open={open}
            onClose={onClose}
            title={t('actionDialogs.delete.title')}
            footer={
                <DialogFooter
                    onClose={onClose}
                    onConfirm={onConfirm}
                    confirmDisabled={!checkboxes.configLoss || !checkboxes.clusterwide || disabled}
                    confirmLabel={t('actionDialogs.delete.confirmAria')}
                    variant="delete"
                >
                    {t('common.delete')}
                </DialogFooter>
            }
        >
            <Subject target={target} names={names}/>
            <Acknowledgements>
                <Checkbox
                    checked={checkboxes.configLoss}
                    onChange={(e) =>
                        setCheckboxes((prev) => ({...prev, configLoss: e.target.checked}))
                    }
                    aria-label={t(instances ? 'actionDialogs.delete.instance.configLossAria' : 'actionDialogs.acknowledge.configLossAria')}
                    label={t(instances ? 'actionDialogs.delete.instance.configLoss' : 'actionDialogs.acknowledge.configLoss')}
                />
                <Checkbox
                    checked={checkboxes.clusterwide}
                    onChange={(e) =>
                        setCheckboxes((prev) => ({...prev, clusterwide: e.target.checked}))
                    }
                    aria-label={t(instances ? 'actionDialogs.delete.instance.localOnlyAria' : 'actionDialogs.acknowledge.clusterwideAria')}
                    label={t(instances ? 'actionDialogs.delete.instance.localOnly' : 'actionDialogs.acknowledge.clusterwide')}
                />
            </Acknowledgements>
        </Dialog>
    );
};

// Dialog for the "switch" action
export const SwitchDialog = ({open, onClose, onConfirm, checked, setChecked, disabled, target, names}) => {
    const {t} = useTranslation();
    return (
        <SingleCheckDialog
            open={open} onClose={onClose} onConfirm={onConfirm}
            checked={checked} setChecked={setChecked} disabled={disabled}
            target={target} names={names}
            cancelDisabled={disabled}
            title={t('actionDialogs.switch.title')}
            checkboxAriaLabel={t('actionDialogs.acknowledge.unavailableDuringMoveAria')}
            checkboxLabel={t('actionDialogs.acknowledge.unavailableDuringMove')}
            confirmAriaLabel={t('actionDialogs.switch.confirmAria')}
            confirmText={t('common.confirm')}
        />
    );
};

// Dialog for the "giveback" action
export const GivebackDialog = ({open, onClose, onConfirm, checked, setChecked, disabled, target, names}) => {
    const {t} = useTranslation();
    return (
        <SingleCheckDialog
            open={open} onClose={onClose} onConfirm={onConfirm}
            checked={checked} setChecked={setChecked} disabled={disabled}
            target={target} names={names}
            title={t('actionDialogs.giveback.title')}
            checkboxAriaLabel={t('actionDialogs.acknowledge.unavailableDuringMoveAria')}
            checkboxLabel={t('actionDialogs.acknowledge.unavailableDuringMove')}
            confirmAriaLabel={t('actionDialogs.giveback.confirmAria')}
            confirmText={t('common.confirm')}
        />
    );
};

// Dialog for the "delete key" action
export const DeleteKeyDialog = ({
                                    open,
                                    onClose,
                                    onConfirm,
                                    keyToDelete,
                                    disabled,
                                }) => {
    const {t} = useTranslation();
    return (
        <Dialog
            open={open}
            onClose={onClose}
            title={t('actionDialogs.deleteKey.title')}
            footer={
                <DialogFooter
                    onClose={onClose}
                    onConfirm={onConfirm}
                    confirmDisabled={disabled}
                    confirmLabel={t('actionDialogs.deleteKey.confirmAria')}
                    variant="delete"
                >
                    {t('common.delete')}
                </DialogFooter>
            }
        >
            <p className="text-ink">
                <Trans
                    i18nKey="actionDialogs.deleteKey.message"
                    values={{key: keyToDelete}}
                    components={{strong: <strong/>}}
                />
            </p>
        </Dialog>
    );
};

// Dialog for the "create key" action
export const CreateKeyDialog = ({
                                    open,
                                    onClose,
                                    onConfirm,
                                    newKeyName,
                                    setNewKeyName,
                                    newKeyFile,
                                    setNewKeyFile,
                                    disabled,
                                }) => {
    const {t} = useTranslation();
    return (
        <Dialog
            open={open}
            onClose={onClose}
            title={t('actionDialogs.createKey.title')}
            footer={
                <DialogFooter
                    variant="create"
                    onClose={onClose}
                    onConfirm={onConfirm}
                    confirmDisabled={disabled || !newKeyName || !newKeyFile}
                    confirmLabel={t('actionDialogs.createKey.confirmAria')}
                >
                    {t('actionDialogs.createKey.confirm')}
                </DialogFooter>
            }
        >
            <Field label={t('actionDialogs.createKey.keyName')}>
                {(control) => (
                    <Input
                        {...control}
                        autoFocus
                        value={newKeyName}
                        onChange={(e) => setNewKeyName(e.target.value)}
                        disabled={disabled}
                        aria-label={t('actionDialogs.createKey.keyNameAria')}
                    />
                )}
            </Field>
            <FilePicker
                id="create-key-file-upload"
                onChange={(e) => setNewKeyFile(e.target.files[0])}
                disabled={disabled}
                file={newKeyFile}
                emptyText={t('actionDialogs.noFileSelected')}
            />
        </Dialog>
    );
};


// Dialog for the "update config" action
export const UpdateConfigDialog = ({
                                       open,
                                       onClose,
                                       onConfirm,
                                       newConfigFile,
                                       setNewConfigFile,
                                       disabled,
                                   }) => {
    const {t} = useTranslation();
    return (
        <Dialog
            open={open}
            onClose={onClose}
            title={t('actionDialogs.updateConfig.title')}
            footer={
                <DialogFooter
                    onClose={onClose}
                    onConfirm={onConfirm}
                    confirmDisabled={disabled || !newConfigFile}
                    confirmLabel={t('actionDialogs.updateConfig.confirmAria')}
                >
                    {t('actionDialogs.updateConfig.confirm')}
                </DialogFooter>
            }
        >
            <FilePicker
                id="update-config-file-upload"
                onChange={(e) => setNewConfigFile(e.target.files[0])}
                disabled={disabled}
                file={newConfigFile}
                emptyText={t('actionDialogs.noFileChosen')}
            />
        </Dialog>
    );
};

// Dialog for the "manage config parameters" action
export const ManageConfigParamsDialog = ({
                                             open,
                                             onClose,
                                             onConfirm,
                                             paramsToSet,
                                             setParamsToSet,
                                             paramsToUnset,
                                             setParamsToUnset,
                                             paramsToDelete,
                                             setParamsToDelete,
                                             disabled,
                                         }) => {
    const {t} = useTranslation();
    return (
        <Dialog
            open={open}
            onClose={onClose}
            title={t('actionDialogs.manageParams.title')}
            size="md"
            footer={
                <DialogFooter
                    onClose={onClose}
                    onConfirm={onConfirm}
                    confirmDisabled={disabled || (!paramsToSet && !paramsToUnset && !paramsToDelete)}
                    confirmLabel={t('actionDialogs.manageParams.confirmAria')}
                >
                    {t('actionDialogs.manageParams.confirm')}
                </DialogFooter>
            }
        >
            <Field label={t('actionDialogs.manageParams.set')} hint={t('actionDialogs.manageParams.setHint')}>
                {(control) => (
                    <Textarea
                        {...control}
                        autoFocus
                        rows={4}
                        value={paramsToSet}
                        onChange={(e) => setParamsToSet(e.target.value)}
                        disabled={disabled}
                        placeholder={"section.param1=value1\nsection.param2=value2"}
                        aria-label={t('actionDialogs.manageParams.setAria')}
                    />
                )}
            </Field>
            <Field label={t('actionDialogs.manageParams.unset')} hint={t('actionDialogs.manageParams.unsetHint')}>
                {(control) => (
                    <Textarea
                        {...control}
                        rows={4}
                        value={paramsToUnset}
                        onChange={(e) => setParamsToUnset(e.target.value)}
                        disabled={disabled}
                        placeholder={"section.param1\nsection.param2"}
                        aria-label={t('actionDialogs.manageParams.unsetAria')}
                    />
                )}
            </Field>
            <Field label={t('actionDialogs.manageParams.deleteSections')} hint={t('actionDialogs.manageParams.deleteSectionsHint')}>
                {(control) => (
                    <Textarea
                        {...control}
                        rows={4}
                        value={paramsToDelete}
                        onChange={(e) => setParamsToDelete(e.target.value)}
                        disabled={disabled}
                        placeholder={"section1\nsection2"}
                        aria-label={t('actionDialogs.manageParams.deleteSectionsAria')}
                    />
                )}
            </Field>
        </Dialog>
    );
};

// Simple dialog for other actions
export const SimpleConfirmDialog = ({open, onClose, onConfirm, action, target}) => {
    const {t} = useTranslation();
    // The action name stays as is in English, French shows its translated label.
    const values = {action, label: typeof action === 'string' ? labelOf(t, action) : action, target};
    return (
        <Dialog
            open={open}
            onClose={onClose}
            title={t('actionDialogs.simpleConfirm.title', values)}
            footer={
                <DialogFooter
                    onClose={onClose}
                    onConfirm={onConfirm}
                    confirmLabel={t('actionDialogs.simpleConfirm.confirmAria', values)}
                >
                    {t('common.confirm')}
                </DialogFooter>
            }
        >
            <p className="text-ink">
                <Trans
                    i18nKey="actionDialogs.simpleConfirm.message"
                    values={values}
                    components={{strong: <strong/>}}
                />
            </p>
        </Dialog>
    );
};
