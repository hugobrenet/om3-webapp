import {describe, expect, test, vi} from 'vitest';
import {actionUrl, resourceActions, syncVariant} from '../objectActions';

vi.mock('../../i18n', () => ({default: {t: (key) => key}}));

const names = (rid, type) => resourceActions(rid, type).map((a) => a.name);

describe('the actions of a resource, by its driver type', () => {
    test('a task runs, neither starts nor stops; a container reserves its devices; what stops, unstops', () => {
        expect(names('task#1', 'task.host')).toEqual(['run']);
        expect(names('container#1', 'container.docker')).toEqual(
            ['start', 'stop', 'unstop', 'restart', 'start standby', 'prstart', 'prstop', 'provision', 'unprovision']);
    });

    test('a sync resource replicates: the sync actions of its driver, neither start nor stop', () => {
        expect(names('sync#1', 'sync.rsync')).toEqual(['sync update', 'sync full', 'provision', 'unprovision']);
        expect(names('sync#1', 'sync.symsrdfs')).toEqual(['sync update', 'sync split', 'sync ingest', 'provision', 'unprovision']);
        expect(names('sync#1', 'sync.zfssnap')).toEqual(['sync update', 'provision', 'unprovision']);
    });

    test('a disk replicated by its driver: the sync actions too; a boot of the ones cleaning up', () => {
        expect(names('disk#1', 'disk.md')).toEqual(
            ['start', 'stop', 'unstop', 'restart', 'start standby', 'prstart', 'prstop', 'sync resync', 'sync ingest', 'boot', 'provision', 'unprovision']);
        expect(names('disk#1', 'disk.loop')).toEqual(
            ['start', 'stop', 'unstop', 'restart', 'start standby', 'prstart', 'prstop', 'provision', 'unprovision']);
        expect(names('ip#1', 'ip.host')).toEqual(['start', 'stop', 'unstop', 'restart', 'start standby', 'provision', 'unprovision']);
    });

    test('its type unknown, the actions of the group of its id', () => {
        expect(names('task#1')).toEqual(['run']);
        expect(names('sync#1')).toEqual(['sync update', 'provision', 'unprovision']);
    });

    test('the words of a sync: into their store, all of them stores; to the peers or a store, some; to the peers, none', () => {
        expect(syncVariant('sync update', ['sync.store'])).toBe('Store');
        expect(syncVariant('sync full', ['sync.store', 'sync.store'])).toBe('Store');
        expect(syncVariant('sync update', ['sync.store', 'sync.rsync', 'fs.flag'])).toBe('Either');
        expect(syncVariant('sync update', ['sync.rsync', 'disk.md'])).toBe('');
        // An action worded the same whatever it acts on.
        expect(syncVariant('start', ['sync.store'])).toBe('');
    });

    test('posted to the endpoint of the action, the resources by their ids', () => {
        const at = (action, rid) => actionUrl({path: 'ns/svc/web', node: 'n1', action, rid});
        expect(at('sync update', 'sync#1')).toBe('/api/node/name/n1/instance/path/ns/svc/web/action/update?rid=sync%231');
        expect(at('start standby', 'disk#1,fs#1')).toBe('/api/node/name/n1/instance/path/ns/svc/web/action/startstandby?rid=disk%231%2Cfs%231');
        expect(at('run', 'task#1')).toBe('/api/node/name/n1/instance/path/ns/svc/web/action/run?rid=task%231');
    });
});
