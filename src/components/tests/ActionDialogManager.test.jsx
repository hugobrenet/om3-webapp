import React from 'react';
import i18n from '../../i18n';
import {render, screen, fireEvent, within} from '@testing-library/react';
import {vi, describe, test, expect, beforeEach, afterEach} from 'vitest';
import ActionDialogManager, {SimpleConfirmDialog} from '../ActionDialogManager';

// ── Mocks ──────────────────────────────────────────────────────────────
vi.mock('../ActionDialogs', () => ({
    FreezeDialog: vi.fn((props) =>
        props.open ? (
            <div data-testid="freeze-dialog">
                <button onClick={props.onClose}>Cancel</button>
                <button onClick={props.onConfirm} disabled={props.disabled}>Confirm</button>
                <input type="checkbox" checked={props.checked}
                       onChange={(e) => props.setChecked(e.target.checked)}
                       data-testid="freeze-checkbox"/>
                <span>{props.pendingAction?.action}</span>
                <span>{props.target}</span>
            </div>
        ) : null
    ),
    StopDialog: vi.fn((props) =>
        props.open ? (
            <div data-testid="stop-dialog">
                <button onClick={props.onClose}>Cancel</button>
                <button onClick={props.onConfirm} disabled={props.disabled}>Confirm</button>
                <input type="checkbox" checked={props.checked}
                       onChange={(e) => props.setChecked(e.target.checked)}
                       data-testid="stop-checkbox"/>
                <span>{props.pendingAction?.action}</span>
                <span>{props.target}</span>
            </div>
        ) : null
    ),
    ShutdownDialog: vi.fn((props) =>
        props.open ? (
            <div data-testid="shutdown-dialog">
                <button onClick={props.onClose}>Cancel</button>
                <button onClick={props.onConfirm} disabled={props.disabled}>Confirm</button>
                <input type="checkbox" checked={props.checkboxes.instancesDown}
                       onChange={(e) => props.setCheckboxes({...props.checkboxes, instancesDown: e.target.checked})}
                       data-testid="shutdown-instancesDown-checkbox"/>
                <input type="checkbox" checked={props.checkboxes.peerTakeover}
                       onChange={(e) => props.setCheckboxes({...props.checkboxes, peerTakeover: e.target.checked})}
                       data-testid="shutdown-peerTakeover-checkbox"/>
                <span>{props.pendingAction?.action}</span>
                <span>{props.target}</span>
            </div>
        ) : null
    ),
    UnprovisionDialog: vi.fn((props) =>
        props.open ? (
            <div data-testid="unprovision-dialog">
                <button onClick={props.onClose}>Cancel</button>
                <button onClick={props.onConfirm} disabled={props.disabled}>Confirm</button>
                <input type="checkbox" checked={props.checkboxes.dataLoss}
                       onChange={(e) => props.setCheckboxes({...props.checkboxes, dataLoss: e.target.checked})}
                       data-testid="unprovision-dataLoss-checkbox"/>
                <input type="checkbox" checked={props.checkboxes.serviceInterruption}
                       onChange={(e) => props.setCheckboxes({
                           ...props.checkboxes,
                           serviceInterruption: e.target.checked
                       })}
                       data-testid="unprovision-serviceInterruption-checkbox"/>
                {!props.pendingAction?.node && (
                    <input type="checkbox" checked={props.checkboxes.clusterwide}
                           onChange={(e) => props.setCheckboxes({...props.checkboxes, clusterwide: e.target.checked})}
                           data-testid="unprovision-clusterwide-checkbox"/>
                )}
                <span>{props.pendingAction?.action}</span>
                <span>{props.target}</span>
            </div>
        ) : null
    ),
    PurgeDialog: vi.fn((props) =>
        props.open ? (
            <div data-testid="purge-dialog">
                <button onClick={props.onClose}>Cancel</button>
                <button onClick={props.onConfirm} disabled={props.disabled}>Confirm</button>
                <input type="checkbox" checked={props.checkboxes.dataLoss}
                       onChange={(e) => props.setCheckboxes({...props.checkboxes, dataLoss: e.target.checked})}
                       data-testid="purge-dataLoss-checkbox"/>
                <input type="checkbox" checked={props.checkboxes.configLoss}
                       onChange={(e) => props.setCheckboxes({...props.checkboxes, configLoss: e.target.checked})}
                       data-testid="purge-configLoss-checkbox"/>
                <input type="checkbox" checked={props.checkboxes.serviceInterruption}
                       onChange={(e) => props.setCheckboxes({
                           ...props.checkboxes,
                           serviceInterruption: e.target.checked
                       })}
                       data-testid="purge-serviceInterruption-checkbox"/>
                <span>{props.pendingAction?.action}</span>
                <span>{props.target}</span>
            </div>
        ) : null
    ),
    DeleteDialog: vi.fn((props) =>
        props.open ? (
            <div data-testid="delete-dialog">
                <span data-testid="delete-instances">{String(props.instances)}</span>
                <button onClick={props.onClose}>Cancel</button>
                <button onClick={props.onConfirm} disabled={props.disabled}>Confirm</button>
                <input type="checkbox" checked={props.checkboxes.configLoss}
                       onChange={(e) => props.setCheckboxes({...props.checkboxes, configLoss: e.target.checked})}
                       data-testid="delete-configLoss-checkbox"/>
                <input type="checkbox" checked={props.checkboxes.clusterwide}
                       onChange={(e) => props.setCheckboxes({...props.checkboxes, clusterwide: e.target.checked})}
                       data-testid="delete-clusterwide-checkbox"/>
                <span>{props.pendingAction?.action}</span>
                <span>{props.target}</span>
            </div>
        ) : null
    ),
    SwitchDialog: vi.fn((props) =>
        props.open ? (
            <div data-testid="switch-dialog">
                <button onClick={props.onClose}>Cancel</button>
                <button onClick={props.onConfirm} disabled={props.disabled}>Confirm</button>
                <input type="checkbox" checked={props.checked}
                       onChange={(e) => props.setChecked(e.target.checked)}
                       data-testid="switch-checkbox"/>
                <span>{props.pendingAction?.action}</span>
                <span>{props.target}</span>
            </div>
        ) : null
    ),
    GivebackDialog: vi.fn((props) =>
        props.open ? (
            <div data-testid="giveback-dialog">
                <button onClick={props.onClose}>Cancel</button>
                <button onClick={props.onConfirm} disabled={props.disabled}>Confirm</button>
                <input type="checkbox" checked={props.checked}
                       onChange={(e) => props.setChecked(e.target.checked)}
                       data-testid="giveback-checkbox"/>
                <span>{props.pendingAction?.action}</span>
                <span>{props.target}</span>
                <span data-testid="giveback-names">{props.names?.join(',')}</span>
            </div>
        ) : null
    ),
    Subject: vi.fn((props) => <span data-testid="subject-names">{props.names?.join(',')}</span>),
}));

