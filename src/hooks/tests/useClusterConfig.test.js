import {act, renderHook} from '@testing-library/react';
import {afterEach, describe, expect, test} from 'vitest';
import useClusterConfig from '../useClusterConfig.js';
import {useMenuState} from '../useSidebarAlerts';

describe('useClusterConfig', () => {
    afterEach(() => {
        act(() => useMenuState.setState({clusterConfig: null}));
    });

    test('is empty, not loaded, until the stream of the menu gives the configuration', () => {
        const {result} = renderHook(() => useClusterConfig());
        expect(result.current).toEqual({loaded: false, clusterId: '', clusterName: '', agentUrl: ''});
    });

    test('names the cluster and its agent, and follows a change', () => {
        const {result} = renderHook(() => useClusterConfig());
        act(() => useMenuState.setState({clusterConfig: {id: 'cluster-id', name: 'dev5', ai: {agent_url: 'https://agent.example.com:8090'}}}));
        expect(result.current).toEqual({loaded: true, clusterId: 'cluster-id', clusterName: 'dev5', agentUrl: 'https://agent.example.com:8090'});
        act(() => useMenuState.setState({clusterConfig: {id: 'cluster-id', name: 'dev5'}}));
        expect(result.current.agentUrl).toBe('');
    });

    test('reads no value of another type', () => {
        const {result} = renderHook(() => useClusterConfig());
        act(() => useMenuState.setState({clusterConfig: {id: 1, name: ['dev5'], ai: {agent_url: 2}}}));
        expect(result.current).toEqual({loaded: true, clusterId: '', clusterName: '', agentUrl: ''});
    });
});
