import React from 'react';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {vi} from 'vitest';
import CreateObjectDialog from '../CreateObjectDialog';
import useEventStore from '../../hooks/useEventStore.js';
import {useActionTracker} from '../../app/action-tracker';

const SOURCE = '[DEFAULT]\nid = 11111111-1111-4111-8111-111111111111\nnodes = *\n\n[fs#1]\ntype = flag\n';

describe('CreateObjectDialog', () => {
    /** The requests made, their method, address and body. */
    let requests;
    let answers;
    const onCreated = vi.fn();

    beforeAll(() => {
        // The list of the combobox keeps its active option in view: jsdom has no layout.
        Element.prototype.scrollIntoView ??= vi.fn();
    });

    beforeEach(() => {
        useActionTracker.setState({tracked: [], revealed: 0});
        vi.clearAllMocks();
        localStorage.setItem('authToken', 'tok');
        requests = [];
        answers = {};
        global.fetch = vi.fn((url, options = {}) => {
            requests.push({method: options.method ?? 'GET', url, body: options.body});
            const answer = answers[`${options.method ?? 'GET'} ${url}`] ?? {status: options.method === 'POST' ? 204 : 200, text: ''};
            return Promise.resolve({
                ok: answer.status < 300,
                status: answer.status,
                text: () => Promise.resolve(answer.text ?? ''),
            });
        });
        useEventStore.setState({objectStatus: {}, objectInstanceStatus: {}});
    });

    afterEach(() => {
        localStorage.clear();
    });

    const open = (props = {}) => render(
        <CreateObjectDialog
            open
            onClose={vi.fn()}
            namespaces={['ns1', 'root']}
            paths={['ns1/svc/web', 'ns1/cfg/settings']}
            onCreated={onCreated}
            {...props}
        />
    );
    const type = (label, value) => fireEvent.change(screen.getByLabelText(label), {target: {value}});
    const create = () => fireEvent.click(screen.getByRole('button', {name: 'Create'}));
    const posts = () => requests.filter((r) => r.method === 'POST');

    test('cancel closes at the first click: pressed, it leaves the name focused, no error to grow the dialog', () => {
        const onClose = vi.fn();
        open({defaultKind: 'sec', onClose});
        const name = screen.getByLabelText('Name');
        expect(name).toHaveFocus();
        const cancel = screen.getByRole('button', {name: 'Cancel'});
        // The press keeps the focus: fireEvent says false when the default is prevented.
        expect(fireEvent.mouseDown(cancel)).toBe(false);
        expect(name).toHaveFocus();
        expect(screen.queryByRole('alert')).toBeNull();
        fireEvent.click(cancel);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    test('opens on the kind it is given, the name focused', () => {
        open({defaultKind: 'cfg', defaultNamespace: 'ns1'});
        expect(screen.getByRole('dialog', {name: 'New object'})).toBeInTheDocument();
        expect(screen.getByLabelText('Kind')).toHaveValue('cfg');
        expect(screen.getByLabelText('Namespace')).toHaveValue('ns1');
        expect(screen.getByLabelText('Name')).toHaveFocus();
    });

    test('a name om refuses is said, and nothing is sent', async () => {
        open({defaultNamespace: 'ns1'});
        type('Name', 'Web');
        create();
        expect(await screen.findByText('Lowercase letters only.')).toBeInTheDocument();
        type('Name', 'node');
        expect(screen.getByText('This name is reserved by om.')).toBeInTheDocument();
        expect(posts()).toEqual([]);
    });

    test('an object that exists is said as soon as its path is typed', () => {
        open({defaultNamespace: 'ns1'});
        type('Name', 'web');
        expect(screen.getByText('ns1/svc/web already exists.')).toBeInTheDocument();
        create();
        expect(posts()).toEqual([]);
    });

    test('from scratch: the configuration is posted with a new id, the object created', async () => {
        open({defaultNamespace: 'ns1'});
        type('Name', 'db');
        expect(screen.getByText('ns1/svc/db')).toBeInTheDocument();
        create();
        await waitFor(() => expect(onCreated).toHaveBeenCalledWith('ns1/svc/db'));
        expect(useActionTracker.getState().tracked.map((e) => [e.label, e.subject, e.state])).toEqual([['Create', 'ns1/svc/db', 'succeeded']]);
        const [post] = posts();
        expect(post.url).toBe('/api/object/path/ns1/svc/db/config/file');
        expect(post.body).toMatch(/^\[DEFAULT\]\nid = [0-9a-f-]{36}\n$/);
    });

    test('a service of the root namespace is written as om writes it', async () => {
        open();
        type('Name', 'db');
        expect(screen.getByText('db')).toBeInTheDocument();
        create();
        await waitFor(() => expect(onCreated).toHaveBeenCalledWith('db'));
        expect(posts()[0].url).toBe('/api/object/path/root/svc/db/config/file');
    });

    test('a cfg or a sec, a datastore: its path alone, created empty, its keys added next', async () => {
        open({defaultKind: 'sec', defaultNamespace: 'ns1'});
        expect(screen.queryByRole('radio')).toBeNull();
        expect(screen.queryByLabelText(/^Configuration/)).toBeNull();
        expect(screen.getByText('Created empty: its keys are added next, in its panel.')).toBeInTheDocument();
        type('Name', 'tls');
        create();
        await waitFor(() => expect(onCreated).toHaveBeenCalledWith('ns1/sec/tls'));
        expect(posts()[0].url).toBe('/api/object/path/ns1/sec/tls/config/file');
        expect(posts()[0].body).toMatch(/^\[DEFAULT\]\nid = [0-9a-f-]+\n$/);
    });

    test('a namespace configuration takes the name om gives it', async () => {
        open({defaultNamespace: 'ns2'});
        fireEvent.change(screen.getByLabelText('Kind'), {target: {value: 'nscfg'}});
        expect(screen.getByLabelText('Name')).toHaveValue('namespace');
        expect(screen.getByLabelText('Name')).toBeDisabled();
        create();
        await waitFor(() => expect(onCreated).toHaveBeenCalledWith('ns2/nscfg/namespace'));
    });

    test('a copy starts from the configuration of the object, its id replaced', async () => {
        answers['GET /api/object/path/ns1/svc/web/config/file?redact-secrets=false'] = {status: 200, text: SOURCE};
        open({defaultNamespace: 'ns1'});
        type('Name', 'web2');
        fireEvent.click(screen.getByRole('radio', {name: 'A copy of an object'}));
        fireEvent.click(screen.getByRole('combobox', {name: 'Object to copy'}));
        fireEvent.click(screen.getByRole('option', {name: 'ns1/svc/web'}));
        await waitFor(() => expect(screen.getByLabelText('Configuration')).toHaveValue(SOURCE));
        create();
        await waitFor(() => expect(onCreated).toHaveBeenCalledWith('ns1/svc/web2'));
        const body = posts()[0].body;
        expect(body).not.toContain('11111111-1111');
        expect(body).toMatch(/^\[DEFAULT\]\nid = [0-9a-f-]{36}\nnodes = \*\n\n\[fs#1\]\ntype = flag\n$/);
    });

    test('a refusal of the daemon is said in the dialog', async () => {
        answers['POST /api/object/path/ns1/svc/db/config/file'] = {status: 400, text: JSON.stringify({detail: 'bad keyword'})};
        open({defaultNamespace: 'ns1'});
        type('Name', 'db');
        create();
        expect(await screen.findByRole('alert')).toHaveTextContent('The object could not be created: bad keyword');
        expect(onCreated).not.toHaveBeenCalled();
    });

    test('provisioned once the daemon reports the new object', async () => {
        open({defaultNamespace: 'ns1'});
        type('Name', 'db');
        fireEvent.click(screen.getByRole('checkbox', {name: 'Provision once created'}));
        create();
        await waitFor(() => expect(posts()).toHaveLength(1));
        expect(onCreated).not.toHaveBeenCalled();
        act(() => {
            useEventStore.setState({
                objectStatus: {'ns1/svc/db': {avail: 'down'}},
                objectInstanceStatus: {'ns1/svc/db': {node1: {avail: 'down'}}},
            });
        });
        await waitFor(() => expect(onCreated).toHaveBeenCalledWith('ns1/svc/db'));
        expect(posts()[1].url).toBe('/api/object/path/ns1/svc/db/action/provision');
        // The creation, then the provisioning, in the actions tray.
        expect(useActionTracker.getState().tracked.map((e) => [e.action, e.subject])).toEqual(expect.arrayContaining([
            ['create', 'ns1/svc/db'],
        ]));
    });

    test('a configuration has nothing to provision', () => {
        open({defaultKind: 'cfg'});
        expect(screen.queryByRole('checkbox', {name: 'Provision once created'})).not.toBeInTheDocument();
    });
});
