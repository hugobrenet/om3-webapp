import React from 'react';
import i18n from '../../i18n';
import {render, screen, waitFor, act, within, fireEvent, cleanup} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {vi} from 'vitest';
import KeysSection from '../KeysSection';
import {resetMaxKeySize} from '../../hooks/useMaxKeySize';
import {CA_PEM, LEAF_PEM} from '../../utils/tests/certificates.fixture';
import {useActionTracker} from '../../app/action-tracker';

// ── Mocks ──────────────────────────────────────────────────────────────
vi.mock('../../hooks/useEventStore.js', () => ({default: vi.fn()}));
vi.mock('../../eventSourceManager.jsx', () => ({
    retainEventReception: vi.fn(() => () => {}),
    configureEventSource: vi.fn(),
}));

const mockLocalStorage = {
    getItem: vi.fn(() => 'mock-token'),
    setItem: vi.fn(),
    removeItem: vi.fn(),
};
Object.defineProperty(global, 'localStorage', {value: mockLocalStorage});

const user = userEvent.setup();
const openSnackbar = vi.fn();
// The writes said in the actions tray, newest first.
const tray = () => useActionTracker.getState().tracked.map((e) => [e.label, e.subject, e.state, e.error ?? null]);
// No success nor progress said by snackbar: the tray says it.
const noWriteSnackbar = () => expect(openSnackbar.mock.calls.filter(([, severity]) => severity !== 'error')).toEqual([]);
const queryLoading = (container = screen) => container.queryByRole('status', {name: /^Loading/});
const encodeText = (text) => new TextEncoder().encode(text);
const makeMockBlob = (uint8Array) => ({
    arrayBuffer: () => Promise.resolve(uint8Array.buffer.slice(uint8Array.byteOffset, uint8Array.byteOffset + uint8Array.byteLength)),
    size: uint8Array.byteLength,
    type: 'application/octet-stream',
});

const mockFetch = ({keys = [], keyBlob = null, methods = {}} = {}) => {
    global.fetch = vi.fn((url, options = {}) => {
        const method = options.method || 'GET';
        if (methods[method]) {
            const res = methods[method](url, options);
            if (res !== undefined) return res;
        }
        if (url.includes('/data/keys')) return Promise.resolve({ok: true, json: () => Promise.resolve({items: keys})});
        if (url.includes('/data/key')) {
            const blob = keyBlob ?? makeMockBlob(encodeText('hello world'));
            return Promise.resolve({ok: true, blob: () => Promise.resolve(blob)});
        }
        return Promise.resolve({ok: true, json: () => Promise.resolve({})});
    });
};

const renderAndWait = async (objectName, expectedCount) => {
    render(<KeysSection decodedObjectName={objectName} openSnackbar={openSnackbar}/>);
    if (expectedCount !== null) {
        await waitFor(() => {
            expect(screen.getByText((content) =>
                content.includes('Object Keys') && content.includes(String(expectedCount))
            )).toBeInTheDocument();
        }, {timeout: 15000});
    }
    await waitFor(() => expect(queryLoading()).not.toBeInTheDocument());
};

/**
 * Opens the dialog of an action. A key is edited or removed from its own dialog,
 * which the click on its line opens: `onViewShown` runs once it is shown, before
 * the action is chosen in it.
 */
const openDialog = async (action, keyName = 'key1', {onViewShown} = {}) => {
    if (action === 'edit' || action === 'delete') {
        const row = (await screen.findByRole('rowheader', {name: keyName})).closest('tr');
        await act(async () => {
            await user.click(row);
        });
        const view = await screen.findByRole('dialog', {name: `View Key: ${keyName}`});
        await waitFor(() => expect(within(view).queryByRole('status', {name: 'Loading key content'})).not.toBeInTheDocument());
        onViewShown?.();
        await act(async () => {
            await user.click(within(view).getByRole('button', {name: action === 'edit' ? 'Edit' : 'Remove'}));
        });
        return screen.findByRole('dialog', {name: action === 'edit' ? 'Update Key' : 'Confirm Key Deletion'});
    }
    const btnMap = {
        create: () => screen.getByRole('button', {name: /add new key/i}),
        // The line of the key shows it.
        view: () => screen.findByRole('rowheader', {name: keyName}).then((h) => h.closest('tr')),
    };
    if (!btnMap[action]) throw new Error('Unknown action: ' + action);
    const btn = await btnMap[action]();
    await act(async () => {
        await user.click(btn);
    });
    return screen.findByRole('dialog');
};

/** A file browsed for: binary, it is sent as is (a text file is loaded in place to edit). */
const uploadFileInDialog = async (dialog) => {
    const fileInput = within(dialog).getByTestId('key-file-input');
    await act(async () => {
        await user.upload(fileInput, new File([new Uint8Array([0x00, 0x01, 0x02])], 'test.bin', {type: 'application/octet-stream'}));
    });
    await waitFor(() => expect(within(dialog).getByText('test.bin')).toBeInTheDocument());
};

const fillNameAndSubmit = async (dialog, name, btnName) => {
    const nameInput = within(dialog).getByRole('textbox', {name: /Key Name/i});
    await act(async () => {
        await user.clear(nameInput);
        await user.type(nameInput, name);
    });
    const submitBtn = within(dialog).getByRole('button', {name: new RegExp(btnName, 'i')});
    await act(async () => {
        await user.click(submitBtn);
    });
};

beforeEach(() => {
    vi.clearAllMocks();
    mockLocalStorage.getItem.mockReturnValue('mock-token');
    useActionTracker.setState({tracked: [], revealed: 0});
});

