import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {act, renderHook} from '@testing-library/react';
import useFetchDaemonStatus from '../useFetchDaemonStatus.jsx';
import {fetchDaemonStatus} from '../../services/api';

vi.mock('../../services/api', () => ({fetchDaemonStatus: vi.fn()}));
const status = (id = 'cluster-id', node = 'node1') => ({
    daemon: {nodename: node},
    cluster: {config: {id, name: 'cluster'}, node: {[node]: {}}},
});

describe('daemon status AI target', () => {
    beforeEach(() => localStorage.clear());
    afterEach(() => localStorage.clear());
    it('does not enable AI routing from cached daemon metadata', () => {
        localStorage.setItem('cachedDaemon', JSON.stringify({nodename: 'cached-node'}));
        localStorage.setItem('cachedClusterId', 'cached-cluster');
        const {result} = renderHook(useFetchDaemonStatus);
        expect(result.current.daemon.nodename).toBe('cached-node');
        expect(result.current.clusterId).toBe('');
    });
    it('exposes the fresh cluster ID and the existing daemon nodename', async () => {
        fetchDaemonStatus.mockResolvedValue(status());
        const {result} = renderHook(useFetchDaemonStatus);
        await act(async () => {
            await result.current.fetchNodes('token');
        });
        expect(result.current.clusterId).toBe('cluster-id');
        expect(result.current.daemon.nodename).toBe('node1');
        expect(localStorage.getItem('cachedClusterId')).toBeNull();
    });
    it.each([undefined, 42, ''])(
        'leaves routing unavailable if the daemon lacks a valid ID (%s)',
        async (id) => {
            const response = status();
            response.cluster.config.id = id;
            fetchDaemonStatus.mockResolvedValue(response);
            const {result} = renderHook(useFetchDaemonStatus);
            await act(async () => {
                await result.current.fetchNodes('token');
            });
            expect(result.current.clusterId).toBe('');
        }
    );
    it('clears the target on failure or missing authentication', async () => {
        fetchDaemonStatus.mockResolvedValue(status());
        const {result} = renderHook(useFetchDaemonStatus);
        await act(async () => {
            await result.current.fetchNodes('token');
        });
        fetchDaemonStatus.mockRejectedValueOnce(new Error('unavailable'));
        await act(async () => {
            await result.current.fetchNodes('token');
        });
        expect(result.current.clusterId).toBe('');
        await act(async () => {
            await result.current.fetchNodes('token');
        });
        expect(result.current.clusterId).toBe('cluster-id');
        await act(async () => {
            await result.current.fetchNodes(null);
        });
        expect(result.current.clusterId).toBe('');
    });
    it('ignores a late result superseded by a newer target', async () => {
        let finishOld;
        fetchDaemonStatus
            .mockImplementationOnce(
                () =>
                    new Promise((resolve) => {
                        finishOld = resolve;
                    })
            )
            .mockResolvedValueOnce(status('new-cluster', 'node2'));
        const {result} = renderHook(useFetchDaemonStatus);
        let oldRequest;
        act(() => {
            oldRequest = result.current.fetchNodes('old-token');
        });
        await act(async () => {
            await result.current.fetchNodes('new-token');
        });
        await act(async () => {
            finishOld(status('old-cluster'));
            await oldRequest;
        });
        expect(result.current.clusterId).toBe('new-cluster');
        expect(result.current.daemon.nodename).toBe('node2');
    });
});
