import React from 'react';
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import ConfigSection from '../ConfigSection';
import CreateObject from '../CreateObject';
import {clearKeywordsCache} from '../ConfigText';
import {clearDesignerCache} from '../ObjectDesigner';
import {clearGrants} from '../../hooks/useGrants';
import {useActionTracker} from '../../app/action-tracker';
import {clearConfigStamps} from '../../app/config-stamps';
import useEventStore from '../../hooks/useEventStore.js';

/*
 * The wait and the force of the configuration writes (app/config-write), with
 * the answers of the daemon as it gives them.
 */

const OBJ = '/api/object/path/ns1/svc/web';
const STORED = '[DEFAULT]\nnodes = *\n\n[fs#1]\ntype = flag\n';
const json = (status, body) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
const LEAK = {title: 'Forbidden', detail: 'fs#1: a change of mnt while the resource is up on n1: stop it first'};
const HELD = {title: 'Held by another object', detail: 'fs#1: mnt /srv on n1 is held by ns1/svc/db fs#2'};

let requests;
let grants;
// Refusals by `METHOD path` (the query left out): the answers taken in order, the last kept.
let refusals;

beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('authToken', 'tok');
    clearGrants();
    clearKeywordsCache();
    clearDesignerCache();
    clearConfigStamps();
    useActionTracker.setState({tracked: [], revealed: 0});
    useEventStore.setState({objectStatus: {}, objectInstanceStatus: {}});
    requests = [];
    grants = {root: null};
    refusals = {};
    global.fetch = vi.fn((url, options = {}) => {
        const method = options.method ?? 'GET';
        requests.push({method, url, body: options.body});
        const key = `${method} ${url.split('?')[0]}`;
        const queue = refusals[key];
        if (queue && queue.length > 0) {
            const next = queue.length > 1 ? queue.shift() : queue[0];
            if (next) return Promise.resolve(json(next.status, next.body));
        }
        if (url.includes('/auth/whoami')) return Promise.resolve(json(200, {grant: grants}));
        if (method === 'GET' && url.includes('/config/file')) return Promise.resolve(new Response(STORED, {status: 200}));
        if (method === 'GET' && url.includes('/config/keywords')) return Promise.resolve(json(200, {items: [
            {option: 'mnt', section: 'fs', text: 'The mount point', converter: 'string'},
            {option: 'nodes', section: 'DEFAULT', text: 'The nodes', converter: 'string'},
        ]}));
        if (method === 'GET') return Promise.resolve(json(200, {items: [{keyword: 'nodes', value: '*'}, {keyword: 'fs#1.type', value: 'flag'}]}));
        return Promise.resolve(new Response(null, {status: 204, headers: {'OM-Last-Modified': '2026-10-23T10:00:00Z'}}));
    });
});

afterEach(() => vi.restoreAllMocks());

const writes = () => requests.filter((r) => r.method !== 'GET');
const tray = () => useActionTracker.getState().tracked.map((e) => [e.label, e.state, e.error ?? null]);

const renderConfig = () => render(
    <ConfigSection
        decodedObjectName="ns1/svc/web"
        configNode="n1"
        setConfigNode={vi.fn()}
        openSnackbar={vi.fn()}
        configDialogOpen
        setConfigDialogOpen={vi.fn()}
        inline
    />,
);

const editAndSave = async (user) => {
    await screen.findByRole('group', {name: 'Configuration file'});
    await act(() => user.click(screen.getByRole('button', {name: 'Edit configuration file'})));
    const editor = await screen.findByRole('textbox', {name: 'Configuration file'});
    fireEvent.change(editor, {target: {value: `${STORED}mnt = /srv\n`}});
    await act(() => user.click(screen.getByRole('button', {name: 'Save'})));
};

