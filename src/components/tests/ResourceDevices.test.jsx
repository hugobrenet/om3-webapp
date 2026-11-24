import React from 'react';
import {act, render, screen, within, fireEvent, waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {vi} from 'vitest';
import {ResourceDevices, ResourceFiles} from '../ResourceDevices';
import {devicesUrl, hasDevices, resourceDevices, resourceFileUrl, resourceFiles} from '../../app/resource-devices';
import useEventStore from '../../hooks/useEventStore';
import {DEVICES_SETTLE_MS} from '../ResourceDevices';

vi.mock('../../eventSourceManager.jsx', async (importOriginal) => ({
    ...(await importOriginal()),
    retainEventReception: vi.fn(() => vi.fn()),
}));

vi.mock('../../utils/logger.js', () => ({
    default: {error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn()},
}));

const device = (node, rid, role, dev, group = 'fs', name = 'ext4') => ({
    kind: 'InstanceDeviceItem',
    meta: {node, object: 'prod/svc/web'},
    data: {path: 'prod/svc/web', rid, role, device: dev, driver: {group, name}},
});

const json = (body, status = 200) => Promise.resolve({
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    clone() {
        return this;
    },
});

const cells = (table) => within(table).getAllByRole('row').slice(1)
    .map((row) => within(row).getAllByRole('cell').map((c) => c.textContent));

beforeEach(() => {
    localStorage.setItem('authToken', 'tok');
});

afterEach(() => {
    localStorage.clear();
});

describe('resource-devices', () => {
    test('the disks, the filesystems, the volumes and the virtual machines tell devices; not an app, nor a docker container', () => {
        expect(hasDevices('disk#1', 'disk.vg')).toBe(true);
        expect(hasDevices('fs#1')).toBe(true);
        expect(hasDevices('volume#1', 'volume')).toBe(true);
        expect(hasDevices('container#1', 'container.kvm')).toBe(true);
        expect(hasDevices('container#1', 'container.docker')).toBe(false);
        expect(hasDevices('container#1')).toBe(false);
        expect(hasDevices('app#1', 'app.simple')).toBe(false);
    });

    test('the addresses: the devices of an instance, a file of a resource, its rid and name encoded', () => {
        expect(devicesUrl('prod/svc/web', 'n1')).toBe('/api/node/name/n1/instance/path/prod/svc/web/device');
        expect(resourceFileUrl('prod/svc/web', 'n1', 'disk#1', '/var/lib/a b'))
            .toBe('/api/node/name/n1/instance/path/prod/svc/web/resource/file?rid=disk%231&name=%2Fvar%2Flib%2Fa%20b');
    });

    test('the devices of a resource alone, by node, then by role as made then stood on, then by device', () => {
        const rows = resourceDevices({
            n2: [device('n2', 'fs#1', 'claimed', '/dev/b')],
            n1: [
                device('n1', 'fs#1', 'claimed', '/dev/a'),
                device('n1', 'disk#1', 'exposed', '/dev/md0', 'disk', 'md'),
                device('n1', 'fs#1', 'sub', '/dev/a'),
                device('n1', 'fs#1', 'base', '/dev/sdb'),
            ],
            n3: null,
        }, 'fs#1');
        expect(rows).toEqual([
            {node: 'n1', role: 'sub', device: '/dev/a', driver: 'fs.ext4'},
            {node: 'n1', role: 'base', device: '/dev/sdb', driver: 'fs.ext4'},
            {node: 'n1', role: 'claimed', device: '/dev/a', driver: 'fs.ext4'},
            {node: 'n2', role: 'claimed', device: '/dev/b', driver: 'fs.ext4'},
        ]);
    });

    test('the files a resource lists on the nodes asked, by node then by name', () => {
        const instances = {
            n2: {resources: {'disk#1': {files: [{name: '/b'}]}}},
            n1: {resources: {'disk#1': {files: [{name: '/b'}, {name: '/a'}]}, 'fs#1': {files: [{name: '/c'}]}}},
            n3: {resources: {'disk#1': {files: [{name: '/z'}]}}},
        };
        expect(resourceFiles(instances, 'disk#1', ['n1', 'n2']).map(({node, name}) => `${node}${name}`)).toEqual(['n1/a', 'n1/b', 'n2/b']);
        expect(resourceFiles(instances, 'app#1', ['n1'])).toEqual([]);
    });
});

describe('ResourceDevices', () => {
    test('its devices on each node holding it, a badge each node, the roles said under them', async () => {
        global.fetch = vi.fn((url) => {
            if (url.includes('/n1/')) return json({kind: 'InstanceDeviceList', items: [device('n1', 'fs#1', 'claimed', '/dev/md/web'), device('n1', 'fs#1', 'sub', '/dev/md/web'), device('n1', 'fs#2', 'sub', '/dev/sdc')]});
            return json({kind: 'InstanceDeviceList', items: [device('n2', 'fs#1', 'sub', '/dev/md/web')]});
        });
        render(<MemoryRouter><ResourceDevices path="prod/svc/web" rid="fs#1" nodes={['n1', 'n2']}/></MemoryRouter>);
        const table = await screen.findByRole('table', {name: 'The devices of the resource on each node'});
        await waitFor(() => expect(cells(table)).toHaveLength(3));
        expect(cells(table)).toEqual([
            ['on n1', 'Sub', '/dev/md/web', 'fs.ext4'],
            ['on n1', 'Claimed', '/dev/md/web', 'fs.ext4'],
            ['on n2', 'Sub', '/dev/md/web', 'fs.ext4'],
        ]);
        expect(screen.getByText('Exposed', {selector: 'dt'})).toBeInTheDocument();
        expect(screen.getByText('Base', {selector: 'dt'}).nextElementSibling).toHaveTextContent(/physical devices/);
    });

    test('a node failing said, the others shown; read again on demand', async () => {
        global.fetch = vi.fn((url) => (url.includes('/n2/')
            ? json({title: 'Internal Server Error', detail: 'boom', status: 500}, 500)
            : json({items: [device('n1', 'fs#1', 'sub', '/dev/sdb')]})));
        render(<MemoryRouter><ResourceDevices path="prod/svc/web" rid="fs#1" nodes={['n1', 'n2']}/></MemoryRouter>);
        expect(await screen.findByText(/Could not read the devices on n2/)).toBeInTheDocument();
        expect(cells(screen.getByRole('table'))).toEqual([['on n1', 'Sub', '/dev/sdb', 'fs.ext4']]);
        fireEvent.click(screen.getByRole('button', {name: 'Read again'}));
        await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(4));
    });

    describe('read again as the resource changes', () => {
        const status = (fs1, fs2) => ({'prod/svc/web': {
            n1: {resources: {'fs#1': {status: fs1}, 'fs#2': {status: fs2}}},
            n2: {resources: {'fs#1': {status: fs1}, 'fs#2': {status: fs2}}},
        }});

        beforeEach(() => {
            useEventStore.setState({objectInstanceStatus: status('up', 'up'), instanceConfig: {}});
        });

        afterEach(() => {
            vi.useRealTimers();
            act(() => useEventStore.setState({objectInstanceStatus: {}, instanceConfig: {}}));
        });

        test('its status changing on its nodes: read once settled; another resource changing, nothing read', async () => {
            vi.useFakeTimers({shouldAdvanceTime: true});
            let dev = '/dev/sdb';
            global.fetch = vi.fn((url) => json({items: [device(url.includes('/n1/') ? 'n1' : 'n2', 'fs#1', 'sub', dev)]}));
            render(<MemoryRouter><ResourceDevices path="prod/svc/web" rid="fs#1" nodes={['n1', 'n2']}/></MemoryRouter>);
            await waitFor(() => expect(cells(screen.getByRole('table'))).toHaveLength(2));
            expect(global.fetch).toHaveBeenCalledTimes(2);
            act(() => useEventStore.setState({objectInstanceStatus: status('up', 'down')}));
            await act(() => vi.advanceTimersByTimeAsync(DEVICES_SETTLE_MS * 2));
            expect(global.fetch).toHaveBeenCalledTimes(2);
            dev = '/dev/sdc';
            // n1, then n2: one read of each.
            act(() => useEventStore.setState({objectInstanceStatus: {'prod/svc/web': {...status('down', 'down')['prod/svc/web'], n2: status('up', 'down')['prod/svc/web'].n2}}}));
            await act(() => vi.advanceTimersByTimeAsync(DEVICES_SETTLE_MS / 2));
            act(() => useEventStore.setState({objectInstanceStatus: status('down', 'down')}));
            await act(() => vi.advanceTimersByTimeAsync(DEVICES_SETTLE_MS / 2));
            expect(global.fetch).toHaveBeenCalledTimes(2);
            await act(() => vi.advanceTimersByTimeAsync(DEVICES_SETTLE_MS));
            expect(global.fetch).toHaveBeenCalledTimes(4);
            await waitFor(() => expect(cells(screen.getByRole('table')).map((row) => row[2])).toEqual(['/dev/sdc', '/dev/sdc']));
        });

        test('its configuration changing: read again, a node failing keeping what it read, no spinner', async () => {
            vi.useFakeTimers({shouldAdvanceTime: true});
            global.fetch = vi.fn((url) => json({items: [device(url.includes('/n1/') ? 'n1' : 'n2', 'fs#1', 'sub', '/dev/sdb')]}));
            render(<MemoryRouter><ResourceDevices path="prod/svc/web" rid="fs#1" nodes={['n1', 'n2']}/></MemoryRouter>);
            await waitFor(() => expect(cells(screen.getByRole('table'))).toHaveLength(2));
            global.fetch = vi.fn((url) => (url.includes('/n2/')
                ? json({title: 'Internal Server Error', detail: 'boom', status: 500}, 500)
                : json({items: [device('n1', 'fs#1', 'sub', '/dev/sdd')]})));
            act(() => useEventStore.setState({instanceConfig: {'prod/svc/web': {n1: {csum: 'b'}}}}));
            await act(() => vi.advanceTimersByTimeAsync(DEVICES_SETTLE_MS));
            expect(screen.getByRole('button', {name: 'Read again'})).toBeEnabled();
            await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
            await waitFor(() => expect(cells(screen.getByRole('table'))).toEqual([
                ['on n1', 'Sub', '/dev/sdd', 'fs.ext4'],
                ['on n2', 'Sub', '/dev/sdb', 'fs.ext4'],
            ]));
            expect(screen.queryByText(/Could not read the devices/)).toBeNull();
        });
    });

    test('none: said so; no node holding it: said so, nothing read', async () => {
        global.fetch = vi.fn(() => json({items: []}));
        const {unmount} = render(<MemoryRouter><ResourceDevices path="prod/svc/web" rid="fs#1" nodes={['n1']}/></MemoryRouter>);
        expect(await screen.findByText(/No device/)).toBeInTheDocument();
        unmount();
        global.fetch.mockClear();
        render(<MemoryRouter><ResourceDevices path="prod/svc/web" rid="fs#1" nodes={[]}/></MemoryRouter>);
        expect(screen.getByText('No node holds this resource.')).toBeInTheDocument();
        expect(global.fetch).not.toHaveBeenCalled();
    });
});