describe('ActionDialogManager', () => {
    test('passes the names of a bulk action to its dialog', () => {
        render(<ActionDialogManager pendingAction={{action: 'giveback'}} handleConfirm={vi.fn()}
                                    target="2 objects" names={['a', 'b']}
                                    supportedActions={['giveback']} onClose={vi.fn()}/>);
        expect(screen.getByTestId('giveback-names')).toHaveTextContent('a,b');
    });

    test('tells the delete dialog it acts on instances', () => {
        render(<ActionDialogManager pendingAction={{action: 'delete'}} handleConfirm={vi.fn()}
                                    target="web on node n1" instances
                                    supportedActions={['delete']} onClose={vi.fn()}/>);
        expect(screen.getByTestId('delete-instances')).toHaveTextContent('true');
    });

    test('lists the names of a bulk action in the simple confirmation', () => {
        render(<ActionDialogManager pendingAction={{action: 'other'}} handleConfirm={vi.fn()}
                                    target="2 objects" names={['a', 'b']}
                                    supportedActions={['other']} onClose={vi.fn()}/>);
        expect(screen.getByTestId('subject-names')).toHaveTextContent('a,b');
    });
});

describe('ActionDialogManager', () => {
    const defaultProps = {
        pendingAction: null,
        handleConfirm: vi.fn(),
        target: 'test-target',
        supportedActions: [
            'freeze', 'stop', 'shutdown', 'unprovision', 'purge',
            'delete', 'switch', 'giveback','other',
        ],
        onClose: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'log').mockImplementation(() => {
        });
        vi.spyOn(console, 'warn').mockImplementation(() => {
        });
        vi.spyOn(console, 'error').mockImplementation(() => {
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    test('renders without crashing when no pendingAction is provided', () => {
        render(<ActionDialogManager {...defaultProps} pendingAction={null}/>);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(defaultProps.onClose).toHaveBeenCalled();
    });

    test('handles null pendingAction without onClose prop', () => {
        render(<ActionDialogManager {...defaultProps} onClose={undefined} pendingAction={null}/>);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    test('handles invalid pendingAction without onClose prop', () => {
        render(<ActionDialogManager {...defaultProps} onClose={undefined} pendingAction={{}}/>);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    test('handles pendingAction with null action without onClose prop', () => {
        render(
            <ActionDialogManager
                {...defaultProps}
                onClose={undefined}
                pendingAction={{action: null}}
            />
        );
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    test('handles pendingAction with non-string action without onClose prop', () => {
        render(
            <ActionDialogManager
                {...defaultProps}
                onClose={undefined}
                pendingAction={{action: 42}}
            />
        );
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    test('handles unsupported action without onClose prop', () => {
        render(
            <ActionDialogManager
                {...defaultProps}
                onClose={undefined}
                pendingAction={{action: 'invalid'}}
                supportedActions={['freeze']}
            />
        );
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    test('logs warning for invalid non-null pendingAction', () => {
        render(<ActionDialogManager {...defaultProps} pendingAction={{}}/>);
        expect(console.warn).toHaveBeenCalledWith('Invalid pendingAction provided:', {});
        expect(defaultProps.onClose).toHaveBeenCalled();
    });

    test('opens FreezeDialog when pendingAction is freeze', async () => {
        render(<ActionDialogManager {...defaultProps} pendingAction={{action: 'freeze'}}/>);
        const dialog = await screen.findByTestId('freeze-dialog');
        expect(dialog).toBeInTheDocument();
    });

    test('renders nothing for invalid or unsupported actions', () => {
        const {container, rerender} = render(<ActionDialogManager {...defaultProps} pendingAction={{}}/>);
        expect(container).toBeEmptyDOMElement();
        rerender(<ActionDialogManager {...defaultProps} pendingAction={{action: 'invalid'}} supportedActions={['freeze']}/>);
        expect(container).toBeEmptyDOMElement();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    test('matches the action case-insensitively and passes props to the dialog', async () => {
        const {FreezeDialog} = await import('../ActionDialogs');
        render(<ActionDialogManager {...defaultProps} pendingAction={{action: 'FREEZE'}}/>);
        await screen.findByTestId('freeze-dialog');
        const props = FreezeDialog.mock.calls[FreezeDialog.mock.calls.length - 1][0];
        expect(props).toMatchObject({open: true, disabled: false, checked: false, target: 'test-target'});
        expect(screen.getByText('test-target')).toBeInTheDocument();
        fireEvent.click(screen.getByText('Confirm'));
        expect(defaultProps.handleConfirm).toHaveBeenCalledWith('FREEZE');
    });

    test('opens SimpleConfirmDialog for unknown action', async () => {
        render(<ActionDialogManager {...defaultProps} pendingAction={{action: 'other'}}/>);
        expect(await screen.findByRole('dialog', {name: 'Confirm Other'})).toBeInTheDocument();
        expect(await screen.findByText('Confirm Other')).toBeInTheDocument();
        expect(screen.getByRole('button', {name: 'Confirm'})).toBeEnabled();
        expect(screen.getByRole('button', {name: 'Cancel'})).toBeEnabled();
        expect(screen.getByText(/Are you sure you want to other on test-target\?/)).toBeInTheDocument();
    });

    test('closes dialog and calls onClose when Cancel is clicked', async () => {
        render(<ActionDialogManager {...defaultProps} pendingAction={{action: 'freeze'}}/>);
        await screen.findByTestId('freeze-dialog');
        fireEvent.click(screen.getByText('Cancel'));
        expect(defaultProps.onClose).toHaveBeenCalled();
    });

    test('updates checkbox and confirms freeze', async () => {
        render(<ActionDialogManager {...defaultProps} pendingAction={{action: 'freeze'}}/>);
        const checkbox = await screen.findByTestId('freeze-checkbox');
        fireEvent.click(checkbox);
        fireEvent.click(screen.getByText('Confirm'));
        expect(defaultProps.handleConfirm).toHaveBeenCalledWith('freeze');
    });

    test('handles shutdown checkboxes properly', async () => {
        render(
            <ActionDialogManager
                {...defaultProps}
                pendingAction={{action: 'shutdown', node: 'test-node'}}
            />
        );
        const instancesDownCheckbox = await screen.findByTestId('shutdown-instancesDown-checkbox');
        const peerTakeoverCheckbox = await screen.findByTestId('shutdown-peerTakeover-checkbox');
        fireEvent.click(instancesDownCheckbox);
        fireEvent.click(peerTakeoverCheckbox);
        fireEvent.click(screen.getByText('Confirm'));
        expect(defaultProps.handleConfirm).toHaveBeenCalledWith('shutdown');
    });

    test('handles invalid setCheckboxes value for shutdown', async () => {
        const {ShutdownDialog} = await import('../ActionDialogs');
        render(<ActionDialogManager {...defaultProps} pendingAction={{action: 'shutdown'}}/>);
        await screen.findByTestId('shutdown-dialog');
        const mockCall = ShutdownDialog.mock.calls[0];
        expect(mockCall[0].setCheckboxes).toBeDefined();
        mockCall[0].setCheckboxes(null);
        expect(console.error).toHaveBeenCalledWith('setCheckboxes for shutdown received invalid value:', null);
    });

    test('handles unprovision checkboxes properly', async () => {
        render(
            <ActionDialogManager
                {...defaultProps}
                pendingAction={{action: 'unprovision', node: 'test-node'}}
            />
        );
        const dataLossCheckbox = await screen.findByTestId('unprovision-dataLoss-checkbox');
        const serviceInterruptionCheckbox = await screen.findByTestId('unprovision-serviceInterruption-checkbox');
        fireEvent.click(dataLossCheckbox);
        fireEvent.click(serviceInterruptionCheckbox);
        fireEvent.click(screen.getByText('Confirm'));
        expect(defaultProps.handleConfirm).toHaveBeenCalledWith('unprovision');
    });

    test('handles invalid setCheckboxes value for unprovision', async () => {
        const {UnprovisionDialog} = await import('../ActionDialogs');
        render(<ActionDialogManager {...defaultProps} pendingAction={{action: 'unprovision'}}/>);
        await screen.findByTestId('unprovision-dialog');
        const mockCall = UnprovisionDialog.mock.calls[0];
        expect(mockCall[0].setCheckboxes).toBeDefined();
        mockCall[0].setCheckboxes(null);
        expect(console.error).toHaveBeenCalledWith('setCheckboxes for unprovision received invalid value:', null);
    });

    test('ignores unsupported action and calls onClose', () => {
        render(
            <ActionDialogManager
                {...defaultProps}
                pendingAction={{action: 'invalid'}}
                supportedActions={['freeze']}
            />
        );
        expect(console.warn).toHaveBeenCalledWith('Unsupported action: invalid');
        expect(defaultProps.onClose).toHaveBeenCalled();
    });

    test('re-initializes dialog when pendingAction changes', async () => {
        const {rerender} = render(
            <ActionDialogManager {...defaultProps} pendingAction={{action: 'stop'}}/>
        );
        await screen.findByTestId('stop-dialog');
        rerender(<ActionDialogManager {...defaultProps} pendingAction={{action: 'freeze'}}/>);
        await screen.findByTestId('freeze-dialog');
    });

    test('handles delete dialog checkboxes correctly', async () => {
        render(<ActionDialogManager {...defaultProps} pendingAction={{action: 'delete'}}/>);
        await screen.findByTestId('delete-dialog');
        fireEvent.click(screen.getByTestId('delete-configLoss-checkbox'));
        fireEvent.click(screen.getByTestId('delete-clusterwide-checkbox'));
        fireEvent.click(screen.getByText('Confirm'));
        expect(defaultProps.handleConfirm).toHaveBeenCalledWith('delete');
    });

    test('handles switch dialog correctly', async () => {
        render(<ActionDialogManager {...defaultProps} pendingAction={{action: 'switch'}}/>);
        await screen.findByTestId('switch-dialog');
        fireEvent.click(screen.getByTestId('switch-checkbox'));
        fireEvent.click(screen.getByText('Confirm'));
        expect(defaultProps.handleConfirm).toHaveBeenCalledWith('switch');
    });

    test('handles giveback dialog correctly', async () => {
        render(<ActionDialogManager {...defaultProps} pendingAction={{action: 'giveback'}}/>);
        await screen.findByTestId('giveback-dialog');
        fireEvent.click(screen.getByTestId('giveback-checkbox'));
        fireEvent.click(screen.getByText('Confirm'));
        expect(defaultProps.handleConfirm).toHaveBeenCalledWith('giveback');
    });

    test('handles simpleConfirm fallback dialog', async () => {
        render(<ActionDialogManager {...defaultProps} pendingAction={{action: 'other'}}/>);
        expect(await screen.findByText('Confirm Other')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: 'Confirm'}));
        expect(defaultProps.handleConfirm).toHaveBeenCalledWith('other');
    });

    test('handles purge dialog correctly', async () => {
        render(<ActionDialogManager {...defaultProps} pendingAction={{action: 'purge'}}/>);
        await screen.findByTestId('purge-dialog');
        fireEvent.click(screen.getByTestId('purge-dataLoss-checkbox'));
        fireEvent.click(screen.getByTestId('purge-configLoss-checkbox'));
        fireEvent.click(screen.getByTestId('purge-serviceInterruption-checkbox'));
        fireEvent.click(screen.getByText('Confirm'));
        expect(defaultProps.handleConfirm).toHaveBeenCalledWith('purge');
    });

    test('covers setCheckboxes branches for shutdown', async () => {
        const {ShutdownDialog} = await import('../ActionDialogs');
        render(<ActionDialogManager {...defaultProps} pendingAction={{action: 'shutdown'}}/>);
        await screen.findByTestId('shutdown-dialog');
        const setCheckboxes = ShutdownDialog.mock.calls[ShutdownDialog.mock.calls.length - 1][0].setCheckboxes;
        setCheckboxes((prev) => ({...prev, instancesDown: true, extra: true}));
        setCheckboxes({peerTakeover: true, invalidKey: false});
        setCheckboxes(42);
        expect(console.error).toHaveBeenCalledWith('setCheckboxes for shutdown received invalid value:', 42);
    });

    test('covers setCheckboxes branches for unprovision', async () => {
        const {UnprovisionDialog} = await import('../ActionDialogs');
        render(<ActionDialogManager {...defaultProps} pendingAction={{action: 'unprovision'}}/>);
        await screen.findByTestId('unprovision-dialog');
        const setCheckboxes = UnprovisionDialog.mock.calls[UnprovisionDialog.mock.calls.length - 1][0].setCheckboxes;
        setCheckboxes((prev) => ({...prev, dataLoss: true, extra: true}));
        setCheckboxes({serviceInterruption: true, invalidKey: false});
        setCheckboxes(42);
        expect(console.error).toHaveBeenCalledWith('setCheckboxes for unprovision received invalid value:', 42);
    });

    test('covers setCheckboxes branches for purge', async () => {
        const {PurgeDialog} = await import('../ActionDialogs');
        render(<ActionDialogManager {...defaultProps} pendingAction={{action: 'purge'}}/>);
        await screen.findByTestId('purge-dialog');
        const setCheckboxes = PurgeDialog.mock.calls[PurgeDialog.mock.calls.length - 1][0].setCheckboxes;
        setCheckboxes((prev) => ({...prev, dataLoss: true, extra: true}));
        setCheckboxes({configLoss: true, invalidKey: false});
        setCheckboxes(42);
        expect(console.error).toHaveBeenCalledWith('setCheckboxes for purge received invalid value:', 42);
    });

    test('covers setCheckboxes branches for delete', async () => {
        const {DeleteDialog} = await import('../ActionDialogs');
        render(<ActionDialogManager {...defaultProps} pendingAction={{action: 'delete'}}/>);
        await screen.findByTestId('delete-dialog');
        const setCheckboxes = DeleteDialog.mock.calls[DeleteDialog.mock.calls.length - 1][0].setCheckboxes;
        setCheckboxes((prev) => ({...prev, configLoss: true, extra: true}));
        setCheckboxes({clusterwide: true, invalidKey: false});
        setCheckboxes(42);
        expect(console.error).toHaveBeenCalledWith('setCheckboxes for delete received invalid value:', 42);
    });

    test('does not log warnings in production environment', () => {
        const originalEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        render(<ActionDialogManager {...defaultProps} pendingAction={{}}/>);
        expect(console.warn).not.toHaveBeenCalled();
        render(
            <ActionDialogManager
                {...defaultProps}
                pendingAction={{action: 'invalid'}}
                supportedActions={[]}
            />
        );
        expect(console.warn).not.toHaveBeenCalled();
        process.env.NODE_ENV = originalEnv;
    });

    const dialogCases = [
        {action: 'freeze', checkbox: 'freeze-checkbox', dialog: 'freeze-dialog'},
        {action: 'stop', checkbox: 'stop-checkbox', dialog: 'stop-dialog'},
        {action: 'unprovision', checkbox: 'unprovision-dataLoss-checkbox', dialog: 'unprovision-dialog'},
        {action: 'purge', checkbox: 'purge-dataLoss-checkbox', dialog: 'purge-dialog'},
        {action: 'delete', checkbox: 'delete-configLoss-checkbox', dialog: 'delete-dialog'},
        {action: 'switch', checkbox: 'switch-checkbox', dialog: 'switch-dialog'},
        {action: 'giveback', checkbox: 'giveback-checkbox', dialog: 'giveback-dialog'},
    ];

    test.each(dialogCases)(
        'covers both branches of if (onClose) for $action dialog',
        async ({action, checkbox, dialog}) => {
            let {unmount} = render(
                <ActionDialogManager {...defaultProps} pendingAction={{action}}/>
            );
            await screen.findByTestId(dialog);
            fireEvent.click(screen.getByText('Cancel'));
            expect(defaultProps.onClose).toHaveBeenCalled();
            unmount();

            defaultProps.onClose.mockClear();
            defaultProps.handleConfirm.mockClear();
            ({unmount} = render(
                <ActionDialogManager {...defaultProps} pendingAction={{action}}/>
            ));
            await screen.findByTestId(dialog);
            if (checkbox) fireEvent.click(screen.getByTestId(checkbox));
            fireEvent.click(screen.getByText('Confirm'));
            expect(defaultProps.handleConfirm).toHaveBeenCalledWith(action);
            expect(defaultProps.onClose).toHaveBeenCalled();
            unmount();

            const propsNoClose = {...defaultProps, onClose: undefined};
            ({unmount} = render(
                <ActionDialogManager {...propsNoClose} pendingAction={{action}}/>
            ));
            await screen.findByTestId(dialog);
            fireEvent.click(screen.getByText('Cancel'));
            unmount();

            defaultProps.handleConfirm.mockClear();
            ({unmount} = render(
                <ActionDialogManager {...propsNoClose} pendingAction={{action}}/>
            ));
            await screen.findByTestId(dialog);
            if (checkbox) fireEvent.click(screen.getByTestId(checkbox));
            fireEvent.click(screen.getByText('Confirm'));
            expect(defaultProps.handleConfirm).toHaveBeenCalledWith(action);
            unmount();
        }
    );

    test('covers both branches of if (onClose) for simpleConfirm dialog', async () => {
        let {unmount} = render(
            <ActionDialogManager {...defaultProps} pendingAction={{action: 'other'}}/>
        );
        await screen.findByText('Confirm Other');
        fireEvent.click(screen.getByText('Cancel'));
        expect(defaultProps.onClose).toHaveBeenCalled();
        unmount();

        defaultProps.onClose.mockClear();
        ({unmount} = render(
            <ActionDialogManager {...defaultProps} pendingAction={{action: 'other'}}/>
        ));
        await screen.findByText('Confirm Other');
        fireEvent.click(screen.getByRole('button', {name: 'Confirm'}));
        expect(defaultProps.onClose).toHaveBeenCalled();
        unmount();

        const propsNoClose = {...defaultProps, onClose: undefined};
        ({unmount} = render(
            <ActionDialogManager {...propsNoClose} pendingAction={{action: 'other'}}/>
        ));
        await screen.findByText('Confirm Other');
        fireEvent.click(screen.getByText('Cancel'));
        unmount();

        ({unmount} = render(
            <ActionDialogManager {...propsNoClose} pendingAction={{action: 'other'}}/>
        ));
        await screen.findByText('Confirm Other');
        fireEvent.click(screen.getByRole('button', {name: 'Confirm'}));
        unmount();
    });
});

describe('SimpleConfirmDialog', () => {
    test('is not rendered when closed', () => {
        render(<SimpleConfirmDialog open={false} onClose={vi.fn()} onConfirm={vi.fn()} action="start" target="t"/>);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    test('calls onConfirm and onClose from its buttons and onClose on Escape', () => {
        const onClose = vi.fn();
        const onConfirm = vi.fn();
        render(<SimpleConfirmDialog open onClose={onClose} onConfirm={onConfirm} action="start" target="t"
                                    disabled={false} cancelDisabled={false}/>);
        const dialog = screen.getByRole('dialog', {name: 'Confirm Start'});
        fireEvent.click(within(dialog).getByRole('button', {name: 'Confirm'}));
        expect(onConfirm).toHaveBeenCalledTimes(1);
        fireEvent.click(within(dialog).getByRole('button', {name: 'Cancel'}));
        expect(onClose).toHaveBeenCalledTimes(1);
        fireEvent.keyDown(dialog, {key: 'Escape'});
        expect(onClose).toHaveBeenCalledTimes(2);
    });

    test('disables its buttons with disabled and cancelDisabled', () => {
        render(<SimpleConfirmDialog open onClose={vi.fn()} onConfirm={vi.fn()} action="start" target="t"
                                    disabled={true} cancelDisabled={true}/>);
        expect(screen.getByRole('button', {name: 'Confirm'})).toBeDisabled();
        expect(screen.getByRole('button', {name: 'Cancel'})).toBeDisabled();
    });

    test('renders with non-string action (covers typeof !== string branch)', () => {
        render(
            <SimpleConfirmDialog
                open={true}
                onClose={vi.fn()}
                onConfirm={vi.fn()}
                action={null}
                target="test-target"
                disabled={false}
                cancelDisabled={false}
            />
        );
        expect(screen.getByText('Confirm Action')).toBeInTheDocument();
        expect(screen.getByText(/Are you sure you want to perform this action on test-target\?/)).toBeInTheDocument();
    });

    test('renders with empty-string action (covers && action short-circuit)', () => {
        render(
            <SimpleConfirmDialog
                open={true}
                onClose={vi.fn()}
                onConfirm={vi.fn()}
                action=""
                target="test-target"
                disabled={false}
                cancelDisabled={false}
            />
        );
        expect(screen.getByText('Confirm Action')).toBeInTheDocument();
        expect(screen.getByText(/Are you sure you want to perform this action on test-target\?/)).toBeInTheDocument();
    });

    test('renders with string action (covers && action TRUE branch)', () => {
        render(
            <SimpleConfirmDialog
                open={true}
                onClose={vi.fn()}
                onConfirm={vi.fn()}
                action="delete"
                target="test-target"
                disabled={false}
                cancelDisabled={false}
            />
        );
        expect(screen.getByText('Confirm Delete')).toBeInTheDocument();
        expect(screen.getByText(/Are you sure you want to delete on test-target\?/)).toBeInTheDocument();
    });
});

describe('SimpleConfirmDialog in French', () => {
    afterEach(async () => {
        await i18n.changeLanguage('en');
    });

    test('shows the translated action label', async () => {
        await i18n.changeLanguage('fr');
        render(<SimpleConfirmDialog open onClose={vi.fn()} onConfirm={vi.fn()} action="freeze" target="test-target"/>);
        expect(screen.getByText('Confirmer « Geler »')).toBeInTheDocument();
        expect(screen.getByText("Voulez-vous vraiment exécuter l'action « Geler » sur test-target ?")).toBeInTheDocument();
        expect(screen.getByRole('button', {name: 'Confirmer'})).toBeInTheDocument();
    });
});
