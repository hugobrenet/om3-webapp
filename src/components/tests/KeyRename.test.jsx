import React from 'react';
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import KeysSection from '../KeysSection';
import {useActionTracker} from '../../app/action-tracker';
import {clearConfigStamps} from '../../app/config-stamps';

/* A key renamed (om <cfg> key rename), as the key store of the daemon takes it. */

const OBJ = '/api/object/path/ns1/cfg/settings';
const json = (status, body) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});

let requests;
let keys;
let patch;

beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('authToken', 'tok');
    clearConfigStamps();
    useActionTracker.setState({tracked: [], revealed: 0});
    requests = [];
    keys = ['a', 'b'];
    patch = () => {
        const [{name, to}] = JSON.parse(requests.at(-1).body);
        keys = keys.map((k) => (k === name ? to : k));
        return new Response(null, {status: 204, headers: {'OM-Last-Modified': '2026-10-23T12:00:00Z'}});
    };
    global.fetch = vi.fn((url, options = {}) => {
        const method = options.method ?? 'GET';
        requests.push({method, url, body: options.body, headers: options.headers});
        if (method === 'PATCH') return Promise.resolve(patch());
        if (url.endsWith('/data/keys')) return Promise.resolve(json(200, {items: keys.map((name) => ({name, size: 5}))}));
        if (url.includes('/data/key?')) return Promise.resolve(new Response('hello', {status: 200}));
        return Promise.resolve(json(200, {}));
    });
});

afterEach(() => vi.restoreAllMocks());

const patches = () => requests.filter((r) => r.method === 'PATCH');
const tray = () => useActionTracker.getState().tracked.map((e) => [e.label, e.state, e.error ?? null]);

/** The key `name` opened, then renamed from its view: the rename dialog. */
const openRename = async (user, name) => {
    render(<KeysSection decodedObjectName="ns1/cfg/settings" openSnackbar={vi.fn()}/>);
    const row = await screen.findByRole('rowheader', {name});
    await act(() => user.click(row.closest('tr')));
    const view = await screen.findByRole('dialog', {name: `View key: ${name}`});
    await act(() => user.click(within(view).getByRole('button', {name: 'Rename'})));
    return screen.findByRole('dialog', {name: `Rename the key ${name}`});
};

describe('a key renamed', () => {
    test('in one operation of the key store, its content kept: waiting for the nodes, said in the tray', async () => {
        const user = userEvent.setup();
        const dialog = await openRename(user, 'a');
        const input = within(dialog).getByRole('textbox', {name: 'New name'});
        expect(input).toHaveValue('a');
        // Its own name, or none: nothing to send.
        expect(within(dialog).getByRole('button', {name: 'Rename'})).toBeDisabled();
        fireEvent.change(input, {target: {value: 'dir/c'}});
        await act(() => user.click(within(dialog).getByRole('button', {name: 'Rename'})));
        await waitFor(() => expect(patches()).toHaveLength(1));
        expect(patches()[0].url).toBe(`${OBJ}/data?wait=30s`);
        expect(JSON.parse(patches()[0].body)).toEqual([{action: 'rename', name: 'a', to: 'dir/c'}]);
        expect(patches()[0].headers['Content-Type']).toBe('application/json');
        await waitFor(() => expect(screen.queryByRole('dialog', {name: 'Rename the key a'})).toBeNull());
        expect(tray()).toEqual([['Rename key a to dir/c', 'succeeded', null]]);
        expect(await screen.findByRole('rowheader', {name: 'dir/c'})).toBeInTheDocument();
    });

    test('onto a key that exists: said before it is sent', async () => {
        const user = userEvent.setup();
        const dialog = await openRename(user, 'a');
        fireEvent.change(within(dialog).getByRole('textbox', {name: 'New name'}), {target: {value: 'b'}});
        expect(within(dialog).getByText('A key b exists already.')).toBeInTheDocument();
        expect(within(dialog).getByRole('button', {name: 'Rename'})).toBeDisabled();
    });

    test('refused: the dialog stays open, the daemon\'s words in it and in the tray', async () => {
        const user = userEvent.setup();
        patch = () => json(500, {title: 'RenameKey', detail: 'a: key already exists: c'});
        const dialog = await openRename(user, 'a');
        fireEvent.change(within(dialog).getByRole('textbox', {name: 'New name'}), {target: {value: 'c'}});
        await act(() => user.click(within(dialog).getByRole('button', {name: 'Rename'})));
        expect(await within(dialog).findByRole('alert')).toHaveTextContent('a: key already exists: c');
        expect(tray()).toEqual([['Rename key a to c', 'refused', expect.stringContaining('a: key already exists: c')]]);
    });

    test('the wait always: no choice to leave it out', async () => {
        const user = userEvent.setup();
        const dialog = await openRename(user, 'a');
        expect(within(dialog).queryByRole('checkbox', {name: '--wait'})).toBeNull();
    });

    test('an update keeps the name of its key: renamed from the view only', async () => {
        const user = userEvent.setup();
        render(<KeysSection decodedObjectName="ns1/cfg/settings" openSnackbar={vi.fn()}/>);
        const row = await screen.findByRole('rowheader', {name: 'a'});
        await act(() => user.click(row.closest('tr')));
        const view = await screen.findByRole('dialog', {name: 'View key: a'});
        await act(() => user.click(within(view).getByRole('button', {name: 'Edit'})));
        const form = await screen.findByRole('dialog', {name: 'Update key'});
        await waitFor(() => expect(within(form).getByRole('textbox', {name: /Key name/i})).toHaveAttribute('readonly'));
    });
});
