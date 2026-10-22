import React from 'react';
import {render, screen, fireEvent, within} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import {vi} from 'vitest';
import InstanceCard from '../InstanceCard.jsx';
import i18n from '../../i18n';

// ── Hoisted logger mock ─────────────────────────────────────────────────
const {mockLogger} = vi.hoisted(() => ({
    mockLogger: {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
    },
}));

// ── Mocks ───────────────────────────────────────────────────────────────
vi.mock('../../utils/logger.js', () => ({
    default: mockLogger,
}));

const ACTIONS = [
    {name: 'start', icon: <span>StartIcon</span>},
    {name: 'stop', icon: <span>StopIcon</span>},
    {name: 'purge', icon: <span>PurgeIcon</span>, color: 'red'},
];

const renderCard = (props = {}) =>
    render(
        <MemoryRouter>
            <InstanceCard node="node1" {...props}/>
        </MemoryRouter>
    );

const statusMark = () => document.querySelector('[data-state]');

const stoppedMark = () => screen.queryByRole('img', {name: 'Instance on node node1 is stopped'});
const laggingMark = () => screen.queryByRole('img', {name: 'Instance on node node1 is lagging'});
const frozenMark = () => screen.queryByTitle('frozen');
const nodeState = (overrides = {}) =>
    vi.fn(() => ({avail: 'up', frozen: 'unfrozen', state: null, isStopped: false, isLagging: false, ...overrides}));

