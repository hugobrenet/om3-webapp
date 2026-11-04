import React from 'react';
import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {vi} from 'vitest';
import {ObjectSnapshots} from '../ObjectSnapshots';
import useEventStore from '../../hooks/useEventStore.js';
import {useActionTracker} from '../../app/action-tracker';

/** What the actions tray holds, the latest first: action, subject, state, reason. */
const tray = () => useActionTracker.getState().tracked.map((e) => [e.action, e.subject, e.state, e.error ?? null]);

const PATH = 'ns1/svc/web';
const OLD = {
    rid: 'sync#1', id: '1111111a-0000-4000-8000-000000000000', created_at: '2026-10-20T10:00:00Z',
    node: 'n2', members: ['fs#1', 'fs#2', 'config', 'refs.json'], location: 's3://backups',
};
const NEW = {...OLD, id: '7c0e41d2-0000-4000-8000-000000000000', created_at: '2026-10-22T10:00:00Z', node: 'n1'};
/** A snapshot as the daemon lists it: in the data of an item, the node asked in its meta. */
const item = (data) => ({kind: 'SyncSnapshotItem', meta: {node: 'n1', object: PATH}, data});

describe('ObjectSnapshots', () => {
    let requests;
    let answers;

    beforeEach(() => {
        useActionTracker.setState({tracked: []});
        localStorage.setItem('authToken', 'tok');
        requests = [];
        // The snapshots oldest first, as the daemon lists them.
        answers = {snapshots: {status: 200, body: {kind: 'SyncSnapshotList', items: [OLD, NEW].map(item)}}, restore: {status: 200, body: {}}};
        global.fetch = vi.fn(async (url, options = {}) => {
            const method = options.method ?? 'GET';
            requests.push(`${method} ${decodeURIComponent(url)}`);
            const answer = url.includes('/sync/snapshots') ? answers.snapshots : answers.restore;
            return new Response(JSON.stringify(answer.body), {status: answer.status, headers: {'Content-Type': 'application/json'}});
        });
        // n2 runs the object, n1 stands by; n3 has no store.
        useEventStore.setState({objectInstanceStatus: {[PATH]: {
            n1: {avail: 'down', resources: {'sync#1': {type: 'sync.store'}}},
            n2: {avail: 'up', resources: {'sync#1': {type: 'sync.store'}, 'fs#1': {type: 'fs.flag'}}},
            n3: {avail: 'down', resources: {'fs#1': {type: 'fs.flag'}}},
        }}});
    });

    afterEach(() => {
        localStorage.clear();
        useEventStore.setState({objectInstanceStatus: {}});
    });

    const renderSnapshots = () => render(<MemoryRouter><ObjectSnapshots path={PATH}/></MemoryRouter>);
    const rows = () => within(screen.getByRole('table', {name: 'Snapshots'})).getAllByRole('row').slice(1)
        .map((row) => within(row).getAllByRole('cell').map((c) => c.textContent));
    const posts = () => requests.filter((r) => r.startsWith('POST'));
    const openRestore = async (id) => {
        await waitFor(() => expect(rows()).toHaveLength(2));
        fireEvent.click(screen.getByRole('button', {name: `Restore ${id} of sync#1`}));
        return screen.getByRole('dialog', {name: `Restore ${id} of sync#1`});
    };

    test('read from the node running the object, the latest first: its id, resource, node, what it holds, its store', async () => {
        renderSnapshots();
        await waitFor(() => expect(rows()).toHaveLength(2));
        expect(requests).toEqual(['GET /api/node/name/n2/instance/path/ns1/svc/web/sync/snapshots']);
        const [latest, older] = rows();
        expect([latest[0], latest[1], latest[3], latest[4], latest[5]]).toEqual(['7c0e41d2', 'sync#1', 'n1', 'fs#1 fs#2 config refs.json', 's3://backups']);
        expect(older[0]).toBe('1111111a');
        // Another node holding the store asked on demand; one without, never offered.
        const asked = screen.getByLabelText('Read from');
        expect([...asked.options].map((o) => o.value)).toEqual(['n2', 'n1']);
        fireEvent.change(asked, {target: {value: 'n1'}});
        await waitFor(() => expect(requests.at(-1)).toBe('GET /api/node/name/n1/instance/path/ns1/svc/web/sync/snapshots'));
    });

    test('aside by default: into a directory, the heads picked, the configuration on demand; followed in the tray', async () => {
        renderSnapshots();
        const dialog = await openRestore('7c0e41d2');
        const submit = within(dialog).getByRole('button', {name: 'Restore aside'});
        // A directory required, an absolute one.
        expect(submit).toBeDisabled();
        fireEvent.change(within(dialog).getByLabelText('Directory'), {target: {value: 'tmp/x'}});
        expect(within(dialog).getByText('An absolute path, as /var/tmp/restore.')).toBeInTheDocument();
        expect(submit).toBeDisabled();
        fireEvent.change(within(dialog).getByLabelText('Directory'), {target: {value: '/var/tmp/web'}});
        fireEvent.click(within(dialog).getByRole('checkbox', {name: 'fs#2'}));
        fireEvent.click(within(dialog).getByRole('checkbox', {name: 'Also restore the configuration of the object'}));
        // The referenced keys in place only: said, not asked.
        expect(dialog).toHaveTextContent('restored in place only');
        fireEvent.click(submit);
        await waitFor(() => expect(posts()).toEqual([
            'POST /api/node/name/n2/instance/path/ns1/svc/web/action/restore?rid=sync#1&snapshot=7c0e41d2-0000-4000-8000-000000000000&head=fs#1&into=/var/tmp/web&config=true',
        ]));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(tray()).toEqual([['restore', 'ns1/svc/web on n2', 'succeeded', null]]);
    });

    test('in place: warned the heads are emptied, confirmed first, in red; the referenced keys as asked, every head unnamed', async () => {
        renderSnapshots();
        const dialog = await openRestore('1111111a');
        fireEvent.click(within(dialog).getByRole('radio', {name: /In place, into the heads/}));
        const submit = within(dialog).getByRole('button', {name: 'Restore in place'});
        expect(submit).toHaveClass('bg-state-down');
        expect(within(dialog).getByRole('alert')).toHaveTextContent('What the heads hold now is lost');
        expect(dialog).toHaveTextContent('The configuration of the object restores aside only.');
        expect(within(dialog).queryByLabelText('Directory')).not.toBeInTheDocument();
        expect(submit).toBeDisabled();
        fireEvent.change(within(dialog).getByLabelText('Referenced keys'), {target: {value: 'overwrite'}});
        expect(dialog).toHaveTextContent('the current values lost');
        fireEvent.click(within(dialog).getByRole('checkbox', {name: /I understand/}));
        fireEvent.click(submit);
        await waitFor(() => expect(posts()).toEqual([
            'POST /api/node/name/n2/instance/path/ns1/svc/web/action/restore?rid=sync#1&snapshot=1111111a-0000-4000-8000-000000000000&refs=overwrite',
        ]));
    });

    test('on another instance on demand: the node asked in the address', async () => {
        renderSnapshots();
        const dialog = await openRestore('7c0e41d2');
        const on = within(dialog).getByLabelText('On the instance of');
        expect([...on.options].map((o) => o.textContent)).toEqual(['n2 (up)', 'n1']);
        fireEvent.change(on, {target: {value: 'n1'}});
        fireEvent.change(within(dialog).getByLabelText('Directory'), {target: {value: '/srv/r'}});
        fireEvent.click(within(dialog).getByRole('button', {name: 'Restore aside'}));
        await waitFor(() => expect(posts()[0]).toMatch(/^POST \/api\/node\/name\/n1\/instance\/path\/ns1\/svc\/web\/action\/restore\?/));
    });

    test('no head picked: nothing sent', async () => {
        renderSnapshots();
        const dialog = await openRestore('7c0e41d2');
        fireEvent.change(within(dialog).getByLabelText('Directory'), {target: {value: '/srv/r'}});
        fireEvent.click(within(dialog).getByRole('checkbox', {name: 'fs#1'}));
        fireEvent.click(within(dialog).getByRole('checkbox', {name: 'fs#2'}));
        expect(within(dialog).getByText('Pick a head at least.')).toBeInTheDocument();
        expect(within(dialog).getByRole('button', {name: 'Restore aside'})).toBeDisabled();
    });

    test('refused: the daemon\'s words in the form, kept open; refused in the tray', async () => {
        answers.restore = {status: 409, body: {title: 'Conflict', detail: 'an action is running on ns1/svc/web'}};
        renderSnapshots();
        const dialog = await openRestore('7c0e41d2');
        fireEvent.change(within(dialog).getByLabelText('Directory'), {target: {value: '/srv/r'}});
        fireEvent.click(within(dialog).getByRole('button', {name: 'Restore aside'}));
        expect(await within(dialog).findByText('HTTP 409 an action is running on ns1/svc/web')).toBeInTheDocument();
        expect(tray()).toEqual([['restore', 'ns1/svc/web on n2', 'refused', 'HTTP 409 an action is running on ns1/svc/web']]);
    });

    test('a daemon older than the snapshots: said as such, not as a failure', async () => {
        answers.snapshots = {status: 404, body: {message: 'Not Found'}};
        renderSnapshots();
        expect(await screen.findByText(/lists no snapshots: it is older than the snapshots/)).toBeInTheDocument();
        expect(screen.queryByText(/could not be read/)).not.toBeInTheDocument();
    });

    test('a failure to read them said, with the daemon\'s words', async () => {
        answers.snapshots = {status: 500, body: {title: 'Store', detail: 's3://backups: access denied'}};
        renderSnapshots();
        expect(await screen.findByText('The snapshots could not be read: HTTP 500 s3://backups: access denied')).toBeInTheDocument();
    });

    test('none kept: said', async () => {
        answers.snapshots = {status: 200, body: {kind: 'SyncSnapshotList', items: []}};
        renderSnapshots();
        expect(await screen.findByText('No snapshot kept.')).toBeInTheDocument();
    });
});