describe('ResourceFiles', () => {
    const NAME = '/var/lib/opensvc/web/disk#1/disks';
    beforeEach(() => {
        useEventStore.setState({objectInstanceStatus: {'prod/svc/web': {
            n1: {resources: {'disk#1': {files: [{name: NAME, csum: 'ab12', mtime: '0001-01-01T00:00:00Z'}]}}},
            n2: {resources: {'disk#1': {files: [{name: NAME, csum: '', mtime: '0001-01-01T00:00:00Z'}]}}},
        }}});
    });

    test('a row each, its content read from its node on demand with its owner and mode', async () => {
        global.fetch = vi.fn(() => Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({'OM-User': '0', 'OM-Group': '0', 'OM-Perm': '644', 'OM-Last-Modified': '2026-11-16T10:00:00Z'}),
            text: () => Promise.resolve('/dev/sdb\n/dev/sdc\n'),
        }));
        render(<MemoryRouter><ResourceFiles path="prod/svc/web" rid="disk#1" nodes={['n1', 'n2']}/></MemoryRouter>);
        const table = screen.getByRole('table', {name: 'The files of the resource on each node'});
        expect(cells(table)).toEqual([
            ['on n1', NAME, '–', 'ab12', 'Show'],
            ['on n2', NAME, '–', '–', 'Show'],
        ]);
        fireEvent.click(screen.getByRole('button', {name: `Show ${NAME} on n2`}));
        expect(global.fetch).toHaveBeenCalledWith(resourceFileUrl('prod/svc/web', 'n2', 'disk#1', NAME), expect.anything());
        const content = await screen.findByLabelText(`Content of ${NAME}`);
        expect(content.textContent).toBe('/dev/sdb\n/dev/sdc\n');
        expect(screen.getByText(/Owner 0:0, mode 644/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: `Hide ${NAME} on n2`}));
        expect(screen.queryByLabelText(`Content of ${NAME}`)).toBeNull();
    });

    test('its checksum changing: read again, what was read kept on a failure', async () => {
        const file = (text) => Promise.resolve({ok: true, status: 200, headers: new Headers(), text: () => Promise.resolve(text)});
        global.fetch = vi.fn(() => file('/dev/sdb\n'));
        render(<MemoryRouter><ResourceFiles path="prod/svc/web" rid="disk#1" nodes={['n1']}/></MemoryRouter>);
        fireEvent.click(screen.getByRole('button', {name: `Show ${NAME} on n1`}));
        expect((await screen.findByLabelText(`Content of ${NAME}`)).textContent).toBe('/dev/sdb\n');
        const csum = (value) => act(() => useEventStore.setState({objectInstanceStatus: {'prod/svc/web': {
            n1: {resources: {'disk#1': {files: [{name: NAME, csum: value, mtime: '2026-11-16T10:00:00Z'}]}}},
        }}}));
        global.fetch = vi.fn(() => file('/dev/sdc\n'));
        csum('cd34');
        await waitFor(() => expect(screen.getByLabelText(`Content of ${NAME}`).textContent).toBe('/dev/sdc\n'));
        global.fetch = vi.fn(() => json({title: 'Internal Server Error', detail: 'boom', status: 500}, 500));
        csum('ef56');
        await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
        await new Promise((r) => setTimeout(r, 20));
        expect(screen.getByLabelText(`Content of ${NAME}`).textContent).toBe('/dev/sdc\n');
        expect(screen.queryByRole('alert')).toBeNull();
    });

    test('not on its node: said so, not as a failure', async () => {
        global.fetch = vi.fn(() => json({title: 'Not Found', detail: '', status: 404}, 404));
        render(<MemoryRouter><ResourceFiles path="prod/svc/web" rid="disk#1" nodes={['n1']}/></MemoryRouter>);
        fireEvent.click(screen.getByRole('button', {name: `Show ${NAME} on n1`}));
        expect(await screen.findByText('The file is not on n1.')).toBeInTheDocument();
        expect(screen.queryByRole('alert')).toBeNull();
    });
});
