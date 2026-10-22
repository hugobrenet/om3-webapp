import React from 'react';
import {render, screen, fireEvent, waitFor, act} from '@testing-library/react';
import {vi} from 'vitest';
import {ContainerLogs, isContainerResource} from '../ContainerLogs';

/** A followed body: its chunks, then open; `ends`, closed after them. */
const body = (chunks, {ends = false} = {}) => ({
    getReader: () => {
        let i = 0;
        return {
            read: () => (i < chunks.length
                ? Promise.resolve({value: new TextEncoder().encode(chunks[i++]), done: false})
                : ends ? Promise.resolve({done: true}) : new Promise(() => {})),
            releaseLock: vi.fn(),
        };
    },
});

/** The daemon answers each read of the logs with the next of `answers`, the last one again past them. */
const answers = (...list) => {
    let n = 0;
    global.fetch = vi.fn((url, options) => Promise.resolve().then(() => {
        if (options?.signal?.aborted) throw Object.assign(new Error('aborted'), {name: 'AbortError'});
        return list[Math.min(n++, list.length - 1)]();
    }));
};
const ok = (chunks, options) => () => ({ok: true, status: 200, body: body(chunks, options)});
const lines = () => [...screen.getByRole('log', {name: 'Container log lines'}).querySelectorAll('.container-log-line')].map((l) => l.textContent);
const reads = () => global.fetch.mock.calls.filter(([, options]) => !options?.signal?.aborted).map(([url]) => url);

