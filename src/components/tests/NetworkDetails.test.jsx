import React from 'react';
import {render, screen, waitFor, fireEvent, within} from '@testing-library/react';
import {vi, describe, test, expect, beforeEach, afterEach} from 'vitest';
import '@testing-library/jest-dom';
import {MemoryRouter, Route, Routes} from 'react-router-dom';
import axios from 'axios';
import NetworkDetails from '../NetworkDetails';
import i18n from '../../i18n';
import {URL_NETWORK_IP} from '../../config/apiPath.js';

// Mock axios
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

// Sample IP details data
const mockIpDetails = [
    {
        ip: '192.168.1.1',
        network: {name: 'default', type: undefined},
        node: 'node1',
        path: '/path/to/resource',
        rid: 'ip#1',
    },
    {
        ip: '192.168.1.2',
        network: {name: 'default', type: 'bridge'},
        node: 'node2',
        path: '/path/to/resource2',
        rid: 'ip#2',
    },
    {
        ip: '192.168.1.3',
        network: {name: 'default', type: 'bridge'},
        node: 'node1',
        path: '/path/to/resource3',
        rid: 'ip#1',
    },
    {
        ip: '127.0.0.1',
        network: {name: 'lo', type: 'loopback'},
        node: 'node1',
        path: '/path/to/loopback',
        rid: 'ip#3',
    },
    {
        ip: '192.168.1.5',
        network: null,
        node: 'node5',
        path: '/path5',
        rid: 'ip#5',
    },
];