describe('InstanceCard Component', () => {
    const user = userEvent.setup();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('renders node name correctly', () => {
        renderCard();
        expect(screen.getByText('node1')).toBeInTheDocument();
        expect(screen.getByRole('group', {name: 'Instance on node node1'})).toBeInTheDocument();
    });

    test('renders node with provided nodeData', () => {
        renderCard({nodeData: {instanceName: 'instance1', provisioned: true}});
        expect(screen.getByText('node1')).toBeInTheDocument();
    });

    test('calls toggleNode when checkbox is clicked', async () => {
        const toggleNode = vi.fn();
        renderCard({toggleNode});
        const checkbox = screen.getByRole('checkbox', {name: /select node node1/i});
        expect(checkbox).not.toBeChecked();
        await user.click(checkbox);
        expect(toggleNode).toHaveBeenCalledWith('node1');
    });

    test('checkbox reflects the selection', () => {
        renderCard({selectedNodes: ['node1']});
        expect(screen.getByRole('checkbox', {name: /select node node1/i})).toBeChecked();
    });

    test('calls onOpenLogs when logs button is clicked', async () => {
        const onOpenLogs = vi.fn();
        renderCard({nodeData: {instanceName: 'instance1'}, onOpenLogs});
        await user.click(screen.getByRole('button', {name: /View logs for instance instance1/i}));
        expect(onOpenLogs).toHaveBeenCalledWith('node1', 'instance1');
    });

    test('calls onViewInstance when card is clicked (except on interactive elements)', async () => {
        const onViewInstance = vi.fn();
        renderCard({onViewInstance});
        await user.click(screen.getByText('node1'));
        expect(onViewInstance).toHaveBeenCalledTimes(1);
        expect(onViewInstance).toHaveBeenCalledWith('node1');

        onViewInstance.mockClear();
        fireEvent.click(screen.getByRole('group', {name: 'Instance on node node1'}));
        expect(onViewInstance).toHaveBeenCalledWith('node1');
    });

    test('the node name is a button opening the instance from the keyboard', async () => {
        const onViewInstance = vi.fn();
        renderCard({onViewInstance});
        screen.getByRole('button', {name: 'node1'}).focus();
        await user.keyboard('{Enter}');
        expect(onViewInstance).toHaveBeenCalledWith('node1');
    });

    test('does not call onViewInstance when interactive elements are clicked', async () => {
        const onViewInstance = vi.fn();
        renderCard({onViewInstance, actions: ACTIONS});
        await user.click(screen.getByRole('checkbox', {name: /select node node1/i}));
        await user.click(screen.getByRole('button', {name: /View logs for instance node1/i}));
        await user.click(screen.getByRole('button', {name: /Node node1 actions/i}));
        await user.click(screen.getByRole('menuitem', {name: 'Start'}));
        expect(onViewInstance).not.toHaveBeenCalled();
    });

    test('opens node actions menu and runs the chosen action', async () => {
        const onAction = vi.fn();
        renderCard({actions: ACTIONS, onAction});
        await user.click(screen.getByRole('button', {name: /Node node1 actions/i}));
        const menu = screen.getByRole('menu', {name: 'Node node1 actions'});
        expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
            'StartIconStart', 'StopIconStop', 'PurgeIconPurge',
        ]);
        await user.click(within(menu).getByRole('menuitem', {name: 'Stop'}));
        expect(onAction).toHaveBeenCalledWith('node1', 'stop');
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    test('closes the node actions menu on a click outside', async () => {
        const onAction = vi.fn();
        renderCard({actions: ACTIONS, onAction});
        await user.click(screen.getByRole('button', {name: /Node node1 actions/i}));
        expect(screen.getByRole('menu')).toBeInTheDocument();
        await user.click(document.body);
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
        expect(onAction).not.toHaveBeenCalled();
    });

    test.each([
        ['up', 'up'],
        ['warn', 'warn'],
        ['down', 'down'],
        ['unknown', 'unknown'],
        ['', 'unknown'],
    ])('displays node avail %p as state %p', (avail, state) => {
        const getNodeState = vi.fn(() => ({avail, frozen: 'unfrozen', state: null}));
        renderCard({getNodeState});
        expect(getNodeState).toHaveBeenCalledWith('node1');
        expect(statusMark()).toHaveAttribute('data-state', state);
        expect(statusMark()).toHaveAttribute('title', avail || 'unknown');
    });

    test.each([
        ['up', true],
        ['stdby up', true],
        ['down', false],
        ['warn', false],
        [undefined, false],
    ])('a down instance of an object %p is gray: %p', (objectAvail, gray) => {
        renderCard({getNodeState: vi.fn(() => ({avail: 'down', frozen: 'unfrozen', state: null})), objectAvail});
        expect(statusMark()).toHaveAttribute('data-state', 'down');
        expect(statusMark()).toHaveClass(gray ? 'text-ink-muted' : 'text-state-down');
    });

    test('shows frozen mark when node is frozen', () => {
        renderCard({getNodeState: vi.fn(() => ({avail: 'up', frozen: 'frozen', state: null}))});
        expect(screen.getByTitle('frozen')).toBeInTheDocument();
    });

    test('does not show frozen mark when node is not frozen', () => {
        renderCard({getNodeState: vi.fn(() => ({avail: 'up', frozen: 'unfrozen', state: null}))});
        expect(screen.queryByTitle('frozen')).not.toBeInTheDocument();
    });

    test.each([[false], ['false']])('shows not provisioned mark when provisioned is %p', (provisioned) => {
        renderCard({nodeData: {provisioned}});
        expect(screen.getByRole('img', {name: 'Instance on node node1 is not provisioned'})).toBeInTheDocument();
    });

    test.each([['n/a'], [true]])('does NOT show not provisioned mark when provisioned is %p', (provisioned) => {
        renderCard({nodeData: {provisioned}});
        expect(screen.queryByRole('img', {name: /is not provisioned/})).not.toBeInTheDocument();
    });

    test('displays node state when available', () => {
        renderCard({getNodeState: vi.fn(() => ({avail: 'up', frozen: 'unfrozen', state: 'running'}))});
        expect(screen.getByText('running')).toBeInTheDocument();
    });

    test('handles default functions gracefully', async () => {
        renderCard({actions: ACTIONS});
        fireEvent.click(screen.getByRole('checkbox', {name: /select node node1/i}));
        expect(mockLogger.warn).toHaveBeenCalledWith('toggleNode not provided');

        fireEvent.click(screen.getByRole('button', {name: /View logs for instance node1/i}));
        expect(mockLogger.warn).toHaveBeenCalledWith('onOpenLogs not provided');

        await user.click(screen.getByRole('button', {name: /Node node1 actions/i}));
        await user.click(screen.getByRole('menuitem', {name: 'Start'}));
        expect(mockLogger.warn).toHaveBeenCalledWith('onAction not provided');
    });

    test('does not make the node name a view button when onViewInstance is not provided', () => {
        renderCard();
        expect(screen.queryByRole('button', {name: 'node1'})).not.toBeInTheDocument();
        fireEvent.click(screen.getByText('node1'));
    });

    test('handles null node prop gracefully', () => {
        renderCard({node: null});
        expect(mockLogger.error).toHaveBeenCalledWith('Node name is required');
    });

    test('disables actions button and entries when actionInProgress is true', () => {
        renderCard({actionInProgress: true, actions: ACTIONS});
        expect(screen.getByRole('button', {name: /Node node1 actions/i})).toBeDisabled();
    });

    test('uses resolved instance name for logs button', async () => {
        const onOpenLogs = vi.fn();
        renderCard({nodeData: {instanceName: 'custom-instance'}, onOpenLogs});
        await user.click(screen.getByRole('button', {name: /View logs for instance custom-instance/i}));
        expect(onOpenLogs).toHaveBeenCalledWith('node1', 'custom-instance');
    });

    test('instanceName prop takes precedence over nodeData', async () => {
        const onOpenLogs = vi.fn();
        renderCard({instanceName: 'svc1', nodeData: {instanceName: 'custom-instance'}, onOpenLogs});
        await user.click(screen.getByRole('button', {name: /View logs for instance svc1/i}));
        expect(onOpenLogs).toHaveBeenCalledWith('node1', 'svc1');
    });

    test('uses node name as instance name when not provided', async () => {
        const onOpenLogs = vi.fn();
        renderCard({onOpenLogs});
        await user.click(screen.getByRole('button', {name: /View logs for instance node1/i}));
        expect(onOpenLogs).toHaveBeenCalledWith('node1', 'node1');
    });

    // ─── stopped indicator ──────────────────────────────────────────────
    describe('stopped indicator', () => {
        test('shows the stopped mark when isStopped is true', () => {
            renderCard({getNodeState: nodeState({avail: 'down', isStopped: true})});
            expect(stoppedMark()).toBeInTheDocument();
        });

        test('does not show the stopped mark when isStopped is false', () => {
            renderCard({getNodeState: nodeState()});
            expect(stoppedMark()).not.toBeInTheDocument();
        });

        test('does not show the stopped mark by default (getNodeState without the flag)', () => {
            renderCard({getNodeState: vi.fn(() => ({avail: 'up', frozen: 'unfrozen', state: null}))});
            expect(stoppedMark()).not.toBeInTheDocument();
        });

        test('stopped tooltip contains the stopped_at date when provided', () => {
            renderCard({
                nodeData: {stopped_at: '2025-05-16T10:00:00Z'},
                getNodeState: nodeState({avail: 'down', isStopped: true}),
            });
            expect(stoppedMark()).toHaveAttribute('title', expect.stringContaining('stopped at'));
        });

        test('stopped tooltip is just "stopped" when no stopped_at is provided', () => {
            renderCard({getNodeState: nodeState({avail: 'down', isStopped: true})});
            expect(stoppedMark()).toHaveAttribute('title', 'stopped');
        });
    });

    // ─── RPO-breached indicator ─────────────────────────────────────────
    describe('RPO-breached indicator', () => {
        test('shows the RPO-breached mark when isLagging is true', () => {
            renderCard({getNodeState: nodeState({isLagging: true})});
            expect(laggingMark()).toBeInTheDocument();
        });

        test('does not show the RPO-breached mark when isLagging is false', () => {
            renderCard({getNodeState: nodeState()});
            expect(laggingMark()).not.toBeInTheDocument();
        });

        test('does not show the RPO-breached mark by default (getNodeState without the flag)', () => {
            renderCard({getNodeState: vi.fn(() => ({avail: 'up', frozen: 'unfrozen', state: null}))});
            expect(laggingMark()).not.toBeInTheDocument();
        });

        test('lagging tooltip is "RPO breached" and does NOT contain a date', () => {
            renderCard({
                nodeData: {rpo_breached_at: '2025-05-16T10:00:00Z'},
                getNodeState: nodeState({isLagging: true}),
            });
            const title = laggingMark().getAttribute('title');
            expect(title).toBe('RPO breached');
            expect(title).not.toEqual(expect.stringContaining('2025'));
        });
    });

    // ─── precedence and coexistence ─────────────────────────────────────
    describe('indicator precedence and coexistence', () => {
        test('RPO-breached takes precedence over frozen', () => {
            renderCard({getNodeState: nodeState({frozen: 'frozen', isLagging: true})});
            expect(laggingMark()).toBeInTheDocument();
            expect(frozenMark()).not.toBeInTheDocument();
        });

        test('frozen is shown when isLagging is false', () => {
            renderCard({getNodeState: nodeState({frozen: 'frozen'})});
            expect(frozenMark()).toBeInTheDocument();
            expect(laggingMark()).not.toBeInTheDocument();
        });

        test('stopped and RPO-breached are shown simultaneously', () => {
            renderCard({getNodeState: nodeState({avail: 'down', isStopped: true, isLagging: true})});
            expect(stoppedMark()).toBeInTheDocument();
            expect(laggingMark()).toBeInTheDocument();
        });

        test('stopped + RPO-breached + frozen: frozen is hidden by lagging precedence', () => {
            renderCard({getNodeState: nodeState({avail: 'down', frozen: 'frozen', isStopped: true, isLagging: true})});
            expect(stoppedMark()).toBeInTheDocument();
            expect(laggingMark()).toBeInTheDocument();
            expect(frozenMark()).not.toBeInTheDocument();
        });

        test('healthy node shows none of the special indicators', () => {
            renderCard({getNodeState: nodeState()});
            expect(stoppedMark()).not.toBeInTheDocument();
            expect(laggingMark()).not.toBeInTheDocument();
            expect(frozenMark()).not.toBeInTheDocument();
        });

        test('availability mark remains visible alongside stopped and lagging', () => {
            renderCard({getNodeState: nodeState({avail: 'down', isStopped: true, isLagging: true})});
            expect(statusMark()).toHaveAttribute('data-state', 'down');
            expect(stoppedMark()).toBeInTheDocument();
            expect(laggingMark()).toBeInTheDocument();
        });
    });

    test('speaks French when the browser does', async () => {
        await i18n.changeLanguage('fr');
        try {
            renderCard({onViewInstance: vi.fn()});
            expect(screen.getByRole('group', {name: 'Instance sur le nœud node1'})).toBeInTheDocument();
            expect(screen.getByTitle('Voir les ressources')).toBeInTheDocument();
        } finally {
            await i18n.changeLanguage('en');
        }
    });
});