describe('the wait of a configuration write', () => {
    test('asked by default: the answer held until every live node has it', async () => {
        const user = userEvent.setup();
        renderConfig();
        await editAndSave(user);
        await waitFor(() => expect(writes()).toHaveLength(1));
        expect(writes()[0]).toMatchObject({method: 'PUT', url: `${OBJ}/config/file?wait=30s`});
    });

    test('always: no choice to leave it out, one this browser kept from before ignored', async () => {
        const user = userEvent.setup();
        localStorage.setItem('om3.config.wait', 'false');
        renderConfig();
        await screen.findByRole('group', {name: 'Configuration file'});
        await act(() => user.click(screen.getByRole('button', {name: 'Edit configuration file'})));
        await screen.findByRole('textbox', {name: 'Configuration file'});
        expect(screen.queryByRole('checkbox', {name: '--wait'})).toBeNull();
        fireEvent.change(screen.getByRole('textbox', {name: 'Configuration file'}), {target: {value: `${STORED}#\n`}});
        await act(() => user.click(screen.getByRole('button', {name: 'Save'})));
        await waitFor(() => expect(writes()).toHaveLength(1));
        expect(writes()[0].url).toBe(`${OBJ}/config/file?wait=30s`);
        localStorage.removeItem('om3.config.wait');
    });

    test('expired: written all the same, the nodes not reached said in the actions tray', async () => {
        const user = userEvent.setup();
        refusals[`PUT ${OBJ}/config/file`] = [{status: 408, body: {detail: 'the configuration has not reached n2 before the wait expired'}}];
        renderConfig();
        await editAndSave(user);
        await waitFor(() => expect(tray()).toEqual([
            ['Update the configuration', 'succeeded', 'the configuration has not reached n2 before the wait expired'],
        ]));
        // Not to be written again: the editor closed, nothing refused said.
        expect(screen.queryByRole('textbox', {name: 'Configuration file'})).toBeNull();
        expect(writes()).toHaveLength(1);
    });
});

describe('the force of a configuration write', () => {
    test('a change a resource up would leak by: root writes it anyway, past the reason said', async () => {
        const user = userEvent.setup();
        refusals[`PUT ${OBJ}/config/file`] = [{status: 403, body: LEAK}, null];
        renderConfig();
        await editAndSave(user);
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent(LEAK.detail);
        await act(() => user.click(within(alert).getByRole('button', {name: 'Write anyway (--force)'})));
        await waitFor(() => expect(writes()).toHaveLength(2));
        expect(writes()[1]).toMatchObject({method: 'PUT', url: `${OBJ}/config/file?wait=30s&force=true`});
        expect(writes()[1].body).toBe(writes()[0].body);
        await waitFor(() => expect(screen.queryByRole('textbox', {name: 'Configuration file'})).toBeNull());
    });

    test('not root: the reason said, root named as who can force it, no button', async () => {
        const user = userEvent.setup();
        grants = {admin: ['ns1']};
        refusals[`PUT ${OBJ}/config/file`] = [{status: 403, body: LEAK}];
        renderConfig();
        await editAndSave(user);
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('Only root can write it anyway, with --force.');
        expect(within(alert).queryByRole('button')).toBeNull();
    });

    test('a refusal force does not lift offers no force', async () => {
        const user = userEvent.setup();
        refusals[`PUT ${OBJ}/config/file`] = [{status: 403, body: {title: 'Forbidden', detail: 'Config validation: unknown keyword'}}];
        renderConfig();
        await editAndSave(user);
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('Config validation: unknown keyword');
        expect(within(alert).queryByRole('button')).toBeNull();
    });

    test('the parameters: written in one request, waiting once; refused, all kept, written anyway on demand', async () => {
        const user = userEvent.setup();
        refusals[`PATCH ${OBJ}/config`] = [{status: 409, body: HELD}, null];
        renderConfig();
        await screen.findByRole('group', {name: 'Configuration file'});
        await act(() => user.click(screen.getByRole('button', {name: 'Design the configuration'})));
        await screen.findByRole('navigation', {name: 'Sections'});
        const dialog = screen.getAllByRole('dialog').find((d) => within(d).queryByRole('heading', {name: 'Configuration design'}));
        // No wait to choose there: root's choice of its keywords by the buttons, once.
        expect(within(dialog).queryByRole('checkbox', {name: /--wait/})).toBeNull();
        expect(within(dialog).getAllByRole('button', {name: 'Show the keywords only root may set'})).toHaveLength(1);
        fireEvent.change(within(dialog).getByRole('textbox', {name: 'Value of nodes'}), {target: {value: 'n1 n2'}});
        await act(() => user.click(within(dialog).getByRole('button', {name: /^Apply \d+ changes?$/})));

        const alert = await within(dialog).findByRole('alert');
        expect(alert).toHaveTextContent(HELD.detail);
        expect(writes().map((w) => decodeURIComponent(w.url))).toEqual([`${OBJ}/config?set=DEFAULT.nodes=n1 n2&wait=30s`]);

        await act(() => user.click(within(alert).getByRole('button', {name: 'Write anyway (--force)'})));
        await waitFor(() => expect(writes()).toHaveLength(2));
        expect(decodeURIComponent(writes()[1].url)).toBe(`${OBJ}/config?set=DEFAULT.nodes=n1 n2&wait=30s&force=true`);
        await waitFor(() => expect(screen.queryByRole('heading', {name: 'Configuration design'})).toBeNull());
        expect(tray()[0]).toEqual(['Set nodes = n1 n2', 'succeeded', null]);
    });

    test('a file uploaded and refused: the dialog stays open, the file written anyway on demand', async () => {
        const user = userEvent.setup();
        refusals[`PUT ${OBJ}/config/file`] = [{status: 409, body: HELD}, null];
        renderConfig();
        await screen.findByRole('group', {name: 'Configuration file'});
        await act(() => user.click(screen.getByRole('button', {name: /Upload new configuration file/i})));
        await act(() => user.upload(document.querySelector('#update-config-file-upload'), new File([STORED], 'web.conf')));
        await act(() => user.click(screen.getByRole('button', {name: 'Update'})));
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent(HELD.detail);
        await act(() => user.click(within(alert).getByRole('button', {name: 'Write anyway (--force)'})));
        await waitFor(() => expect(writes()).toHaveLength(2));
        expect(writes()[1].url).toBe(`${OBJ}/config/file?wait=30s&force=true`);
        await waitFor(() => expect(screen.queryByRole('heading', {name: 'Update configuration'})).toBeNull());
    });
});

