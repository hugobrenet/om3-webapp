import React from 'react';
import {render as renderInDom, screen, fireEvent, waitFor, within} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {vi} from 'vitest';
import {NamespaceClaims} from '../NamespaceClaims';
import {clearGrants} from '../../hooks/useGrants';
import useEventStore from '../../hooks/useEventStore';
import {resetPgUsage} from '../../hooks/usePgUsage';

/** Rendered in a router: its badges open their records over the view. */
const render = (ui) => renderInDom(<MemoryRouter>{ui}</MemoryRouter>);

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
default = 50%
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
let grant;
let refuse;

beforeEach(() => {
    localStorage.setItem('authToken', 'tok');
    clearGrants();
    requests = [];
    grant = {squatter: null};
    refuse = null;
    resetPgUsage();
    // One node, its cgroups read through the API.
    useEventStore.setState({nodeStatus: {n1: {}}, objectInstanceStatus: {}});
    global.fetch = vi.fn(async (url, options = {}) => {
        const method = options.method ?? 'GET';
        requests.push({url, method, body: options.body});
        if (url === '/api/auth/whoami') return new Response(JSON.stringify({grant}), {status: 200});
        if (url === '/api/node/name/n1/metrics/pg') {
            return new Response(`opensvc_pg_cgroup_memory_current_bytes{namespace="prod",path="prod/svc/web"} ${GiB}`, {status: 200});
        }
        if (method !== 'GET') {
            if (refuse) return new Response(JSON.stringify({detail: refuse}), {status: 403});
            return method === 'POST' ? new Response(null, {status: 204}) : new Response(JSON.stringify({is_changed: true}), {status: 200});
        }
        if (url === '/api/object/path/prod/nscfg/namespace/config/file') return new Response(NSCFG, {status: 200});
        if (url.endsWith('/nscfg/namespace/config/file')) return new Response('{}', {status: 404});
        const body = API[url];
        return body ? new Response(JSON.stringify(body), {status: 200}) : new Response('{}', {status: 404});
    });
});

afterEach(() => {
    resetPgUsage();
    localStorage.clear();
});

const claimsTable = () => screen.getByRole('table', {name: 'Claims and usage'});
const line = (text) => within(claimsTable()).getAllByRole('row').find((r) => r.textContent.startsWith(text));
const cells = (text) => within(line(text)).getAllByRole('cell').map((c) => c.textContent);
const dialog = () => screen.getByRole('dialog');
const next = () => fireEvent.click(within(dialog()).getByRole('button', {name: 'Next'}));
/** The keyword operations of the write sent, decoded. */
const written = (method) => {
    const request = requests.find((r) => r.method === method);
    const params = new URLSearchParams(request.url.split('?')[1]);
    return {url: request.url.split('?')[0], set: params.getAll('set'), unset: params.getAll('unset'), delete: params.getAll('delete'), body: request.body};
};
/** Rendered for a squatter, the claims read and the actions offered. */
const renderClaims = async (namespace = 'prod') => {
    render(<NamespaceClaims namespace={namespace}/>);
    await screen.findByRole('button', {name: 'Add a claim'});
};

