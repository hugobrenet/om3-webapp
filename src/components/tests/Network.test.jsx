import React from 'react';
import {render, screen, waitFor, fireEvent, within} from '@testing-library/react';
import '@testing-library/jest-dom';
import {MemoryRouter} from 'react-router-dom';
import axios from 'axios';
import {vi, describe, test, expect, beforeEach, afterEach} from 'vitest';
import Network from '../Network';
import i18n from '../../i18n';
import {URL_NETWORK} from '../../config/apiPath.js';

// Mock axios
vi.mock('axios', () => ({
    default: {
        get: vi.fn(),
    },
}));

// The panel of a network, on its own tested elsewhere: here, which network it is given.
vi.mock('../RecordPanels', () => ({
    NetworkDetailPanel: ({name, onClose}) => (name ? (
        <div data-testid="network-panel">{name}<button onClick={onClose}>close</button></div>
    ) : null),
}));

// Mock useNavigate from react-router-dom
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useNavigate: () => mockNavigate,
    };
});

// Mock localStorage
const mockLocalStorage = {
    getItem: vi.fn(),
};
Object.defineProperty(window, 'localStorage', {
    value: mockLocalStorage,
});

// Sample network data for testing
const mockNetworks = [
    {name: 'lo', type: 'loopback', network: '127.0.0.0/8', size: 100, used: 50, free: 50},
    {name: 'default', type: 'bridge', network: '192.168.1.0/24', size: 200, used: 100, free: 100},
    {name: 'test', type: 'overlay', network: '10.0.0.0/24', size: 100, used: 90, free: 10},
    {name: 'mid', type: 'bridge', network: '172.16.0.0/16', size: 100, used: 60, free: 40},
];

// The usage bar is a progressbar named after its network, carrying data-state; its fill is its child.
const usageBar = (row) => within(row).queryByRole('progressbar');

