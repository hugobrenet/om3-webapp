import React from 'react';
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {vi} from 'vitest';
import {ClusterLocks, LOCKS_EVERY_MS, durationMs} from '../ClusterLocks';
import {useActionTracker} from '../../app/action-tracker';

/** What the actions tray holds, the latest first: label, subject, state, reason. */
const tray = () => useActionTracker.getState().tracked.map((e) => [e.label, e.subject, e.state, e.error ?? null]);

const lock = (name, id, extra = {}) => ({
    name, id, node: 'n1', holder: `om pool claim ${name}`,
    acquired_at: '2026-10-21T10:00:00Z', expires_at: '2026-10-21T10:00:30Z', expires_in: '29.5s', ...extra,
});

describe('durationMs', () => {
    test('a Go duration in milliseconds', () => {
        expect(durationMs('29.5s')).toBe(29500);
        expect(durationMs('1m30s')).toBe(90000);
        expect(durationMs('250ms')).toBe(250);
        expect(durationMs('1h2m3s')).toBe(3723000);
        expect(durationMs('-1s')).toBe(-1000);
    });

    test.each([undefined, '', '30', 'soon', '1x'])('%s is no duration', (text) => {
        expect(durationMs(text)).toBeNull();
    });
});

describe('ClusterLocks', () => {
    let requests;
    let locks;
    let released;
    let posted;

    beforeEach(() => {
        vi.useFakeTimers({shouldAdvanceTime: true});
        useActionTracker.setState({tracked: []});
        localStorage.setItem('authToken', 'tok');
        requests = [];
        locks = [lock('net-default', 'id-2', {node: 'n2', holder: '', expires_in: '1m5s'}), lock('alloc', 'id-1')];
        released = {status: 204};
        posted = [];
        global.fetch = vi.fn(async (url, options = {}) => {
            const method = options.method ?? 'GET';
            requests.push(`${method} ${decodeURIComponent(url)}`);
            if (method === 'POST') {
                const body = JSON.parse(options.body);
                posted.push(body);
                const holding = locks.find((l) => l.name === body.name);
                if (holding) {
                    return new Response(JSON.stringify({title: 'Lock held', detail: `lock ${body.name} is held by ${holding.holder || holding.node} on n1 until 10:00:30`}),
                        {status: 409, headers: {'Content-Type': 'application/problem+json'}});
                }
                const granted = lock(body.name, `id-${body.name}`, {holder: body.holder ?? '', expires_in: body.lease ?? '30s'});
                locks = [...locks, granted];
                return new Response(JSON.stringify(granted), {status: 200, headers: {'Content-Type': 'application/json'}});
            }
            if (method === 'DELETE') {
                if (released.status === 204) locks = locks.filter((l) => !url.includes(`id=${l.id}`));
                return new Response(released.status === 204 ? null : JSON.stringify({detail: released.detail}), {status: released.status});
            }
            return new Response(JSON.stringify({kind: 'ClusterLockList', items: locks}), {status: 200});
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        localStorage.clear();
    });

    const renderLocks = () => render(<MemoryRouter><ClusterLocks/></MemoryRouter>);
    const table = () => screen.getByRole('table', {name: 'Cluster locks'});
    const rows = () => within(table()).getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell').map((c) => c.textContent));

    test('the locks held, by name: holder, node, lease left counted down, id', async () => {
        renderLocks();
        await waitFor(() => expect(rows()).toHaveLength(2));
        const [alloc, net] = rows();
        expect([alloc[0], alloc[1], alloc[2], alloc[4], alloc[5]]).toEqual(['alloc', 'om pool claim alloc', 'n1', '30 s', 'id-1']);
        expect([net[0], net[1], net[2], net[4], net[5]]).toEqual(['net-default', '–', 'n2', '1 min 5 s', 'id-2']);
        expect(requests).toEqual(['GET /api/cluster/lock']);
        // The lease counted down between two reads, on the clock of the page.
        await act(async () => {
            await vi.advanceTimersByTimeAsync(3000);
        });
        expect(rows()[0][4]).toBe('27 s');
    });

    test('read again every few seconds: a lock taken or released shows, no event telling it', async () => {
        renderLocks();
        await waitFor(() => expect(rows()).toHaveLength(2));
        locks = [lock('alloc', 'id-1')];
        await act(async () => {
            await vi.advanceTimersByTimeAsync(LOCKS_EVERY_MS);
        });
        await waitFor(() => expect(rows().map((r) => r[0])).toEqual(['alloc']));
        expect(requests).toEqual(['GET /api/cluster/lock', 'GET /api/cluster/lock']);
    });

    test('a lease run out is gone at once, before the next read', async () => {
        locks = [lock('alloc', 'id-1', {expires_in: '2s'})];
        renderLocks();
        await waitFor(() => expect(rows()).toHaveLength(1));
        // Past its end, at the next tick of the countdown.
        await act(async () => {
            await vi.advanceTimersByTimeAsync(3100);
        });
        expect(within(table()).getByText('No lock is held.')).toBeInTheDocument();
    });

    test('released, confirmed first, warned the holder is not told, by its name and its id; said in the tray, read again', async () => {
        renderLocks();
        await waitFor(() => expect(rows()).toHaveLength(2));
        fireEvent.click(screen.getByRole('button', {name: 'Release alloc'}));
        const dialog = screen.getByRole('dialog', {name: 'Release the lock alloc?'});
        expect(dialog).toHaveTextContent('taken back from om pool claim alloc');
        expect(within(dialog).getByRole('alert')).toHaveTextContent('Its holder is not told');
        expect(dialog).toHaveTextContent('Released only while still held under id-1');
        expect(requests.filter((r) => r.startsWith('DELETE'))).toEqual([]);
        fireEvent.click(within(dialog).getByRole('button', {name: 'Release'}));
        await waitFor(() => expect(requests).toContain('DELETE /api/cluster/lock?name=alloc&id=id-1'));
        await waitFor(() => expect(rows().map((r) => r[0])).toEqual(['net-default']));
        expect(tray()).toEqual([['Release', 'the lock alloc', 'succeeded', null]]);
    });

    test('released meanwhile, or its lease ended: the refusal said in the tray', async () => {
        released = {status: 404, detail: 'lock alloc is not held under id-1: it was released, or its lease ended'};
        renderLocks();
        await waitFor(() => expect(rows()).toHaveLength(2));
        fireEvent.click(screen.getByRole('button', {name: 'Release alloc'}));
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', {name: 'Release'}));
        await waitFor(() => expect(tray()).toEqual([[
            'Release', 'the lock alloc', 'refused', 'HTTP 404 lock alloc is not held under id-1: it was released, or its lease ended',
        ]]));
    });

    describe('acquired on demand', () => {
        const openAcquire = async () => {
            await waitFor(() => expect(rows()).toHaveLength(2));
            fireEvent.click(screen.getByRole('button', {name: 'Acquire'}));
            return screen.getByRole('dialog', {name: 'Acquire a cluster lock'});
        };
        const field = (dialog, label) => within(dialog).getByLabelText(label);
        const submit = (dialog) => fireEvent.click(within(dialog).getByRole('button', {name: 'Acquire'}));

        test('its name, held by the webapp for 30 s by default, waiting for none: granted, said in the tray, listed', async () => {
            renderLocks();
            const dialog = await openAcquire();
            expect(field(dialog, 'Holder')).toHaveValue('the webapp');
            expect(field(dialog, 'Lease')).toHaveValue('30s');
            expect(field(dialog, 'Wait')).toHaveValue('');
            expect(within(dialog).getByText(/release it once done/)).toBeInTheDocument();
            fireEvent.change(field(dialog, 'Name'), {target: {value: ' maintenance '}});
            submit(dialog);
            await waitFor(() => expect(posted).toEqual([{name: 'maintenance', holder: 'the webapp', lease: '30s'}]));
            await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
            await waitFor(() => expect(rows().map((r) => r[0])).toEqual(['alloc', 'maintenance', 'net-default']));
            expect(tray()).toEqual([['Acquire', 'the lock maintenance', 'succeeded', null]]);
        });

        test('its holder, lease and wait as said', async () => {
            renderLocks();
            const dialog = await openAcquire();
            fireEvent.change(field(dialog, 'Name'), {target: {value: 'upgrade'}});
            fireEvent.change(field(dialog, 'Holder'), {target: {value: 'ops: kernel upgrade'}});
            fireEvent.change(field(dialog, 'Lease'), {target: {value: '5m'}});
            fireEvent.change(field(dialog, 'Wait'), {target: {value: '10s'}});
            submit(dialog);
            await waitFor(() => expect(posted).toEqual([{name: 'upgrade', holder: 'ops: kernel upgrade', lease: '5m', wait: '10s'}]));
        });

        test('held by another: said in the form, kept open to try again; refused in the tray', async () => {
            renderLocks();
            const dialog = await openAcquire();
            fireEvent.change(field(dialog, 'Name'), {target: {value: 'alloc'}});
            submit(dialog);
            expect(await within(dialog).findByText('Not granted: lock alloc is held by om pool claim alloc on n1 until 10:00:30. Set a wait to queue for it, or try again later.')).toBeInTheDocument();
            expect(screen.getByRole('dialog', {name: 'Acquire a cluster lock'})).toBeInTheDocument();
            expect(tray()).toEqual([['Acquire', 'the lock alloc', 'refused', 'HTTP 409 lock alloc is held by om pool claim alloc on n1 until 10:00:30']]);
        });

        test('a name required, a lease of 10 min at most, durations as om reads them: nothing sent until right', async () => {
            renderLocks();
            const dialog = await openAcquire();
            submit(dialog);
            expect(await within(dialog).findByText('A lock needs a name.')).toBeInTheDocument();
            fireEvent.change(field(dialog, 'Name'), {target: {value: 'x'}});
            fireEvent.change(field(dialog, 'Lease'), {target: {value: '11m'}});
            expect(within(dialog).getByText('10m at most.')).toBeInTheDocument();
            fireEvent.change(field(dialog, 'Lease'), {target: {value: '30s'}});
            fireEvent.change(field(dialog, 'Wait'), {target: {value: 'soon'}});
            expect(within(dialog).getByText('A duration, as 30s, 1m30s or 10m.')).toBeInTheDocument();
            submit(dialog);
            await act(async () => {
                await vi.advanceTimersByTimeAsync(10);
            });
            expect(posted).toEqual([]);
        });

        test('not offered to a user who may not read the locks', async () => {
            global.fetch = vi.fn(async () => new Response(JSON.stringify({detail: 'forbidden'}), {status: 403}));
            renderLocks();
            expect(await screen.findByText('Reading the cluster locks takes the root role.')).toBeInTheDocument();
            expect(screen.queryByRole('button', {name: 'Acquire'})).not.toBeInTheDocument();
        });
    });

    test('none held: said', async () => {
        locks = [];
        renderLocks();
        expect(await screen.findByText('No lock is held.')).toBeInTheDocument();
    });

    test('refused to a user not root: said, no table', async () => {
        global.fetch = vi.fn(async () => new Response(JSON.stringify({detail: 'forbidden'}), {status: 403}));
        renderLocks();
        expect(await screen.findByText('Reading the cluster locks takes the root role.')).toBeInTheDocument();
        expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });

    describe('what the review found', () => {
        const advance = (ms) => act(async () => {
            await vi.advanceTimersByTimeAsync(ms);
        });

        test('never two reads at a time: the next read waits for a slow one to end', async () => {
            let answer = null;
            global.fetch = vi.fn((url) => {
                requests.push(`GET ${url}`);
                return new Promise((resolve) => {
                    answer = () => resolve(new Response(JSON.stringify({items: locks}), {status: 200}));
                });
            });
            renderLocks();
            // Slower than the pace of the reads: no second read meanwhile.
            await advance(LOCKS_EVERY_MS * 1.5);
            expect(requests).toHaveLength(1);
            // Seen again meanwhile: the read running goes on alone.
            act(() => document.dispatchEvent(new Event('visibilitychange')));
            expect(requests).toHaveLength(1);
            await act(async () => answer());
            await waitFor(() => expect(rows()).toHaveLength(2));
            await advance(LOCKS_EVERY_MS);
            expect(requests).toHaveLength(2);
        });

        test('a double click on the confirmation releases once', async () => {
            renderLocks();
            await waitFor(() => expect(rows()).toHaveLength(2));
            fireEvent.click(screen.getByRole('button', {name: 'Release alloc'}));
            const confirm = within(screen.getByRole('dialog')).getByRole('button', {name: 'Release'});
            fireEvent.click(confirm);
            fireEvent.click(confirm);
            await waitFor(() => expect(tray()).toHaveLength(1));
            expect(requests.filter((r) => r.startsWith('DELETE'))).toEqual(['DELETE /api/cluster/lock?name=alloc&id=id-1']);
        });

        test('denied after a read: no table of locks the session may not see', async () => {
            renderLocks();
            await waitFor(() => expect(rows()).toHaveLength(2));
            global.fetch = vi.fn(async () => new Response(JSON.stringify({detail: 'forbidden'}), {status: 403}));
            await advance(LOCKS_EVERY_MS);
            expect(await screen.findByText('Reading the cluster locks takes the root role.')).toBeInTheDocument();
            expect(screen.queryByRole('table')).not.toBeInTheDocument();
            expect(screen.queryByRole('button', {name: /^Release /})).not.toBeInTheDocument();
        });

        test('a read failing once: the locks kept, said not current, none released, the confirmation left open', async () => {
            renderLocks();
            await waitFor(() => expect(rows()).toHaveLength(2));
            fireEvent.click(screen.getByRole('button', {name: 'Release alloc'}));
            global.fetch = vi.fn(async () => new Response(JSON.stringify({error: 'leader restarting'}), {status: 502}));
            await advance(LOCKS_EVERY_MS);
            expect(await screen.findByText('Not read again (HTTP 502 leader restarting): the locks below are as last read, none released until they are read again.')).toBeInTheDocument();
            expect(rows()).toHaveLength(2);
            expect(screen.getByRole('button', {name: 'Release alloc'})).toBeDisabled();
            expect(screen.getByRole('dialog', {name: 'Release the lock alloc?'})).toBeInTheDocument();
        });

        test('a lock without a name still listed; without its lease left, counted down to the end the daemon wrote, never hidden here', async () => {
            const end = new Date(Date.now() + 20_000).toISOString();
            locks = [lock(undefined, 'id-3'), lock('alloc', 'id-1', {expires_in: undefined, expires_at: end})];
            renderLocks();
            await waitFor(() => expect(rows()).toHaveLength(2));
            expect(rows().map((r) => [r[0], r[4], r[5]])).toEqual([['', '30 s', 'id-3'], ['alloc', '20 s', 'id-1']]);
            // Past that end on this clock, which need not be the daemon's: still listed, the next read tells.
            global.fetch = vi.fn(() => new Promise(() => undefined));
            await advance(25_000);
            expect(rows().map((r) => [r[4], r[5]])).toEqual([['5 s', 'id-3'], ['0 s', 'id-1']]);
        });

        test('the lock to release gone meanwhile, its lease run out: the confirmation closes, nothing released', async () => {
            locks = [lock('alloc', 'id-1', {expires_in: '2s'})];
            renderLocks();
            await waitFor(() => expect(rows()).toHaveLength(1));
            fireEvent.click(screen.getByRole('button', {name: 'Release alloc'}));
            expect(screen.getByRole('dialog', {name: 'Release the lock alloc?'})).toBeInTheDocument();
            await advance(3100);
            expect(screen.queryByRole('dialog', {name: /Release the lock/})).not.toBeInTheDocument();
            expect(requests.filter((r) => r.startsWith('DELETE'))).toEqual([]);
        });

        test('the page hidden, nothing read nor counted down; seen again, read at once', async () => {
            const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
            try {
                renderLocks();
                await waitFor(() => expect(rows()).toHaveLength(2));
                visibility.mockReturnValue('hidden');
                const lease = rows()[0][4];
                await advance(LOCKS_EVERY_MS * 3);
                // The read before it was hidden alone; the lease left as it was.
                expect(requests).toEqual(['GET /api/cluster/lock']);
                expect(rows()[0][4]).toBe(lease);
                visibility.mockReturnValue('visible');
                act(() => document.dispatchEvent(new Event('visibilitychange')));
                await waitFor(() => expect(requests).toEqual(['GET /api/cluster/lock', 'GET /api/cluster/lock']));
                // And on again at its pace.
                await advance(LOCKS_EVERY_MS);
                expect(requests).toHaveLength(3);
            } finally {
                visibility.mockRestore();
            }
        });

        test('the release confirmed in red, as what is taken away; the refresh outlined', async () => {
            renderLocks();
            await waitFor(() => expect(rows()).toHaveLength(2));
            expect(screen.getByRole('button', {name: 'Refresh'})).toHaveClass('border');
            fireEvent.click(screen.getByRole('button', {name: 'Release alloc'}));
            expect(within(screen.getByRole('dialog')).getByRole('button', {name: 'Release'})).toHaveClass('bg-state-down');
        });

        test('a release unanswered: not said refused, the locks read until it is gone', async () => {
            renderLocks();
            await waitFor(() => expect(rows()).toHaveLength(2));
            const reading = global.fetch;
            global.fetch = vi.fn(async (url, options = {}) => {
                if (options.method === 'DELETE') {
                    // Released on the daemon, the answer lost.
                    locks = locks.filter((l) => l.id !== 'id-1');
                    throw new TypeError('Failed to fetch');
                }
                return reading(url, options);
            });
            fireEvent.click(screen.getByRole('button', {name: 'Release alloc'}));
            fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', {name: 'Release'}));
            await advance(100);
            await waitFor(() => expect(tray()).toEqual([['Release', 'the lock alloc', 'succeeded', null]]));
        });

        test('a refusal said in the words of the daemon, its error as well as its detail', async () => {
            released = {status: 500};
            renderLocks();
            await waitFor(() => expect(rows()).toHaveLength(2));
            global.fetch = vi.fn(async (url, options = {}) => (options.method === 'DELETE'
                ? new Response(JSON.stringify({error: 'lock store unavailable'}), {status: 500})
                : new Response(JSON.stringify({items: locks}), {status: 200})));
            fireEvent.click(screen.getByRole('button', {name: 'Release alloc'}));
            fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', {name: 'Release'}));
            await waitFor(() => expect(tray()).toEqual([['Release', 'the lock alloc', 'refused', 'HTTP 500 lock store unavailable']]));
        });

        test('the footer says the pace as it is: after each read, while shown', async () => {
            renderLocks();
            expect(await screen.findByText('Read again 5 s after each read, while this page is shown: no event tells a lock taken or released.')).toBeInTheDocument();
        });
    });
});