// ── Tests ──────────────────────────────────────────────────────────────
describe('KeysSection', () => {
    test.each([
        ['service path', 'root/svc/service1'],
        ['null', null],
        ['short path', 'cluster'],
        ['invalid kind', 'root/invalid/test'],
    ])('does not render for %s', async (_, objectName) => {
        render(<KeysSection decodedObjectName={objectName} openSnackbar={openSnackbar}/>);
        await waitFor(() => expect(screen.queryByText(/Object Keys/i)).not.toBeInTheDocument());
    });

    test('the keys are on all the nodes: no node column; a line clicked shows its key, no tool on it', async () => {
        mockFetch({keys: [{name: 'k', node: 'n', size: 100}]});
        await renderAndWait('root/sec/sec1', 1);
        expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['', 'Name▲', 'Size']);
        expect(screen.queryByText('n')).not.toBeInTheDocument();
        // The names at the left, as the other columns.
        expect(screen.getByRole('rowheader', {name: 'k'})).toHaveClass('text-left');
        expect(screen.queryByRole('button', {name: 'View key k'})).not.toBeInTheDocument();
        const row = screen.getByRole('rowheader', {name: 'k'}).closest('tr');
        expect(row).toHaveAttribute('title', 'View key k');
        // Edited and removed from its dialog and the selection: no tool on the line.
        expect(within(row).queryByRole('button')).toBeNull();
        // Solid: "Add" in a wide window, the plus alone in a narrow one; named in full.
        const add = screen.getByRole('button', {name: 'Add new key'});
        expect(add).toHaveClass('bg-accent', 'max-md:w-7');
        expect(add).toHaveTextContent(/^Add$/);
    });

    test('the key shown, edited or removed from its dialog: the dialog of the action in its place', async () => {
        mockFetch({keys: [{name: 'k', node: 'n', size: 5}], keyBlob: makeMockBlob(encodeText('hello'))});
        await renderAndWait('root/cfg/cfg1', 1);
        let view = await openDialog('view', 'k');
        expect(view).toHaveAccessibleName('View Key: k');
        const remove = within(view).getByRole('button', {name: 'Remove'});
        expect(remove).toHaveClass('bg-state-down');
        await act(async () => {
            await user.click(within(view).getByRole('button', {name: 'Edit'}));
        });
        const update = await screen.findByRole('dialog', {name: 'Update Key'});
        expect(screen.queryByRole('dialog', {name: 'View Key: k'})).not.toBeInTheDocument();
        await waitFor(() => expect(within(update).getByDisplayValue('hello')).toBeInTheDocument());
        await act(async () => {
            await user.click(within(update).getByRole('button', {name: 'Cancel'}));
        });

        view = await openDialog('view', 'k');
        await act(async () => {
            await user.click(within(view).getByRole('button', {name: 'Remove'}));
        });
        const confirm = await screen.findByRole('dialog', {name: 'Confirm Key Deletion'});
        expect(confirm).toHaveTextContent('k');
        expect(screen.queryByRole('dialog', {name: 'View Key: k'})).not.toBeInTheDocument();
    });

    test('of the keys removed together, one refused: the others still go, each said in the tray', async () => {
        const deleted = [];
        mockFetch({
            keys: [{name: 'k1', node: 'n', size: 1}, {name: 'k2', node: 'n', size: 2}],
            methods: {DELETE: (url) => {
                const name = new URL(url, 'http://x').searchParams.get('name');
                if (name === 'k1') return Promise.resolve({ok: false, status: 403, json: async () => ({detail: 'forbidden'})});
                deleted.push(name);
                return Promise.resolve({ok: true});
            }},
        });
        await renderAndWait('root/cfg/cfg1', 2);
        await act(async () => {
            await user.click(screen.getByRole('checkbox', {name: 'Select key k1'}));
            await user.click(screen.getByRole('checkbox', {name: 'Select key k2'}));
        });
        await act(async () => {
            await user.click(screen.getByRole('button', {name: 'Remove 2 keys'}));
        });
        const confirm = await screen.findByRole('dialog', {name: 'Confirm Key Deletion'});
        await act(async () => {
            await user.click(within(confirm).getByRole('button', {name: /Delete/}));
        });
        await waitFor(() => expect(tray()).toHaveLength(2));
        expect(tray()).toEqual([
            ['Delete key k2', 'root/cfg/cfg1', 'succeeded', null],
            ['Delete key k1', 'root/cfg/cfg1', 'refused', expect.stringMatching(/^HTTP 403/)],
        ]);
        expect(deleted).toEqual(['k2']);
    });

    test('the keys checked, removed together once confirmed; nothing checked, a hint', async () => {
        const deleted = [];
        mockFetch({
            keys: [{name: 'k1', node: 'n', size: 1}, {name: 'k2', node: 'n', size: 2}, {name: 'k3', node: 'n', size: 3}],
            methods: {DELETE: (url) => {
                deleted.push(new URL(url, 'http://x').searchParams.get('name'));
                return Promise.resolve({ok: true});
            }},
        });
        await renderAndWait('root/cfg/cfg1', 3);
        // In the header of the list, left of the Add button.
        const hint = screen.getByText('Check keys to select them.');
        const add = screen.getByRole('button', {name: 'Add new key'});
        expect(hint.parentElement.nextElementSibling).toBe(add);
        await act(async () => {
            await user.click(screen.getByRole('checkbox', {name: 'Select key k1'}));
            await user.click(screen.getByRole('checkbox', {name: 'Select key k3'}));
        });
        // A checkbox checks: it does not show the key.
        expect(screen.queryByRole('dialog', {name: /View Key/})).not.toBeInTheDocument();
        const remove = screen.getByRole('button', {name: 'Remove 2 keys'});
        expect(remove).toHaveClass('bg-state-down');
        expect(remove.parentElement.nextElementSibling).toBe(add);
        expect(screen.queryByText('Check keys to select them.')).not.toBeInTheDocument();
        await act(async () => {
            await user.click(remove);
        });
        const confirm = await screen.findByRole('dialog', {name: 'Confirm Key Deletion'});
        expect(confirm).toHaveTextContent('delete the 2 keys k1, k3?');
        await act(async () => {
            await user.click(within(confirm).getByRole('button', {name: /Delete/}));
        });
        // One entry a key, newest first.
        await waitFor(() => expect(tray()).toEqual([
            ['Delete key k3', 'root/cfg/cfg1', 'succeeded', null],
            ['Delete key k1', 'root/cfg/cfg1', 'succeeded', null],
        ]));
        expect(deleted).toEqual(['k1', 'k3']);
    });

    test('the key edited, removed from its dialog: the confirmation in its place', async () => {
        mockFetch({keys: [{name: 'k', node: 'n', size: 5}], keyBlob: makeMockBlob(encodeText('hello'))});
        await renderAndWait('root/cfg/cfg1', 1);
        const update = await openDialog('edit', 'k');
        const remove = within(update).getByRole('button', {name: 'Remove'});
        expect(remove).toHaveClass('bg-state-down');
        await act(async () => {
            await user.click(remove);
        });
        const confirm = await screen.findByRole('dialog', {name: 'Confirm Key Deletion'});
        expect(confirm).toHaveTextContent('delete the key k?');
        expect(screen.queryByRole('dialog', {name: 'Update Key'})).not.toBeInTheDocument();
    });

    test('all the keys selected at once by the checkbox of the header, mixed when some are', async () => {
        mockFetch({keys: [{name: 'k1', node: 'n', size: 1}, {name: 'k2', node: 'n', size: 2}]});
        await renderAndWait('root/cfg/cfg1', 2);
        const all = screen.getByRole('checkbox', {name: 'Select all the keys'});
        expect(all).not.toBeChecked();
        await act(async () => {
            await user.click(screen.getByRole('checkbox', {name: 'Select key k1'}));
        });
        expect(all.indeterminate).toBe(true);
        await act(async () => {
            await user.click(all);
        });
        expect(all).toBeChecked();
        expect(all.indeterminate).toBe(false);
        expect(screen.getByRole('checkbox', {name: 'Select key k2'})).toBeChecked();
        expect(screen.getByRole('button', {name: 'Remove 2 keys'})).toBeInTheDocument();
        await act(async () => {
            await user.click(all);
        });
        expect(screen.getByRole('checkbox', {name: 'Select key k1'})).not.toBeChecked();
        expect(screen.getByText('Check keys to select them.')).toBeInTheDocument();
    });

    test('sorted by name at first; by size, the largest first, again the other way', async () => {
        mockFetch({keys: [
            {name: 'b', node: 'n', size: 10},
            {name: 'c', node: 'n', size: 300},
            {name: 'a', node: 'n', size: 20},
        ]});
        await renderAndWait('root/cfg/cfg1', 3);
        const names = () => screen.getAllByRole('rowheader').map((h) => h.textContent);
        expect(names()).toEqual(['a', 'b', 'c']);
        expect(screen.getByRole('columnheader', {name: /Name/})).toHaveAttribute('aria-sort', 'ascending');
        await act(async () => {
            await user.click(screen.getByRole('button', {name: 'Size'}));
        });
        expect(names()).toEqual(['c', 'a', 'b']);
        expect(screen.getByRole('columnheader', {name: /Size/})).toHaveAttribute('aria-sort', 'descending');
        await act(async () => {
            await user.click(screen.getByRole('button', {name: /Size/}));
        });
        expect(names()).toEqual(['b', 'a', 'c']);
        await act(async () => {
            await user.click(screen.getByRole('button', {name: 'Name'}));
        });
        expect(names()).toEqual(['a', 'b', 'c']);
    });

    test('a text key copied, any key downloaded as stored, by name', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {value: {writeText}, configurable: true});
        const createObjectURL = vi.fn(() => 'blob:key');
        const revokeObjectURL = vi.fn();
        Object.assign(URL, {createObjectURL, revokeObjectURL});
        const clicks = [];
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
            clicks.push({href: this.getAttribute('href'), download: this.getAttribute('download')});
        });
        try {
            mockFetch({keys: [{name: 'app.conf', node: 'n', size: 5}], keyBlob: makeMockBlob(encodeText('hello'))});
            await renderAndWait('root/cfg/cfg1', 1);
            const view = await openDialog('view', 'app.conf');
            await waitFor(() => expect(queryLoading(within(view))).not.toBeInTheDocument());
            await act(async () => {
                await user.click(within(view).getByRole('button', {name: 'Copy the content'}));
            });
            expect(writeText).toHaveBeenCalledWith('hello');
            expect(await within(view).findByRole('button', {name: 'Copied'})).toBeInTheDocument();
            await act(async () => {
                await user.click(within(view).getByRole('button', {name: 'Download the key'}));
            });
            expect(clicks).toEqual([{href: 'blob:key', download: 'app.conf'}]);
            expect(revokeObjectURL).toHaveBeenCalledWith('blob:key');
        } finally {
            click.mockRestore();
            Object.defineProperty(navigator, 'clipboard', {value: undefined, configurable: true});
        }
    });

    test('a binary key: downloaded, not copied', async () => {
        Object.defineProperty(navigator, 'clipboard', {value: {writeText: vi.fn()}, configurable: true});
        try {
            mockFetch({keys: [{name: 'bk', node: 'n', size: 2}], keyBlob: makeMockBlob(new Uint8Array([0x00, 0x07]))});
            await renderAndWait('root/cfg/cfg1', 1);
            const view = await openDialog('view', 'bk');
            await waitFor(() => expect(queryLoading(within(view))).not.toBeInTheDocument());
            expect(within(view).queryByRole('button', {name: 'Copy the content'})).toBeNull();
            expect(within(view).getByRole('button', {name: 'Download the key'})).toBeInTheDocument();
        } finally {
            Object.defineProperty(navigator, 'clipboard', {value: undefined, configurable: true});
        }
    });

    test('renders for cfg and sec', async () => {
        mockFetch({keys: [{name: 'k', node: 'n', size: 100}]});
        await renderAndWait('root/cfg/cfg1', 1);
        expect(screen.getByText('k')).toBeInTheDocument();
    });

    test.each([
        ['full table', [{name: 'k1', node: 'n1', size: 10}, {
            name: 'k2',
            node: 'n2',
            size: 20
        }], ['k1', 'k2', '10 bytes', '20 bytes']],
        ['empty array', [], ['No keys available.']],
        ['no items field', {}, ['No keys available.']],
        ['non-array items', 'not-array', ['No keys available.']],
    ])('displays %s', async (_, keys, expectedTexts) => {
        const safeKeys = Array.isArray(keys) ? keys : keys;
        mockFetch({keys: safeKeys});
        const count = Array.isArray(safeKeys) ? safeKeys.length : 0;
        await renderAndWait('root/cfg/cfg1', count);
        for (const text of expectedTexts) {
            expect(screen.getByText(text)).toBeInTheDocument();
        }
    });

    test('shows loading spinner', async () => {
        global.fetch = vi.fn(() => new Promise(() => {
        }));
        render(<KeysSection decodedObjectName="root/cfg/cfg1" openSnackbar={openSnackbar}/>);
        expect(await screen.findByRole('status', {name: 'Loading keys'})).toBeInTheDocument();
    });

    test('displays fetch error', async () => {
        global.fetch = vi.fn(() => Promise.reject(new Error('Fail')));
        await renderAndWait('root/cfg/cfg1', 0);
        expect(screen.getByText(/Fail/i)).toBeInTheDocument();
    });

    test('displays HTTP error', async () => {
        global.fetch = vi.fn(() => Promise.resolve({ok: false, status: 500}));
        await renderAndWait('root/cfg/cfg1', 0);
        expect(await screen.findByText(/Failed to fetch keys: 500/i)).toBeInTheDocument();
    });

    test.each([
        ['create', 'Create', 'newKey', true, 'Add key newKey'],
        ['edit', 'Update', 'updatedKey', true, 'Update key updatedKey'],
        ['delete', 'Delete', 'key1', false, 'Delete key key1'],
    ])('%s success', async (action, btn, name, needsFile, label) => {
        mockFetch({keys: [{name: 'key1', node: 'n1', size: 10}]});
        await renderAndWait('root/cfg/cfg1', 1);
        const dialog = await openDialog(action);
        if (action !== 'delete') {
            if (needsFile) await uploadFileInDialog(dialog, action === 'edit' ? 'update' : 'create');
            await fillNameAndSubmit(dialog, name, btn);
        } else {
            await act(async () => {
                await user.click(within(dialog).getByRole('button', {name: /Delete/i}));
            });
        }
        await waitFor(() => expect(tray()).toEqual([[label, 'root/cfg/cfg1', 'succeeded', null]]));
        noWriteSnackbar();
    });

    test('create empty content mode', async () => {
        mockFetch({keys: [], methods: {POST: () => Promise.resolve({ok: true})}});
        await renderAndWait('root/cfg/cfg1', 0);
        const dialog = await openDialog('create');
        await act(async () => {
            await user.type(within(dialog).getByRole('textbox', {name: /Key Name/i}), 'emptyKey');
        });
        expect(within(dialog).getByRole('button', {name: /Create/i})).not.toBeDisabled();
        await act(async () => {
            await user.click(within(dialog).getByRole('button', {name: /Create/i}));
        });
        await waitFor(() => expect(tray()).toEqual([['Add key emptyKey', 'root/cfg/cfg1', 'succeeded', null]]));
    });

    test.each([
        ['create', 'POST', 'newKey', 'Create', 'Add key newKey'],
        ['edit', 'PUT', 'updatedKey', 'Update', 'Update key updatedKey'],
        ['delete', 'DELETE', 'key1', 'Delete', 'Delete key key1'],
    ])('%s HTTP error', async (action, method, name, btn, label) => {
        mockFetch({
            keys: [{name: 'key1', node: 'n1', size: 10}],
            methods: {[method]: () => Promise.resolve({ok: false, status: 400})},
        });
        await renderAndWait('root/cfg/cfg1', 1);
        const dialog = await openDialog(action);
        if (action !== 'delete') {
            await uploadFileInDialog(dialog, action === 'edit' ? 'update' : 'create');
            await fillNameAndSubmit(dialog, name, btn);
        } else {
            await act(async () => {
                await user.click(within(dialog).getByRole('button', {name: /Delete/i}));
            });
        }
        await waitFor(() => expect(tray()).toEqual([[label, 'root/cfg/cfg1', 'refused', expect.stringMatching(/^HTTP 400/)]]));
        noWriteSnackbar();
    });

    test.each([
        ['create', 'POST', 'newKey', 'Create', 'Add key newKey'],
        ['edit', 'PUT', 'updatedKey', 'Update', 'Update key updatedKey'],
        ['delete', 'DELETE', 'key1', 'Delete', 'Delete key key1'],
    ])('%s network error', async (action, method, name, btn, label) => {
        mockFetch({
            keys: [{name: 'key1', node: 'n1', size: 10}],
            methods: {[method]: () => Promise.reject(new Error('Network error'))},
        });
        await renderAndWait('root/cfg/cfg1', 1);
        const dialog = await openDialog(action);
        if (action !== 'delete') {
            await uploadFileInDialog(dialog, action === 'edit' ? 'update' : 'create');
            await fillNameAndSubmit(dialog, name, btn);
        } else {
            await act(async () => {
                await user.click(within(dialog).getByRole('button', {name: /Delete/i}));
            });
        }
        await waitFor(() => expect(tray()).toEqual([[label, 'root/cfg/cfg1', 'refused', 'Network error']]));
        noWriteSnackbar();
    });

    test.each([
        ['create', (d) => uploadFileInDialog(d, 'create').then(() => fillNameAndSubmit(d, 'newKey', 'Create'))],
        ['edit', (d) => uploadFileInDialog(d, 'update').then(() => fillNameAndSubmit(d, 'updatedKey', 'Update'))],
        ['delete', (d) => user.click(within(d).getByRole('button', {name: /Delete/i}))],
    ])('auth token missing for %s', async (action, actionFn) => {
        mockFetch({keys: [{name: 'key1', node: 'n1', size: 10}]});
        await renderAndWait('root/cfg/cfg1', 1);
        const dialog = await openDialog(action);
        mockLocalStorage.getItem.mockReturnValue(null);
        await actionFn(dialog);
        await waitFor(() => expect(openSnackbar).toHaveBeenCalledWith('Auth token not found.', 'error'));
    });

    test('auth token missing for view', async () => {
        mockFetch({keys: [{name: 'key1', node: 'n1', size: 10}]});
        await renderAndWait('root/cfg/cfg1', 1);
        mockLocalStorage.getItem.mockReturnValue(null);
        const viewBtn = (await screen.findByRole('rowheader', {name: 'key1'})).closest('tr');
        await act(async () => {
            await user.click(viewBtn);
        });
        await waitFor(() => expect(openSnackbar).toHaveBeenCalledWith('Auth token not found.', 'error'));
    });

    test.each([
        ['create', 'POST', 'Create'],
        ['edit', 'PUT', 'Update'],
        ['delete', 'DELETE', 'Delete'],
    ])('%s buttons disabled during action', async (action, method, btn) => {
        mockFetch({
            keys: [{name: 'key1', node: 'n1', size: 10}],
            methods: {
                [method]: () => new Promise(() => {
                })
            },
        });
        await renderAndWait('root/cfg/cfg1', 1);
        const dialog = await openDialog(action);
        if (action !== 'delete') {
            await uploadFileInDialog(dialog, action === 'edit' ? 'update' : 'create');
            await fillNameAndSubmit(dialog, action === 'create' ? 'newKey' : 'updatedKey', btn);
        } else {
            await act(async () => {
                await user.click(within(dialog).getByRole('button', {name: /Delete/i}));
            });
        }
        await waitFor(() => expect(within(dialog).getByRole('button', {name: new RegExp(btn, 'i')})).toBeDisabled());
    });

    test('create: a name needed, the content not: an empty key', async () => {
        mockFetch({keys: []});
        await renderAndWait('root/cfg/cfg1', 0);
        const dialog = await openDialog('create');
        expect(within(dialog).queryByRole('radio')).toBeNull();
        expect(within(dialog).getByRole('textbox', {name: 'Key Content'})).toHaveValue('');
        expect(within(dialog).getByRole('button', {name: /Create/i})).toBeDisabled();
        await act(async () => {
            await user.type(within(dialog).getByRole('textbox', {name: /Key Name/i}), 'test');
        });
        expect(within(dialog).getByRole('button', {name: /Create/i})).toBeEnabled();
    });

    test.each(['create', 'edit', 'delete', 'view'])('%s dialog closes with Cancel/Escape', async (action) => {
        mockFetch({
            keys: [{name: 'key1', node: 'n1', size: 10}],
            keyBlob: action === 'view' ? makeMockBlob(encodeText('t')) : undefined,
        });
        if (action === 'create') await renderAndWait('root/cfg/cfg1', 0);
        else await renderAndWait('root/cfg/cfg1', 1);
        let dialog = await openDialog(action);
        if (action === 'view') await waitFor(() => expect(queryLoading(within(dialog))).not.toBeInTheDocument());
        // The footer button (the header holds a close cross too).
        await act(async () => {
            await user.click(within(dialog).getAllByRole('button', {name: /^(Cancel|Close)$/}).at(-1));
        });
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

        dialog = await openDialog(action);
        fireEvent.keyDown(dialog, {key: 'Escape'});
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    test('view shows text', async () => {
        mockFetch({keys: [{name: 'tk', node: 'n', size: 5}], keyBlob: makeMockBlob(encodeText('hello'))});
        await renderAndWait('root/cfg/cfg1', 1);
        await openDialog('view', 'tk');
        const dialog = screen.getByRole('dialog');
        await waitFor(() => expect(queryLoading(within(dialog))).not.toBeInTheDocument());
        expect(within(dialog).getByText(/Type:\s*Text/i)).toBeInTheDocument();
        expect(within(dialog).getByDisplayValue('hello')).toBeInTheDocument();
        expect(within(dialog).queryByRole('button', {name: 'Decode certificate'})).toBeNull();
    });

    test('a key holding certificates decodes them, and shows its content again', async () => {
        const chain = LEAF_PEM + CA_PEM;
        mockFetch({keys: [{name: 'chain', node: 'n', size: chain.length}], keyBlob: makeMockBlob(encodeText(chain))});
        await renderAndWait('root/cfg/cfg1', 1);
        const dialog = await openDialog('view', 'chain');
        await waitFor(() => expect(queryLoading(within(dialog))).not.toBeInTheDocument());
        await act(async () => {
            await user.click(within(dialog).getByRole('button', {name: 'Decode certificate'}));
        });
        expect(within(dialog).queryByRole('textbox', {name: 'Key content'})).toBeNull();
        const leaf = within(dialog).getByRole('region', {name: 'Certificate 1 of 2'});
        expect(within(leaf).getByText('O=OpenSVC, CN=web.example.com')).toBeInTheDocument();
        expect(within(leaf).getByText('DNS:web.example.com')).toBeInTheDocument();
        expect(within(leaf).getByText('RSA 2048 bits')).toBeInTheDocument();
        expect(within(leaf).getByText(/^Valid, expires in \d+ days$/)).toHaveClass('text-state-up');
        expect(await within(leaf).findByText(/^47:A1:99:02/)).toBeInTheDocument();
        const ca = within(dialog).getByRole('region', {name: 'Certificate 2 of 2'});
        expect(within(ca).getByText('CA:TRUE, pathlen:0')).toBeInTheDocument();
        expect(within(ca).getByText('Basic constraints (critical)')).toBeInTheDocument();
        await act(async () => {
            await user.click(within(dialog).getByRole('button', {name: 'Show content'}));
        });
        expect(within(dialog).getByRole('textbox', {name: 'Key content'})).toHaveValue(chain);
    });

    test('a certificate of a masked secret decodes, the secret kept masked', async () => {
        const pem = '-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIA==\n-----END PRIVATE KEY-----\n' + LEAF_PEM;
        mockFetch({keys: [{name: 'fullpem', node: 'n', size: pem.length}], keyBlob: makeMockBlob(encodeText(pem))});
        await renderAndWait('root/sec/sec1', 1);
        const dialog = await openDialog('view', 'fullpem');
        await waitFor(() => expect(queryLoading(within(dialog))).not.toBeInTheDocument());
        await act(async () => {
            await user.click(within(dialog).getByRole('button', {name: 'Hide secret'}));
        });
        expect(within(dialog).getByText('The content of this secret is masked.')).toBeInTheDocument();
        await act(async () => {
            await user.click(within(dialog).getByRole('button', {name: 'Decode certificate'}));
        });
        expect(within(dialog).getByRole('region', {name: 'Certificate'})).toBeInTheDocument();
        expect(within(dialog).queryByText(/PRIVATE KEY/)).toBeNull();
    });

    test('view shows binary', async () => {
        mockFetch({keys: [{name: 'bk', node: 'n', size: 2}], keyBlob: makeMockBlob(new Uint8Array([0x00, 0x07]))});
        await renderAndWait('root/cfg/cfg1', 1);
        await openDialog('view', 'bk');
        const dialog = screen.getByRole('dialog');
        await waitFor(() => expect(queryLoading(within(dialog))).not.toBeInTheDocument());
        expect(within(dialog).getByText(/Binary \(Hex View\)/i)).toBeInTheDocument();
    });

    test('view error closes dialog', async () => {
        mockFetch({
            keys: [{name: 'key1', node: 'n1', size: 1}],
            methods: {
                GET: (url) => url.includes('/data/key?name=') ? Promise.resolve({
                    ok: false,
                    status: 500
                }) : undefined
            },
        });
        await renderAndWait('root/cfg/cfg1', 1);
        const viewBtn = (await screen.findByRole('rowheader', {name: 'key1'})).closest('tr');
        await act(async () => {
            await user.click(viewBtn);
        });
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(openSnackbar).toHaveBeenCalledWith('Failed to fetch key content: 500', 'error');
    });

    test('update spinner and text mode', async () => {
        let resolveBlob;
        let reads = 0;
        mockFetch({
            keys: [{name: 'key1', node: 'n1', size: 1}],
            methods: {
                // Shown first, read at once; edited, read when the test says.
                GET: (url) => url.includes('/data/key?name=') && ++reads > 1 ? Promise.resolve({
                    ok: true,
                    blob: () => new Promise(r => {
                        resolveBlob = r;
                    })
                }) : undefined
            },
        });
        await renderAndWait('root/cfg/cfg1', 1);
        const dialog = await openDialog('edit', 'key1');
        expect(within(dialog).getByRole('status', {name: 'Loading key content'})).toBeInTheDocument();
        await act(async () => resolveBlob(makeMockBlob(encodeText('hi'))));
        await waitFor(() => expect(queryLoading(within(dialog))).not.toBeInTheDocument());
    });

    test('update binary: said in place, the update waits for new content', async () => {
        mockFetch({keys: [{name: 'b', node: 'n', size: 2}], keyBlob: makeMockBlob(new Uint8Array([0x00, 0x01]))});
        await renderAndWait('root/cfg/cfg1', 1);
        const dialog = await openDialog('edit', 'b');
        const content = await within(dialog).findByRole('textbox', {name: 'Key Content'});
        await waitFor(() => expect(content).toHaveAttribute('placeholder', expect.stringMatching(/content is binary/)));
        expect(within(dialog).getByRole('button', {name: 'Update'})).toBeDisabled();
        await uploadFileInDialog(dialog);
        expect(within(dialog).getByRole('button', {name: 'Update'})).toBeEnabled();
    });

    test('update prefetch error', async () => {
        let reads = 0;
        mockFetch({
            keys: [{name: 'key1', node: 'n1', size: 1}],
            // Shown first, read; edited, the read fails.
            methods: {GET: (url) => url.includes('/data/key?name=') && ++reads > 1 ? Promise.reject(new Error('fail')) : undefined},
        });
        await renderAndWait('root/cfg/cfg1', 1);
        const dialog = await openDialog('edit', 'key1');
        await waitFor(() => expect(openSnackbar).toHaveBeenCalledWith('Error: fail', 'error'));
        // Not read, the key is not shown empty: an update would empty it.
        const content = await within(dialog).findByRole('textbox', {name: 'Key Content'});
        expect(content).toHaveValue('');
        expect(content).toHaveAttribute('placeholder', expect.stringMatching(/could not be read/));
        expect(within(dialog).getByRole('button', {name: 'Update'})).toBeDisabled();
        await act(async () => {
            await user.type(content, 'new');
        });
        expect(within(dialog).getByRole('button', {name: 'Update'})).toBeEnabled();
    });

    test('update: the content of a key read late does not fill the form of another', async () => {
        let resolveFirst;
        const reads = {};
        mockFetch({
            keys: [{name: 'key1', node: 'n1', size: 3}, {name: 'key2', node: 'n1', size: 3}],
            methods: {
                // Each key shown first, read at once; key1 edited, read when the test says.
                GET: (url) => {
                    const name = url.match(/\/data\/key\?name=(\w+)/)?.[1];
                    if (!name) return undefined;
                    reads[name] = (reads[name] ?? 0) + 1;
                    if (name === 'key1' && reads[name] > 1) {
                        return Promise.resolve({ok: true, blob: () => new Promise((r) => { resolveFirst = r; })});
                    }
                    return Promise.resolve({ok: true, blob: () => Promise.resolve(makeMockBlob(encodeText(name === 'key1' ? 'one' : 'two')))});
                },
            },
        });
        await renderAndWait('root/cfg/cfg1', 2);
        const first = await openDialog('edit', 'key1');
        await act(async () => {
            await user.click(within(first).getByRole('button', {name: 'Cancel'}));
        });
        const second = await openDialog('edit', 'key2');
        await waitFor(() => expect(within(second).getByRole('textbox', {name: 'Key Content'})).toHaveValue('two'));
        await act(async () => resolveFirst(makeMockBlob(encodeText('one'))));
        expect(within(screen.getByRole('dialog', {name: 'Update Key'})).getByRole('textbox', {name: 'Key Content'})).toHaveValue('two');
    });

    test('fullscreen toggles', async () => {
        mockFetch({keys: []});
        await renderAndWait('root/cfg/cfg1', 0);
        const dialog = await openDialog('create');
        await act(async () => {
            await user.click(within(dialog).getByRole('button', {name: 'Full screen'}));
        });
        await waitFor(() => expect(within(screen.getByRole('dialog')).getByRole('button', {name: 'Exit full screen'})).toBeInTheDocument());
        expect(within(screen.getByRole('dialog')).getByRole('textbox', {name: 'Key Content'})).toBeInTheDocument();
        await act(async () => {
            await user.click(within(screen.getByRole('dialog')).getByRole('button', {name: 'Exit full screen'}));
        });
        expect(within(screen.getByRole('dialog')).queryByRole('button', {name: 'Exit full screen'})).not.toBeInTheDocument();
        expect(within(screen.getByRole('dialog')).getByRole('textbox', {name: /Key Name/i})).toBeInTheDocument();
    });

    test('fullscreen keeps the typed text', async () => {
        mockFetch({keys: []});
        await renderAndWait('root/cfg/cfg1', 0);
        const dialog = await openDialog('create');
        await act(async () => {
            await user.type(within(dialog).getByRole('textbox', {name: 'Key Content'}), 'abc');
            await user.click(within(dialog).getByRole('button', {name: 'Full screen'}));
        });
        expect(within(screen.getByRole('dialog')).getByRole('textbox', {name: 'Key Content'})).toHaveValue('abc');
    });

    test('fullscreen hides fields', async () => {
        mockFetch({keys: []});
        await renderAndWait('root/cfg/cfg1', 0);
        const dialog = await openDialog('create');
        await act(async () => {
            await user.click(within(dialog).getByRole('button', {name: 'Full screen'}));
        });
        const fullDlg = screen.getByRole('dialog');
        expect(within(fullDlg).queryByRole('textbox', {name: /Key Name/i})).not.toBeInTheDocument();
    });

    test('cancel after fullscreen resets', async () => {
        mockFetch({keys: []});
        await renderAndWait('root/cfg/cfg1', 0);
        const dialog = await openDialog('create');
        await act(async () => {
            await user.click(within(dialog).getByRole('button', {name: 'Full screen'}));
        });
        await act(async () => {
            await user.click(within(screen.getByRole('dialog')).getByRole('button', {name: /Cancel/i}));
        });
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        const newDialog = await openDialog('create');
        expect(within(newDialog).queryByRole('button', {name: 'Exit full screen'})).not.toBeInTheDocument();
        expect(within(newDialog).getByRole('textbox', {name: /Key Name/i})).toBeInTheDocument();
    });

    test('a text file loaded in place to edit, its name the key name; a binary one by its name, sent as is, dropped back to typing', async () => {
        mockFetch({keys: []});
        await renderAndWait('root/cfg/cfg1', 0);
        const dialog = await openDialog('create');
        expect(within(dialog).getByText(/drop a file here/)).toBeInTheDocument();
        const input = within(dialog).getByTestId('key-file-input');
        await act(async () => {
            await user.upload(input, new File(['host = db1\n'], 'app.conf', {type: 'text/plain'}));
        });
        const content = within(dialog).getByRole('textbox', {name: 'Key Content'});
        await waitFor(() => expect(content).toHaveValue('host = db1\n'));
        expect(within(dialog).getByRole('textbox', {name: /Key Name/i})).toHaveValue('app.conf');
        expect(within(dialog).getByText('11 bytes')).toBeInTheDocument();

        await uploadFileInDialog(dialog);
        expect(within(dialog).queryByRole('textbox', {name: 'Key Content'})).toBeNull();
        // The name typed or set first is kept.
        expect(within(dialog).getByRole('textbox', {name: /Key Name/i})).toHaveValue('app.conf');
        await act(async () => {
            await user.click(within(dialog).getByRole('button', {name: 'Drop the file, type the content'}));
        });
        expect(within(dialog).getByRole('textbox', {name: 'Key Content'})).toBeInTheDocument();
    });

    test('a file dropped on the content is loaded, the zone said while dragged over', async () => {
        mockFetch({keys: []});
        await renderAndWait('root/cfg/cfg1', 0);
        const dialog = await openDialog('create');
        const zone = dialog.querySelector('[data-drop-zone]');
        fireEvent.dragOver(zone);
        expect(within(dialog).getByText('Drop to load the file')).toBeInTheDocument();
        const file = new File(['dropped'], 'drop.txt', {type: 'text/plain'});
        await act(async () => {
            fireEvent.drop(zone, {dataTransfer: {files: [file]}});
        });
        await waitFor(() => expect(within(dialog).getByRole('textbox', {name: 'Key Content'})).toHaveValue('dropped'));
        expect(within(dialog).queryByText('Drop to load the file')).toBeNull();
    });

    test('the largest key of the node serving the API: said, a larger one not sent', async () => {
        resetMaxKeySize();
        mockFetch({
            keys: [],
            methods: {GET: (url) => (url === '/api/cluster/status' ? Promise.resolve({
                ok: true,
                json: () => Promise.resolve({daemon: {nodename: 'n1'}, cluster: {node: {n1: {config: {max_key_size: 2048}}}}}),
            }) : undefined)},
        });
        await renderAndWait('root/cfg/cfg1', 0);
        const dialog = await openDialog('create');
        expect(await within(dialog).findByText('0 bytes of up to 2 KiB')).toBeInTheDocument();
        await act(async () => {
            await user.type(within(dialog).getByRole('textbox', {name: /Key Name/i}), 'big');
        });
        fireEvent.change(within(dialog).getByRole('textbox', {name: 'Key Content'}), {target: {value: 'x'.repeat(3000)}});
        expect(within(dialog).getByText('3000 bytes: too large, a key holds up to 2 KiB')).toHaveClass('text-state-down');
        expect(within(dialog).getByRole('button', {name: /Create/i})).toBeDisabled();
        resetMaxKeySize();
    });

    test('the largest key said in the unit it is a round number of: om3 "1mb" is 1000000 bytes', async () => {
        resetMaxKeySize();
        mockFetch({
            keys: [],
            methods: {GET: (url) => (url === '/api/cluster/status' ? Promise.resolve({
                ok: true,
                json: () => Promise.resolve({daemon: {nodename: 'n1'}, cluster: {node: {n1: {config: {max_key_size: 1000000}}}}}),
            }) : undefined)},
        });
        await renderAndWait('root/cfg/cfg1', 0);
        const dialog = await openDialog('create');
        expect(await within(dialog).findByText('0 bytes of up to 1 MB')).toBeInTheDocument();
        resetMaxKeySize();
    });

    test('dialog resets after create', async () => {
        mockFetch({keys: [], methods: {POST: () => Promise.resolve({ok: true})}});
        await renderAndWait('root/cfg/cfg1', 0);
        const dialog = await openDialog('create');
        await act(async () => {
            await user.type(within(dialog).getByRole('textbox', {name: /Key Name/i}), 'temp');
        });
        await act(async () => {
            await user.click(within(dialog).getByRole('button', {name: /Create/i}));
        });
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        const dialog2 = await openDialog('create');
        expect(within(dialog2).getByRole('textbox', {name: /Key Name/i}).value).toBe('');
    });

    test('token lost after delete triggers error', async () => {
        mockFetch({keys: [{name: 'k1', node: 'n1', size: 5}]});
        await renderAndWait('root/cfg/cfg1', 1);
        global.fetch = vi.fn((url, options) => {
            if (url.includes('/data/key') && options?.method === 'DELETE') {
                mockLocalStorage.getItem.mockReturnValue(null);
                return Promise.resolve({ok: true});
            }
            if (url.includes('/data/keys')) return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({items: []})
            });
            // The key shown before it is removed.
            if (url.includes('/data/key?name=')) return Promise.resolve({ok: true, blob: () => Promise.resolve(makeMockBlob(encodeText('x')))});
            return Promise.resolve({ok: true});
        });
        const dialog = await openDialog('delete', 'k1');
        await act(async () => {
            await user.click(within(dialog).getByRole('button', {name: /Delete/i}));
        });
        await waitFor(() => expect(tray()).toEqual([['Delete key k1', 'root/cfg/cfg1', 'succeeded', null]]));
        expect(await screen.findByText(/Auth token not found/i)).toBeInTheDocument();
    });

    test('create text sends Blob, update file sends File', async () => {
        let capturedBody;
        mockFetch({keys: [{name: 'key1', node: 'n1', size: 10}]});
        await renderAndWait('root/cfg/cfg1', 1);

        let dialog = await openDialog('create');
        await act(async () => {
            await user.type(within(dialog).getByRole('textbox', {name: /Key Name/i}), 'blobKey');
        });
        const textArea = within(dialog).getByRole('textbox', {name: 'Key Content'});
        await act(async () => {
            await user.type(textArea, 'data');
        });
        global.fetch = vi.fn((url, options = {}) => {
            if (url.includes('/data/key') && options.method === 'POST') {
                capturedBody = options.body;
                return Promise.resolve({ok: true});
            }
            if (url.includes('/data/keys')) return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({items: [{name: 'key1', node: 'n1', size: 10}]})
            });
            return Promise.resolve({ok: true, blob: () => Promise.resolve(makeMockBlob(encodeText('text')))});
        });
        await act(async () => {
            await user.click(within(dialog).getByRole('button', {name: /Create/i}));
        });
        await waitFor(() => expect(capturedBody instanceof Blob).toBe(true));

        dialog = await openDialog('edit');
        await waitFor(() => expect(queryLoading(within(dialog))).not.toBeInTheDocument());
        await uploadFileInDialog(dialog, 'update');
        global.fetch = vi.fn((url, options = {}) => {
            if (url.includes('/data/key') && options.method === 'PUT') {
                capturedBody = options.body;
                return Promise.resolve({ok: true});
            }
            if (url.includes('/data/keys')) return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({items: [{name: 'key1', node: 'n1', size: 10}]})
            });
            return Promise.resolve({ok: true, blob: () => Promise.resolve(makeMockBlob(encodeText('text')))});
        });
        await act(async () => {
            await user.click(within(dialog).getByRole('button', {name: /Update/i}));
        });
        await waitFor(() => expect(capturedBody instanceof File).toBe(true));
    });

    test('a key added in the configuration file is listed once the configuration changes', async () => {
        mockFetch({keys: [{name: 'existing', node: 'n', size: 9}]});
        const {rerender} = render(<KeysSection decodedObjectName="root/cfg/cfg1" openSnackbar={openSnackbar} refreshKey={0}/>);
        expect(await screen.findByRole('rowheader', {name: 'existing'})).toBeInTheDocument();

        mockFetch({keys: [{name: 'existing', node: 'n', size: 9}, {name: 'babar', node: 'n', size: 14}]});
        rerender(<KeysSection decodedObjectName="root/cfg/cfg1" openSnackbar={openSnackbar} refreshKey={1}/>);
        expect(await screen.findByRole('rowheader', {name: 'babar'})).toBeInTheDocument();
        expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/root/cfg/cfg1/data/keys'), expect.any(Object));
    });

    // ── User-specific tests ───────────────────────────────────────────────

    test('the keys of a user are listed, read from its data keys', async () => {
        mockFetch({keys: [{name: 'password', node: 'n', size: 16}, {name: 'private_key', node: 'n', size: 1704}]});
        await renderAndWait('root/usr/usr1', 2);
        expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/root/usr/usr1/data/keys'), expect.any(Object));
        expect(screen.getByRole('rowheader', {name: 'password'})).toBeInTheDocument();
        expect(screen.getByRole('rowheader', {name: 'private_key'})).toBeInTheDocument();
    });

    test('a user key, a password or a private key, is masked as a secret', async () => {
        mockFetch({
            keys: [{name: 'password', node: 'n', size: 11}],
            keyBlob: makeMockBlob(encodeText('supersecret')),
        });
        await renderAndWait('root/usr/usr1', 1);
        await openDialog('view', 'password');
        const dialog = screen.getByRole('dialog');
        await waitFor(() => expect(queryLoading(within(dialog))).not.toBeInTheDocument());
        expect(within(dialog).getByText(/Masked again in 10 seconds/)).toBeInTheDocument();
        await act(async () => {
            await user.click(within(dialog).getByRole('button', {name: /hide secret/i}));
        });
        expect(within(dialog).queryByDisplayValue('supersecret')).not.toBeInTheDocument();
    });

    // ── Secret-specific tests ─────────────────────────────────────────────

    test('a secret decoded shows at once, a countdown before it is masked again', async () => {
        mockFetch({
            keys: [{name: 'sk', node: 'n', size: 11}],
            keyBlob: makeMockBlob(encodeText('supersecret')),
        });
        await renderAndWait('root/sec/sec1', 1);
        await openDialog('view', 'sk');
        const dialog = screen.getByRole('dialog');
        await waitFor(() => expect(queryLoading(within(dialog))).not.toBeInTheDocument());

        expect(within(dialog).getByDisplayValue('supersecret')).toBeInTheDocument();
        expect(within(dialog).getByText(/Masked again in 10 seconds/)).toBeInTheDocument();
        expect(within(dialog).queryByText(/is masked/i)).not.toBeInTheDocument();
    });

    test('secret hide and reveal buttons toggle content visibility', async () => {
        mockFetch({
            keys: [{name: 'sk', node: 'n', size: 11}],
            keyBlob: makeMockBlob(encodeText('supersecret')),
        });
        await renderAndWait('root/sec/sec1', 1);
        await openDialog('view', 'sk');
        const dialog = screen.getByRole('dialog');
        await waitFor(() => expect(queryLoading(within(dialog))).not.toBeInTheDocument());

        await act(async () => {
            await user.click(within(dialog).getByRole('button', {name: /hide secret/i}));
        });
        expect(within(dialog).queryByDisplayValue('supersecret')).not.toBeInTheDocument();
        expect(within(dialog).getByText(/is masked/i)).toBeInTheDocument();

        await act(async () => {
            await user.click(within(dialog).getByRole('button', {name: /reveal secret/i}));
        });
        expect(within(dialog).getByDisplayValue('supersecret')).toBeInTheDocument();
        expect(within(dialog).queryByText(/is masked/i)).not.toBeInTheDocument();
    });

    test('a secret decoded is masked again on its own after 10 seconds', async () => {
        mockFetch({
            keys: [{name: 'sk', node: 'n', size: 11}],
            keyBlob: makeMockBlob(encodeText('supersecret')),
        });
        await renderAndWait('root/sec/sec1', 1);
        vi.useFakeTimers({shouldAdvanceTime: true});
        try {
            await openDialog('view', 'sk');
            const dialog = screen.getByRole('dialog');
            await waitFor(() => expect(within(dialog).getByDisplayValue('supersecret')).toBeInTheDocument());
            expect(within(dialog).getByText(/Masked again in 10 seconds/)).toBeInTheDocument();

            act(() => vi.advanceTimersByTime(3_000));
            expect(within(dialog).getByText(/Masked again in 7 seconds/)).toBeInTheDocument();

            act(() => vi.advanceTimersByTime(7_000));
            expect(within(dialog).queryByDisplayValue('supersecret')).not.toBeInTheDocument();
            expect(within(dialog).getByText(/is masked/i)).toBeInTheDocument();
            expect(within(dialog).getByRole('button', {name: /reveal secret/i})).toBeInTheDocument();
        } finally {
            vi.useRealTimers();
        }
    });

    test('cfg view does not show reveal button and displays content directly', async () => {
        mockFetch({
            keys: [{name: 'ck', node: 'n', size: 5}],
            keyBlob: makeMockBlob(encodeText('hello')),
        });
        await renderAndWait('root/cfg/cfg1', 1);
        await openDialog('view', 'ck');
        const dialog = screen.getByRole('dialog');
        await waitFor(() => expect(queryLoading(within(dialog))).not.toBeInTheDocument());

        expect(within(dialog).queryByRole('button', {name: /reveal secret/i})).not.toBeInTheDocument();
        expect(within(dialog).queryByRole('button', {name: /hide secret/i})).not.toBeInTheDocument();
        expect(within(dialog).getByDisplayValue('hello')).toBeInTheDocument();
    });

    test('a secret masked, closed and decoded again shows again, its countdown afresh', async () => {
        mockFetch({
            keys: [{name: 'sk', node: 'n', size: 11}],
            keyBlob: makeMockBlob(encodeText('supersecret')),
        });
        await renderAndWait('root/sec/sec1', 1);

        let dialog = await openDialog('view', 'sk');
        await waitFor(() => expect(queryLoading(within(dialog))).not.toBeInTheDocument());
        await act(async () => {
            await user.click(within(dialog).getByRole('button', {name: /hide secret/i}));
        });
        await act(async () => {
            await user.click(within(dialog).getAllByRole('button', {name: /^Close$/}).at(-1));
        });
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

        dialog = await openDialog('view', 'sk');
        await waitFor(() => expect(within(dialog).getByDisplayValue('supersecret')).toBeInTheDocument());
        expect(within(dialog).getByText(/Masked again in 10 seconds/)).toBeInTheDocument();
    });

    test('secret edit does not fetch content and says it waits for new content', async () => {
        let fetchKeyCalled = false;
        mockFetch({
            keys: [{name: 'sk', node: 'n', size: 11}],
            methods: {
                GET: (url) => {
                    if (url.includes('/data/key?name=')) {
                        fetchKeyCalled = true;
                        return Promise.resolve({
                            ok: true,
                            blob: () => Promise.resolve(makeMockBlob(encodeText('supersecret'))),
                        });
                    }
                    return undefined;
                },
            },
        });
        await renderAndWait('root/sec/sec1', 1);
        // Shown, its content read; edited, never.
        const dialog = await openDialog('edit', 'sk', {onViewShown: () => {
            fetchKeyCalled = false;
        }});

        // The form says it: new content, typed or from a file, to replace the hidden one.
        await waitFor(() => expect(within(dialog).getByRole('textbox', {name: 'Key Content'}))
            .toHaveAttribute('placeholder', expect.stringMatching(/content of a secret is hidden/)));
        // No GET request to /data/key to fetch the content
        expect(fetchKeyCalled).toBe(false);
        // Nothing typed: no update, which would empty the secret.
        expect(within(dialog).getByRole('button', {name: 'Update'})).toBeDisabled();
        // No spinner
        expect(queryLoading(within(dialog))).not.toBeInTheDocument();
    });

    test('secret edit uploads new content via file', async () => {
        let capturedBody;
        let fetchKeyCalled = false;
        mockFetch({
            keys: [{name: 'sk', node: 'n', size: 11}],
            methods: {
                GET: (url) => {
                    if (url.includes('/data/key?name=')) {
                        fetchKeyCalled = true;
                    }
                    return undefined;
                },
                PUT: (url, options) => {
                    capturedBody = options.body;
                    return Promise.resolve({ok: true});
                },
            },
        });
        await renderAndWait('root/sec/sec1', 1);
        // Shown, its content read; edited, never.
        const dialog = await openDialog('edit', 'sk', {onViewShown: () => {
            fetchKeyCalled = false;
        }});

        // The form says it: new content, typed or from a file, to replace the hidden one.
        await waitFor(() => expect(within(dialog).getByRole('textbox', {name: 'Key Content'}))
            .toHaveAttribute('placeholder', expect.stringMatching(/content of a secret is hidden/)));

        await uploadFileInDialog(dialog, 'update');
        await act(async () => {
            await user.click(within(dialog).getByRole('button', {name: /Update/i}));
        });

        await waitFor(() => expect(tray()).toEqual([['Update key sk', 'root/sec/sec1', 'succeeded', null]]));
        expect(capturedBody).toBeInstanceOf(File);
        expect(fetchKeyCalled).toBe(false);
    });

    test('secret delete works normally', async () => {
        mockFetch({
            keys: [{name: 'sk', node: 'n', size: 11}],
            methods: {DELETE: () => Promise.resolve({ok: true})},
        });
        await renderAndWait('root/sec/sec1', 1);
        const dialog = await openDialog('delete', 'sk');
        await act(async () => {
            await user.click(within(dialog).getByRole('button', {name: /Delete/i}));
        });
        await waitFor(() => expect(tray()).toEqual([['Delete key sk', 'root/sec/sec1', 'succeeded', null]]));
    });

    test('secret create works normally', async () => {
        mockFetch({
            keys: [],
            methods: {POST: () => Promise.resolve({ok: true})},
        });
        await renderAndWait('root/sec/sec1', 0);
        const dialog = await openDialog('create');
        await act(async () => {
            await user.type(within(dialog).getByRole('textbox', {name: /Key Name/i}), 'newSecret');
        });
        const textArea = within(dialog).getByRole('textbox', {name: 'Key Content'});
        await act(async () => {
            await user.type(textArea, 'mySecretValue');
        });
        await act(async () => {
            await user.click(within(dialog).getByRole('button', {name: /Create/i}));
        });
        await waitFor(() => expect(tray()).toEqual([['Add key newSecret', 'root/sec/sec1', 'succeeded', null]]));
    });

    test('secret view offers to hide the value it shows', async () => {
        mockFetch({
            keys: [{name: 'sk', node: 'n', size: 11}],
            keyBlob: makeMockBlob(encodeText('topsecret')),
        });
        await renderAndWait('root/sec/sec1', 1);
        await openDialog('view', 'sk');
        const dialog = screen.getByRole('dialog');
        await waitFor(() => expect(queryLoading(within(dialog))).not.toBeInTheDocument());

        expect(within(dialog).getByRole('button', {name: /hide secret/i})).toBeInTheDocument();
        expect(within(dialog).queryByRole('button', {name: /reveal secret/i})).not.toBeInTheDocument();
    });

    test('secret binary view shows hex at once', async () => {
        mockFetch({
            keys: [{name: 'sk', node: 'n', size: 2}],
            keyBlob: makeMockBlob(new Uint8Array([0x00, 0x01])),
        });
        await renderAndWait('root/sec/sec1', 1);
        await openDialog('view', 'sk');
        const dialog = screen.getByRole('dialog');
        await waitFor(() => expect(queryLoading(within(dialog))).not.toBeInTheDocument());

        expect(within(dialog).getByText(/Binary \(Hex View\)/i)).toBeInTheDocument();
        expect(within(dialog).getByDisplayValue(/00000000/)).toBeInTheDocument();
        expect(within(dialog).queryByText(/is masked/i)).not.toBeInTheDocument();
    });

    test('secret edit in text mode sends Blob', async () => {
        let capturedBody;
        mockFetch({
            keys: [{name: 'sk', node: 'n', size: 11}],
            methods: {
                PUT: (url, options) => {
                    capturedBody = options.body;
                    return Promise.resolve({ok: true});
                },
            },
        });
        await renderAndWait('root/sec/sec1', 1);
        const dialog = await openDialog('edit', 'sk');
        // The form says it: new content, typed or from a file, to replace the hidden one.
        await waitFor(() => expect(within(dialog).getByRole('textbox', {name: 'Key Content'}))
            .toHaveAttribute('placeholder', expect.stringMatching(/content of a secret is hidden/)));

        const textArea = within(dialog).getByRole('textbox', {name: 'Key Content'});
        await act(async () => {
            await user.type(textArea, 'newsecret');
        });
        await act(async () => {
            await user.click(within(dialog).getByRole('button', {name: /Update/i}));
        });

        await waitFor(() => expect(tray()).toEqual([['Update key sk', 'root/sec/sec1', 'succeeded', null]]));
        expect(capturedBody).toBeInstanceOf(Blob);
        expect(capturedBody).not.toBeInstanceOf(File);
    });

    test('secret edit never shows loading spinner', async () => {
        mockFetch({keys: [{name: 'sk', node: 'n', size: 11}]});
        await renderAndWait('root/sec/sec1', 1);
        const dialog = await openDialog('edit', 'sk');
        // Check immediately then after a few ticks
        expect(queryLoading(within(dialog))).not.toBeInTheDocument();
        await act(async () => {
            await Promise.resolve();
        });
        expect(queryLoading(within(dialog))).not.toBeInTheDocument();
    });

    test('secret edit resets between opens', async () => {
        mockFetch({keys: [{name: 'sk', node: 'n', size: 11}]});
        await renderAndWait('root/sec/sec1', 1);

        let dialog = await openDialog('edit', 'sk');
        // The form says it: new content, typed or from a file, to replace the hidden one.
        await waitFor(() => expect(within(dialog).getByRole('textbox', {name: 'Key Content'}))
            .toHaveAttribute('placeholder', expect.stringMatching(/content of a secret is hidden/)));
        await act(async () => {
            await user.type(within(dialog).getByRole('textbox', {name: 'Key Content'}), 'leaked');
        });
        await act(async () => {
            await user.click(within(dialog).getByRole('button', {name: /Cancel/i}));
        });
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

        dialog = await openDialog('edit', 'sk');
        expect(within(dialog).getByRole('textbox', {name: 'Key Content'})).toHaveValue('');
        expect(within(dialog).queryByDisplayValue('leaked')).not.toBeInTheDocument();
    });

    test('reveal state does not leak to cfg view', async () => {
        mockFetch({
            keys: [{name: 'sk', node: 'n', size: 5}],
            keyBlob: makeMockBlob(encodeText('secret')),
        });
        await renderAndWait('root/sec/sec1', 1);
        let dialog = await openDialog('view', 'sk');
        await waitFor(() => expect(within(dialog).getByDisplayValue('secret')).toBeInTheDocument());
        await act(async () => {
            await user.click(within(dialog).getAllByRole('button', {name: /^Close$/}).at(-1));
        });
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

        // Re-render as cfg
        cleanup();
        mockFetch({
            keys: [{name: 'ck', node: 'n', size: 5}],
            keyBlob: makeMockBlob(encodeText('hello')),
        });
        await renderAndWait('root/cfg/cfg1', 1);
        await openDialog('view', 'ck');
        dialog = screen.getByRole('dialog');
        await waitFor(() => expect(queryLoading(within(dialog))).not.toBeInTheDocument());
        expect(within(dialog).queryByRole('button', {name: /reveal secret/i})).not.toBeInTheDocument();
        expect(within(dialog).getByDisplayValue('hello')).toBeInTheDocument();
    });

    test('secret hide button is enabled in view dialog', async () => {
        mockFetch({
            keys: [{name: 'sk', node: 'n', size: 5}],
            keyBlob: makeMockBlob(encodeText('x')),
        });
        await renderAndWait('root/sec/sec1', 1);
        await openDialog('view', 'sk');
        const dialog = screen.getByRole('dialog');
        await waitFor(() => expect(queryLoading(within(dialog))).not.toBeInTheDocument());
        expect(within(dialog).getByRole('button', {name: /hide secret/i})).not.toBeDisabled();
    });

    test.each([
        'root/sec/sec1',
        'root/sec/mysecret',
        'root/sec/a-very-long-secret-name',
        'root/sec/123',
    ])('detects secret kind for path %s', async (path) => {
        mockFetch({
            keys: [{name: 'sk', node: 'n', size: 5}],
            keyBlob: makeMockBlob(encodeText('x')),
        });
        await renderAndWait(path, 1);
        await openDialog('view', 'sk');
        const dialog = screen.getByRole('dialog');
        await waitFor(() => expect(queryLoading(within(dialog))).not.toBeInTheDocument());
        expect(within(dialog).getByText(/Masked again in/)).toBeInTheDocument();
    });

    test('secret edit does not fetch content on cancel', async () => {
        let keyContentCalls = 0;
        mockFetch({
            keys: [{name: 'sk', node: 'n', size: 11}],
            methods: {
                GET: (url) => {
                    if (url.includes('/data/key?name=')) keyContentCalls++;
                    return undefined;
                },
            },
        });
        await renderAndWait('root/sec/sec1', 1);
        // Shown, its content read; edited, never.
        const dialog = await openDialog('edit', 'sk', {onViewShown: () => {
            keyContentCalls = 0;
        }});
        await act(async () => {
            await user.click(within(dialog).getByRole('button', {name: /Cancel/i}));
        });
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(keyContentCalls).toBe(0);
    });

    test('secret with empty content can be revealed', async () => {
        mockFetch({
            keys: [{name: 'sk', node: 'n', size: 0}],
            keyBlob: makeMockBlob(new Uint8Array([])),
        });
        await renderAndWait('root/sec/sec1', 1);
        await openDialog('view', 'sk');
        const dialog = screen.getByRole('dialog');
        await waitFor(() => expect(queryLoading(within(dialog))).not.toBeInTheDocument());
        // Empty content is displayed without crashing
        expect(within(dialog).queryByText(/is masked/i)).not.toBeInTheDocument();
    });
});