describe('NamespaceClaims: the table', () => {
    test('each claim: what is used of it, its limit, the share and what is left', async () => {
        render(<NamespaceClaims namespace="prod"/>);
        await waitFor(() => expect(line('Pooldefault')).toBeDefined());
        expect(cells('Pooldefault').slice(0, 3)).toEqual(['Pooldefault', '10 GiB', '20 GiB']);
        expect(cells('Pooldefault')[4]).toBe('10 GiB');
        expect(within(line('Pooldefault')).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
        expect(cells('Networkdefault').slice(0, 3)).toEqual(['Networkdefault', '1', '10']);
        await waitFor(() => expect(cells('Memory').slice(0, 3)).toEqual(['Memory', '1 GiB', '4 GiB']));
        expect(cells('Memory')[4]).toBe('3 GiB');
        // No trend column, no sparkline.
        expect(screen.queryByRole('img', {name: /last 5 minutes/i})).not.toBeInTheDocument();
    });

    test('the cpu claim in cpu', async () => {
        render(<NamespaceClaims namespace="prod"/>);
        await waitFor(() => expect(line('CPU')).toBeDefined());
        expect(cells('CPU')[2]).toBe('4 cpu');
    });

    test('a pool used without a claim: out of its size, said so', async () => {
        render(<NamespaceClaims namespace="prod"/>);
        await waitFor(() => expect(line('Poolshm')).toBeDefined());
        expect(cells('Poolshm').slice(0, 3)).toEqual(['Poolshm', '1 GiB', '4 GiB (pool size, no claim)']);
    });

    test('a namespace claiming nothing is told it is capped by nothing but the pools and networks', async () => {
        render(<NamespaceClaims namespace="dev"/>);
        expect(await screen.findByText(/claims nothing/)).toBeInTheDocument();
        expect(within(claimsTable()).getByText('No pool, network, cpu or memory used.')).toBeInTheDocument();
    });
});

describe('NamespaceClaims: who may change them', () => {
    test('an admin of the namespace reads them, changes none: the daemon asks root or the squatter grant', async () => {
        grant = {admin: ['prod']};
        render(<NamespaceClaims namespace="prod"/>);
        expect(await screen.findByText(/Only root and the squatters/)).toBeInTheDocument();
        await waitFor(() => expect(line('Pooldefault')).toBeDefined());
        expect(screen.queryByRole('button', {name: 'Add a claim'})).not.toBeInTheDocument();
        expect(screen.queryByRole('button', {name: /^Edit the claim/})).not.toBeInTheDocument();
    });

    test.each([[{root: null}], [{squatter: null}]])('%o adds, edits and removes them', async (g) => {
        grant = g;
        await renderClaims();
        await waitFor(() => expect(line('Pooldefault')).toBeDefined());
        expect(within(line('Pooldefault')).getByRole('button', {name: 'Edit the claim of default'})).toBeInTheDocument();
        expect(within(line('Pooldefault')).getByRole('button', {name: 'Remove the claim of default'})).toBeInTheDocument();
        // Used without a claim: claimed of from its line.
        expect(within(line('Poolshm')).getByRole('button', {name: 'Claim of shm'})).toBeInTheDocument();
    });
});

describe('NamespaceClaims: the wizard', () => {
    test('a new claim in steps: what, which, how much, then what is written, read back first', async () => {
        await renderClaims();
        await waitFor(() => expect(line('Pooldefault')).toBeDefined());
        fireEvent.click(screen.getByRole('button', {name: 'Add a claim'}));
        expect(dialog()).toHaveAccessibleName('New claim of prod');
        // Cpu and memory claimed already, the only network too: changed, not claimed twice.
        expect(within(dialog()).getByRole('radio', {name: /^CPU/})).toBeDisabled();
        expect(within(dialog()).getByRole('radio', {name: /^Memory/})).toBeDisabled();
        expect(within(dialog()).getByRole('radio', {name: /^Addresses of a network/})).toBeDisabled();
        expect(within(dialog()).getByRole('button', {name: 'Next'})).toBeDisabled();
        fireEvent.click(within(dialog()).getByRole('radio', {name: /^Storage of a pool/}));
        next();
        // Which pool: the ones not claimed yet, with what it uses of each.
        expect(within(dialog()).getAllByRole('radio').map((r) => r.value)).toEqual(['shm']);
        expect(within(dialog()).getByText('1 GiB used of 4 GiB')).toBeInTheDocument();
        fireEvent.click(within(dialog()).getByRole('radio', {name: /shm/}));
        next();
        const amount = within(dialog()).getByLabelText('Most it may take of shm');
        fireEvent.change(amount, {target: {value: '2'}});
        expect(within(dialog()).getByLabelText('Unit')).toHaveValue('g');
        next();
        expect(within(dialog()).getByText('prod may take up to 2 GiB of the pool shm.')).toBeInTheDocument();
        expect(within(dialog()).getByTestId('claim-preview')).toHaveTextContent('[claim#5] type = pool name = shm limit = 2g');
        fireEvent.click(within(dialog()).getByRole('button', {name: 'Save the claim'}));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(written('PATCH')).toMatchObject({
            url: '/api/object/path/prod/nscfg/namespace/config',
            set: ['claim#5.type=pool', 'claim#5.name=shm', 'claim#5.limit=2g'],
            unset: [],
        });
        // Read again at once, the table showing the claim written.
        await waitFor(() => expect(requests.filter((r) => r.url.endsWith('/nscfg/namespace/config/file')).length).toBeGreaterThan(1));
    });

    test('a pool used without a claim, claimed from its line: straight to how much', async () => {
        await renderClaims();
        await waitFor(() => expect(line('Poolshm')).toBeDefined());
        fireEvent.click(within(line('Poolshm')).getByRole('button', {name: 'Claim of shm'}));
        expect(within(dialog()).getByLabelText('Most it may take of shm')).toBeInTheDocument();
        expect(within(dialog()).getByText(/Used now: 1 GiB\. Pool size: 4 GiB\./)).toBeInTheDocument();
        // Nothing to go back to: its type and its pool are given.
        expect(within(dialog()).queryByRole('button', {name: 'Back'})).not.toBeInTheDocument();
        // More than the pool: allowed, the pool capping first.
        fireEvent.change(within(dialog()).getByLabelText('Most it may take of shm'), {target: {value: '8'}});
        expect(within(dialog()).getByText(/the pool caps it first/)).toBeInTheDocument();
    });

    test('an edit starts from the limit written, its unit kept, and rewrites the section', async () => {
        await renderClaims();
        await waitFor(() => expect(cells('Memory').slice(0, 3)).toEqual(['Memory', '1 GiB', '4 GiB']));
        fireEvent.click(within(line('Memory')).getByRole('button', {name: 'Edit the claim of Memory'}));
        const amount = within(dialog()).getByLabelText('Most memory it may use');
        expect(amount).toHaveValue('4');
        expect(within(dialog()).getAllByLabelText('Unit')[0]).toHaveValue('g');
        // Under what is used now: a warning, not a refusal.
        fireEvent.change(amount, {target: {value: '512'}});
        fireEvent.change(within(dialog()).getAllByLabelText('Unit')[0], {target: {value: 'm'}});
        expect(within(dialog()).getByRole('alert')).toHaveTextContent(/Below the 1 GiB used now/);
        fireEvent.change(amount, {target: {value: '8'}});
        fireEvent.change(within(dialog()).getAllByLabelText('Unit')[0], {target: {value: 'g'}});
        next();
        fireEvent.click(within(dialog()).getByRole('button', {name: 'Save the claim'}));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        // No default before, none unset.
        expect(written('PATCH')).toMatchObject({set: ['claim#3.type=memory', 'claim#3.limit=8g'], unset: []});
    });

    test('cpu in cpus, written in hundredths of a cpu as om3 reads it; its default kept or removed', async () => {
        await renderClaims();
        await waitFor(() => expect(line('CPU')).toBeDefined());
        fireEvent.click(within(line('CPU')).getByRole('button', {name: 'Edit the claim of CPU'}));
        const amount = within(dialog()).getByLabelText('Most cpus it may use');
        expect(amount).toHaveValue('4');
        expect(within(dialog()).getByLabelText('Cpus of a container setting none (optional)')).toHaveValue('0.5');
        // Not a number: said, and no step further.
        fireEvent.change(amount, {target: {value: '2x'}});
        expect(within(dialog()).getByText('Enter a number greater than 0.')).toBeInTheDocument();
        expect(within(dialog()).getByRole('button', {name: 'Next'})).toBeDisabled();
        fireEvent.change(amount, {target: {value: '1,5'}});
        fireEvent.change(within(dialog()).getByLabelText('Cpus of a container setting none (optional)'), {target: {value: ''}});
        next();
        expect(within(dialog()).getByTestId('claim-preview')).toHaveTextContent('[claim#4] type = cpu limit = 150%');
        fireEvent.click(within(dialog()).getByRole('button', {name: 'Save the claim'}));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(written('PATCH')).toMatchObject({set: ['claim#4.type=cpu', 'claim#4.limit=150%'], unset: ['claim#4.default']});
    });

    test('a claim removed, confirmed first, its section deleted', async () => {
        await renderClaims();
        await waitFor(() => expect(line('Pooldefault')).toBeDefined());
        fireEvent.click(within(line('Pooldefault')).getByRole('button', {name: 'Remove the claim of default'}));
        expect(dialog()).toHaveTextContent('prod will no longer be limited to 20 GiB of default.');
        expect(dialog()).toHaveTextContent(/capped by nothing but the size of the pool/);
        fireEvent.click(within(dialog()).getByRole('button', {name: 'Remove'}));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(written('PATCH')).toMatchObject({url: '/api/object/path/prod/nscfg/namespace/config', delete: ['claim#1']});
    });

    test('the first claim of a namespace without configuration creates it, with an id, the claim in it', async () => {
        await renderClaims('dev');
        fireEvent.click(screen.getByRole('button', {name: 'Add a claim'}));
        fireEvent.click(within(dialog()).getByRole('radio', {name: /^CPU/}));
        next();
        fireEvent.change(within(dialog()).getByLabelText('Most cpus it may use'), {target: {value: '2'}});
        next();
        expect(dialog()).toHaveTextContent('dev has no configuration object yet: it is created with this claim.');
        fireEvent.click(within(dialog()).getByRole('button', {name: 'Save the claim'}));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        const post = written('POST');
        expect(post).toMatchObject({url: '/api/object/path/dev/nscfg/namespace/config/file', set: ['claim#1.type=cpu', 'claim#1.limit=200%']});
        expect(post.body).toMatch(/^\[DEFAULT\]\nid = [0-9a-f-]{36}\n/);
    });

    test('a write refused says why, in the wizard, which stays open', async () => {
        refuse = 'requires the squatter grant';
        await renderClaims();
        await waitFor(() => expect(line('Poolshm')).toBeDefined());
        fireEvent.click(within(line('Poolshm')).getByRole('button', {name: 'Claim of shm'}));
        fireEvent.change(within(dialog()).getByLabelText('Most it may take of shm'), {target: {value: '2'}});
        next();
        fireEvent.click(within(dialog()).getByRole('button', {name: 'Save the claim'}));
        expect(await within(dialog()).findByText(/could not be written: .*requires the squatter grant/)).toBeInTheDocument();
    });
});
