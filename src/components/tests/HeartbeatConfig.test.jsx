import React from 'react';
import {render, screen, fireEvent, waitFor, within} from '@testing-library/react';
import {vi} from 'vitest';
import '../../i18n';
import {HeartbeatConfigDialog, HeartbeatWizard} from '../HeartbeatConfig';

const FILE = `[cluster]
name = dev2

[hb#1]
type = unicast
addr@n1 = 10.0.0.1
addr@n2 = 10.0.0.2
port = 10011

[hb#2]
type = disk
dev = /dev/mapper/hb
`;

const KEYWORDS = {items: [
    {section: 'hb', option: 'port', text: 'The port each node listens to.', default: '10000', types: ['unicast', 'multicast']},
    {section: 'hb', option: 'dev', text: 'The device of the heartbeat.', types: ['disk'], required: true},
    {section: 'hb', option: 'timeout', text: 'The delay before a peer is gone.', default: '15s'},
]};

/** The API: the cluster configuration file, its keywords, the writes recorded. */
const mockApi = ({file = FILE, patch = {ok: true}} = {}) => {
    const calls = [];
    global.fetch = vi.fn(async (url, options = {}) => {
        calls.push({url, method: options.method ?? 'GET'});
        if (url.startsWith('/api/cluster/config/file')) return {ok: true, text: async () => file};
        if (url === '/api/cluster/config/keywords') return {ok: true, json: async () => KEYWORDS};
        if (url.startsWith('/api/cluster/config?')) return {status: 200, json: async () => ({}), text: async () => '', ...patch};
        return {ok: false, status: 404, json: async () => ({}), text: async () => ''};
    });
    return calls;
};

/** The operations of a write, its query decoded. */
const opsOf = (call) => [...new URLSearchParams(call.url.split('?')[1]).entries()];

describe('HeartbeatConfigDialog', () => {
    test('a heartbeat: its section of the cluster configuration, its secrets hidden; the wizard for root', async () => {
        const calls = mockApi();
        const onEdit = vi.fn();
        render(<HeartbeatConfigDialog name="hb#1" onClose={() => {}} onEdit={onEdit}/>);
        const dialog = screen.getByRole('dialog', {name: 'hb#1 configuration'});
        await waitFor(() => expect(dialog).toHaveTextContent('addr@n1 = 10.0.0.1'));
        expect(dialog).toHaveTextContent('[hb#1]');
        expect(dialog).not.toHaveTextContent('[hb#2]');
        expect(calls[0].url).toBe('/api/cluster/config/file?redact-secrets=true');
        fireEvent.click(within(dialog).getByRole('button', {name: 'Edit with the wizard'}));
        expect(onEdit).toHaveBeenCalled();
    });

    test('not root: the configuration only, no wizard', async () => {
        mockApi();
        render(<HeartbeatConfigDialog name="hb#2" onClose={() => {}}/>);
        await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('dev = /dev/mapper/hb'));
        expect(screen.queryByRole('button', {name: 'Edit with the wizard'})).toBeNull();
    });

    test('root, another heartbeat all up: deleted from its configuration, confirmed first', async () => {
        const calls = mockApi();
        const onDeleted = vi.fn();
        render(<HeartbeatConfigDialog name="hb#1" onClose={() => {}} onEdit={() => {}} onDeleted={onDeleted} deletable/>);
        const dialog = screen.getByRole('dialog');
        await waitFor(() => expect(dialog).toHaveTextContent('port = 10011'));
        fireEvent.click(within(dialog).getByRole('button', {name: 'Delete'}));
        expect(dialog).toHaveTextContent('Delete [hb#1] from the cluster configuration? Its streams stop on every node.');
        expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
        // Cancelled: back to the configuration.
        fireEvent.click(within(dialog).getByRole('button', {name: 'Cancel'}));
        expect(dialog).toHaveTextContent('port = 10011');
        fireEvent.click(within(dialog).getByRole('button', {name: 'Delete'}));
        fireEvent.click(within(dialog).getByRole('button', {name: 'Delete'}));
        await waitFor(() => expect(onDeleted).toHaveBeenCalledWith('hb#1'));
        expect(calls.filter((c) => c.method === 'PATCH').map(opsOf)).toEqual([[['delete', 'hb#1']]]);
    });

    test('root, no other heartbeat all up: not offered, said why', async () => {
        mockApi();
        render(<HeartbeatConfigDialog name="hb#1" onClose={() => {}} onEdit={() => {}} onDeleted={() => {}} deletable={false}/>);
        await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('port = 10011'));
        expect(screen.queryByRole('button', {name: 'Delete'})).toBeNull();
        expect(screen.getByText('It may be deleted once another heartbeat has all its streams up.')).toBeInTheDocument();
    });

    test('not root: no deletion, no word of it', async () => {
        mockApi();
        render(<HeartbeatConfigDialog name="hb#1" onClose={() => {}} deletable/>);
        await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('port = 10011'));
        expect(screen.queryByRole('button', {name: 'Delete'})).toBeNull();
        expect(document.querySelector('[data-delete-hint]')).toBeNull();
    });

    test('refused by the daemon: said, the dialog open', async () => {
        mockApi({patch: {ok: false, status: 403, json: async () => ({detail: 'not root'})}});
        const onDeleted = vi.fn();
        render(<HeartbeatConfigDialog name="hb#1" onClose={() => {}} onDeleted={onDeleted} deletable/>);
        await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('port = 10011'));
        fireEvent.click(screen.getByRole('button', {name: 'Delete'}));
        fireEvent.click(screen.getByRole('button', {name: 'Delete'}));
        expect(await screen.findByText(/^The heartbeat could not be deleted/)).toBeInTheDocument();
        expect(onDeleted).not.toHaveBeenCalled();
    });

    test('a heartbeat not in the file: said so', async () => {
        mockApi();
        render(<HeartbeatConfigDialog name="hb#9" onClose={() => {}}/>);
        expect(await screen.findByText('No [hb#9] section in the cluster configuration.')).toBeInTheDocument();
    });
});

