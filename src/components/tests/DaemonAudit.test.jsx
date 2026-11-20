import React from 'react';
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {DaemonAudit} from '../DaemonAudit';
import useEventStore from '../../hooks/useEventStore.js';

const mockGrants = vi.hoisted(() => ({value: {root: null}}));
vi.mock('../../hooks/useGrants', () => ({
    // Undefined, the grants not read yet.
    useIsRoot: () => (mockGrants.value === undefined ? undefined : Object.prototype.hasOwnProperty.call(mockGrants.value, 'root')),
}));

/** A record of the stream, as the daemon writes it. */
const record = (id, level, message, extra = '') =>
    `id:${id}\n${extra}data:{"level":"${level}","message":"n1: ${message}","time":"2026-11-16T13:19:09.84${id}+01:00"}\n\n\n`;

/**
 * A stream fed by the test: `push` a chunk, `end` it. The signal aborting the
 * request ends it too, as the browser does.
 */
function feed(signal) {
    const queue = [];
    let wake = null;
    const next = () => new Promise((resolve) => {
        wake = resolve;
    });
    const deliver = (item) => {
        if (wake) {
            const w = wake;
            wake = null;
            w(item);
        } else queue.push(item);
    };
    signal?.addEventListener('abort', () => deliver({done: true}));
    return {
        body: {
            getReader: () => ({
                read: () => (queue.length > 0 ? Promise.resolve(queue.shift()) : next()),
                cancel: () => Promise.resolve(),
            }),
        },
        push: (chunk) => deliver({value: new TextEncoder().encode(chunk), done: false}),
        end: () => deliver({done: true}),
    };
}

