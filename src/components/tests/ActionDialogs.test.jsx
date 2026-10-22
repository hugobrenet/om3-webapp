import React from 'react';
import i18n from '../../i18n';
import {render, screen, fireEvent, within} from '@testing-library/react';
import {
    FreezeDialog, StopDialog, RestartDialog, ClearDialog, DrainDialog,
    UnprovisionDialog, PurgeDialog, DeleteDialog, SwitchDialog, GivebackDialog,
    DeleteKeyDialog, CreateKeyDialog, UpdateConfigDialog,
    ManageConfigParamsDialog, SimpleConfirmDialog, ShutdownDialog,
} from '../ActionDialogs';

describe('ActionDialogs', () => {
    const onClose = jest.fn();
    const onConfirm = jest.fn();
    const defaultSetState = jest.fn();

    afterEach(() => jest.clearAllMocks());

    // Helper to test dialogs with a single checkbox and a confirm button
    function testCheckboxDialog(DialogComponent, dialogTitleText, confirmLabel = 'Confirm', {
        checkboxName, checkboxText, confirmName, confirmText = confirmLabel, danger = false,
    } = {}) {
        test(`${dialogTitleText} renders a dialog with its checkbox and buttons`, () => {
            render(
                <DialogComponent open onClose={onClose} onConfirm={onConfirm}
                                 checked={false} setChecked={defaultSetState} disabled={false}/>
            );
            const dialog = screen.getByRole('dialog', {name: dialogTitleText});
            const checkbox = within(dialog).getByRole('checkbox', {name: checkboxName});
            expect(checkbox).not.toBeChecked();
            expect(within(dialog).getByLabelText(checkboxText)).toBe(checkbox);
            const confirmBtn = within(dialog).getByRole('button', {name: confirmName});
            expect(confirmBtn).toHaveTextContent(confirmText);
            // None of them deletes: outlined, stop and restart too.
            expect(confirmBtn).toHaveClass('border', 'border-line');
            expect(confirmBtn).not.toHaveClass('bg-state-down', 'bg-accent');
            expect(within(dialog).getByRole('button', {name: 'Cancel'})).toBeEnabled();
        });

        test(`${dialogTitleText} is not rendered when closed`, () => {
            render(
                <DialogComponent open={false} onClose={onClose} onConfirm={onConfirm}
                                 checked={false} setChecked={defaultSetState} disabled={false}/>
            );
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        });

        test(`${dialogTitleText} calls onClose on Escape`, () => {
            render(
                <DialogComponent open onClose={onClose} onConfirm={onConfirm}
                                 checked={false} setChecked={defaultSetState} disabled={false}/>
            );
            fireEvent.keyDown(screen.getByRole('dialog'), {key: 'Escape'});
            expect(onClose).toHaveBeenCalledTimes(1);
            expect(onConfirm).not.toHaveBeenCalled();
        });

        test(`${dialogTitleText} enables confirm when checked`, () => {
            let checked = false;
            const setChecked = jest.fn(val => checked = val);
            const {rerender} = render(
                <DialogComponent open onClose={onClose} onConfirm={onConfirm}
                                 checked={checked} setChecked={setChecked} disabled={false}/>
            );

            const buttonName = confirmLabel === 'Confirm' ? /Confirm/i : new RegExp(`Confirm ${confirmLabel.toLowerCase()}`, 'i');
            const confirmBtn = screen.getByRole('button', {name: buttonName});
            expect(confirmBtn).toBeDisabled();

            // Check the box
            fireEvent.click(screen.getByRole('checkbox'));
            expect(setChecked).toHaveBeenCalledWith(true);

            // Simulate parent updating checked prop
            rerender(
                <DialogComponent open onClose={onClose} onConfirm={onConfirm}
                                 checked={true} setChecked={setChecked} disabled={false}/>
            );
            expect(confirmBtn).not.toBeDisabled();

            fireEvent.click(confirmBtn);
            expect(onConfirm).toHaveBeenCalled();
        });

        test(`${dialogTitleText} calls onClose when cancel button is clicked`, () => {
            render(
                <DialogComponent open onClose={onClose} onConfirm={onConfirm}
                                 checked={true} setChecked={defaultSetState} disabled={false}/>
            );
            const cancelBtn = screen.getByRole('button', {name: /Cancel/i});
            fireEvent.click(cancelBtn);
            expect(onClose).toHaveBeenCalled();
        });

        test(`${dialogTitleText} confirm button is disabled when disabled prop is true`, () => {
            render(
                <DialogComponent open onClose={onClose} onConfirm={onConfirm}
                                 checked={true} setChecked={defaultSetState} disabled={true}/>
            );
            const buttonName = confirmLabel === 'Confirm' ? /Confirm/i : new RegExp(`Confirm ${confirmLabel.toLowerCase()}`, 'i');
            const confirmBtn = screen.getByRole('button', {name: buttonName});
            expect(confirmBtn).toBeDisabled();
        });
    }

    // Tests for simple checkbox dialogs
    testCheckboxDialog(FreezeDialog, 'Confirm Freeze', 'Confirm', {
        checkboxName: 'Confirm failover pause',
        checkboxText: 'I understand that the selected service orchestration will be paused.',
        confirmName: 'Confirm freeze action',
    });
    testCheckboxDialog(StopDialog, 'Confirm Stop', 'Stop', {
        checkboxName: 'Confirm service interruption',
        checkboxText: 'I understand that this may interrupt services.',
        confirmName: 'Confirm stop action',
        danger: true,
    });
    testCheckboxDialog(RestartDialog, 'Confirm Restart', 'Restart', {
        checkboxName: 'Confirm service interruption',
        checkboxText: 'I understand that this may interrupt services.',
        confirmName: 'Confirm restart action',
        danger: true,
    });
    testCheckboxDialog(ClearDialog, 'Confirm Clear', 'Confirm', {
        checkboxName: 'Confirm clear action',
        checkboxText: 'I understand that this will clear node status and logs.',
        confirmName: 'Confirm clear action',
    });
    testCheckboxDialog(DrainDialog, 'Confirm Drain', 'Confirm', {
        checkboxName: 'Confirm service migration',
        checkboxText: 'I understand that this will migrate services away from the selected nodes.',
        confirmName: 'Confirm drain action',
    });
    testCheckboxDialog(SwitchDialog, 'Confirm Switch', 'Confirm', {
        checkboxName: 'Confirm service unavailability',
        checkboxText: 'I understand the selected services will be unavailable during move.',
        confirmName: 'Confirm switch action',
    });
    testCheckboxDialog(GivebackDialog, 'Confirm Giveback', 'Confirm', {
        checkboxName: 'Confirm service unavailability',
        checkboxText: 'I understand the selected services will be unavailable during move.',
        confirmName: 'Confirm giveback action',
    });

    test('SwitchDialog disables Cancel while disabled, the other dialogs do not', () => {
        const {unmount} = render(
            <SwitchDialog open onClose={onClose} onConfirm={onConfirm}
                          checked={true} setChecked={defaultSetState} disabled={true}/>
        );
        expect(screen.getByRole('button', {name: 'Cancel'})).toBeDisabled();
        unmount();
        render(
            <GivebackDialog open onClose={onClose} onConfirm={onConfirm}
                            checked={true} setChecked={defaultSetState} disabled={true}/>
        );
        expect(screen.getByRole('button', {name: 'Cancel'})).toBeEnabled();
    });

    // ----- UnprovisionDialog specific tests (including isNodeAction branch) -----
    describe('ShutdownDialog', () => {
        const render2 = (checkboxes, setCb, disabled = false) => (
            <ShutdownDialog open onClose={onClose} onConfirm={onConfirm}
                            checkboxes={checkboxes} setCheckboxes={setCb} disabled={disabled}/>
        );

        afterEach(() => jest.clearAllMocks());

        test('asks to acknowledge the instances shutdown and the peer takeover before it confirms', () => {
            let checkboxes = {instancesDown: false, peerTakeover: false};
            const setCb = jest.fn(updater => {
                checkboxes = updater(checkboxes);
            });
            const {rerender} = render(render2(checkboxes, setCb));

            const dialog = screen.getByRole('dialog', {name: 'Confirm Shutdown'});
            expect(within(dialog).getAllByRole('checkbox').map((c) => c.getAttribute('aria-label'))).toEqual([
                'Confirm instances shutdown', 'Confirm peer takeover',
            ]);
            const confirmBtn = screen.getByRole('button', {name: 'Confirm shutdown action'});
            expect(confirmBtn).toBeDisabled();
            // A shutdown deletes nothing: outlined.
            expect(confirmBtn).toHaveClass('border', 'border-line');

            fireEvent.click(screen.getByLabelText(/all svc and vol instances on this node will be shut down/i));
            expect(checkboxes).toEqual({instancesDown: true, peerTakeover: false});
            rerender(render2(checkboxes, setCb));
            expect(confirmBtn).toBeDisabled();

            fireEvent.click(screen.getByLabelText(/peer nodes are not notified of a maintenance period/i));
            expect(checkboxes).toEqual({instancesDown: true, peerTakeover: true});
            rerender(render2(checkboxes, setCb));
            expect(confirmBtn).not.toBeDisabled();
            fireEvent.click(confirmBtn);
            expect(onConfirm).toHaveBeenCalledTimes(1);
        });

        test('stays disabled while an action runs, and cancels', () => {
            render(render2({instancesDown: true, peerTakeover: true}, jest.fn(), true));
            expect(screen.getByRole('button', {name: 'Confirm shutdown action'})).toBeDisabled();
            fireEvent.click(screen.getByRole('button', {name: /^Cancel$/i}));
            expect(onClose).toHaveBeenCalled();
        });
    });

    describe('UnprovisionDialog', () => {
        const baseCheckboxes = {dataLoss: false, clusterwide: false, serviceInterruption: false};
        const setCheckboxes = jest.fn();

        afterEach(() => jest.clearAllMocks());

        test('requires all three checkboxes when not a node action (clusterwide appears)', () => {
            let checkboxes = {...baseCheckboxes};
            const setCb = jest.fn(updater => {
                checkboxes = updater(checkboxes);
            });
            const {rerender} = render(
                <UnprovisionDialog open pendingAction={{}} onClose={onClose} onConfirm={onConfirm}
                                   checkboxes={checkboxes} setCheckboxes={setCb} disabled={false}/>
            );

            const dialog = screen.getByRole('dialog', {name: 'Confirm Unprovision'});
            expect(within(dialog).getAllByRole('checkbox').map((c) => c.getAttribute('aria-label'))).toEqual([
                'Confirm data loss', 'Confirm clusterwide orchestration', 'Confirm service interruption',
            ]);
            const confirmBtn = screen.getByRole('button', {name: /Confirm unprovision action/i});
            expect(confirmBtn).toBeDisabled();
            expect(confirmBtn).toHaveClass('bg-state-down');

            // Check each checkbox individually
            fireEvent.click(screen.getByLabelText(/I understand data will be lost/i));
            fireEvent.click(screen.getByLabelText(/I understand the selected services may be temporarily interrupted/i));
            fireEvent.click(screen.getByLabelText(/I understand this action will be orchestrated clusterwide/i));
            expect(checkboxes).toEqual({dataLoss: true, clusterwide: true, serviceInterruption: true});

            // Simulate state updates
            rerender(
                <UnprovisionDialog open pendingAction={{}} onClose={onClose} onConfirm={onConfirm}
                                   checkboxes={{dataLoss: true, clusterwide: true, serviceInterruption: true}}
                                   setCheckboxes={setCb} disabled={false}/>
            );
            expect(confirmBtn).not.toBeDisabled();
            fireEvent.click(confirmBtn);
            expect(onConfirm).toHaveBeenCalled();
        });

        test('requires only dataLoss and serviceInterruption when isNodeAction is true (no clusterwide checkbox)', () => {
            let checkboxes = {dataLoss: false, clusterwide: false, serviceInterruption: false};
            const setCb = jest.fn(updater => {
                checkboxes = updater(checkboxes);
            });
            const pendingAction = {node: 'some-node'}; // makes isNodeAction true

            const {rerender} = render(
                <UnprovisionDialog open pendingAction={pendingAction} onClose={onClose} onConfirm={onConfirm}
                                   checkboxes={checkboxes} setCheckboxes={setCb} disabled={false}/>
            );

            // Clusterwide checkbox should NOT be present
            expect(screen.queryByLabelText(/I understand this action will be orchestrated clusterwide/i)).not.toBeInTheDocument();

            const confirmBtn = screen.getByRole('button', {name: /Confirm unprovision action/i});
            expect(confirmBtn).toBeDisabled();

            // Check only dataLoss and serviceInterruption
            fireEvent.click(screen.getByLabelText(/I understand data will be lost/i));
            fireEvent.click(screen.getByLabelText(/I understand the selected services may be temporarily interrupted/i));
            expect(checkboxes).toEqual({dataLoss: true, clusterwide: false, serviceInterruption: true});

            rerender(
                <UnprovisionDialog open pendingAction={pendingAction} onClose={onClose} onConfirm={onConfirm}
                                   checkboxes={{dataLoss: true, clusterwide: false, serviceInterruption: true}}
                                   setCheckboxes={setCb} disabled={false}/>
            );
            expect(confirmBtn).not.toBeDisabled();
            fireEvent.click(confirmBtn);
            expect(onConfirm).toHaveBeenCalled();
        });

        test('hides the clusterwide checkbox for a batch node action', () => {
            render(
                <UnprovisionDialog open pendingAction={{batch: 'nodes'}} onClose={onClose} onConfirm={onConfirm}
                                   checkboxes={{dataLoss: true, clusterwide: false, serviceInterruption: true}}
                                   setCheckboxes={setCheckboxes} disabled={false}/>
            );
            expect(screen.queryByRole('checkbox', {name: 'Confirm clusterwide orchestration'})).not.toBeInTheDocument();
            expect(screen.getByRole('button', {name: 'Confirm unprovision action'})).toBeEnabled();
        });

        test('calls onClose when cancel is clicked', () => {
            render(
                <UnprovisionDialog open pendingAction={{}} onClose={onClose} onConfirm={onConfirm}
                                   checkboxes={baseCheckboxes} setCheckboxes={setCheckboxes} disabled={false}/>
            );
            fireEvent.click(screen.getByRole('button', {name: /Cancel/i}));
            expect(onClose).toHaveBeenCalled();
        });

        test('confirm button disabled when disabled prop is true', () => {
            render(
                <UnprovisionDialog open pendingAction={{}} onClose={onClose} onConfirm={onConfirm}
                                   checkboxes={{dataLoss: true, clusterwide: true, serviceInterruption: true}}
                                   setCheckboxes={setCheckboxes} disabled={true}/>
            );
            const confirmBtn = screen.getByRole('button', {name: /Confirm unprovision action/i});
            expect(confirmBtn).toBeDisabled();
        });
    });

    // ----- PurgeDialog -----
    describe('PurgeDialog', () => {
        const baseCheckboxes = {dataLoss: false, configLoss: false, serviceInterruption: false};
        const setCheckboxes = jest.fn();

        test('requires all three checkboxes', () => {
            let checkboxes = {...baseCheckboxes};
            const setCb = jest.fn(updater => {
                checkboxes = updater(checkboxes);
            });
            const {rerender} = render(
                <PurgeDialog open onClose={onClose} onConfirm={onConfirm}
                             checkboxes={checkboxes} setCheckboxes={setCb} disabled={false}/>
            );
            expect(screen.getByRole('dialog', {name: 'Confirm Purge'})).toBeInTheDocument();
            expect(screen.getAllByRole('checkbox').map((c) => c.getAttribute('aria-label'))).toEqual([
                'Confirm data loss', 'Confirm configuration loss', 'Confirm service interruption',
            ]);
            const confirmBtn = screen.getByRole('button', {name: /Confirm purge action/i});
            expect(confirmBtn).toBeDisabled();
            expect(confirmBtn).toHaveClass('bg-state-down');

            fireEvent.click(screen.getByLabelText(/I understand data will be lost/i));
            fireEvent.click(screen.getByLabelText(/I understand the configuration will be lost/i));
            fireEvent.click(screen.getByLabelText(/I understand the selected services may be temporarily interrupted/i));
            expect(checkboxes).toEqual({dataLoss: true, configLoss: true, serviceInterruption: true});

            rerender(
                <PurgeDialog open onClose={onClose} onConfirm={onConfirm}
                             checkboxes={{dataLoss: true, configLoss: true, serviceInterruption: true}}
                             setCheckboxes={setCb} disabled={false}/>
            );
            expect(confirmBtn).not.toBeDisabled();
            fireEvent.click(confirmBtn);
            expect(onConfirm).toHaveBeenCalled();
        });

        test('confirm button disabled when disabled prop is true', () => {
            render(
                <PurgeDialog open onClose={onClose} onConfirm={onConfirm}
                             checkboxes={{dataLoss: true, configLoss: true, serviceInterruption: true}}
                             setCheckboxes={setCheckboxes} disabled={true}/>
            );
            expect(screen.getByRole('button', {name: /Confirm purge action/i})).toBeDisabled();
        });

        test('calls onClose on cancel', () => {
            render(
                <PurgeDialog open onClose={onClose} onConfirm={onConfirm}
                             checkboxes={baseCheckboxes} setCheckboxes={setCheckboxes} disabled={false}/>
            );
            fireEvent.click(screen.getByRole('button', {name: /Cancel/i}));
            expect(onClose).toHaveBeenCalled();
        });
    });

    // ----- DeleteDialog -----
    describe('DeleteDialog', () => {
        const baseCheckboxes = {configLoss: false, clusterwide: false};
        const setCheckboxes = jest.fn();

        test('requires both checkboxes', () => {
            let checkboxes = {...baseCheckboxes};
            const setCb = jest.fn(updater => {
                checkboxes = updater(checkboxes);
            });
            const {rerender} = render(
                <DeleteDialog open onClose={onClose} onConfirm={onConfirm}
                              checkboxes={checkboxes} setCheckboxes={setCb} disabled={false}/>
            );
            expect(screen.getByRole('dialog', {name: 'Confirm Delete'})).toBeInTheDocument();
            const confirmBtn = screen.getByRole('button', {name: /Confirm delete action/i});
            expect(confirmBtn).toBeDisabled();
            expect(confirmBtn).toHaveTextContent('Delete');
            expect(confirmBtn).toHaveClass('bg-state-down');

            fireEvent.click(screen.getByLabelText(/I understand the configuration will be lost/i));
            fireEvent.click(screen.getByLabelText(/I understand this action will be orchestrated clusterwide/i));
            expect(checkboxes).toEqual({configLoss: true, clusterwide: true});

            rerender(
                <DeleteDialog open onClose={onClose} onConfirm={onConfirm}
                              checkboxes={{configLoss: true, clusterwide: true}}
                              setCheckboxes={setCb} disabled={false}/>
            );
            expect(confirmBtn).not.toBeDisabled();
            fireEvent.click(confirmBtn);
            expect(onConfirm).toHaveBeenCalled();
        });

        test('calls onClose on cancel', () => {
            render(
                <DeleteDialog open onClose={onClose} onConfirm={onConfirm}
                              checkboxes={baseCheckboxes} setCheckboxes={setCheckboxes} disabled={false}/>
            );
            fireEvent.click(screen.getByRole('button', {name: /Cancel/i}));
            expect(onClose).toHaveBeenCalled();
        });
    });

    // ----- DeleteKeyDialog -----
    describe('DeleteKeyDialog', () => {
        test('shows key and calls onConfirm on delete, onClose on cancel', () => {
            render(<DeleteKeyDialog open onClose={onClose} onConfirm={onConfirm}
                                    keyToDelete="MY_SECRET_KEY" disabled={false}/>);
            expect(screen.getByRole('dialog', {name: 'Confirm Key Deletion'})).toBeInTheDocument();
            expect(screen.getByText(/MY_SECRET_KEY/)).toBeInTheDocument();
            expect(screen.getByRole('button', {name: 'Confirm delete key action'})).toHaveClass('bg-state-down');

            const deleteBtn = screen.getByRole('button', {name: /Delete/i});
            fireEvent.click(deleteBtn);
            expect(onConfirm).toHaveBeenCalled();

            const cancelBtn = screen.getByRole('button', {name: /Cancel/i});
            fireEvent.click(cancelBtn);
            expect(onClose).toHaveBeenCalled();
        });

        test('delete button is disabled when disabled prop is true', () => {
            render(<DeleteKeyDialog open onClose={onClose} onConfirm={onConfirm}
                                    keyToDelete="KEY" disabled={true}/>);
            expect(screen.getByRole('button', {name: /Delete/i})).toBeDisabled();
        });
    });

    // ----- CreateKeyDialog -----
    describe('CreateKeyDialog', () => {
        const defaultProps = {
            open: true,
            onClose,
            onConfirm,
            newKeyName: '',
            setNewKeyName: jest.fn(),
            newKeyFile: null,
            setNewKeyFile: jest.fn(),
            disabled: false,
        };

        test('requires key name and file to enable Create button', () => {
            let props = {...defaultProps};
            const {rerender} = render(<CreateKeyDialog {...props} />);
            expect(screen.getByRole('dialog', {name: 'Create New Key'})).toBeInTheDocument();
            expect(screen.getByText('No file selected')).toBeInTheDocument();
            const nameInput = screen.getByRole('textbox', {name: /Key Name/i});
            expect(screen.getByLabelText('Key Name')).toBe(nameInput);
            const createBtn = screen.getByRole('button', {name: /Create/i});
            expect(createBtn).toBeDisabled();

            // Fill name only
            fireEvent.change(nameInput, {target: {value: 'mykey'}});
            expect(props.setNewKeyName).toHaveBeenCalledWith('mykey');
            // Create still disabled without file
            rerender(<CreateKeyDialog {...props} newKeyName="mykey"/>);
            expect(createBtn).toBeDisabled();

            // Simulate file selection
            const file = new File(['file content'], 'key.pem', {type: 'text/plain'});
            const fileInput = document.getElementById('create-key-file-upload');
            // Since input is hidden, we need to get it by id
            fireEvent.change(fileInput, {target: {files: [file]}});
            expect(props.setNewKeyFile).toHaveBeenCalledWith(file);

            rerender(<CreateKeyDialog {...props} newKeyName="mykey" newKeyFile={file}/>);
            expect(createBtn).not.toBeDisabled();
            expect(screen.getByText('key.pem')).toBeInTheDocument();

            fireEvent.click(createBtn);
            expect(onConfirm).toHaveBeenCalled();
        });

        test('Choose File opens the hidden file input', () => {
            render(<CreateKeyDialog {...defaultProps} />);
            const fileInput = document.getElementById('create-key-file-upload');
            const click = jest.spyOn(fileInput, 'click');
            fireEvent.click(screen.getByRole('button', {name: 'Choose File'}));
            expect(click).toHaveBeenCalled();
        });

        test('name input and Choose File are disabled when disabled prop is true', () => {
            render(<CreateKeyDialog {...defaultProps} disabled={true}/>);
            expect(screen.getByRole('textbox', {name: /Key Name/i})).toBeDisabled();
            expect(screen.getByRole('button', {name: 'Choose File'})).toBeDisabled();
            expect(document.getElementById('create-key-file-upload')).toBeDisabled();
        });

        test('calls onClose when cancel is clicked', () => {
            render(<CreateKeyDialog {...defaultProps} />);
            fireEvent.click(screen.getByRole('button', {name: /Cancel/i}));
            expect(onClose).toHaveBeenCalled();
        });

        test('Create button is disabled when disabled prop is true', () => {
            render(<CreateKeyDialog {...defaultProps} disabled={true} newKeyName="key" newKeyFile={{}}/>);
            expect(screen.getByRole('button', {name: /Create/i})).toBeDisabled();
        });
    });

    // ----- UpdateConfigDialog -----
    describe('UpdateConfigDialog', () => {
        const defaultProps = {
            open: true,
            onClose,
            onConfirm,
            newConfigFile: null,
            setNewConfigFile: jest.fn(),
            disabled: false,
        };

        test('enables Update button only when a file is selected', () => {
            let props = {...defaultProps};
            const {rerender} = render(<UpdateConfigDialog {...props} />);
            expect(screen.getByRole('dialog', {name: 'Update Configuration'})).toBeInTheDocument();
            expect(screen.getByText('No file chosen')).toBeInTheDocument();
            const updateBtn = screen.getByRole('button', {name: /Update/i});
            expect(updateBtn).toBeDisabled();

            // Simulate file selection
            const file = new File(['config'], 'config.yaml', {type: 'text/yaml'});
            const fileInput = document.getElementById('update-config-file-upload');
            fireEvent.change(fileInput, {target: {files: [file]}});
            expect(props.setNewConfigFile).toHaveBeenCalledWith(file);

            rerender(<UpdateConfigDialog {...props} newConfigFile={file}/>);
            expect(updateBtn).not.toBeDisabled();
            expect(screen.getByText('config.yaml')).toBeInTheDocument();

            fireEvent.click(updateBtn);
            expect(onConfirm).toHaveBeenCalled();
        });

        test('Choose File opens the hidden file input', () => {
            render(<UpdateConfigDialog {...defaultProps} />);
            const fileInput = document.getElementById('update-config-file-upload');
            const click = jest.spyOn(fileInput, 'click');
            fireEvent.click(screen.getByRole('button', {name: 'Choose File'}));
            expect(click).toHaveBeenCalled();
        });

        test('calls onClose on cancel', () => {
            render(<UpdateConfigDialog {...defaultProps} />);
            fireEvent.click(screen.getByRole('button', {name: /Cancel/i}));
            expect(onClose).toHaveBeenCalled();
        });

        test('Update button disabled when disabled prop is true', () => {
            render(<UpdateConfigDialog {...defaultProps} disabled={true} newConfigFile={{name: 'cfg'}}/>);
            expect(screen.getByRole('button', {name: /Update/i})).toBeDisabled();
        });
    });

    // ----- ManageConfigParamsDialog -----
    describe('ManageConfigParamsDialog', () => {
        const defaultProps = {
            open: true,
            onClose,
            onConfirm,
            paramsToSet: '',
            setParamsToSet: jest.fn(),
            paramsToUnset: '',
            setParamsToUnset: jest.fn(),
            paramsToDelete: '',
            setParamsToDelete: jest.fn(),
            disabled: false,
        };

        test('enables Apply button when any of the three fields has content', () => {
            let props = {...defaultProps};
            const {rerender} = render(<ManageConfigParamsDialog {...props} />);
            expect(screen.getByRole('dialog', {name: 'Manage Configuration Parameters'})).toBeInTheDocument();
            const applyBtn = screen.getByRole('button', {name: /Apply/i});
            expect(applyBtn).toBeDisabled();

            // Only paramsToSet
            rerender(<ManageConfigParamsDialog {...props} paramsToSet="a=b"/>);
            expect(applyBtn).not.toBeDisabled();

            // Reset
            rerender(<ManageConfigParamsDialog {...props} paramsToSet="" paramsToUnset="section.key"/>);
            expect(applyBtn).not.toBeDisabled();

            rerender(<ManageConfigParamsDialog {...props} paramsToSet="" paramsToUnset="" paramsToDelete="section"/>);
            expect(applyBtn).not.toBeDisabled();

            fireEvent.click(applyBtn);
            expect(onConfirm).toHaveBeenCalled();
        });

        test('calls onClose on cancel', () => {
            render(<ManageConfigParamsDialog {...defaultProps} />);
            fireEvent.click(screen.getByRole('button', {name: /Cancel/i}));
            expect(onClose).toHaveBeenCalled();
        });

        test('Apply button disabled when disabled prop is true', () => {
            render(<ManageConfigParamsDialog {...defaultProps} disabled={true} paramsToSet="a=b"/>);
            expect(screen.getByRole('button', {name: /Apply/i})).toBeDisabled();
        });

        test('textarea fields handle multiline input', () => {
            const setParamsToSet = jest.fn();
            render(
                <ManageConfigParamsDialog
                    {...defaultProps}
                    paramsToSet=""
                    setParamsToSet={setParamsToSet}
                />
            );
            const textarea = screen.getByRole('textbox', {name: /Parameters to set/i});
            fireEvent.change(textarea, {target: {value: 'key1=val1\nkey2=val2'}});
            expect(setParamsToSet).toHaveBeenCalledWith('key1=val1\nkey2=val2');
        });

        test('unset and delete fields call their setters', () => {
            render(<ManageConfigParamsDialog {...defaultProps} />);
            fireEvent.change(screen.getByRole('textbox', {name: 'Parameters to unset input'}), {target: {value: 's.k'}});
            expect(defaultProps.setParamsToUnset).toHaveBeenCalledWith('s.k');
            fireEvent.change(screen.getByRole('textbox', {name: 'Sections to delete input'}), {target: {value: 's'}});
            expect(defaultProps.setParamsToDelete).toHaveBeenCalledWith('s');
            expect(screen.getByLabelText('Parameter keys to unset')).toHaveAttribute('aria-label', 'Parameters to unset input');
            expect(screen.getByText('Delete sections (one key per line, e.g., section)')).toBeInTheDocument();
        });

        test('fields are disabled when disabled prop is true', () => {
            render(<ManageConfigParamsDialog {...defaultProps} disabled={true}/>);
            screen.getAllByRole('textbox').forEach((t) => expect(t).toBeDisabled());
        });
    });

    // ----- SimpleConfirmDialog -----
    describe('SimpleConfirmDialog', () => {
        test('renders action and target, calls onConfirm and onClose', () => {
            render(<SimpleConfirmDialog open onClose={onClose} onConfirm={onConfirm} action="reboot" target="node-1"/>);

            expect(screen.getByRole('dialog', {name: 'Confirm reboot'})).toBeInTheDocument();
            expect(screen.getByText(/Confirm reboot/i)).toBeInTheDocument();
            expect(screen.getByText('reboot', {selector: 'strong'})).toBeInTheDocument();
            expect(screen.getByRole('dialog')).toHaveTextContent('Are you sure you want to reboot on node-1?');

            expect(screen.getByText(/Are you sure you want to/i)).toBeInTheDocument();

            const confirmBtn = screen.getByRole('button', {name: /Confirm reboot action/i});
            fireEvent.click(confirmBtn);
            expect(onConfirm).toHaveBeenCalled();

            const cancelBtn = screen.getByRole('button', {name: /Cancel/i});
            fireEvent.click(cancelBtn);
            expect(onClose).toHaveBeenCalled();
        });
    });

    // ----- What a dialog acts on -----
    describe('target', () => {
        test.each([
            ['FreezeDialog', FreezeDialog], ['StopDialog', StopDialog], ['SwitchDialog', SwitchDialog],
            ['GivebackDialog', GivebackDialog],
        ])('%s says what it acts on', (_, DialogComponent) => {
            render(<DialogComponent open onClose={onClose} onConfirm={onConfirm} checked={false}
                                    setChecked={defaultSetState} disabled={false} target="object root/svc/web"/>);
            expect(screen.getByRole('dialog')).toHaveTextContent('Acts on object root/svc/web.');
            expect(screen.getByText('object root/svc/web', {selector: 'strong'})).toBeInTheDocument();
        });

        test.each([
            ['ShutdownDialog', ShutdownDialog, {instancesDown: false, peerTakeover: false}],
            ['UnprovisionDialog', UnprovisionDialog, {dataLoss: false, serviceInterruption: false, clusterwide: false}],
            ['PurgeDialog', PurgeDialog, {dataLoss: false, configLoss: false, serviceInterruption: false}],
            ['DeleteDialog', DeleteDialog, {configLoss: false, clusterwide: false}],
        ])('%s lists the names of a bulk action', (_, DialogComponent, checkboxes) => {
            render(<DialogComponent open onClose={onClose} onConfirm={onConfirm} checkboxes={checkboxes}
                                    setCheckboxes={defaultSetState} disabled={false}
                                    target="3 objects" names={['root/svc/a', 'root/svc/b', 'root/svc/c']}/>);
            const dialog = screen.getByRole('dialog');
            expect(dialog).toHaveTextContent('Acts on 3 objects.');
            const list = within(dialog).getByRole('list', {name: 'Targets'});
            expect(within(list).getAllByRole('listitem').map((li) => li.textContent))
                .toEqual(['root/svc/a', 'root/svc/b', 'root/svc/c']);
        });

        test('ShutdownDialog on instances says their resources stop, not the daemon', () => {
            render(<ShutdownDialog open onClose={onClose} onConfirm={onConfirm} instances
                                   checkboxes={{instancesDown: false, peerTakeover: false}}
                                   setCheckboxes={defaultSetState} disabled={false}/>);
            const dialog = screen.getByRole('dialog');
            expect(within(dialog).getByRole('checkbox', {name: 'Confirm instances shutdown'})).toBeInTheDocument();
            expect(dialog).toHaveTextContent('every resource of these instances, standby ones included, will be stopped');
            expect(dialog).not.toHaveTextContent('daemon');
        });

        test('DeleteDialog on instances says their configuration only goes, not orchestrated', () => {
            render(<DeleteDialog open onClose={onClose} onConfirm={onConfirm} instances
                                 checkboxes={{configLoss: true, clusterwide: true}}
                                 setCheckboxes={defaultSetState} disabled={false}/>);
            const dialog = screen.getByRole('dialog');
            expect(within(dialog).getByRole('checkbox', {name: 'Confirm instance configuration loss'})).toBeChecked();
            expect(within(dialog).getByRole('checkbox', {name: 'Confirm instance configuration only'})).toBeChecked();
            expect(dialog).not.toHaveTextContent('clusterwide');
            expect(within(dialog).getByRole('button', {name: 'Confirm delete action'})).toBeEnabled();
        });

        test('UnprovisionDialog on instances asks no clusterwide acknowledgement', () => {
            render(<UnprovisionDialog open onClose={onClose} onConfirm={onConfirm} instances
                                      checkboxes={{dataLoss: true, serviceInterruption: true, clusterwide: false}}
                                      setCheckboxes={defaultSetState} disabled={false}/>);
            expect(screen.queryByRole('checkbox', {name: 'Confirm clusterwide orchestration'})).not.toBeInTheDocument();
            expect(screen.getByRole('button', {name: 'Confirm unprovision action'})).toBeEnabled();
        });

        test('a single name is not listed again', () => {
            render(<DeleteDialog open onClose={onClose} onConfirm={onConfirm}
                                 checkboxes={{configLoss: false, clusterwide: false}}
                                 setCheckboxes={defaultSetState} disabled={false}
                                 target="1 objects" names={['root/svc/a']}/>);
            expect(screen.queryByRole('list')).not.toBeInTheDocument();
        });
    });
});

