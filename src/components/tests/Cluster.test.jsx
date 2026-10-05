import React from 'react';
import {render, screen, waitFor, fireEvent, act} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import axios from 'axios';
import {vi, describe, test, expect, beforeEach, afterEach, afterAll} from 'vitest';
import * as matchers from 'vitest-axe';
import ClusterOverview from '../Cluster.jsx';
import {URL_POOL, URL_NETWORK} from '../../config/apiPath.js';
import {startEventReception, closeEventSource} from '../../eventSourceManager';
import {
    useNodeStats,
    useObjectStats,
    useHeartbeatStats,
} from '../../hooks/useClusterData';
import {useKindData} from '../../hooks/useKindData';

expect.extend(matchers);

// Hoisted variables for use in mocks
const {
    mockNavigate,
    mockToken,
} = vi.hoisted(() => ({
    mockNavigate: vi.fn(),
    mockToken: 'mock-token',
}));

vi.mock('react-router-dom', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useNavigate: () => mockNavigate,
    };
});

vi.mock('axios');

vi.mock('../../hooks/useClusterData', () => ({
    useNodeStats: vi.fn(),
    useObjectStats: vi.fn(),
    useHeartbeatStats: vi.fn(),
}));

vi.mock('../../hooks/useKindData', () => ({
    useKindData: vi.fn(),
}));

vi.mock('../../eventSourceManager', () => ({
    startEventReception: vi.fn(),
    closeEventSource: vi.fn(),
    startLoggerReception: vi.fn(),
    closeLoggerEventSource: vi.fn(),
    DEFAULT_FILTERS: [],
}));

vi.mock('../ClusterStatGrids.jsx', () => {
    const GridNodes = ({nodeCount, frozenCount, onClick}) => (
        <button aria-label="Nodes stat card" onClick={onClick}>
            <div data-testid="node-count">{nodeCount}</div>
            <div data-testid="node-status">Frozen: {frozenCount}</div>
        </button>
    );
    const GridObjects = ({objectCount, statusCount, onClick}) => (
        <div>
            <button aria-label="Objects stat card" onClick={() => onClick && onClick()}>
                <div data-testid="object-count">{objectCount}</div>
                <div data-testid="up-count">Up {statusCount?.up ?? 0}</div>
                <div data-testid="warn-count">Warn {statusCount?.warn ?? 0}</div>
                <div data-testid="down-count">Down {statusCount?.down ?? 0}</div>
                <div data-testid="na-count">N/A {statusCount?.['n/a'] ?? 0}</div>
                <div data-testid="unprovisioned-count">
                    Unprovisioned {statusCount?.unprovisioned ?? 0}
                </div>
            </button>
            <button
                aria-label="Objects up status"
                onClick={() => onClick && onClick('up')}
                data-testid="up-status-button"
            >
                View Up
            </button>
            <button
                aria-label="Objects warn status"
                onClick={() => onClick && onClick('warn')}
                data-testid="warn-status-button"
            >
                View Warn
            </button>
        </div>
    );
    const GridNamespaces = ({namespaceCount, namespaceSubtitle, onClick}) => (
        <button aria-label="Namespaces stat card" onClick={() => onClick && onClick()}>
            <div data-testid="namespace-count">{namespaceCount}</div>
            <div>
                {namespaceSubtitle?.map((ns) => (
                    <div
                        key={ns.namespace}
                        role="group"
                        aria-label={`${ns.namespace} chip`}
                        className="ns-chip"
                        data-testid={`namespace-${ns.namespace}`}
                    >
                        <span>{ns.namespace}</span>
                        <span data-testid={`${ns.namespace}-count`} style={{fontSize: '10px'}}>
              {ns.count}
            </span>
                    </div>
                ))}
            </div>
        </button>
    );
    const GridHeartbeats = ({heartbeatCount, runningCount, perHeartbeatStats, onClick}) => (
        <div>
            <button aria-label="Heartbeats stat card" onClick={() => onClick && onClick()}>
                <div data-testid="heartbeat-count">{heartbeatCount}</div>
                <div data-testid="running-count">Running: {runningCount}</div>
                <div data-testid="beating-count">Beating: {perHeartbeatStats?.beating ?? 0}</div>
                <div data-testid="non-beating-count">Non-beating: {perHeartbeatStats?.stale ?? 0}</div>
            </button>
            <button
                aria-label="Heartbeats beating status"
                onClick={() => onClick && onClick('beating')}
                data-testid="beating-status-button"
            >
                View Beating
            </button>
            <button
                aria-label="Heartbeats running state"
                onClick={() => onClick && onClick('beating', 'running')}
                data-testid="running-state-button"
            >
                View Running
            </button>
            <button
                aria-label="Heartbeats id status"
                onClick={() => onClick && onClick('beating', 'running', 'node1')}
                data-testid="id-status-button"
            >
                View Id
            </button>
            <button
                aria-label="Heartbeats id without status"
                onClick={() => onClick && onClick(undefined, undefined, 'node1')}
                data-testid="id-only-button"
            >
                View Id Only
            </button>
            <button
                aria-label="Heartbeats state only"
                onClick={() => onClick && onClick(undefined, 'running')}
                data-testid="state-only-button"
            >
                View State Only
            </button>
        </div>
    );
    const GridPools = ({poolCount, onClick}) => (
        <button aria-label="Pools stat card" onClick={() => onClick && onClick()}>
            <div data-testid="pool-count">{poolCount}</div>
        </button>
    );
    const GridNetworks = ({networks, onClick}) => (
        <button aria-label="Networks stat card" onClick={() => onClick && onClick()}>
            <div data-testid="network-count">{networks?.length ?? 0}</div>
        </button>
    );
    const GridKinds = ({kindCount, kindSubtitle, onClick}) => (
        <button aria-label="Kinds stat card" onClick={() => onClick && onClick()}>
            <div data-testid="kind-count">{kindCount}</div>
            <div>
                {kindSubtitle?.map(({kind}) => (
                    <div key={kind} data-testid={`kind-${kind}`}>
                        {kind}
                    </div>
                ))}
            </div>
        </button>
    );
    return {
        GridNodes,
        GridObjects,
        GridNamespaces,
        GridHeartbeats,
        GridPools,
        GridNetworks,
        GridKinds,
    };
});