describe('KeysSection keyboard', () => {
    test('the arrows walk the keys, Enter shows the one reached', async () => {
        mockFetch({keys: [{name: 'a', node: 'n', size: 1}, {name: 'b', node: 'n', size: 1}, {name: 'c', node: 'n', size: 1}]});
        await renderAndWait('root/sec/s1', 3);
        const row = (name) => screen.getByRole('rowheader', {name}).closest('tr');
        row('a').focus();
        fireEvent.keyDown(row('a'), {key: 'ArrowDown'});
        expect(row('b')).toHaveFocus();
        fireEvent.keyDown(row('b'), {key: 'ArrowDown'});
        expect(row('c')).toHaveFocus();
        fireEvent.keyDown(row('c'), {key: 'ArrowUp'});
        expect(row('b')).toHaveFocus();
        fireEvent.keyDown(row('b'), {key: 'Enter'});
        expect(await screen.findByRole('dialog', {name: 'View Key: b'})).toBeInTheDocument();
    });
});

describe('KeysSection certificate', () => {
    test('a sec: its certificate created or renewed from the menu of its keys; written, its keys read again', async () => {
        mockFetch({keys: [{name: 'certificate', node: 'node1', size: 1200}]});
        await renderAndWait('root/sec/tls', 1);
        fireEvent.click(screen.getByRole('button', {name: 'Certificate'}));
        fireEvent.click(screen.getByRole('menuitem', {name: 'Renew'}));
        await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
            '/api/object/path/root/sec/tls/certificate/renew?force=false', expect.objectContaining({method: 'POST'})));
        // Answered, the keys read again: the one listing them, then once more.
        await waitFor(() => expect(global.fetch.mock.calls.filter(([url]) => url.includes('/data/keys'))).toHaveLength(2));
    });

    test('a cfg: no certificate', async () => {
        mockFetch({keys: [{name: 'key1', node: 'node1', size: 12}]});
        await renderAndWait('root/cfg/cfg1', 1);
        expect(screen.queryByRole('button', {name: 'Certificate'})).toBeNull();
    });
});

describe('KeysSection in French', () => {
    afterEach(async () => {
        await i18n.changeLanguage('en');
    });

    test('shows the keys table in French', async () => {
        await i18n.changeLanguage('fr');
        mockFetch({keys: [{name: 'key1', node: 'node1', size: 12}]});
        render(<KeysSection decodedObjectName="root/cfg/cfg1" openSnackbar={openSnackbar}/>);
        expect(await screen.findByText("Clés de l'objet (1)")).toBeInTheDocument();
        expect(screen.getByText('12 octets')).toBeInTheDocument();
        expect(screen.getByRole('checkbox', {name: 'Sélectionner la clé key1'})).toBeInTheDocument();
    });
});