describe('ActionDialogs in French', () => {
    beforeEach(async () => {
        await i18n.changeLanguage('fr');
    });
    afterEach(async () => {
        await i18n.changeLanguage('en');
    });

    test('PurgeDialog shows its French acknowledgements', () => {
        render(<PurgeDialog open onClose={jest.fn()} onConfirm={jest.fn()}
                            checkboxes={{dataLoss: false, configLoss: false, serviceInterruption: false}}
                            setCheckboxes={jest.fn()} disabled={false}/>);
        expect(screen.getByRole('dialog', {name: 'Confirmer la purge'})).toBeInTheDocument();
        expect(screen.getByRole('checkbox', {name: 'Confirmer la perte de configuration'})).toBeInTheDocument();
        expect(screen.getByRole('button', {name: 'Annuler'})).toBeInTheDocument();
    });

    test('SimpleConfirmDialog shows the translated action label', () => {
        render(<SimpleConfirmDialog open onClose={jest.fn()} onConfirm={jest.fn()} action="restart daemon" target="node-1"/>);
        expect(screen.getByRole('dialog')).toHaveTextContent(
            "Voulez-vous vraiment exécuter l'action Redémarrer le démon sur node-1 ?"
        );
        expect(screen.getByText('Redémarrer le démon', {selector: 'strong'})).toBeInTheDocument();
    });
});
