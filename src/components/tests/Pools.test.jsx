import React from 'react';
import {render, screen, waitFor, fireEvent, within} from '@testing-library/react';
import '@testing-library/jest-dom';
import {vi, describe, test, expect, beforeEach, afterEach} from 'vitest';
import axios from 'axios';
import Pools from '../Pools';
import i18n from '../../i18n';
import {URL_POOL} from '../../config/apiPath.js';

// ── Mocks ──────────────────────────────────────────────────────────────
vi.mock('axios', () => ({
    default: {
        get: vi.fn(),
    },
}));

// Mock localStorage
const mockLocalStorage = {
    getItem: vi.fn(),
};
Object.defineProperty(window, 'localStorage', {
    value: mockLocalStorage,
});

// Sample pool data
const mockPools = [
    {name: 'pool1', type: 'zfs', volume_count: 5, used: 50, size: 100, head: 'node1'},
    {name: 'pool2', type: 'lvm', volume_count: 3, used: 0, size: 200, head: 'node2'},
    {name: 'pool3', type: 'ext4', volume_count: 10, used: 75, size: 100, head: 'node3'},
];

const sortButton = (name) => screen.getByRole('button', {name});
const header = (name) => screen.getByRole('columnheader', {name});

/** The cells saying N/A, whatever element holds the words. */
const naCells = () => screen.getAllByRole('cell').filter((cell) => cell.textContent === 'N/A');