describe('ContainerLogs', () => {
    beforeEach(() => localStorage.setItem('authToken', 'tok'));
    afterEach(() => localStorage.clear());

    test('a container by its type, else by its section', () => {
        expect(isContainerResource('container#1', 'container.docker')).toBe(true);
        expect(isContainerResource('container#1', 'container.podman')).toBe(true);
        expect(isContainerResource('app#1', 'app.simple')).toBe(false);
        expect(isContainerResource('container#1', undefined)).toBe(true);
        expect(isContainerResource('fs#1', undefined)).toBe(false);
    });

    test('follows the container on the first node it is up on, its last lines first, as root reads them', async () => {
        answers(ok(['first line\nsecond ', 'line\n']));
        render(<ContainerLogs path="prod/svc/web" rid="container#1" nodes={['n1', 'n2']} upNodes={['n2']}/>);
        await waitFor(() => expect(lines()).toEqual(['first line', 'second line']));
        expect(reads()).toEqual(['/api/node/name/n2/instance/path/prod/svc/web/container/log?rid=container%231&follow=true&lines=200']);
        expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
        expect(screen.getByText('Connected').parentElement).toHaveAttribute('data-state', 'up');
    });

    test('opened before the instances are known: read once they are', async () => {
        answers(ok(['ready\n']));
        const {rerender} = render(<ContainerLogs path="prod/svc/web" rid="container#1" nodes={[]}/>);
        expect(global.fetch).not.toHaveBeenCalled();
        rerender(<ContainerLogs path="prod/svc/web" rid="container#1" nodes={['n1', 'n2']} upNodes={['n2']}/>);
        await waitFor(() => expect(lines()).toEqual(['ready']));
        expect(reads()).toEqual(['/api/node/name/n2/instance/path/prod/svc/web/container/log?rid=container%231&follow=true&lines=200']);
    });

    test('another node chosen: its container read, the lines of the other gone', async () => {
        answers(ok(['on n2\n']), ok(['on n1\n']));
        render(<ContainerLogs path="prod/svc/web" rid="container#1" nodes={['n1', 'n2']} upNodes={['n2']}/>);
        await waitFor(() => expect(lines()).toEqual(['on n2']));
        fireEvent.change(screen.getByRole('combobox', {name: 'Node of the container'}), {target: {value: 'n1'}});
        await waitFor(() => expect(lines()).toEqual(['on n1']));
        expect(reads().at(-1)).toContain('/node/name/n1/');
    });

    test('refused to a user not root: said', async () => {
        answers(() => ({ok: false, status: 403}));
        render(<ContainerLogs path="prod/svc/web" rid="container#1" nodes={['n1']}/>);
        expect(await screen.findByText('Reading the logs of a container takes the root role.')).toBeInTheDocument();
        expect(screen.getByText('Disconnected').parentElement).toHaveAttribute('data-state', 'down');
    });

    test('the stream ended while the container runs (the daemon restarted): said, read again without its last lines twice', async () => {
        answers(ok(['before\n'], {ends: true}), ok(['after\n']));
        render(<ContainerLogs path="prod/svc/web" rid="container#1" nodes={['n1']} upNodes={['n1']}/>);
        await waitFor(() => expect(screen.getByText(/were lost/)).toBeInTheDocument());
        await waitFor(() => expect(lines()).toEqual(['before', 'after']), {timeout: 3000});
        expect(reads().at(-1)).toMatch(/&lines=0$/);
        expect(screen.queryByText(/were lost/)).not.toBeInTheDocument();
    });

    test('no container there (removed as it stopped): said once, not as a line, read again once it runs', async () => {
        // As the daemon passes the runtime's answer on: an HTTP 200, the stream ended at once.
        answers(ok(['Error response from daemon: No such container: encap.container.1\n'], {ends: true}), ok(['booted\n']));
        const {rerender} = render(<ContainerLogs path="encap" rid="container#1" nodes={['n1']} upNodes={[]}/>);
        expect(await screen.findByText(/No container container#1 on n1/)).toBeInTheDocument();
        expect(screen.queryByRole('log', {name: 'Container log lines'}).querySelectorAll('.container-log-line')).toHaveLength(0);
        expect(screen.queryByText(/were lost/)).not.toBeInTheDocument();
        // Not read again while it does not run.
        await new Promise((r) => setTimeout(r, 1500));
        expect(global.fetch).toHaveBeenCalledTimes(1);
        // It runs: read.
        rerender(<ContainerLogs path="encap" rid="container#1" nodes={['n1']} upNodes={['n1']}/>);
        await waitFor(() => expect(lines()).toEqual(['booted']));
        expect(screen.queryByText(/No container/)).not.toBeInTheDocument();
    });

    test('a container stopped: its last lines, said stopped, not read again', async () => {
        answers(ok(['last words\n'], {ends: true}));
        render(<ContainerLogs path="prod/svc/web" rid="container#1" nodes={['n1']} upNodes={[]}/>);
        await waitFor(() => expect(lines()).toEqual(['last words']));
        expect(await screen.findByText(/container#1 does not run on n1/)).toBeInTheDocument();
        await new Promise((r) => setTimeout(r, 1500));
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('up, yet the stream ending at once: read again later each time, not every second', async () => {
        vi.useFakeTimers({shouldAdvanceTime: true});
        try {
            answers(ok(['Error response from daemon: No such container: x\n'], {ends: true}));
            render(<ContainerLogs path="prod/svc/web" rid="container#1" nodes={['n1']} upNodes={['n1']}/>);
            await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
            // 2s, then 4s, then 8s: 3 reads more in 14s, not 14.
            await act(async () => { await vi.advanceTimersByTimeAsync(14500); });
            expect(global.fetch.mock.calls.length).toBeLessThanOrEqual(4);
            expect(screen.getByText(/No container container#1 on n1/)).toBeInTheDocument();
        } finally {
            vi.useRealTimers();
        }
    });

    test('the lines searched', async () => {
        answers(ok(['level=info ready\nlevel=error boom\n']));
        render(<ContainerLogs path="prod/svc/web" rid="container#1" nodes={['n1']}/>);
        await waitFor(() => expect(lines()).toHaveLength(2));
        fireEvent.change(screen.getByPlaceholderText('Search logs...'), {target: {value: 'ERROR'}});
        expect(lines()).toEqual(['level=error boom']);
        expect(screen.getByText('1 / 2 lines')).toBeInTheDocument();
    });

    test('paused, nothing read; resumed, read again from now', async () => {
        // Resumed, the daemon sends what comes after (lines=0): nothing yet.
        answers(ok(['one\n']), ok([]));
        render(<ContainerLogs path="prod/svc/web" rid="container#1" nodes={['n1']}/>);
        await waitFor(() => expect(lines()).toEqual(['one']));
        fireEvent.click(screen.getByRole('button', {name: 'Pause'}));
        expect(screen.getByText('Disconnected')).toBeInTheDocument();
        await act(async () => fireEvent.click(screen.getByRole('button', {name: 'Resume'})));
        // The first read stopped by the pause, the second from now.
        await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
        expect(global.fetch.mock.calls[1][0]).toMatch(/&lines=0$/);
        expect(lines()).toEqual(['one']);
    });
});