describe('NetworkDetails Component', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockLocalStorage.getItem.mockReturnValue('mock-token');
    });

    afterEach(() => {
        vi.useRealTimers?.();
    });

    test('renders the Network Details title with network name and type', async () => {
        axios.get.mockResolvedValueOnce({data: {items: mockIpDetails}});

        render(
            <MemoryRouter initialEntries={['/network/default']}>
                <Routes>
                    <Route path="/network/:networkName" element={<NetworkDetails/>}/>
                </Routes>
            </MemoryRouter>
        );

        await waitFor(() => {
            const titleElements = screen.getAllByText(/Network Details:/i);
            const matchingTitle = titleElements.find(el =>
                el.textContent.includes('Network Details: default') &&
                el.textContent.includes('(N/A)')
            );
            expect(matchingTitle).toBeInTheDocument();
        });
        expect(screen.getByRole('heading', {level: 1})).toHaveTextContent('Network Details: default (N/A)');
        expect(screen.getByRole('table', {name: 'Network details'})).toBeInTheDocument();
    });

    test('renders N/A in title when networkName is not provided', () => {
        render(
            <MemoryRouter initialEntries={['/network']}>
                <Routes>
                    <Route path="/network" element={<NetworkDetails/>}/>
                </Routes>
            </MemoryRouter>
        );
        expect(screen.getByText(/Network Details: N\/A \(N\/A\)/i)).toBeInTheDocument();
    });

    test('speaks French to a French browser', async () => {
        await i18n.changeLanguage('fr');
        try {
            render(
                <MemoryRouter initialEntries={['/network']}>
                    <Routes>
                        <Route path="/network" element={<NetworkDetails/>}/>
                    </Routes>
                </MemoryRouter>
            );
            expect(screen.getByRole('heading', {level: 1})).toHaveTextContent('Détails du réseau : N/D (N/D)');
            expect(screen.getByRole('button', {name: 'Masquer les filtres'})).toBeInTheDocument();
        } finally {
            await i18n.changeLanguage('en');
        }
    });

    test('renders table headers correctly', async () => {
        axios.get.mockResolvedValueOnce({data: {items: mockIpDetails}});

        render(
            <MemoryRouter initialEntries={['/network/default']}>
                <Routes>
                    <Route path="/network/:networkName" element={<NetworkDetails/>}/>
                </Routes>
            </MemoryRouter>
        );

        await waitFor(() => {
            const tableHeaders = screen.getAllByRole('columnheader');
            const headersText = tableHeaders.map(header => header.textContent);
            expect(headersText).toEqual(['IP', 'Node', 'Path', 'RID']);
        });
    });

    test('renders filter inputs for Node, Path, and RID', () => {
        render(
            <MemoryRouter initialEntries={['/network/default']}>
                <Routes>
                    <Route path="/network/:networkName" element={<NetworkDetails/>}/>
                </Routes>
            </MemoryRouter>
        );
        expect(screen.getByLabelText('Node')).toBeInTheDocument();
        expect(screen.getByLabelText('Path')).toBeInTheDocument();
        expect(screen.getByLabelText('RID')).toBeInTheDocument();
        expect(screen.getByText('Hide filters')).toBeInTheDocument();
    });

    test('toggles filter visibility on button click', async () => {
        axios.get.mockResolvedValueOnce({data: {items: mockIpDetails}});

        render(
            <MemoryRouter initialEntries={['/network/default']}>
                <Routes>
                    <Route path="/network/:networkName" element={<NetworkDetails/>}/>
                </Routes>
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(screen.getByLabelText('Node')).toBeInTheDocument();
        });

        const filterButton = screen.getByRole('button', {name: /hide filters/i});
        expect(filterButton).toHaveAttribute('aria-expanded', 'true');

        fireEvent.click(filterButton);
        await waitFor(() => {
            expect(screen.queryByLabelText('Node')).not.toBeInTheDocument();
        });

        await waitFor(() => {
            expect(screen.getByRole('button', {name: /show filters/i})).toHaveAttribute('aria-expanded', 'false');
        });

        fireEvent.click(screen.getByRole('button', {name: /show filters/i}));
        await waitFor(() => {
            expect(screen.getByLabelText('Node')).toBeInTheDocument();
        });

        await waitFor(() => {
            expect(screen.getByRole('button', {name: /hide filters/i})).toBeInTheDocument();
        });
    });

    test('displays IP details correctly, including rows with duplicate RIDs', async () => {
        axios.get.mockResolvedValueOnce({data: {items: mockIpDetails}});

        render(
            <MemoryRouter initialEntries={['/network/default']}>
                <Routes>
                    <Route path="/network/:networkName" element={<NetworkDetails/>}/>
                </Routes>
            </MemoryRouter>
        );

        await waitFor(() => {
            const table = screen.getByRole('table');
            const rows = within(table).getAllByRole('row').slice(1);
            expect(rows).toHaveLength(3);
        });

        const table = screen.getByRole('table');
        const rows = within(table).getAllByRole('row').slice(1);

        const testRow = (row, ip, node, path, rid) => {
            const cells = within(row).getAllByRole('cell');
            expect(cells[0]).toHaveTextContent(ip);
            expect(cells[1]).toHaveTextContent(node);
            expect(cells[2]).toHaveTextContent(path);
            expect(cells[3]).toHaveTextContent(rid);
        };

        testRow(rows[0], '192.168.1.1', 'node1', '/path/to/resource', 'ip#1');
        testRow(rows[1], '192.168.1.2', 'node2', '/path/to/resource2', 'ip#2');
        testRow(rows[2], '192.168.1.3', 'node1', '/path/to/resource3', 'ip#1');
    });

    test('filters IP details by node', async () => {
        vi.useFakeTimers();
        axios.get.mockResolvedValueOnce({data: {items: mockIpDetails}});

        render(
            <MemoryRouter initialEntries={['/network/default']}>
                <Routes>
                    <Route path="/network/:networkName" element={<NetworkDetails/>}/>
                </Routes>
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(screen.getByText('192.168.1.1')).toBeInTheDocument();
        });

        const nodeInput = screen.getByLabelText('Node');
        fireEvent.change(nodeInput, {target: {value: 'node1'}});
        vi.advanceTimersByTime(300);

        await waitFor(() => {
            expect(screen.getByText('192.168.1.1')).toBeInTheDocument();
            expect(screen.getByText('192.168.1.3')).toBeInTheDocument();
            expect(screen.queryByText('192.168.1.2')).not.toBeInTheDocument();
        });
        vi.useRealTimers();
    });

    test('filters IP details by path', async () => {
        vi.useFakeTimers();
        axios.get.mockResolvedValueOnce({data: {items: mockIpDetails}});

        render(
            <MemoryRouter initialEntries={['/network/default']}>
                <Routes>
                    <Route path="/network/:networkName" element={<NetworkDetails/>}/>
                </Routes>
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(screen.getByText('192.168.1.1')).toBeInTheDocument();
        });

        const pathInput = screen.getByLabelText('Path');
        fireEvent.change(pathInput, {target: {value: 'resource3'}});
        vi.advanceTimersByTime(300);

        await waitFor(() => {
            expect(screen.getByText('192.168.1.3')).toBeInTheDocument();
            expect(screen.queryByText('192.168.1.1')).not.toBeInTheDocument();
            expect(screen.queryByText('192.168.1.2')).not.toBeInTheDocument();
        });
        vi.useRealTimers();
    });

    test('filters IP details by RID', async () => {
        vi.useFakeTimers();
        axios.get.mockResolvedValueOnce({data: {items: mockIpDetails}});

        render(
            <MemoryRouter initialEntries={['/network/default']}>
                <Routes>
                    <Route path="/network/:networkName" element={<NetworkDetails/>}/>
                </Routes>
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(screen.getByText('192.168.1.1')).toBeInTheDocument();
        });

        const ridInput = screen.getByLabelText('RID');
        fireEvent.change(ridInput, {target: {value: 'ip#1'}});
        vi.advanceTimersByTime(300);

        await waitFor(() => {
            expect(screen.getByText('192.168.1.1')).toBeInTheDocument();
            expect(screen.getByText('192.168.1.3')).toBeInTheDocument();
            expect(screen.queryByText('192.168.1.2')).not.toBeInTheDocument();
        });
        vi.useRealTimers();
    });

    test('displays no IP details when filters exclude all items', async () => {
        vi.useFakeTimers();
        axios.get.mockResolvedValueOnce({data: {items: mockIpDetails}});

        render(
            <MemoryRouter initialEntries={['/network/default']}>
                <Routes>
                    <Route path="/network/:networkName" element={<NetworkDetails/>}/>
                </Routes>
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(screen.getByText('192.168.1.1')).toBeInTheDocument();
        });

        const nodeInput = screen.getByLabelText('Node');
        fireEvent.change(nodeInput, {target: {value: 'nonexistent'}});
        vi.advanceTimersByTime(300);

        await waitFor(() => {
            expect(screen.getByText('No IP details available for this network.')).toBeInTheDocument();
            expect(screen.queryByText('192.168.1.1')).not.toBeInTheDocument();
            expect(screen.queryByText('192.168.1.2')).not.toBeInTheDocument();
            expect(screen.queryByText('192.168.1.3')).not.toBeInTheDocument();
        });
        vi.useRealTimers();
    });

    test('handles API error gracefully', async () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {
        });
        const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
        });
        axios.get.mockRejectedValueOnce(new Error('API Error'));

        render(
            <MemoryRouter initialEntries={['/network/default']}>
                <Routes>
                    <Route path="/network/:networkName" element={<NetworkDetails/>}/>
                </Routes>
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(consoleErrorSpy).toHaveBeenCalledWith('Error retrieving network IP details', expect.any(Error));
        });

        await waitFor(() => {
            expect(screen.getByRole('alert')).toHaveTextContent('Failed to load network details. Please try again.');
            expect(screen.getByText('No IP details available for this network.')).toBeInTheDocument();
            expect(screen.getByText(/Network Details: default \(N\/A\)/i)).toBeInTheDocument();
            expect(screen.queryByText('192.168.1.1')).not.toBeInTheDocument();
        });

        expect(consoleWarnSpy).not.toHaveBeenCalled();
        consoleErrorSpy.mockRestore();
        consoleWarnSpy.mockRestore();
    });

    test('displays no IP details when no items match networkName', async () => {
        axios.get.mockResolvedValueOnce({data: {items: mockIpDetails}});

        render(
            <MemoryRouter initialEntries={['/network/unknown']}>
                <Routes>
                    <Route path="/network/:networkName" element={<NetworkDetails/>}/>
                </Routes>
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(screen.getByText('No IP details available for this network.')).toBeInTheDocument();
            expect(screen.getByText(/Network Details: unknown \(N\/A\)/i)).toBeInTheDocument();
            expect(screen.queryByText('192.168.1.1')).not.toBeInTheDocument();
            expect(screen.queryByText('127.0.0.1')).not.toBeInTheDocument();
        });
    });

    test('displays no IP details when API returns empty items', async () => {
        axios.get.mockResolvedValueOnce({data: {items: []}});

        render(
            <MemoryRouter initialEntries={['/network/default']}>
                <Routes>
                    <Route path="/network/:networkName" element={<NetworkDetails/>}/>
                </Routes>
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(screen.getByText('No IP details available for this network.')).toBeInTheDocument();
            expect(screen.getByText(/Network Details: default \(N\/A\)/i)).toBeInTheDocument();
            expect(screen.queryByText('192.168.1.1')).not.toBeInTheDocument();
        });
    });

    test('handles API response without items property', async () => {
        axios.get.mockResolvedValueOnce({data: {}});

        render(
            <MemoryRouter initialEntries={['/network/default']}>
                <Routes>
                    <Route path="/network/:networkName" element={<NetworkDetails/>}/>
                </Routes>
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(screen.getByText('No IP details available for this network.')).toBeInTheDocument();
            expect(screen.getByText(/Network Details: default \(N\/A\)/i)).toBeInTheDocument();
        });
    });

    test('handles null or undefined fields gracefully', async () => {
        const mockIpDetailsWithNulls = [
            {
                ip: '192.168.1.1',
                network: {name: 'default', type: 'bridge'},
                node: null,
                path: undefined,
                rid: 'ip#1',
            },
            {
                ip: '192.168.1.2',
                network: {name: 'default', type: 'bridge'},
                node: 'node2',
                path: '/path/to/resource2',
                rid: 'ip#2',
            },
        ];
        axios.get.mockResolvedValueOnce({data: {items: mockIpDetailsWithNulls}});

        render(
            <MemoryRouter initialEntries={['/network/default']}>
                <Routes>
                    <Route path="/network/:networkName" element={<NetworkDetails/>}/>
                </Routes>
            </MemoryRouter>
        );

        await waitFor(() => {
            const rows = screen.getAllByRole('row').slice(1);
            expect(rows).toHaveLength(2);
        });

        const rows = screen.getAllByRole('row').slice(1);
        const firstRowCells = within(rows[0]).getAllByRole('cell');
        expect(firstRowCells[0]).toHaveTextContent('192.168.1.1');
        expect(firstRowCells[1]).toHaveTextContent('N/A');
        expect(firstRowCells[2]).toHaveTextContent('N/A');
        expect(firstRowCells[3]).toHaveTextContent('ip#1');

        const secondRowCells = within(rows[1]).getAllByRole('cell');
        expect(secondRowCells[0]).toHaveTextContent('192.168.1.2');
        expect(secondRowCells[1]).toHaveTextContent('node2');
        expect(secondRowCells[2]).toHaveTextContent('/path/to/resource2');
        expect(secondRowCells[3]).toHaveTextContent('ip#2');
    });

    test('calls API with correct authorization token', async () => {
        axios.get.mockResolvedValueOnce({data: {items: []}});

        render(
            <MemoryRouter initialEntries={['/network/default']}>
                <Routes>
                    <Route path="/network/:networkName" element={<NetworkDetails/>}/>
                </Routes>
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(axios.get).toHaveBeenCalledWith(URL_NETWORK_IP, {
                headers: {Authorization: 'Bearer mock-token'},
            });
        });
    });

    test('does not fetch data when networkName is not provided', () => {
        axios.get.mockReset();

        render(
            <MemoryRouter initialEntries={['/network']}>
                <Routes>
                    <Route path="/network" element={<NetworkDetails/>}/>
                </Routes>
            </MemoryRouter>
        );

        expect(axios.get).not.toHaveBeenCalled();
        expect(screen.getByText(/Network Details: N\/A \(N\/A\)/i)).toBeInTheDocument();
    });

    test('shows loading indicator while fetching data', async () => {
        let resolve;
        const promise = new Promise((r) => {
            resolve = r;
        });
        axios.get.mockReturnValueOnce(promise);

        render(
            <MemoryRouter initialEntries={['/network/default']}>
                <Routes>
                    <Route path="/network/:networkName" element={<NetworkDetails/>}/>
                </Routes>
            </MemoryRouter>
        );

        expect(screen.getByRole('status')).toHaveTextContent('Loading network details');
        expect(screen.queryByRole('table')).not.toBeInTheDocument();

        resolve({data: {items: mockIpDetails}});
        await promise;

        await waitFor(() => {
            expect(screen.queryByText('Loading network details')).not.toBeInTheDocument();
        });

        await waitFor(() => {
            expect(screen.getByText('192.168.1.1')).toBeInTheDocument();
        });
    });

    test('does not update state if unmounted before fetch completes', async () => {
        const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
        });
        let resolve;
        const promise = new Promise((r) => {
            resolve = r;
        });
        axios.get.mockReturnValueOnce(promise);

        const {unmount} = render(
            <MemoryRouter initialEntries={['/network/default']}>
                <Routes>
                    <Route path="/network/:networkName" element={<NetworkDetails/>}/>
                </Routes>
            </MemoryRouter>
        );

        unmount();

        resolve({data: {items: mockIpDetails}});
        await promise;

        expect(consoleWarnSpy).not.toHaveBeenCalled();
        consoleWarnSpy.mockRestore();
    });

    test('does not update state on error if unmounted', async () => {
        const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
        });
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {
        });
        let reject;
        const promise = new Promise((_, r) => {
            reject = r;
        });
        axios.get.mockReturnValueOnce(promise);

        const {unmount} = render(
            <MemoryRouter initialEntries={['/network/default']}>
                <Routes>
                    <Route path="/network/:networkName" element={<NetworkDetails/>}/>
                </Routes>
            </MemoryRouter>
        );

        unmount();

        reject(new Error('API Error'));
        await expect(promise).rejects.toThrow('API Error');

        expect(consoleWarnSpy).not.toHaveBeenCalled();
        consoleWarnSpy.mockRestore();
        consoleErrorSpy.mockRestore();
    });
});