describe('Network Component', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockLocalStorage.getItem.mockReturnValue('mock-token');
    });

    test('renders table headers correctly', () => {
        render(<Network/>, {wrapper: MemoryRouter});
        const headers = screen.getAllByRole('columnheader').map((h) => h.textContent.replace(/[▲▼]/g, '').trim());
        expect(headers).toEqual(['Name', 'Type', 'Network', 'Usage']);
        ['Name', 'Type', 'Network', 'Usage'].forEach((name) => {
            expect(screen.getByRole('button', {name})).toBeInTheDocument();
        });
        // Default sort: name ascending
        expect(screen.getByRole('columnheader', {name: 'Name'})).toHaveAttribute('aria-sort', 'ascending');
        expect(screen.getByRole('columnheader', {name: 'Usage'})).toHaveAttribute('aria-sort', 'none');
        expect(screen.getByRole('table', {name: 'Networks'})).toBeInTheDocument();
    });

    test('speaks French to a French browser', async () => {
        axios.get.mockResolvedValueOnce({data: {items: []}});
        await i18n.changeLanguage('fr');
        try {
            render(<Network/>, {wrapper: MemoryRouter});
            expect(screen.getByRole('columnheader', {name: 'Réseau'})).toBeInTheDocument();
            expect(screen.getByText('Aucun réseau disponible.')).toBeInTheDocument();
        } finally {
            await i18n.changeLanguage('en');
        }
    });

    test('displays network data correctly when API call succeeds', async () => {
        axios.get.mockResolvedValueOnce({data: {items: mockNetworks}});

        render(<Network/>, {wrapper: MemoryRouter});

        await waitFor(() => {
            expect(screen.getByText('lo')).toBeInTheDocument();
        });

        // Check lo data (sorted first)
        const loRow = screen.getByRole('row', {name: /lo/i});
        expect(loRow).toHaveTextContent('lo');
        await waitFor(() => {
            expect(loRow).toHaveTextContent('loopback');
        });
        await waitFor(() => {
            expect(loRow).toHaveTextContent('127.0.0.0/8');
        });
        await waitFor(() => {
            expect(loRow).toHaveTextContent('50.0%');
        });
        await waitFor(() => {
            expect(usageBar(loRow)).toBeInTheDocument();
        });

        const defaultRow = screen.getByRole('row', {name: /default/i});
        expect(defaultRow).toHaveTextContent('default');
        await waitFor(() => {
            expect(defaultRow).toHaveTextContent('bridge');
        });
        await waitFor(() => {
            expect(defaultRow).toHaveTextContent('192.168.1.0/24');
        });
        await waitFor(() => {
            expect(defaultRow).toHaveTextContent('50.0%');
        });
        await waitFor(() => {
            expect(usageBar(defaultRow)).toBeInTheDocument();
        });

        expect(axios.get).toHaveBeenCalledWith(URL_NETWORK, {
            headers: {Authorization: 'Bearer mock-token'},
        });
    });

    test('displays tooltip with used/size on percentage and progress bar', async () => {
        axios.get.mockResolvedValueOnce({data: {items: mockNetworks}});

        render(<Network/>, {wrapper: MemoryRouter});

        await waitFor(() => {
            expect(screen.getByText('lo')).toBeInTheDocument();
        });

        // The title covers both the percentage and the bar beside it
        const loRow = screen.getByRole('row', {name: /lo/i});
        const loUsage = within(loRow).getByTitle('50/100');
        expect(loUsage).toContainElement(within(loRow).getByText('50.0%'));
        expect(loUsage).toContainElement(usageBar(loRow));

        const defaultRow = screen.getByRole('row', {name: /default/i});
        const defaultUsage = within(defaultRow).getByTitle('100/200');
        expect(defaultUsage).toContainElement(within(defaultRow).getByText('50.0%'));
        expect(defaultUsage).toContainElement(usageBar(defaultRow));
    });

    test('handles API error gracefully', async () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {
        });
        axios.get.mockRejectedValueOnce(new Error('API Error'));

        render(<Network/>, {wrapper: MemoryRouter});

        await waitFor(() => {
            expect(consoleErrorSpy).toHaveBeenCalledWith('Error retrieving networks', expect.any(Error));
        });

        await waitFor(() => {
            expect(screen.getByText('No networks available.')).toBeInTheDocument();
        });

        await waitFor(() => {
            expect(screen.queryByText('lo')).not.toBeInTheDocument();
        });

        await waitFor(() => {
            expect(screen.queryByText('default')).not.toBeInTheDocument();
        });

        consoleErrorSpy.mockRestore();
    });

    test('displays N/A for usage when size is zero', async () => {
        const networksWithZeroSize = [
            {name: 'test', type: 'bridge', network: '10.0.0.0/24', size: 0, used: 10, free: 0},
        ];
        axios.get.mockResolvedValueOnce({data: {items: networksWithZeroSize}});

        render(<Network/>, {wrapper: MemoryRouter});

        await waitFor(() => {
            expect(screen.getByText('test')).toBeInTheDocument();
        });

        const testRow = screen.getByRole('row', {name: /test/i});
        const usageCell = within(testRow).getByText('N/A');
        await waitFor(() => {
            expect(usageCell).toHaveTextContent('N/A');
        });
        await waitFor(() => {
            expect(usageBar(testRow)).toBeNull();
        });
    });

    test('calls API with correct authorization token', async () => {
        axios.get.mockResolvedValueOnce({data: {items: []}});

        render(<Network/>, {wrapper: MemoryRouter});

        await waitFor(() => {
            expect(axios.get).toHaveBeenCalledWith(URL_NETWORK, {
                headers: {Authorization: 'Bearer mock-token'},
            });
        });
    });

    test('sorts networks alphabetically by name in ascending order by default', async () => {
        const unsortedNetworks = [
            {name: 'zebra', type: 'bridge', network: '10.0.0.0/24', size: 100, used: 50, free: 50},
            {name: 'apple', type: 'loopback', network: '127.0.0.0/8', size: 100, used: 50, free: 50},
        ];
        axios.get.mockResolvedValueOnce({data: {items: unsortedNetworks}});

        render(<Network/>, {wrapper: MemoryRouter});

        await waitFor(() => {
            expect(screen.getByText('apple')).toBeInTheDocument();
        });

        await waitFor(() => {
            expect(screen.getByText('zebra')).toBeInTheDocument();
        });

        const rows = screen.getAllByRole('row');
        const appleRow = rows.find(row => row.textContent.includes('apple'));
        const zebraRow = rows.find(row => row.textContent.includes('zebra'));

        expect(appleRow).toBeInTheDocument();
        expect(zebraRow).toBeInTheDocument();
        expect(rows.indexOf(appleRow)).toBeLessThan(rows.indexOf(zebraRow));
    });

    test('sorts networks alphabetically by name in descending order', async () => {
        const unsortedNetworks = [
            {name: 'zebra', type: 'bridge', network: '10.0.0.0/24', size: 100, used: 50, free: 50},
            {name: 'apple', type: 'loopback', network: '127.0.0.0/8', size: 100, used: 50, free: 50},
        ];
        axios.get.mockResolvedValueOnce({data: {items: unsortedNetworks}});

        render(<Network/>, {wrapper: MemoryRouter});

        await waitFor(() => {
            expect(screen.getByText('apple')).toBeInTheDocument();
        });

        const nameHeader = screen.getByRole('button', {name: 'Name'});
        fireEvent.click(nameHeader);

        await waitFor(() => {
            const rows = screen.getAllByRole('row');
            const appleRow = rows.find(row => row.textContent.includes('apple'));
            const zebraRow = rows.find(row => row.textContent.includes('zebra'));
            expect(rows.indexOf(zebraRow)).toBeLessThan(rows.indexOf(appleRow));
        });
    });

    test('sorts networks by type in ascending order', async () => {
        const unsortedNetworks = [
            {name: 'zebra', type: 'loopback', network: '10.0.0.0/24', size: 100, used: 50, free: 50},
            {name: 'apple', type: 'bridge', network: '127.0.0.0/8', size: 100, used: 50, free: 50},
        ];
        axios.get.mockResolvedValueOnce({data: {items: unsortedNetworks}});

        render(<Network/>, {wrapper: MemoryRouter});

        await waitFor(() => {
            expect(screen.getByText('apple')).toBeInTheDocument();
        });

        const typeHeader = screen.getByRole('button', {name: 'Type'});
        fireEvent.click(typeHeader);

        await waitFor(() => {
            expect(screen.getByText('bridge')).toBeInTheDocument();
        });

        await waitFor(() => {
            expect(screen.getByText('loopback')).toBeInTheDocument();
        });

        const rows = screen.getAllByRole('row');
        const appleRow = rows.find(row => row.textContent.includes('bridge')); // apple has type 'bridge'
        const zebraRow = rows.find(row => row.textContent.includes('loopback')); // zebra has type 'loopback'

        expect(appleRow).toBeInTheDocument();
        expect(zebraRow).toBeInTheDocument();
        expect(rows.indexOf(appleRow)).toBeLessThan(rows.indexOf(zebraRow)); // bridge < loopback
    });

    test('sorts networks by type in descending order', async () => {
        const unsortedNetworks = [
            {name: 'zebra', type: 'loopback', network: '10.0.0.0/24', size: 100, used: 50, free: 50},
            {name: 'apple', type: 'bridge', network: '127.0.0.0/8', size: 100, used: 50, free: 50},
        ];
        axios.get.mockResolvedValueOnce({data: {items: unsortedNetworks}});

        render(<Network/>, {wrapper: MemoryRouter});

        await waitFor(() => {
            expect(screen.getByText('apple')).toBeInTheDocument();
        });

        const typeHeader = screen.getByRole('button', {name: 'Type'});
        fireEvent.click(typeHeader); // to asc
        fireEvent.click(typeHeader); // to desc

        await waitFor(() => {
            const rows = screen.getAllByRole('row');
            const appleRow = rows.find(row => row.textContent.includes('bridge'));
            const zebraRow = rows.find(row => row.textContent.includes('loopback'));
            expect(rows.indexOf(zebraRow)).toBeLessThan(rows.indexOf(appleRow)); // loopback > bridge
        });
    });

    test('sorts networks by network in ascending order', async () => {
        const unsortedNetworks = [
            {name: 'zebra', type: 'bridge', network: '192.168.1.0/24', size: 100, used: 50, free: 50},
            {name: 'apple', type: 'loopback', network: '127.0.0.0/8', size: 100, used: 50, free: 50},
        ];
        axios.get.mockResolvedValueOnce({data: {items: unsortedNetworks}});

        render(<Network/>, {wrapper: MemoryRouter});

        await waitFor(() => {
            expect(screen.getByText('apple')).toBeInTheDocument();
        });

        const networkHeader = screen.getByRole('button', {name: 'Network'});
        fireEvent.click(networkHeader);

        await waitFor(() => {
            expect(screen.getByText('127.0.0.0/8')).toBeInTheDocument();
        });

        await waitFor(() => {
            expect(screen.getByText('192.168.1.0/24')).toBeInTheDocument();
        });

        const rows = screen.getAllByRole('row');
        const appleRow = rows.find(row => row.textContent.includes('127.0.0.0/8'));
        const zebraRow = rows.find(row => row.textContent.includes('192.168.1.0/24'));

        expect(appleRow).toBeInTheDocument();
        expect(zebraRow).toBeInTheDocument();
        expect(rows.indexOf(appleRow)).toBeLessThan(rows.indexOf(zebraRow)); // 127.0.0.0/8 < 192.168.1.0/24
    });

    test('sorts networks by network in descending order', async () => {
        const unsortedNetworks = [
            {name: 'zebra', type: 'bridge', network: '192.168.1.0/24', size: 100, used: 50, free: 50},
            {name: 'apple', type: 'loopback', network: '127.0.0.0/8', size: 100, used: 50, free: 50},
        ];
        axios.get.mockResolvedValueOnce({data: {items: unsortedNetworks}});

        render(<Network/>, {wrapper: MemoryRouter});

        await waitFor(() => {
            expect(screen.getByText('apple')).toBeInTheDocument();
        });

        const networkHeader = screen.getByRole('button', {name: 'Network'});
        fireEvent.click(networkHeader); // to asc
        fireEvent.click(networkHeader); // to desc

        await waitFor(() => {
            const rows = screen.getAllByRole('row');
            const appleRow = rows.find(row => row.textContent.includes('127.0.0.0/8'));
            const zebraRow = rows.find(row => row.textContent.includes('192.168.1.0/24'));
            expect(rows.indexOf(zebraRow)).toBeLessThan(rows.indexOf(appleRow)); // 192 > 127
        });
    });

    test('sorts networks by usage in ascending order', async () => {
        const unsortedNetworks = [
            {name: 'zebra', type: 'bridge', network: '10.0.0.0/24', size: 100, used: 90, free: 10}, // 90%
            {name: 'apple', type: 'loopback', network: '127.0.0.0/8', size: 100, used: 50, free: 50}, // 50%
        ];
        axios.get.mockResolvedValueOnce({data: {items: unsortedNetworks}});

        render(<Network/>, {wrapper: MemoryRouter});

        await waitFor(() => {
            expect(screen.getByText('apple')).toBeInTheDocument();
        });

        const usageHeader = screen.getByRole('button', {name: 'Usage'});
        fireEvent.click(usageHeader);

        await waitFor(() => {
            expect(screen.getByText('50.0%')).toBeInTheDocument();
        });

        await waitFor(() => {
            expect(screen.getByText('90.0%')).toBeInTheDocument();
        });

        const rows = screen.getAllByRole('row');
        const appleRow = rows.find(row => row.textContent.includes('50.0%'));
        const zebraRow = rows.find(row => row.textContent.includes('90.0%'));

        expect(appleRow).toBeInTheDocument();
        expect(zebraRow).toBeInTheDocument();
        expect(rows.indexOf(appleRow)).toBeLessThan(rows.indexOf(zebraRow)); // 50% < 90%
    });

    test('sorts networks by usage in descending order', async () => {
        const unsortedNetworks = [
            {name: 'zebra', type: 'bridge', network: '10.0.0.0/24', size: 100, used: 90, free: 10}, // 90%
            {name: 'apple', type: 'loopback', network: '127.0.0.0/8', size: 100, used: 50, free: 50}, // 50%
        ];
        axios.get.mockResolvedValueOnce({data: {items: unsortedNetworks}});

        render(<Network/>, {wrapper: MemoryRouter});

        await waitFor(() => {
            expect(screen.getByText('apple')).toBeInTheDocument();
        });

        const usageHeader = screen.getByRole('button', {name: 'Usage'});
        fireEvent.click(usageHeader); // to asc
        fireEvent.click(usageHeader); // to desc

        await waitFor(() => {
            const rows = screen.getAllByRole('row');
            const appleRow = rows.find(row => row.textContent.includes('50.0%'));
            const zebraRow = rows.find(row => row.textContent.includes('90.0%'));
            expect(rows.indexOf(zebraRow)).toBeLessThan(rows.indexOf(appleRow)); // 90% > 50%
        });
    });

    test('sets progress bar color to success when usage <= 50%', async () => {
        axios.get.mockResolvedValueOnce({data: {items: mockNetworks}});

        render(<Network/>, {wrapper: MemoryRouter});

        await waitFor(() => {
            expect(screen.getByText('lo')).toBeInTheDocument();
        });

        const loRow = screen.getByRole('row', {name: /lo/i});
        const bar = usageBar(loRow);
        const fill = bar.firstElementChild;
        expect(bar).toHaveAccessibleName('Usage of lo');
        expect(bar).toHaveAttribute('aria-valuenow', '50');
        expect(bar).toHaveAttribute('data-state', 'up');
        expect(fill).toHaveClass('bg-state-up');
        expect(fill).toHaveStyle({width: '50%'});
    });

    test('sets progress bar color to warning when usage > 50% and <= 80%', async () => {
        axios.get.mockResolvedValueOnce({data: {items: mockNetworks}});

        render(<Network/>, {wrapper: MemoryRouter});

        await waitFor(() => {
            expect(screen.getByText('mid')).toBeInTheDocument();
        });

        const midRow = screen.getByRole('row', {name: /mid/i});
        const bar = usageBar(midRow);
        const fill = bar.firstElementChild;
        expect(bar).toHaveAttribute('data-state', 'warn');
        expect(fill).toHaveClass('bg-state-warn');
        expect(fill).toHaveStyle({width: '60%'});
    });

    test('sets progress bar color to error when usage > 80%', async () => {
        axios.get.mockResolvedValueOnce({data: {items: mockNetworks}});

        render(<Network/>, {wrapper: MemoryRouter});

        await waitFor(() => {
            expect(screen.getByText('test')).toBeInTheDocument();
        });

        const testRow = screen.getByRole('row', {name: /test/i});
        const bar = usageBar(testRow);
        const fill = bar.firstElementChild;
        expect(bar).toHaveAttribute('data-state', 'down');
        expect(fill).toHaveClass('bg-state-down');
        expect(fill).toHaveStyle({width: '90%'});
    });

    test('handles usage > 100% by capping progress bar at 100%', async () => {
        const networksWithOverUsage = [
            {name: 'over', type: 'bridge', network: '10.0.0.0/24', size: 100, used: 120, free: -20},
        ];
        axios.get.mockResolvedValueOnce({data: {items: networksWithOverUsage}});

        render(<Network/>, {wrapper: MemoryRouter});

        await waitFor(() => {
            expect(screen.getByText('over')).toBeInTheDocument();
        });

        const overRow = screen.getByRole('row', {name: /over/i});
        expect(overRow).toHaveTextContent('120.0%');
        const bar = usageBar(overRow);
        const fill = bar.firstElementChild;
        expect(fill).toHaveStyle({width: '100%'});
        expect(bar).toHaveAttribute('data-state', 'down');

        expect(within(overRow).getByTitle('120/100')).toContainElement(within(overRow).getByText('120.0%'));
    });

    test('opens the network panel over the list on row click', async () => {
        axios.get.mockResolvedValueOnce({data: {items: mockNetworks}});

        render(<Network/>, {wrapper: MemoryRouter});

        await waitFor(() => {
            expect(screen.getByText('lo')).toBeInTheDocument();
        });

        const loRow = screen.getByRole('row', {name: /lo/i});
        fireEvent.click(loRow);
        expect(await screen.findByTestId('network-panel')).toHaveTextContent('lo');
        expect(loRow).toHaveAttribute('aria-current', 'true');

        fireEvent.click(screen.getByRole('row', {name: /default/i}));
        expect(await screen.findByTestId('network-panel')).toHaveTextContent('default');
        expect(mockNavigate).not.toHaveBeenCalled();
    });

    test('opens the network panel with the keyboard', async () => {
        axios.get.mockResolvedValueOnce({data: {items: mockNetworks}});

        render(<Network/>, {wrapper: MemoryRouter});

        await waitFor(() => {
            expect(screen.getByText('lo')).toBeInTheDocument();
        });

        const loRow = screen.getByRole('row', {name: /lo/i});
        expect(loRow).toHaveAttribute('tabindex', '0');
        fireEvent.keyDown(loRow, {key: 'Enter'});
        expect(await screen.findByTestId('network-panel')).toHaveTextContent('lo');
    });

    test('the panel of the network in the URL is open, and closes', async () => {
        axios.get.mockResolvedValueOnce({data: {items: mockNetworks}});

        render(
            <MemoryRouter initialEntries={['/network?sel=lo']}>
                <Network/>
            </MemoryRouter>
        );

        expect(await screen.findByTestId('network-panel')).toHaveTextContent('lo');
        fireEvent.click(screen.getByRole('button', {name: 'close'}));
        await waitFor(() => expect(screen.queryByTestId('network-panel')).not.toBeInTheDocument());
    });

    test('toggles the sort direction and marks the sorted column', async () => {
        axios.get.mockResolvedValueOnce({data: {items: mockNetworks}});

        render(<Network/>, {wrapper: MemoryRouter});

        await waitFor(() => {
            expect(screen.getByText('lo')).toBeInTheDocument();
        });

        const header = (name) => screen.getByRole('columnheader', {name});
        fireEvent.click(screen.getByRole('button', {name: 'Name'}));
        expect(header('Name')).toHaveAttribute('aria-sort', 'descending');

        fireEvent.click(screen.getByRole('button', {name: 'Usage'}));
        expect(header('Usage')).toHaveAttribute('aria-sort', 'ascending');
        expect(header('Name')).toHaveAttribute('aria-sort', 'none');

        fireEvent.click(screen.getByRole('button', {name: 'Usage'}));
        expect(header('Usage')).toHaveAttribute('aria-sort', 'descending');
    });
});