describe('HeartbeatWizard', () => {
    const next = () => fireEvent.click(screen.getByRole('button', {name: 'Next'}));

    test('seeded by a heartbeat: its driver, its keys; the changes written in one request, the emptied unset', async () => {
        const calls = mockApi();
        const onSaved = vi.fn();
        render(<HeartbeatWizard name="hb#1" nodes={['n1', 'n2']} onClose={() => {}} onSaved={onSaved}/>);
        expect(await screen.findByRole('radio', {name: /^unicast/})).toBeChecked();
        // Its secrets told, the wizard writing them back as they are.
        expect(calls.find((c) => c.url.startsWith('/api/cluster/config/file')).url).toBe('/api/cluster/config/file?redact-secrets=false');
        next();
        // An address a node, seeded; the port, its help and its default.
        expect(screen.getByLabelText('addr on n1')).toHaveValue('10.0.0.1');
        expect(screen.getByLabelText('addr on n2')).toHaveValue('10.0.0.2');
        const port = screen.getByLabelText('port');
        expect(port).toHaveValue('10011');
        await waitFor(() => expect(port).toHaveAttribute('placeholder', '10000'));
        expect(screen.getByText('The port each node listens to.')).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('addr on n2'), {target: {value: '10.0.0.20'}});
        fireEvent.change(port, {target: {value: ''}});
        fireEvent.change(screen.getByLabelText('timeout'), {target: {value: '20s'}});
        next();
        expect(screen.getByTestId('hb-preview')).toHaveTextContent('[hb#1] type = unicast addr@n1 = 10.0.0.1 addr@n2 = 10.0.0.20 timeout = 20s');
        fireEvent.click(screen.getByRole('button', {name: 'Write'}));
        await waitFor(() => expect(onSaved).toHaveBeenCalledWith('hb#1'));
        const writes = calls.filter((c) => c.method === 'PATCH');
        expect(writes).toHaveLength(1);
        expect(opsOf(writes[0])).toEqual([
            ['set', 'hb#1.addr@n2=10.0.0.20'],
            ['set', 'hb#1.timeout=20s'],
            ['unset', 'hb#1.port'],
        ]);
    });

    test('another driver: said, the section deleted first, then the keys of the new one set', async () => {
        const calls = mockApi();
        const onSaved = vi.fn();
        render(<HeartbeatWizard name="hb#1" nodes={['n1', 'n2']} onClose={() => {}} onSaved={onSaved}/>);
        fireEvent.click(await screen.findByRole('radio', {name: /^disk/}));
        next();
        // Its required device: no going on without it.
        expect(screen.getByRole('button', {name: 'Next'})).toBeDisabled();
        fireEvent.change(screen.getByLabelText('dev (required)'), {target: {value: '/dev/mapper/hb1'}});
        next();
        expect(screen.getByText(/The driver changes from unicast to disk/)).toBeInTheDocument();
        expect(screen.getByTestId('hb-preview')).toHaveTextContent('[hb#1] type = disk dev = /dev/mapper/hb1');
        fireEvent.click(screen.getByRole('button', {name: 'Write'}));
        await waitFor(() => expect(onSaved).toHaveBeenCalled());
        const writes = calls.filter((c) => c.method === 'PATCH').map(opsOf);
        expect(writes).toEqual([
            [['delete', 'hb#1']],
            [['set', 'hb#1.type=disk'], ['set', 'hb#1.dev=/dev/mapper/hb1']],
        ]);
    });

    test('a new heartbeat: named after the others, blank, written', async () => {
        const calls = mockApi();
        const onSaved = vi.fn();
        render(<HeartbeatWizard name={null} nodes={['n1', 'n2']} onClose={() => {}} onSaved={onSaved}/>);
        expect(await screen.findByRole('dialog', {name: 'New heartbeat hb#3'})).toBeInTheDocument();
        expect(screen.getByRole('button', {name: 'Next'})).toBeDisabled();
        fireEvent.click(await screen.findByRole('radio', {name: /^multicast/}));
        next();
        fireEvent.change(screen.getByLabelText('port'), {target: {value: '10013'}});
        next();
        fireEvent.click(screen.getByRole('button', {name: 'Write'}));
        await waitFor(() => expect(onSaved).toHaveBeenCalledWith('hb#3'));
        expect(calls.filter((c) => c.method === 'PATCH').map(opsOf)).toEqual([
            [['set', 'hb#3.type=multicast'], ['set', 'hb#3.port=10013']],
        ]);
    });

    test('refused by the daemon: said, the wizard open', async () => {
        mockApi({patch: {ok: false, status: 403, json: async () => ({detail: 'not root'})}});
        const onSaved = vi.fn();
        render(<HeartbeatWizard name="hb#2" nodes={['n1']} onClose={() => {}} onSaved={onSaved}/>);
        await screen.findByRole('radio', {name: /^disk/});
        next();
        fireEvent.change(screen.getByLabelText('max_slots'), {target: {value: '8'}});
        next();
        fireEvent.click(screen.getByRole('button', {name: 'Write'}));
        expect(await screen.findByText(/^The heartbeat could not be written/)).toBeInTheDocument();
        expect(onSaved).not.toHaveBeenCalled();
    });
});
