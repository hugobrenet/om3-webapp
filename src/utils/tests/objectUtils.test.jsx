import {
    extractNamespace,
    extractKind,
    isActionAllowedForSelection,
    ALLOWED_ACTIONS_BY_KIND
} from '../objectUtils';

describe('objectUtils', () => {
    describe('extractNamespace', () => {
        test('should return namespace when name has 3 parts', () => {
            expect(extractNamespace('ns/kind/name')).toBe('ns');
        });

        test('should return "root" when name has less than 3 parts', () => {
            expect(extractNamespace('kind/name')).toBe('root');
            expect(extractNamespace('name')).toBe('root');
        });
    });

    describe('extractKind', () => {
        test('should return kind when name has 3 parts', () => {
            expect(extractKind('ns/kind/name')).toBe('kind');
        });

        test('should return first part when name has 2 parts', () => {
            expect(extractKind('kind/name')).toBe('kind');
        });

        test('should return "ccfg" for cluster object', () => {
            expect(extractKind('cluster')).toBe('ccfg');
        });

        test('should return "svc" for other single-part names', () => {
            expect(extractKind('service')).toBe('svc');
        });
    });

    describe('isActionAllowedForSelection', () => {
        test('should return false for empty selection', () => {
            expect(isActionAllowedForSelection('start', [])).toBe(false);
        });

        test('should check action against allowed actions for single kind', () => {
            // Test with cfg kind
            expect(isActionAllowedForSelection('delete', ['cfg/obj1'])).toBe(true);
            expect(isActionAllowedForSelection('freeze', ['cfg/obj1'])).toBe(false);

            // Test with vol kind
            expect(isActionAllowedForSelection('freeze', ['vol/obj1'])).toBe(true);
            expect(isActionAllowedForSelection('switch', ['vol/obj1'])).toBe(false); // Not in vol specific list
        });

        test('should check action against default list when kind not found', () => {
            expect(isActionAllowedForSelection('start', ['unknown/obj1'])).toBe(true);
            expect(isActionAllowedForSelection('invalid-action', ['unknown/obj1'])).toBe(false);
        });

        test('should handle multiple objects of same kind', () => {
            const selection = ['cfg/obj1', 'cfg/obj2'];
            expect(isActionAllowedForSelection('delete', selection)).toBe(true);
            expect(isActionAllowedForSelection('freeze', selection)).toBe(false);
        });

        test('should handle multiple objects of different kinds', () => {
            const selection = ['cfg/obj1', 'vol/obj2'];

            // Action allowed for both kinds
            expect(isActionAllowedForSelection('delete', selection)).toBe(true);

            // Action allowed only for vol
            expect(isActionAllowedForSelection('freeze', selection)).toBe(true);

            // Action allowed only for cfg
            expect(isActionAllowedForSelection('abort', selection)).toBe(true);

            // Action not allowed for either
            expect(isActionAllowedForSelection('switch', selection)).toBe(false);
        });

        test('should handle objects without explicit kind definitions', () => {
            const selection = ['svc/obj1', 'unknown/obj2'];
            expect(isActionAllowedForSelection('start', selection)).toBe(true);
            expect(isActionAllowedForSelection('stop', selection)).toBe(true);
            expect(isActionAllowedForSelection('invalid', selection)).toBe(false);
        });
    });

    describe('ALLOWED_ACTIONS_BY_KIND', () => {
        test('should have correct action lists for each kind', () => {
            // The cluster object's actions are the cluster's.
            expect(ALLOWED_ACTIONS_BY_KIND.ccfg).toEqual(['abort', 'freeze', 'unfreeze']);
            expect(ALLOWED_ACTIONS_BY_KIND.cfg).toEqual(['abort', 'delete']);
            expect(ALLOWED_ACTIONS_BY_KIND.vol).toEqual([
                'abort', 'delete', 'freeze', 'provision', 'purge', 'unfreeze', 'unprovision'
            ]);
            expect(ALLOWED_ACTIONS_BY_KIND.sec).toEqual(['abort', 'delete']);
            expect(ALLOWED_ACTIONS_BY_KIND.usr).toEqual(['abort', 'delete']);
            expect(ALLOWED_ACTIONS_BY_KIND.default).toEqual([
                'start', 'stop', 'restart', 'freeze', 'unfreeze', 'delete',
                'provision', 'unprovision', 'purge', 'switch', 'giveback', 'abort'
            ]);
        });
    });
});