describe('Pools Component', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockLocalStorage.getItem.mockReturnValue('mock-token');
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    test('renders table headers correctly', async () => {
        axios.get.mockResolvedValueOnce({data: {items: []}});

        render(<Pools/>);

        await waitFor(() => {
            const headers = screen.getAllByRole('columnheader').map((h) => h.textContent.replace(/[▲▼]/g, '').trim());
            expect(headers).toEqual(['Name', 'Type', 'Volume Count', 'Usage', 'Head']);
        });
        // Default sort: name ascending, the other columns unsorted
        expect(header('Name')).toHaveAttribute('aria-sort', 'ascending');
        expect(header('Type')).toHaveAttribute('aria-sort', 'none');
        expect(screen.getByRole('table', {name: 'Pools'})).toBeInTheDocument();
    });

    test('speaks French to a French browser', async () => {
        axios.get.mockRejectedValueOnce(new Error('Network error'));
        await i18n.changeLanguage('fr');
        try {
            render(<Pools/>);
            expect(await screen.findByText('Échec du chargement des pools. Veuillez réessayer.')).toBeInTheDocument();
            expect(screen.getByRole('button', {name: 'Réessayer'})).toBeInTheDocument();
        } finally {
            await i18n.changeLanguage('en');
        }
    });

    test('displays pool data correctly when API call succeeds', async () => {
        axios.get.mockResolvedValueOnce({data: {items: mockPools}});

        render(<Pools/>);

        await waitFor(() => {
            expect(screen.getByText('pool1')).toBeInTheDocument();
            expect(screen.getByText('zfs')).toBeInTheDocument();
            expect(screen.getByText('5')).toBeInTheDocument();
            expect(screen.getByText('50.0%')).toBeInTheDocument();
            expect(screen.getByText('node1')).toBeInTheDocument();

            expect(screen.getByText('pool2')).toBeInTheDocument();
            expect(screen.getByText('lvm')).toBeInTheDocument();
            expect(screen.getByText('3')).toBeInTheDocument();
            expect(screen.getByText('0.0%')).toBeInTheDocument();
            expect(screen.getByText('node2')).toBeInTheDocument();

            expect(screen.getByText('pool3')).toBeInTheDocument();
            expect(screen.getByText('ext4')).toBeInTheDocument();
            expect(screen.getByText('10')).toBeInTheDocument();
            expect(screen.getByText('75.0%')).toBeInTheDocument();
            expect(screen.getByText('node3')).toBeInTheDocument();
        });

        expect(axios.get).toHaveBeenCalledWith(URL_POOL, {
            headers: {Authorization: 'Bearer mock-token'},
        });
    });

    test('handles API error gracefully', async () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {
        });
        axios.get.mockRejectedValueOnce(new Error('API Error'));

        render(<Pools/>);

        await waitFor(() => {
            expect(consoleErrorSpy).toHaveBeenCalledWith('Error retrieving pools', expect.any(Error));
            expect(screen.queryByText('pool1')).not.toBeInTheDocument();
            expect(screen.queryByText('pool2')).not.toBeInTheDocument();

            const alert = screen.getByRole('alert');
            expect(alert).toHaveClass('text-state-down');
            expect(within(alert).getByText('Failed to load pools. Please try again.')).toBeInTheDocument();
            expect(within(alert).getByRole('button', {name: /retry/i})).toBeInTheDocument();
        });

        consoleErrorSpy.mockRestore();
    });

    test('does not update state when component is unmounted during API error', async () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {
        });
        axios.get.mockImplementationOnce(
            () =>
                new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('API Error')), 100);
                })
        );

        const {unmount} = render(<Pools/>);
        unmount();

        await new Promise((resolve) => setTimeout(resolve, 150));

        expect(consoleErrorSpy).toHaveBeenCalledWith('Error retrieving pools', expect.any(Error));
        expect(screen.queryByText('Failed to load pools. Please try again.')).not.toBeInTheDocument();

        consoleErrorSpy.mockRestore();
    });

    test('displays N/A for usage when used is negative', async () => {
        const poolsWithNegativeUsed = [
            {name: 'pool4', type: 'zfs', volume_count: 2, used: -10, size: 100, head: 'node4'},
        ];
        axios.get.mockResolvedValueOnce({data: {items: poolsWithNegativeUsed}});

        render(<Pools/>);

        await waitFor(() => {
            expect(screen.getByText('pool4')).toBeInTheDocument();
        });

        // N/A in the slot of the value, an empty track in the place of the bar.
        expect(naCells()).toHaveLength(1);
        expect(within(naCells()[0]).queryByRole('progressbar')).not.toBeInTheDocument();
    });

    test('handles pools with missing properties', async () => {
        const poolsWithMissingProps = [
            {name: null, type: undefined, volume_count: null, used: undefined, size: null, head: undefined},
        ];
        axios.get.mockResolvedValueOnce({data: {items: poolsWithMissingProps}});

        render(<Pools/>);

        await waitFor(() => {
            expect(naCells().length).toBe(5);
        });
    });

    test('handles API response with null items', async () => {
        axios.get.mockResolvedValueOnce({data: {items: null}});

        render(<Pools/>);

        await waitFor(() => {
            expect(screen.getByText('No pools available.')).toBeInTheDocument();
        });
    });

    test('calls API with correct authorization token', async () => {
        axios.get.mockResolvedValueOnce({data: {items: []}});

        render(<Pools/>);

        await waitFor(() => {
            expect(axios.get).toHaveBeenCalledWith(URL_POOL, {
                headers: {Authorization: 'Bearer mock-token'},
            });
        });
    });

    test('displays "No pools available." when API returns an empty list', async () => {
        axios.get.mockResolvedValueOnce({data: {items: []}});

        render(<Pools/>);

        await waitFor(() => {
            expect(screen.getByText('No pools available.')).toBeInTheDocument();
        });
    });

    test('displays error and allows retry on failure', async () => {
        axios.get.mockRejectedValueOnce(new Error('API Error'));

        render(<Pools/>);

        await waitFor(() => {
            expect(screen.getByText('Failed to load pools. Please try again.')).toBeInTheDocument();
            expect(screen.getByRole('button', {name: /retry/i})).toBeInTheDocument();
        });

        // Second call succeeds
        axios.get.mockResolvedValueOnce({data: {items: mockPools}});

        const retryButton = screen.getByRole('button', {name: /retry/i});
        fireEvent.click(retryButton);

        await waitFor(() => {
            expect(screen.getByText('pool1')).toBeInTheDocument();
            expect(screen.getByText('pool2')).toBeInTheDocument();
            expect(screen.getByText('pool3')).toBeInTheDocument();
            expect(screen.queryByText('Failed to load pools. Please try again.')).not.toBeInTheDocument();
        });

        expect(axios.get).toHaveBeenCalledTimes(2);
    });

    test('handles retry with missing auth token', async () => {
        axios.get.mockRejectedValueOnce(new Error('API Error'));

        render(<Pools/>);

        await waitFor(() => {
            expect(screen.getByText('Failed to load pools. Please try again.')).toBeInTheDocument();
        });

        mockLocalStorage.getItem.mockReturnValue(null);
        axios.get.mockRejectedValueOnce(new Error('No Token'));

        const retryButton = screen.getByRole('button', {name: /retry/i});
        fireEvent.click(retryButton);

        await waitFor(() => {
            expect(screen.getByRole('status')).toHaveTextContent('Loading pools');
        });

        await waitFor(() => {
            expect(screen.getByText('Failed to load pools. Please try again.')).toBeInTheDocument();
        });

        expect(axios.get).toHaveBeenCalledWith(URL_POOL, {
            headers: {Authorization: 'Bearer null'},
        });
        expect(axios.get).toHaveBeenCalledTimes(2);
    });

    test('sorts table by different columns', async () => {
        axios.get.mockResolvedValueOnce({data: {items: mockPools}});

        render(<Pools/>);

        await waitFor(() => {
            expect(screen.getByText('pool1')).toBeInTheDocument();
        });

        const getRows = () => screen.getAllByRole('row', {name: /pool[1-3]/});

        // initial name asc
        await waitFor(() => {
            const rows = getRows();
            expect(within(rows[0]).getByText('pool1')).toBeInTheDocument();
            expect(within(rows[1]).getByText('pool2')).toBeInTheDocument();
            expect(within(rows[2]).getByText('pool3')).toBeInTheDocument();
            expect(header('Name')).toHaveAttribute('aria-sort', 'ascending');
        });

        // name desc
        fireEvent.click(sortButton('Name'));
        await waitFor(() => {
            const rows = getRows();
            expect(within(rows[0]).getByText('pool3')).toBeInTheDocument();
            expect(within(rows[1]).getByText('pool2')).toBeInTheDocument();
            expect(within(rows[2]).getByText('pool1')).toBeInTheDocument();
            expect(header('Name')).toHaveAttribute('aria-sort', 'descending');
        });

        fireEvent.click(sortButton('Name'));
        await waitFor(() => {
            const rows = getRows();
            expect(within(rows[0]).getByText('pool1')).toBeInTheDocument();
            expect(within(rows[1]).getByText('pool2')).toBeInTheDocument();
            expect(within(rows[2]).getByText('pool3')).toBeInTheDocument();
            expect(header('Name')).toHaveAttribute('aria-sort', 'ascending');
        });

        // type asc
        fireEvent.click(sortButton('Type'));
        await waitFor(() => {
            const rows = getRows();
            expect(within(rows[0]).getByText('pool3')).toBeInTheDocument(); // ext4
            expect(within(rows[1]).getByText('pool2')).toBeInTheDocument(); // lvm
            expect(within(rows[2]).getByText('pool1')).toBeInTheDocument(); // zfs
            expect(header('Type')).toHaveAttribute('aria-sort', 'ascending');
        });

        // type desc
        fireEvent.click(sortButton('Type'));
        await waitFor(() => {
            const rows = getRows();
            expect(within(rows[0]).getByText('pool1')).toBeInTheDocument(); // zfs
            expect(header('Type')).toHaveAttribute('aria-sort', 'descending');
        });

        // volume_count asc
        fireEvent.click(sortButton('Volume Count'));
        await waitFor(() => {
            const rows = getRows();
            expect(within(rows[0]).getByText('pool2')).toBeInTheDocument(); // 3
            expect(within(rows[1]).getByText('pool1')).toBeInTheDocument(); // 5
            expect(within(rows[2]).getByText('pool3')).toBeInTheDocument(); // 10
            expect(header('Volume Count')).toHaveAttribute('aria-sort', 'ascending');
        });

        // volume_count desc
        fireEvent.click(sortButton('Volume Count'));
        await waitFor(() => {
            const rows = getRows();
            expect(within(rows[0]).getByText('pool3')).toBeInTheDocument(); // 10
            expect(header('Volume Count')).toHaveAttribute('aria-sort', 'descending');
        });

        // usage asc
        fireEvent.click(sortButton('Usage'));
        await waitFor(() => {
            const rows = getRows();
            expect(within(rows[0]).getByText('pool2')).toBeInTheDocument(); // 0.0%
            expect(within(rows[1]).getByText('pool1')).toBeInTheDocument(); // 50.0%
            expect(within(rows[2]).getByText('pool3')).toBeInTheDocument(); // 75.0%
            expect(header('Usage')).toHaveAttribute('aria-sort', 'ascending');
        });

        // usage desc
        fireEvent.click(sortButton('Usage'));
        await waitFor(() => {
            const rows = getRows();
            expect(within(rows[0]).getByText('pool3')).toBeInTheDocument(); // 75.0%
            expect(header('Usage')).toHaveAttribute('aria-sort', 'descending');
        });

        // head asc
        fireEvent.click(sortButton('Head'));
        await waitFor(() => {
            const rows = getRows();
            expect(within(rows[0]).getByText('pool1')).toBeInTheDocument(); // node1
            expect(within(rows[1]).getByText('pool2')).toBeInTheDocument(); // node2
            expect(within(rows[2]).getByText('pool3')).toBeInTheDocument(); // node3
            expect(header('Head')).toHaveAttribute('aria-sort', 'ascending');
        });

        // head desc
        fireEvent.click(sortButton('Head'));
        await waitFor(() => {
            const rows = getRows();
            expect(within(rows[0]).getByText('pool3')).toBeInTheDocument(); // node3
            expect(header('Head')).toHaveAttribute('aria-sort', 'descending');
        });
    });

    test('handles usage calculation with zero size', async () => {
        const poolsWithZeroSize = [
            {name: 'pool5', type: 'zfs', volume_count: 2, used: 10, size: 0, head: 'node5'},
        ];
        axios.get.mockResolvedValueOnce({data: {items: poolsWithZeroSize}});

        render(<Pools/>);

        await waitFor(() => {
            expect(screen.getByText('pool5')).toBeInTheDocument();
            expect(naCells()).toHaveLength(1);
        });
    });

    test('renders Alert component with correct properties on API error', async () => {
        axios.get.mockRejectedValueOnce(new Error('API Error'));

        render(<Pools/>);

        await waitFor(() => {
            const alert = screen.getByRole('alert');
            expect(alert).toHaveClass('text-state-down');
            expect(within(alert).getByText('Failed to load pools. Please try again.')).toBeInTheDocument();

            const retryButton = within(alert).getByRole('button', {name: /retry/i});
            expect(retryButton).toHaveAttribute('type', 'button');
            expect(retryButton).toHaveClass('h-7');
        });

        // Retry fails again
        axios.get.mockRejectedValueOnce(new Error('Retry Failed'));
        const retryButton = screen.getByRole('button', {name: /retry/i});
        fireEvent.click(retryButton);

        await waitFor(() => {
            expect(screen.getByRole('status')).toHaveTextContent('Loading pools');
        });

        await waitFor(() => {
            expect(screen.getByText('Failed to load pools. Please try again.')).toBeInTheDocument();
            expect(screen.getByRole('button', {name: /retry/i})).toBeInTheDocument();
        });

        expect(axios.get).toHaveBeenCalledTimes(2);
    });

    test('covers sort fallback for missing name/type/head', async () => {
        const poolsWithMissingStrings = [
            {name: null, type: 'zfs', volume_count: 5, used: 50, size: 100, head: 'node1'},
            {name: 'pool2', type: null, volume_count: 3, used: 0, size: 200, head: null},
            {name: 'pool3', type: 'ext4', volume_count: 10, used: 75, size: 100, head: 'node3'},
        ];
        axios.get.mockResolvedValueOnce({data: {items: poolsWithMissingStrings}});

        render(<Pools/>);
        await waitFor(() => expect(screen.getByText('pool2')).toBeInTheDocument());

        // Initial state: sort by name asc (null first, then pool2, pool3)
        let rows = screen.getAllByRole('row', {name: /pool|N\/A/});
        expect(within(rows[0]).getByText('N/A')).toBeInTheDocument();
        expect(within(rows[1]).getByText('pool2')).toBeInTheDocument();
        expect(within(rows[2]).getByText('pool3')).toBeInTheDocument();

        // Click Name to sort desc: order becomes pool3, pool2, N/A
        fireEvent.click(sortButton('Name'));
        await waitFor(() => {
            rows = screen.getAllByRole('row', {name: /pool|N\/A/});
            expect(within(rows[0]).getByText('pool3')).toBeInTheDocument();
            expect(within(rows[1]).getByText('pool2')).toBeInTheDocument();
            expect(within(rows[2]).getByText('N/A')).toBeInTheDocument();
        });

        // Click Name again to sort asc: back to N/A, pool2, pool3
        fireEvent.click(sortButton('Name'));
        await waitFor(() => {
            rows = screen.getAllByRole('row', {name: /pool|N\/A/});
            expect(within(rows[0]).getByText('N/A')).toBeInTheDocument();
            expect(within(rows[1]).getByText('pool2')).toBeInTheDocument();
            expect(within(rows[2]).getByText('pool3')).toBeInTheDocument();
        });

        // Sort by type asc: null type first ('' < 'ext4' < 'zfs')
        fireEvent.click(sortButton('Type'));
        await waitFor(() => {
            rows = screen.getAllByRole('row', {name: /pool|N\/A/});
            expect(within(rows[0]).getByText('pool2')).toBeInTheDocument(); // null type
            expect(within(rows[1]).getByText('pool3')).toBeInTheDocument(); // ext4
            expect(within(rows[2]).getByText('N/A')).toBeInTheDocument(); // zfs (row with name null)
        });

        // Sort by head asc: null head first ('' < 'node1' < 'node3')
        fireEvent.click(sortButton('Head'));
        await waitFor(() => {
            rows = screen.getAllByRole('row', {name: /pool|N\/A/});
            expect(within(rows[0]).getByText('pool2')).toBeInTheDocument(); // null head
            expect(within(rows[1]).getByText('N/A')).toBeInTheDocument(); // node1 (row with name null)
            expect(within(rows[2]).getByText('pool3')).toBeInTheDocument(); // node3
        });
    });

    test('covers sort fallback for missing volume_count', async () => {
        const poolsWithMissingVolume = [
            {name: 'pool1', type: 'zfs', volume_count: 5, used: 50, size: 100, head: 'node1'},
            {name: 'pool2', type: 'lvm', volume_count: null, used: 0, size: 200, head: 'node2'},
            {name: 'pool3', type: 'ext4', volume_count: 10, used: 75, size: 100, head: 'node3'},
        ];
        axios.get.mockResolvedValueOnce({data: {items: poolsWithMissingVolume}});

        render(<Pools/>);
        await waitFor(() => expect(screen.getByText('pool1')).toBeInTheDocument());

        fireEvent.click(sortButton('Volume Count'));
        await waitFor(() => {
            const rows = screen.getAllByRole('row', {name: /pool[1-3]/});
            // null volume_count treated as 0, so order: pool2 (0), pool1 (5), pool3 (10)
            expect(within(rows[0]).getByText('pool2')).toBeInTheDocument();
            expect(within(rows[1]).getByText('pool1')).toBeInTheDocument();
            expect(within(rows[2]).getByText('pool3')).toBeInTheDocument();
        });
    });

    test('covers usage sort with zero size (false branch)', async () => {
        const poolsWithZeroSize = [
            {name: 'pool1', type: 'zfs', volume_count: 5, used: 50, size: 100, head: 'node1'},
            {name: 'pool2', type: 'lvm', volume_count: 3, used: 0, size: 0, head: 'node2'}, // size = 0
            {name: 'pool3', type: 'ext4', volume_count: 10, used: 75, size: 100, head: 'node3'},
        ];
        axios.get.mockResolvedValueOnce({data: {items: poolsWithZeroSize}});

        render(<Pools/>);
        await waitFor(() => expect(screen.getByText('pool1')).toBeInTheDocument());

        fireEvent.click(sortButton('Usage'));
        await waitFor(() => {
            const rows = screen.getAllByRole('row', {name: /pool[1-3]/});
            // pool2 (size=0) treated as 0% (false branch of the ternary)
            expect(within(rows[0]).getByText('pool2')).toBeInTheDocument();
            expect(within(rows[1]).getByText('pool1')).toBeInTheDocument();
            expect(within(rows[2]).getByText('pool3')).toBeInTheDocument();
        });
    });

    test('covers retry success with non-array items', async () => {
        axios.get.mockRejectedValueOnce(new Error('API Error'));

        render(<Pools/>);
        await waitFor(() => expect(screen.getByText('Failed to load pools. Please try again.')).toBeInTheDocument());

        // Retry succeeds but items is null
        axios.get.mockResolvedValueOnce({data: {items: null}});

        const retryButton = screen.getByRole('button', {name: /retry/i});
        fireEvent.click(retryButton);

        await waitFor(() => {
            expect(screen.getByText('No pools available.')).toBeInTheDocument();
        });
    });

    test('shows a usage bar beside the percentage, coloured by thresholds', async () => {
        const pools = [
            {name: 'low', type: 'zfs', volume_count: 1, used: 50, size: 100, head: 'n1'},
            {name: 'mid', type: 'zfs', volume_count: 1, used: 60, size: 100, head: 'n1'},
            {name: 'high', type: 'zfs', volume_count: 1, used: 90, size: 100, head: 'n1'},
            {name: 'over', type: 'zfs', volume_count: 1, used: 120, size: 100, head: 'n1'},
            {name: 'none', type: 'zfs', volume_count: 1, used: 10, size: 0, head: 'n1'},
        ];
        axios.get.mockResolvedValueOnce({data: {items: pools}});

        render(<Pools/>);
        await waitFor(() => expect(screen.getByText('low')).toBeInTheDocument());

        const bar = (name) => within(screen.getByRole('row', {name: new RegExp(`^${name} `)})).queryByRole('progressbar');
        const fill = (name) => bar(name).firstElementChild;
        expect(bar('low')).toHaveAccessibleName('Usage of low');
        expect(bar('low')).toHaveAttribute('aria-valuenow', '50');
        expect(bar('low')).toHaveAttribute('data-state', 'up');
        expect(fill('low')).toHaveClass('bg-state-up');
        expect(fill('low')).toHaveStyle({width: '50%'});
        expect(bar('mid')).toHaveAttribute('data-state', 'warn');
        expect(fill('mid')).toHaveClass('bg-state-warn');
        expect(bar('high')).toHaveAttribute('data-state', 'down');
        expect(fill('high')).toHaveClass('bg-state-down');
        expect(fill('over')).toHaveStyle({width: '100%'});
        expect(bar('none')).toBeNull();

        const overRow = screen.getByRole('row', {name: /^over /});
        expect(within(overRow).getByText('120.0%').parentElement).toHaveAttribute('title', '120/100');
    });
});