describe('DaemonAudit', () => {
    let streams;
    let requests;
    let answer;

    beforeEach(() => {
        mockGrants.value = {root: null};
        useEventStore.setState({objectStatus: {'prod/svc/web': {}, 'prod/svc/db': {}}});
        localStorage.setItem('authToken', 'tok');
        streams = [];
        requests = [];
        answer = null;
        global.fetch = vi.fn(async (url, options = {}) => {
            requests.push({url, method: options.method, accept: options.headers?.Accept});
            if (answer) return answer(url);
            const stream = feed(options.signal);
            streams.push(stream);
            return {ok: true, status: 200, body: stream.body};
        });
        HTMLElement.prototype.scrollIntoView = vi.fn();
    });

    afterEach(() => {
        localStorage.clear();
    });

    const subsystemsField = () => screen.getByRole('combobox', {name: 'Subsystems'});
    const options = () => within(screen.getByRole('listbox', {name: 'Subsystems'})).queryAllByRole('option').map((o) => o.textContent);
    /** The chips, by the text they show. */
    const chips = () => screen.queryAllByRole('button', {name: /^Remove /}).map((b) => b.parentElement.firstChild.textContent);

    const lines = () => within(screen.getByRole('log', {name: 'Audit records'})).queryAllByText(/./, {selector: '[data-text]'}).map((e) => e.textContent);

    test('streams the subsystems chosen from the level chosen, the node dropped from the records; stopped, the request aborted', async () => {
        render(<DaemonAudit node="n1"/>);
        fireEvent.change(screen.getByRole('combobox', {name: 'From level'}), {target: {value: 'trace'}});
        const field = subsystemsField();
        fireEvent.focus(field);
        // A name taking a suffix, picked: written for its suffix, the object monitors suggested.
        fireEvent.change(field, {target: {value: 'imo'}});
        fireEvent.click(screen.getByRole('option', {name: /^imon:/}));
        expect(field).toHaveValue('imon:');
        expect(options()).toEqual(['imon:*', 'imon:prod/svc/db', 'imon:prod/svc/web']);
        fireEvent.click(screen.getByRole('option', {name: 'imon:*'}));
        // A known one, by the keyboard.
        fireEvent.change(field, {target: {value: 'sched'}});
        fireEvent.keyDown(field, {key: 'ArrowDown'});
        fireEvent.keyDown(field, {key: 'Enter'});
        expect(chips()).toEqual(['imon:*', 'scheduler']);
        expect(field).toHaveValue('');
        fireEvent.click(screen.getByRole('button', {name: 'Start'}));

        await waitFor(() => expect(streams).toHaveLength(1));
        expect(requests[0]).toEqual({
            url: '/api/node/name/n1/daemon/audit?level=trace&sub=imon%3A*&sub=scheduler',
            method: 'POST',
            accept: 'text/event-stream',
        });
        await act(async () => {
            streams[0].push(record(0, 'info', 'daemon audit: audit started') + record(1, 'debug', 'daemon: imon: prod/svc/web: start'));
            streams[0].push(record(2, 'trace', 'daemon: scheduler: next run'));
        });
        await waitFor(() => expect(lines()).toEqual(['daemon audit: audit started', 'start', 'next run']));
        expect(screen.getByRole('status')).toHaveTextContent('Auditing imon:*, scheduler, from trace');
        // Running, the choice is held.
        expect(subsystemsField()).toBeDisabled();

        // Searched, the records matching alone.
        fireEvent.change(screen.getByPlaceholderText('Search the records'), {target: {value: 'scheduler'}});
        expect(lines()).toEqual(['next run']);

        fireEvent.click(screen.getByRole('button', {name: 'Stop'}));
        expect(screen.getByRole('button', {name: 'Start'})).toBeInTheDocument();
        expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    });

    test('the subsystems typed: a pattern of its own, pasted ones, kept on leaving; Backspace takes the last back', () => {
        render(<DaemonAudit node="n1"/>);
        const field = subsystemsField();
        fireEvent.focus(field);
        fireEvent.change(field, {target: {value: 'hb:1'}});
        fireEvent.keyDown(field, {key: 'Enter'});
        fireEvent.change(field, {target: {value: 'dns, runner nmo'}});
        expect(chips()).toEqual(['hb:1', 'dns', 'runner']);
        expect(field).toHaveValue('nmo');
        fireEvent.blur(field);
        expect(chips()).toEqual(['hb:1', 'dns', 'runner', 'nmo']);
        fireEvent.keyDown(field, {key: 'Backspace'});
        fireEvent.click(screen.getByRole('button', {name: 'Remove dns'}));
        expect(chips()).toEqual(['hb:1', 'runner']);
    });

    test('all the subsystems when none is named', async () => {
        render(<DaemonAudit node="n1"/>);
        fireEvent.click(screen.getByRole('button', {name: 'Start'}));
        await waitFor(() => expect(requests).toHaveLength(1));
        expect(requests[0].url).toBe('/api/node/name/n1/daemon/audit?level=debug');
        // Said in words, not its key.
        expect(screen.getByRole('status')).toHaveTextContent('Auditing every subsystem, from debug');
    });

    test('refused while another runs: said, and taken over on demand, preempting it', async () => {
        answer = () => new Response(JSON.stringify({title: 'Audit already active', detail: 'refused, audit session is already running for user root', status: 409}), {status: 409, headers: {'Content-Type': 'application/json'}});
        render(<DaemonAudit node="n1"/>);
        fireEvent.click(screen.getByRole('button', {name: 'Start'}));
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('Another audit is running on this daemon');
        expect(alert).toHaveTextContent('already running for user root');
        answer = null;
        fireEvent.click(within(alert).getByRole('button', {name: 'Take over'}));
        await waitFor(() => expect(requests).toHaveLength(2));
        expect(requests[1].url).toBe('/api/node/name/n1/daemon/audit?level=debug&preempt=true');
    });

    test('preempted by another session: said, not opened again', async () => {
        render(<DaemonAudit node="n1"/>);
        fireEvent.click(screen.getByRole('button', {name: 'Start'}));
        await waitFor(() => expect(streams).toHaveLength(1));
        await act(async () => {
            streams[0].push(record(0, 'warn', 'daemon audit: session preempted by another session', 'event:preempted\n'));
        });
        expect(await screen.findByRole('alert')).toHaveTextContent('Another session took the audit over');
        expect(lines()).toEqual(['daemon audit: session preempted by another session']);
        expect(requests).toHaveLength(1);
        expect(screen.getByRole('button', {name: 'Start'})).toBeInTheDocument();
    });

    test('ended by the daemon: said, the records kept', async () => {
        render(<DaemonAudit node="n1"/>);
        fireEvent.click(screen.getByRole('button', {name: 'Start'}));
        await waitFor(() => expect(streams).toHaveLength(1));
        await act(async () => {
            streams[0].push(record(0, 'info', 'daemon audit: audit started'));
            streams[0].end();
        });
        expect(await screen.findByText(/The daemon ended the audit/)).toBeInTheDocument();
        expect(lines()).toEqual(['daemon audit: audit started']);
    });

    test('left, the audit stopped', async () => {
        const {unmount} = render(<DaemonAudit node="n1"/>);
        fireEvent.click(screen.getByRole('button', {name: 'Start'}));
        await waitFor(() => expect(streams).toHaveLength(1));
        unmount();
        expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    });

    test('the grants not read yet: waited for, root only not said, no audit offered', () => {
        mockGrants.value = undefined;
        render(<DaemonAudit node="n1"/>);
        expect(screen.getByRole('status', {name: 'Reading your grants'})).toBeInTheDocument();
        expect(screen.queryByText('Auditing the daemon needs the root grant.')).toBeNull();
        expect(screen.queryByRole('button', {name: 'Start'})).not.toBeInTheDocument();
    });

    test('root only: said, no audit offered', () => {
        mockGrants.value = {};
        render(<DaemonAudit node="n1"/>);
        expect(screen.getByText('Auditing the daemon needs the root grant.')).toBeInTheDocument();
        expect(screen.queryByRole('button', {name: 'Start'})).not.toBeInTheDocument();
    });
});