describe('ClusterOverview', () => {
    beforeEach(() => {
        vi.stubEnv('VITE_AI_AGENT_URL', '');
        vi.clearAllMocks();

        Storage.prototype.getItem = vi.fn(() => mockToken);

        useNodeStats.mockReturnValue({count: 2, frozen: 1});
        useObjectStats.mockReturnValue({
            objectCount: 4,
            statusCount: {
                up: 1,
                warn: 1,
                down: 1,
                'n/a': 1,
                unprovisioned: 1,
            },
            namespaceCount: 3,
            namespaceSubtitle: [
                {namespace: 'ns1', count: 2},
                {namespace: 'root', count: 1},
                {namespace: 'ns-with-dash', count: 1},
                {namespace: 'ns.with.dots', count: 1},
            ],
        });
        useHeartbeatStats.mockReturnValue({
            count: 5,
            running: 2,
            perHeartbeatStats: {beating: 3, stale: 2},
        });
        useKindData.mockReturnValue({
            statusByKind: {Pod: 'up', Service: 'warn'},
            kinds: ['Pod', 'Service'],
        });

        axios.get.mockResolvedValue({
            data: {items: [{id: 'pool1'}, {id: 'pool2'}], networks: ['net1', 'net2']},
        });

        startEventReception.mockImplementation(vi.fn());
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
    });

    test('renders cluster overview with all stat cards and edge-case data', async () => {
        render(
            <MemoryRouter>
                <ClusterOverview/>
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(screen.getByTestId('pool-count')).toHaveTextContent('2');
        });

        expect(screen.getByText('Cluster Overview')).toBeInTheDocument();

        // Nodes
        expect(screen.getByTestId('node-count')).toHaveTextContent('2');
        expect(screen.getByTestId('node-status')).toHaveTextContent('Frozen: 1');

        // Objects
        expect(screen.getByTestId('object-count')).toHaveTextContent('4');
        expect(screen.getByTestId('up-count')).toHaveTextContent('Up 1');
        expect(screen.getByTestId('warn-count')).toHaveTextContent('Warn 1');
        expect(screen.getByTestId('down-count')).toHaveTextContent('Down 1');
        expect(screen.getByTestId('na-count')).toHaveTextContent('N/A 1');
        expect(screen.getByTestId('unprovisioned-count')).toHaveTextContent('Unprovisioned 1');

        // Namespaces
        expect(screen.getByTestId('namespace-count')).toHaveTextContent('3');
        expect(screen.getByTestId('namespace-ns1')).toBeInTheDocument();
        expect(screen.getByTestId('namespace-root')).toBeInTheDocument();
        expect(screen.getByTestId('namespace-ns-with-dash')).toBeInTheDocument();
        expect(screen.getByTestId('namespace-ns.with.dots')).toBeInTheDocument();
        expect(screen.getByTestId('ns1-count')).toHaveTextContent('2');

        // Heartbeats
        expect(screen.getByTestId('heartbeat-count')).toHaveTextContent('5');
        expect(screen.getByTestId('beating-count')).toHaveTextContent('Beating: 3');
        expect(screen.getByTestId('non-beating-count')).toHaveTextContent('Non-beating: 2');
        expect(screen.getByTestId('running-count')).toHaveTextContent('Running: 2');

        // Pools & Networks
        expect(screen.getByRole('button', {name: /Pools stat card/i})).toBeInTheDocument();
        expect(screen.getByRole('button', {name: /Networks stat card/i})).toBeInTheDocument();
        expect(screen.getByTestId('network-count')).toHaveTextContent('2');

        // Kinds
        expect(screen.getByTestId('kind-count')).toHaveTextContent('2');
        expect(screen.getByTestId('kind-Pod')).toBeInTheDocument();
        expect(screen.getByTestId('kind-Service')).toBeInTheDocument();
    });

    test('configured AI assistant is accessible from cluster overview', async () => {
        vi.stubEnv('VITE_AI_AGENT_URL', 'https://agent.example.com');
        render(<MemoryRouter><ClusterOverview/></MemoryRouter>);
        fireEvent.click(await screen.findByRole('button', {name: 'AI Assistant'}));
        expect(mockNavigate).toHaveBeenCalledWith('/ai');
    });

    test('cluster overview hides the AI entry when not configured', async () => {
        render(<MemoryRouter><ClusterOverview/></MemoryRouter>);
        await screen.findByText('Cluster Overview');
        expect(screen.queryByRole('button', {name: 'AI Assistant'})).not.toBeInTheDocument();
    });

    test('fetches data on mount with auth token', async () => {
        render(
            <MemoryRouter>
                <ClusterOverview/>
            </MemoryRouter>
        );

        expect(localStorage.getItem).toHaveBeenCalledWith('authToken');
        expect(startEventReception).toHaveBeenCalledWith(mockToken, expect.any(Array));

        expect(axios.get).toHaveBeenCalledWith(URL_POOL, expect.objectContaining({
            headers: {Authorization: `Bearer ${mockToken}`},
            timeout: 5000,
        }));
        expect(axios.get).toHaveBeenCalledWith(URL_NETWORK, expect.objectContaining({
            headers: {Authorization: `Bearer ${mockToken}`},
            timeout: 5000,
        }));

        await waitFor(() => {
            expect(screen.getByTestId('pool-count')).toHaveTextContent('2');
        });
    });

    test('navigates correctly on all card clicks', async () => {
        render(
            <MemoryRouter>
                <ClusterOverview/>
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(screen.getByTestId('pool-count')).toHaveTextContent('2');
        });

        const clickAndAssert = (role, expectedPath) => {
            fireEvent.click(screen.getByRole('button', {name: new RegExp(role, 'i')}));
            expect(mockNavigate).toHaveBeenCalledWith(expectedPath);
            mockNavigate.mockClear();
        };

        clickAndAssert('Nodes stat card', '/nodes');
        clickAndAssert('Objects stat card', '/objects');
        clickAndAssert('Namespaces stat card', '/namespaces');
        clickAndAssert('Heartbeats stat card', '/heartbeats');
        clickAndAssert('Pools stat card', '/pools');
        clickAndAssert('Kinds stat card', '/kinds');
        clickAndAssert('Networks stat card', '/network');

        fireEvent.click(screen.getByTestId('up-status-button'));
        expect(mockNavigate).toHaveBeenCalledWith('/objects?globalState=up');
        mockNavigate.mockClear();

        fireEvent.click(screen.getByTestId('warn-status-button'));
        expect(mockNavigate).toHaveBeenCalledWith('/objects?globalState=warn');
        mockNavigate.mockClear();

        fireEvent.click(screen.getByTestId('beating-status-button'));
        expect(mockNavigate).toHaveBeenCalledWith('/heartbeats?status=beating');
        mockNavigate.mockClear();

        fireEvent.click(screen.getByTestId('running-state-button'));
        expect(mockNavigate).toHaveBeenCalledWith('/heartbeats?status=beating&state=running');
        mockNavigate.mockClear();

        fireEvent.click(screen.getByTestId('id-status-button'));
        expect(mockNavigate).toHaveBeenCalledWith('/heartbeats?status=beating&state=running&id=node1');
        mockNavigate.mockClear();

        fireEvent.click(screen.getByTestId('id-only-button'));
        expect(mockNavigate).toHaveBeenCalledWith('/heartbeats?id=node1');
        mockNavigate.mockClear();

        fireEvent.click(screen.getByTestId('state-only-button'));
        expect(mockNavigate).toHaveBeenCalledWith('/heartbeats?state=running');
        mockNavigate.mockClear();
    });

    test('handles empty data correctly', async () => {
        useNodeStats.mockReturnValue({count: 0, frozen: 0});
        useObjectStats.mockReturnValue({
            objectCount: 0,
            statusCount: {up: 0, warn: 0, down: 0, 'n/a': 0, unprovisioned: 0},
            namespaceCount: 0,
            namespaceSubtitle: [],
        });
        useHeartbeatStats.mockReturnValue({
            count: 0,
            running: 0,
            perHeartbeatStats: {beating: 0, stale: 0},
        });
        useKindData.mockReturnValue({statusByKind: {}, kinds: []});
        axios.get.mockResolvedValue({data: {items: [], networks: []}});

        render(
            <MemoryRouter>
                <ClusterOverview/>
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(screen.getByTestId('node-count')).toHaveTextContent('0');
        });

        expect(screen.getByTestId('object-count')).toHaveTextContent('0');
        expect(screen.getByTestId('namespace-count')).toHaveTextContent('0');
        expect(screen.getByTestId('heartbeat-count')).toHaveTextContent('0');
        expect(screen.getByTestId('pool-count')).toHaveTextContent('0');
        expect(screen.getByTestId('network-count')).toHaveTextContent('0');
        expect(screen.getByTestId('kind-count')).toHaveTextContent('0');
    });

    test('does not fetch data without auth token', async () => {
        Storage.prototype.getItem = vi.fn(() => null);

        render(
            <MemoryRouter>
                <ClusterOverview/>
            </MemoryRouter>
        );

        expect(startEventReception).not.toHaveBeenCalled();
        expect(axios.get).not.toHaveBeenCalled();
    });

    test('handles API errors gracefully', async () => {
        axios.get.mockRejectedValue(new Error('Network error'));

        render(
            <MemoryRouter>
                <ClusterOverview/>
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(screen.getByTestId('pool-count')).toHaveTextContent('0');
            expect(screen.getByTestId('network-count')).toHaveTextContent('0');
        });
    });

    test('cleans up on unmount during fetch', async () => {
        let resolvePromise;
        const slowPromise = new Promise((resolve) => {
            resolvePromise = resolve;
        });
        axios.get.mockReturnValue(slowPromise);

        const {unmount} = render(
            <MemoryRouter>
                <ClusterOverview/>
            </MemoryRouter>
        );

        await waitFor(() => expect(axios.get).toHaveBeenCalledTimes(2));

        unmount();
        resolvePromise({data: {items: [{id: 'pool1'}], networks: []}});

        await act(async () => {
            await slowPromise;
        });

        expect(mockNavigate).not.toHaveBeenCalled();
    });

    test('aborts in-flight request on unmount (covers cleanup abort)', async () => {
        const abortSpy = vi.spyOn(AbortController.prototype, 'abort');
        let resolvePromise;
        const neverResolvingPromise = new Promise((resolve) => {
            resolvePromise = resolve;
        });
        axios.get.mockImplementation(() => neverResolvingPromise);

        const {unmount} = render(
            <MemoryRouter>
                <ClusterOverview/>
            </MemoryRouter>
        );

        await waitFor(() => expect(axios.get).toHaveBeenCalledTimes(2));

        await act(async () => {
            unmount();
        });

        expect(abortSpy).toHaveBeenCalled();

        resolvePromise({data: {items: [], networks: []}});
        abortSpy.mockRestore();
    });

    test('does not abort when no request is in flight (covers false branch of cleanup)', async () => {
        Storage.prototype.getItem = vi.fn(() => null);

        const {unmount} = render(
            <MemoryRouter>
                <ClusterOverview/>
            </MemoryRouter>
        );

        unmount();

        expect(closeEventSource).toHaveBeenCalled();
    });

    test('shows loading indicator initially before data loads', async () => {
        useNodeStats.mockReturnValue({count: 0, frozen: 0});
        useObjectStats.mockReturnValue({
            objectCount: 0,
            statusCount: {up: 0, warn: 0, down: 0, 'n/a': 0, unprovisioned: 0},
            namespaceCount: 0,
            namespaceSubtitle: [],
        });
        useHeartbeatStats.mockReturnValue({
            count: 0,
            running: 0,
            perHeartbeatStats: {beating: 0, stale: 0},
        });
        useKindData.mockReturnValue({statusByKind: {}, kinds: []});

        let resolvePromise;
        const slowPromise = new Promise((resolve) => {
            resolvePromise = resolve;
        });
        axios.get.mockReturnValue(slowPromise);

        render(
            <MemoryRouter>
                <ClusterOverview/>
            </MemoryRouter>
        );

        expect(screen.getByText('Loading cluster data...')).toBeInTheDocument();

        resolvePromise({data: {items: [], networks: []}});
        await act(async () => {
            await slowPromise;
        });
    });

    test('uses fallback empty arrays when items are undefined', async () => {
        axios.get.mockImplementation((url) => {
            if (url === URL_POOL) return Promise.resolve({data: {}});
            if (url === URL_NETWORK) return Promise.resolve({data: {}});
            return Promise.reject(new Error('Unknown URL'));
        });

        render(
            <MemoryRouter>
                <ClusterOverview/>
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(screen.getByTestId('pool-count')).toHaveTextContent('0');
            expect(screen.getByTestId('network-count')).toHaveTextContent('0');
        });
    });

    test('handles AbortError silently without updating state', async () => {
        const abortError = new Error('Aborted');
        abortError.name = 'AbortError';
        axios.get.mockRejectedValue(abortError);

        render(
            <MemoryRouter>
                <ClusterOverview/>
            </MemoryRouter>
        );

        await act(async () => {
            await Promise.resolve();
        });

        expect(screen.getByTestId('pool-count')).toHaveTextContent('0');
        expect(screen.getByTestId('network-count')).toHaveTextContent('0');
    });

    test('does not update state if unmounted during error', async () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {
        });

        let rejectPromise;
        const promise = new Promise((_, reject) => {
            rejectPromise = reject;
        });
        axios.get.mockReturnValue(promise);

        const {unmount} = render(
            <MemoryRouter>
                <ClusterOverview/>
            </MemoryRouter>
        );

        await waitFor(() => expect(axios.get).toHaveBeenCalledTimes(2));

        unmount();

        rejectPromise(new Error('Network error'));

        await act(async () => {
            await promise.catch(() => {
            });
        });

        expect(consoleErrorSpy).not.toHaveBeenCalled();
        consoleErrorSpy.mockRestore();
    });
});
