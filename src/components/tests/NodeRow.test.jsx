import React from 'react';
import {render as rtlRender, screen, fireEvent, within} from '@testing-library/react';
import NodeRow from '../NodeRow';
import i18n from '../../i18n';

// A row lives in a table body.
const wrapper = ({children}) => <table><tbody>{children}</tbody></table>;
const render = (ui, options) => rtlRender(ui, {wrapper, ...options});
import '@testing-library/jest-dom';

describe('NodeRow Component', () => {
    const defaultProps = {
        nodename: 'node1',
        stats: {score: 85, load_15m: 1.5, mem_avail: 60, swap_avail: 75},
        status: {frozen_at: null, agent: 'v1.2.3', booted_at: null},
        monitor: {state: 'running', updated_at: null},
        isSelected: false,
        daemonNodename: 'node2',
        onSelect: jest.fn(),
    };

    beforeEach(() => {
        jest.clearAllMocks();
        document.body.innerHTML = '';
        Object.defineProperty(navigator, 'userAgent', {
            value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/91 Safari/537.36',
            configurable: true,
        });
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2023-01-01T12:00:00Z'));
    });

    afterEach(() => {
        jest.restoreAllMocks();
        jest.useRealTimers();
    });

    test('a node of the cluster reporting nothing is a line of "?", no action reaching it', () => {
        render(<NodeRow {...defaultProps} stats={undefined} status={undefined} monitor={undefined}/>);
        const row = screen.getByRole('row', {name: /Node node1 row/i});
        expect(within(row).getByTitle('No status: the node is gone or not heard from')).toHaveClass('text-state-down');
        expect(within(row).getAllByText('?')).toHaveLength(8);
        expect(within(row).getByRole('checkbox')).toBeDisabled();
    });

    test('renders nodename correctly', () => {
        render(<NodeRow {...defaultProps} />);
        expect(screen.getByText('node1')).toBeInTheDocument();
    });

    test('speaks French to a French browser', async () => {
        await i18n.changeLanguage('fr');
        try {
            render(<NodeRow {...defaultProps} stats={undefined}/>);
            expect(screen.getByRole('checkbox', {name: 'Sélectionner le nœud node1'})).toBeInTheDocument();
            expect(screen.getAllByText('N/D').length).toBeGreaterThan(0);
        } finally {
            await i18n.changeLanguage('en');
        }
    });

    test('renders checkbox with correct checked state', () => {
        const {rerender} = render(<NodeRow {...defaultProps} isSelected={true}/>);
        const row = screen.getByRole('row', {name: /Node node1 row/i});
        const checkbox = within(row).getByRole('checkbox', {name: /Select node node1/i});
        expect(checkbox).toBeChecked();

        rerender(<NodeRow {...defaultProps} isSelected={false}/>);
        const updatedCheckbox = within(screen.getByRole('row', {name: /Node node1 row/i})).getByRole('checkbox', {name: /Select node node1/i});
        expect(updatedCheckbox).not.toBeChecked();
    });

    test('calls onSelect when checkbox is clicked', () => {
        render(<NodeRow {...defaultProps} />);
        const checkbox = screen.getByRole('checkbox', {name: /Select node node1/i});
        fireEvent.click(checkbox);
        expect(defaultProps.onSelect).toHaveBeenCalledWith(expect.any(Object), 'node1');
    });

    test('renders monitor state when not idle', () => {
        render(<NodeRow {...defaultProps} monitor={{state: 'running'}}/>);
        const cells = screen.getAllByRole('cell');
        expect(within(cells[2]).getByText('running', {ignore: '.sr-only'})).toBeInTheDocument();
        const mark = within(cells[2]).getByTitle('running');
        expect(mark).toHaveAttribute('data-state', 'warn');
    });

    test('shows idle as a mark only', () => {
        render(<NodeRow {...defaultProps} monitor={{state: 'idle'}}/>);
        const cells = screen.getAllByRole('cell');
        expect(within(cells[2]).queryByText('idle', {ignore: '.sr-only'})).not.toBeInTheDocument();
        expect(within(cells[2]).getByTitle('idle')).toHaveAttribute('data-state', 'up');
    });

    test('marks a failed monitor state as down', () => {
        render(<NodeRow {...defaultProps} monitor={{state: 'drain failed'}}/>);
        expect(screen.getByTitle('drain failed')).toHaveAttribute('data-state', 'down');
    });

    test('marks a missing monitor as unknown', () => {
        render(<NodeRow {...defaultProps} monitor={undefined}/>);
        expect(screen.getByTitle('unknown')).toHaveAttribute('data-state', 'unknown');
    });

    test('renders frozen mark when frozen_at is set', () => {
        render(<NodeRow {...defaultProps} status={{frozen_at: '2023-01-01T12:00:00Z', agent: 'v1.2.3'}}/>);
        const cells = screen.getAllByRole('cell');
        expect(within(cells[2]).getByTitle('frozen')).toHaveTextContent('frozen');
    });

    test('does not render frozen mark when not frozen or invalid date', () => {
        const {unmount} = render(<NodeRow {...defaultProps} status={{frozen_at: null}}/>);
        expect(screen.queryByTitle('frozen')).not.toBeInTheDocument();
        unmount();

        render(<NodeRow {...defaultProps} status={{frozen_at: '0001-01-01T00:00:00Z'}}/>);
        expect(screen.queryByTitle('frozen')).not.toBeInTheDocument();
    });

    test('renders daemon node indicator when nodename matches daemonNodename', () => {
        render(<NodeRow {...defaultProps} daemonNodename="node1"/>);
        const indicator = screen.getByRole('img', {name: 'Connected to this node'});
        expect(indicator).toHaveAttribute('title', 'Connected to this node');
    });

    test('does not render daemon node indicator when nodename does not match daemonNodename', () => {
        render(<NodeRow {...defaultProps} daemonNodename="node2"/>);
        expect(screen.queryByRole('img', {name: 'Connected to this node'})).not.toBeInTheDocument();
    });

    test('renders stats correctly', () => {
        render(<NodeRow {...defaultProps} />);
        expect(screen.getByText('85')).toBeInTheDocument();
        expect(screen.getByText('1.5')).toBeInTheDocument();
        expect(screen.getByText('60%')).toBeInTheDocument();
        expect(screen.getByText('75%')).toBeInTheDocument();
        expect(screen.getByText('v1.2.3')).toBeInTheDocument();
    });

    test('renders N/A for undefined stats', () => {
        render(<NodeRow {...defaultProps} stats={null} status={null}/>);
        const cells = screen.getAllByRole('cell');
        expect(cells[3]).toHaveTextContent('N/A');
        expect(cells[4]).toHaveTextContent('N/A');
        expect(cells[5]).toHaveTextContent('N/A');
        expect(cells[6]).toHaveTextContent(/^-$/);
        expect(cells[7]).toHaveTextContent('N/A');
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });

    test('renders the swap available, 0% included, and a dash for a node without swap', () => {
        const {rerender} = render(<NodeRow {...defaultProps} stats={{swap_avail: 0, swap_total: 2048}}/>);
        expect(screen.getAllByRole('cell')[6]).toHaveTextContent(/^0%$/);
        rerender(<NodeRow {...defaultProps} stats={{swap_avail: 0, swap_total: 0}}/>);
        expect(screen.getAllByRole('cell')[6]).toHaveTextContent(/^-$/);
    });

    test('renders the load bar beside its value, with value and state', () => {
        render(<NodeRow {...defaultProps} stats={{load_15m: 5}}/>);
        const cell = screen.getByText('5').closest('td');
        const progress = within(cell).getByRole('progressbar', {name: 'Load (15m)'});
        expect(progress).toHaveAttribute('aria-valuenow', '100');
        expect(progress).toHaveAttribute('data-state', 'down');
        expect(progress.firstChild).toHaveClass('bg-state-down');
        expect(progress.firstChild).toHaveStyle({width: '100%'});
    });

    test('renders the mem bar beside its value, with value and state', () => {
        render(<NodeRow {...defaultProps} stats={{mem_avail: 10}}/>);
        const cell = screen.getByText('10%').closest('td');
        const progress = within(cell).getByRole('progressbar', {name: 'Mem Avail'});
        expect(progress).toHaveAttribute('aria-valuenow', '10');
        expect(progress).toHaveAttribute('data-state', 'down');
        expect(progress.firstChild).toHaveStyle({width: '10%'});
    });

    test('has no menu of actions: the panel of the node holds them', () => {
        render(<NodeRow {...defaultProps} />);
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    test('checkbox click stops propagation', () => {
        render(<NodeRow {...defaultProps} />);
        const checkbox = screen.getByRole('checkbox', {name: /Select node node1/i});
        const spy = jest.spyOn(Event.prototype, 'stopPropagation');
        fireEvent.click(checkbox);
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });

    describe('booted_at column', () => {
        test('renders formatted date when booted_at is valid', () => {
            render(<NodeRow {...defaultProps} status={{...defaultProps.status, booted_at: '2023-01-01T10:00:00Z'}}/>);
            expect(screen.getByText('2h ago')).toBeInTheDocument();
        });

        test('renders tooltip with full date when booted_at is valid', () => {
            const date = '2023-01-01T10:00:00Z';
            render(<NodeRow {...defaultProps} status={{...defaultProps.status, booted_at: date}}/>);
            expect(screen.getByText('2h ago')).toHaveAttribute('title', new Date(date).toLocaleString(i18n.language));
        });

        test('renders "Xd ago" when booted_at is within 7 days', () => {
            render(<NodeRow {...defaultProps} status={{...defaultProps.status, booted_at: '2022-12-30T12:00:00Z'}}/>);
            expect(screen.getByText('2d ago')).toBeInTheDocument();
        });

        test('renders locale date when booted_at is older than 7 days', () => {
            const oldDate = '2022-12-24T12:00:00Z';
            const expectedDateString = new Date(oldDate).toLocaleDateString(i18n.language);
            render(<NodeRow {...defaultProps} status={{...defaultProps.status, booted_at: oldDate}}/>);
            expect(screen.getByText(expectedDateString)).toBeInTheDocument();
        });

        test('renders "Just now" when booted_at is less than a minute ago', () => {
            render(<NodeRow {...defaultProps} status={{...defaultProps.status, booted_at: '2023-01-01T11:59:30Z'}}/>);
            expect(screen.getByText('Just now')).toBeInTheDocument();
        });

        test('renders "-" when booted_at equals the zero-value date', () => {
            render(<NodeRow {...defaultProps} status={{...defaultProps.status, booted_at: '0001-01-01T00:00:00Z'}}/>);
            const cells = screen.getAllByRole('cell');
            expect(cells[8]).toHaveTextContent(/^-$/);
        });
    });

    describe('updated_at column', () => {
        test('renders "-" when updated_at is null', () => {
            render(<NodeRow {...defaultProps} />);
            const cells = screen.getAllByRole('cell');
            expect(cells[9]).toHaveTextContent(/^-$/);
        });

        test('renders formatted date when updated_at is valid', () => {
            const date = '2023-01-01T11:30:00Z';
            render(<NodeRow {...defaultProps}
                            monitor={{...defaultProps.monitor, updated_at: date}}/>);
            expect(screen.getByText('30m ago')).toHaveAttribute('title', new Date(date).toLocaleString(i18n.language));
        });

        test('renders "Xd ago" when updated_at is within 7 days', () => {
            render(<NodeRow {...defaultProps}
                            monitor={{...defaultProps.monitor, updated_at: '2022-12-30T12:00:00Z'}}/>);
            expect(screen.getByText('2d ago')).toBeInTheDocument();
        });

        test('renders locale date when updated_at is older than 7 days', () => {
            const oldDate = '2022-12-24T12:00:00Z';
            const expectedDateString = new Date(oldDate).toLocaleDateString(i18n.language);
            render(<NodeRow {...defaultProps} monitor={{...defaultProps.monitor, updated_at: oldDate}}/>);
            expect(screen.getByText(expectedDateString)).toBeInTheDocument();
        });

        test('renders "Just now" when updated_at is less than a minute ago', () => {
            render(<NodeRow {...defaultProps}
                            monitor={{...defaultProps.monitor, updated_at: '2023-01-01T11:59:30Z'}}/>);
            expect(screen.getByText('Just now')).toBeInTheDocument();
        });

        test('renders "-" when updated_at equals the zero-value date', () => {
            render(<NodeRow {...defaultProps}
                            monitor={{...defaultProps.monitor, updated_at: '0001-01-01T00:00:00Z'}}/>);
            const cells = screen.getAllByRole('cell');
            expect(cells[9]).toHaveTextContent(/^-$/);
        });
    });

    test('renders load_15m progress bar with different states based on value', () => {
        const {rerender} = render(<NodeRow {...defaultProps} stats={{load_15m: 1}}/>);
        expect(screen.getByText('1')).toBeInTheDocument();
        expect(screen.getByRole('progressbar', {name: 'Load (15m)'})).toHaveAttribute('data-state', 'up');
        expect(screen.getByRole('progressbar', {name: 'Load (15m)'})).toHaveAttribute('aria-valuenow', '20');
        rerender(<NodeRow {...defaultProps} stats={{load_15m: 3}}/>);
        expect(screen.getByText('3')).toBeInTheDocument();
        expect(screen.getByRole('progressbar', {name: 'Load (15m)'})).toHaveAttribute('data-state', 'warn');
        rerender(<NodeRow {...defaultProps} stats={{load_15m: 5}}/>);
        expect(screen.getByText('5')).toBeInTheDocument();
        expect(screen.getByRole('progressbar', {name: 'Load (15m)'})).toHaveAttribute('data-state', 'down');
    });

    test('renders mem_avail progress bar with different states based on value', () => {
        const {rerender} = render(<NodeRow {...defaultProps} stats={{mem_avail: 10}}/>);
        expect(screen.getByText('10%')).toBeInTheDocument();
        expect(screen.getByRole('progressbar', {name: 'Mem Avail'})).toHaveAttribute('data-state', 'down');
        rerender(<NodeRow {...defaultProps} stats={{mem_avail: 30}}/>);
        expect(screen.getByText('30%')).toBeInTheDocument();
        expect(screen.getByRole('progressbar', {name: 'Mem Avail'})).toHaveAttribute('data-state', 'warn');
        rerender(<NodeRow {...defaultProps} stats={{mem_avail: 80}}/>);
        expect(screen.getByText('80%')).toBeInTheDocument();
        expect(screen.getByRole('progressbar', {name: 'Mem Avail'})).toHaveAttribute('data-state', 'up');
    });

    test('renders "-" when nodename is empty', () => {
        render(<NodeRow {...defaultProps} nodename=""/>);
        const cells = screen.getAllByRole('cell');
        expect(cells[1]).toHaveTextContent('-');
    });

    test('keeps its cells on one line', () => {
        render(<NodeRow {...defaultProps} />);
        const row = screen.getByRole('row', {name: /Node node1 row/i});
        expect(row).toHaveClass('h-[1.875rem]');
        expect(screen.getAllByRole('cell')).toHaveLength(10);
    });

    test('marks a selected row', () => {
        const {rerender} = render(<NodeRow {...defaultProps} isSelected={true}/>);
        expect(screen.getByRole('row', {name: /Node node1 row/i})).toHaveClass('bg-accent-soft');
        rerender(<NodeRow {...defaultProps} isSelected={false}/>);
        expect(screen.getByRole('row', {name: /Node node1 row/i})).not.toHaveClass('bg-accent-soft');
    });

    test('the row opens the panel of its node, its logs on a tab of it; its controls act on their own', () => {
        const onOpen = jest.fn();
        render(<table><tbody><NodeRow {...defaultProps} onOpen={onOpen} isOpen/></tbody></table>);
        const row = screen.getByRole('row', {name: /node1/});
        expect(row).toHaveAttribute('aria-current', 'true');
        fireEvent.click(screen.getByText('node1'));
        expect(onOpen).toHaveBeenCalledWith('node1');

        onOpen.mockClear();
        fireEvent.click(screen.getByRole('checkbox'));
        expect(onOpen).not.toHaveBeenCalled();

        fireEvent.keyDown(row, {key: 'Enter'});
        expect(onOpen).toHaveBeenCalledWith('node1');
    });
});
