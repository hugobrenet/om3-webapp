import React from 'react';
import {render, screen, fireEvent, waitFor, within} from '@testing-library/react';
import {vi} from 'vitest';
import {NamespaceConfig, NamespaceUsage} from '../NamespacePanel';
import useEventStore from '../../hooks/useEventStore';

vi.mock('../NamespaceMetrics', () => ({
    default: ({namespace}) => <div data-testid="namespace-metrics">{namespace}</div>,
}));
vi.mock('../ObjectConfig', () => ({
    default: ({path, statusPath, absent}) => <div data-testid="object-config">{`${path} ${statusPath}${absent ? ' absent' : ''}`}</div>,
}));

const GiB = 1024 ** 3;

const NSCFG = `[DEFAULT]
id = 1

[claim#1]
type = pool
name = default
limit = 20g

[claim#2]
type = network
name = default
limit = 10

[claim#3]
type = memory
limit = 4g

[claim#4]
type = cpu
limit = 400%
`;

const API = {
    '/api/pool': {items: [{name: 'default', size: 100 * GiB}, {name: 'shm', size: 4 * GiB}]},
    '/api/pool/volume': {items: [
        {path: 'prod/vol/data', pool: 'default', size: 10 * GiB},
        {path: 'prod/vol/cache', pool: 'shm', size: GiB},
    ]},
    '/api/network': {items: [{name: 'default', size: 65536}]},
    '/api/network/ip': {items: [{ip: '10.0.0.1', path: 'prod/svc/web', network: {name: 'default'}}]},
};

let requests;

beforeEach(() => {
    localStorage.setItem('authToken', 'tok');
    requests = [];
    useEventStore.setState({objectStatus: {}, objectInstanceStatus: {}});
    global.fetch = vi.fn(async (url, options = {}) => {
        requests.push({url, method: options.method ?? 'GET', body: options.body});
        if (url === '/metrics/pg') {
            return new Response(`opensvc_pg_cgroup_memory_current_bytes{namespace="prod",path="prod/svc/web"} ${GiB}`, {status: 200});
        }
        if (url === '/api/object/path/prod/nscfg/namespace/config/file') {
            return options.method === 'POST' ? new Response(null, {status: 204}) : new Response(NSCFG, {status: 200});
        }
        if (url.endsWith('/nscfg/namespace/config/file')) {
            return options.method === 'POST' ? new Response(null, {status: 204}) : new Response('{}', {status: 404});
        }
        const body = API[url];
        return body ? new Response(JSON.stringify(body), {status: 200}) : new Response('{}', {status: 404});
    });
});

afterEach(() => localStorage.clear());


describe('NamespaceUsage', () => {
    test('the usage of its objects, one by one; the claims are a tab of their own', () => {
        render(<NamespaceUsage namespace="prod"/>);
        expect(screen.getByRole('region', {name: 'CPU and memory by object'})).toContainElement(screen.getByTestId('namespace-metrics'));
        expect(screen.queryByRole('table', {name: 'Claims and usage'})).not.toBeInTheDocument();
    });
});

describe('NamespaceConfig', () => {
    test('the configuration object, as the cluster lists it: "<namespace>/"', () => {
        useEventStore.setState({objectStatus: {'prod/': {avail: 'n/a'}}});
        render(<NamespaceConfig namespace="prod"/>);
        expect(screen.getByTestId('object-config')).toHaveTextContent('prod/nscfg/namespace prod/');
    });

    test('the root namespace configuration is listed as "/"', () => {
        useEventStore.setState({objectInstanceStatus: {'/': {n1: {}}}});
        render(<NamespaceConfig namespace="root"/>);
        expect(screen.getByTestId('object-config')).toHaveTextContent('root/nscfg/namespace /');
    });

    test('none yet: the configuration edited from empty, created by its first change', () => {
        render(<NamespaceConfig namespace="dev"/>);
        expect(screen.getByTestId('object-config')).toHaveTextContent('dev/nscfg/namespace dev/ absent');
    });
});
