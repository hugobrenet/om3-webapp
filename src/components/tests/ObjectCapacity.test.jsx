import React from 'react';
import {render, screen, fireEvent, waitFor, within} from '@testing-library/react';
import {vi} from 'vitest';
import {ObjectCapacity, SIZE} from '../ObjectCapacity';

// The actions tray is tested on its own: here, what is said to it.
const {mockTrackResponse, mockTrackRefused} = vi.hoisted(() => ({mockTrackResponse: vi.fn(), mockTrackRefused: vi.fn()}));
vi.mock('../../app/action-tracker', () => ({trackResponse: mockTrackResponse, trackRefused: mockTrackRefused}));

const KEYWORDS = [
    {option: 'pg_mem_limit', section: '', example: '512m', text: 'The memory the group may use. More text.'},
    {option: 'pg_cpus', section: '', example: '0-2', text: 'The cpus the group runs on.\n\nMore.'},
    {option: 'size', section: '', example: '10g', text: 'Not a cap.'},
    {option: 'pg_cpus', section: 'subset', example: '0-2', text: 'The same keyword in another section.'},
];

describe('the capacity of an object', () => {
    let requests;
    /** The configuration of the object, by keyword as asked; a post's answer. */
    let config;
    let answer;

    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.setItem('authToken', 'tok');
        requests = [];
        config = {'size': '10g', 'pg_cpus': '0-1', 'subset#web.pg_cpus@n2': '3'};
        answer = {status: 200, body: {orchestration_id: 'o-1', node: 'n1'}};
        global.fetch = vi.fn(async (url, options = {}) => {
            const method = options.method ?? 'GET';
            requests.push({method, url: decodeURIComponent(url), body: options.body});
            if (url.endsWith('/config/keywords')) return new Response(JSON.stringify({items: KEYWORDS}), {status: 200});
            if (url.includes('/config?')) {
                const asked = new URLSearchParams(url.split('?')[1]).getAll('kw');
                return new Response(JSON.stringify({items: asked.map((kw) => ({keyword: kw, value: config[kw] ?? ''}))}), {status: 200});
            }
            return new Response(JSON.stringify(answer.body), {status: answer.status});
        });
    });

    afterEach(() => localStorage.clear());

    const section = (name) => screen.getByRole('region', {name});
    const posts = () => requests.filter((r) => r.method === 'POST').map((r) => [r.url, r.body ?? null]);

    test('a size as the daemon parses it, to reach or to add', () => {
        for (const ok of ['20g', '12Gi', '11GB', '+1g', '+512m', '1.5t', '1024']) expect([ok, SIZE.test(ok)]).toEqual([ok, true]);
        for (const bad of ['-1g', 'g', '1x', '+', '1 2g']) expect([bad, SIZE.test(bad)]).toEqual([bad, false]);
    });

    test('a volume: its size, then its caps; a service: its caps alone', async () => {
        const {unmount} = render(<ObjectCapacity path="ns1/vol/data"/>);
        expect(screen.getAllByRole('heading').map((h) => h.textContent)).toEqual(['Size', 'Process group caps']);
        unmount();
        render(<ObjectCapacity path="ns1/svc/web"/>);
        expect(screen.getAllByRole('heading').map((h) => h.textContent)).toEqual(['Process group caps']);
        await waitFor(() => expect(requests.some((r) => r.url.endsWith('/config/keywords'))).toBe(true));
    });

    describe('resize', () => {
        const size = () => section('Size');

        test('says the size configured; resized by the amount asked, followed in the tray, the size read again', async () => {
            render(<ObjectCapacity path="ns1/vol/data"/>);
            expect(await within(size()).findByText('10g')).toBeInTheDocument();
            fireEvent.change(within(size()).getByLabelText('New size'), {target: {value: ' +1g '}});
            config.size = '11g';
            fireEvent.click(within(size()).getByRole('button', {name: 'Resize'}));
            expect(await within(size()).findByText('11g')).toBeInTheDocument();
            expect(posts()).toEqual([['/api/object/path/ns1/vol/data/action/resize', JSON.stringify({size: '+1g'})]]);
            expect(mockTrackResponse).toHaveBeenCalledWith(expect.anything(), {action: 'resize', subject: 'ns1/vol/data', path: 'ns1/vol/data'});
            // Accepted, the field emptied for the next.
            expect(within(size()).getByLabelText('New size')).toHaveValue('');
        });

        test('empty, to the size configured: no size posted', async () => {
            render(<ObjectCapacity path="ns1/vol/data"/>);
            fireEvent.click(within(size()).getByRole('button', {name: 'Resize'}));
            await waitFor(() => expect(posts()).toEqual([['/api/object/path/ns1/vol/data/action/resize', '{}']]));
        });

        test('a size the daemon could not parse is refused before it is posted', () => {
            render(<ObjectCapacity path="ns1/vol/data"/>);
            fireEvent.change(within(size()).getByLabelText('New size'), {target: {value: 'big'}});
            expect(within(size()).getByText('A size, as 20g, 12Gi or +1g')).toBeInTheDocument();
            expect(within(size()).getByRole('button', {name: 'Resize'})).toBeDisabled();
        });

        test('refused, the form says why, as the tray does, the size kept', async () => {
            answer = {status: 400, body: {detail: 'a resize only grows'}};
            render(<ObjectCapacity path="ns1/vol/data"/>);
            fireEvent.change(within(size()).getByLabelText('New size'), {target: {value: '1g'}});
            fireEvent.click(within(size()).getByRole('button', {name: 'Resize'}));
            expect(await within(size()).findByText('HTTP 400 a resize only grows')).toBeInTheDocument();
            expect(within(size()).getByLabelText('New size')).toHaveValue('1g');
            expect(mockTrackRefused).toHaveBeenCalledWith({action: 'resize', subject: 'ns1/vol/data', path: 'ns1/vol/data', reason: 'HTTP 400 a resize only grows'});
        });
    });

    describe('cap', () => {
        const caps = () => section('Process group caps');
        const table = () => within(caps()).getByRole('table', {name: 'Process group caps'});
        const rows = () => within(table()).getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell').slice(0, 2).map((c) => c.textContent));

        test('the pg keywords of the object, once each, their help and the value configured', async () => {
            render(<ObjectCapacity path="ns1/svc/web" nodes={['n1', 'n2']}/>);
            await waitFor(() => expect(rows()).toEqual([
                ['pg_cpusThe cpus the group runs on.', '0-1'],
                ['pg_mem_limitThe memory the group may use.', '–'],
            ]));
            expect(within(caps()).getByLabelText('New value of pg_mem_limit')).toHaveAttribute('placeholder', '512m');
        });

        test('a value changed is white on the grey of the others, until set', async () => {
            render(<ObjectCapacity path="ns1/svc/web"/>);
            await waitFor(() => expect(rows()).toHaveLength(2));
            const cpus = () => within(caps()).getByLabelText('New value of pg_cpus');
            const mem = () => within(caps()).getByLabelText('New value of pg_mem_limit');
            expect(cpus()).toHaveClass('bg-surface');
            expect(cpus()).not.toHaveClass('bg-surface-raised');
            fireEvent.change(cpus(), {target: {value: '0-3'}});
            expect(cpus()).toHaveClass('bg-surface-raised');
            expect(cpus()).not.toHaveClass('bg-surface');
            expect(mem()).not.toHaveClass('bg-surface-raised');
            // Emptied, or blank, it is no change: grey again.
            fireEvent.change(cpus(), {target: {value: ' '}});
            expect(cpus()).not.toHaveClass('bg-surface-raised');
            // No button of its own: the button under the table sets them all.
            expect(within(caps()).getAllByRole('button').map((b) => b.textContent)).toEqual(['Apply the caps configured']);
        });

        test('the caps changed set together, of the section and the node chosen, default lifting one; followed in the tray', async () => {
            render(<ObjectCapacity path="ns1/svc/web" nodes={['n1', 'n2']}/>);
            await waitFor(() => expect(rows()).toHaveLength(2));
            expect(within(caps()).getByText(/A value of default lifts a cap/)).toBeInTheDocument();
            fireEvent.change(within(caps()).getByLabelText('Section'), {target: {value: 'subset#web'}});
            fireEvent.change(within(caps()).getByLabelText('Node'), {target: {value: 'n2'}});
            // What that section holds on that node, read again.
            await waitFor(() => expect(rows()[0]).toEqual(['pg_cpusThe cpus the group runs on.', '3']));
            fireEvent.change(within(caps()).getByLabelText('New value of pg_mem_limit'), {target: {value: '1g'}});
            fireEvent.change(within(caps()).getByLabelText('New value of pg_cpus'), {target: {value: 'default'}});
            config['subset#web.pg_mem_limit@n2'] = '1g';
            fireEvent.click(within(caps()).getByRole('button', {name: 'Set 2 caps'}));
            await waitFor(() => expect(posts()).toEqual([[
                '/api/object/path/ns1/svc/web/action/cap?set=subset#web.pg_cpus@n2=default&set=subset#web.pg_mem_limit@n2=1g',
                null,
            ]]));
            expect(mockTrackResponse).toHaveBeenCalledWith(expect.anything(), {action: 'cap', subject: 'ns1/svc/web', path: 'ns1/svc/web'});
            // Accepted, the values asked emptied, grey again, the ones configured read again.
            await waitFor(() => expect(rows()[1]).toEqual(['pg_mem_limitThe memory the group may use.', '1g']));
            expect(within(caps()).getByLabelText('New value of pg_mem_limit')).toHaveValue('');
            expect(within(caps()).getByLabelText('New value of pg_mem_limit')).not.toHaveClass('bg-surface-raised');
        });

        test('nothing changed: the caps configured applied again', async () => {
            render(<ObjectCapacity path="ns1/svc/web"/>);
            await waitFor(() => expect(rows()).toHaveLength(2));
            expect(within(caps()).getByText('Nothing changed: the caps configured are applied again.')).toBeInTheDocument();
            fireEvent.click(within(caps()).getByRole('button', {name: 'Apply the caps configured'}));
            await waitFor(() => expect(posts()).toEqual([['/api/object/path/ns1/svc/web/action/cap', null]]));
        });

        test('refused, the form says why, the values asked kept', async () => {
            answer = {status: 403, body: {detail: 'claim overrun'}};
            render(<ObjectCapacity path="ns1/svc/web"/>);
            await waitFor(() => expect(rows()).toHaveLength(2));
            fireEvent.change(within(caps()).getByLabelText('New value of pg_cpus'), {target: {value: '0-7'}});
            fireEvent.click(within(caps()).getByRole('button', {name: 'Set 1 cap'}));
            expect(await within(caps()).findByText('HTTP 403 claim overrun')).toBeInTheDocument();
            expect(within(caps()).getByLabelText('New value of pg_cpus')).toHaveValue('0-7');
        });
    });
});
