import i18n from '../../i18n';
import {actionLabel, NODE_ACTIONS, OBJECT_ACTIONS, INSTANCE_ACTIONS, RESOURCE_ACTIONS, objectActionsFor} from '../actions';

describe('actionLabel', () => {
    afterEach(async () => {
        await i18n.changeLanguage('en');
    });

    test('is the capitalized name in English', () => {
        expect(actionLabel('restart daemon')).toBe('Restart daemon');
        expect(actionLabel('start')).toBe('Start');
        expect(actionLabel('scsi scan')).toBe('Scsi scan');
    });

    test('has an English label for every action', () => {
        const all = [...OBJECT_ACTIONS, ...INSTANCE_ACTIONS, ...RESOURCE_ACTIONS, ...NODE_ACTIONS];
        for (const {name} of all) {
            const key = name.replace(/\s+(\w)/g, (_, c) => c.toUpperCase());
            expect(i18n.exists(`actions.labels.${key}`)).toBe(true);
            expect(actionLabel(name)).toBe(name.charAt(0).toUpperCase() + name.slice(1));
        }
    });

    test('is translated in French', async () => {
        await i18n.changeLanguage('fr');
        expect(actionLabel('restart daemon')).toBe('Redémarrer le démon');
        expect(actionLabel('freeze')).toBe('Geler');
    });

    test('falls back to the capitalized name for an unknown action', async () => {
        expect(actionLabel('reboot')).toBe('Reboot');
        await i18n.changeLanguage('fr');
        expect(actionLabel('reboot')).toBe('Reboot');
        expect(actionLabel('')).toBe('');
        expect(actionLabel(undefined)).toBe('');
    });
});

describe('INSTANCE_ACTIONS', () => {
    // The instance actions om3 serves, .../instance/path/{namespace}/{kind}/{name}/action/<this>,
    // as daemon/api/api.yaml on om3 main names them.
    const OM3_INSTANCE_ACTIONS = [
        'boot', 'delete', 'freeze', 'info', 'provision', 'install', 'prstart', 'prstop', 'restart',
        'run', 'shutdown', 'start', 'startstandby', 'status', 'stop', 'pg/reset', 'pg/update',
        'ingest', 'full', 'resync', 'split', 'update', 'unfreeze', 'unprovision',
    ];

    test('each posts to a path om3 serves', () => {
        for (const {name, endpoint} of INSTANCE_ACTIONS) {
            expect([name, OM3_INSTANCE_ACTIONS.includes(endpoint)]).toEqual([name, true]);
        }
    });

    test('sync ingest posts to action/ingest, its path since om3 named the paths after the actions', () => {
        expect(INSTANCE_ACTIONS.find((a) => a.name === 'sync ingest').endpoint).toBe('ingest');
    });

    test('the replication as om <path> sync does it, and the install, each on its path', () => {
        const endpoint = (name) => INSTANCE_ACTIONS.find((a) => a.name === name)?.endpoint;
        expect(['sync update', 'sync full', 'sync resync', 'sync split', 'install'].map(endpoint))
            .toEqual(['update', 'full', 'resync', 'split', 'install']);
    });
});

describe('objectActionsFor the key kinds', () => {
    const names = (kind) => objectActionsFor(kind).map((a) => a.name);

    test('a secret is deleted, not purged; a configuration and a user both', () => {
        expect(names('sec')).toEqual(['delete']);
        expect(names('cfg')).toEqual(['delete', 'purge']);
        expect(names('usr')).toEqual(['delete', 'purge']);
        expect(names('svc')).toContain('purge');
    });
});