describe('the force and the wait of a creation', () => {
    const open = () => render(
        <CreateObject onClose={vi.fn()} namespaces={['ns1']} paths={[]} onCreated={vi.fn()} defaultNamespace="ns1"/>,
    );
    const create = (name) => {
        fireEvent.change(screen.getByLabelText('Name'), {target: {value: name}});
        fireEvent.click(screen.getByRole('button', {name: 'Next'}));
        fireEvent.click(screen.getByRole('button', {name: 'Next'}));
        fireEvent.click(screen.getByRole('button', {name: 'Create'}));
    };

    test('waits for the nodes by default', async () => {
        open();
        create('web');
        await waitFor(() => expect(writes()).toHaveLength(1));
        expect(writes()[0].url).toBe(`${OBJ}/config/file?wait=30s`);
    });

    test('held by another object: said as such, not as an object that exists; root creates it anyway', async () => {
        refusals[`POST ${OBJ}/config/file`] = [{status: 409, body: HELD}, null];
        open();
        create('web');
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent(`The object could not be created: ${HELD.detail}`);
        fireEvent.click(within(alert).getByRole('button', {name: 'Create anyway (--force)'}));
        await waitFor(() => expect(writes()).toHaveLength(2));
        expect(writes()[1].url).toBe(`${OBJ}/config/file?wait=30s&force=true`);
    });

    test('an object that exists: replaced on demand, by anyone', async () => {
        grants = {admin: ['ns1']};
        refusals[`POST ${OBJ}/config/file`] = [{status: 409, body: {title: 'Conflict', detail: 'Use the PUT method instead of POST to update the object config'}}, null];
        open();
        create('web');
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('ns1/svc/web already exists.');
        fireEvent.click(within(alert).getByRole('button', {name: 'Replace it (--force)'}));
        await waitFor(() => expect(writes()).toHaveLength(2));
        expect(writes()[1].url).toBe(`${OBJ}/config/file?wait=30s&force=true`);
    });
});
