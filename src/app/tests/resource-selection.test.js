import {describe, expect, test} from 'vitest';
import {commonResourceActions, resourceTargets} from '../resource-selection';

const line = (object, hostNode, rid, type) => ({object, hostNode, rid, type});

describe('resourceTargets', () => {
    test('one target an instance, its rids joined in a rid expression, sorted', () => {
        expect(resourceTargets([
            line('ns1/svc/web', 'n2', 'fs#1', 'fs.flag'),
            line('ns1/svc/web', 'n1', 'fs#2', 'fs.flag'),
            line('ns1/svc/web', 'n1', 'app#1', 'app.forking'),
            line('a/svc/x', 'n1', 'ip#0', 'ip.host'),
            line('ns1/svc/web', 'n1', 'fs#2', 'fs.flag'),
        ])).toEqual([
            {path: 'a/svc/x', node: 'n1', rid: 'ip#0'},
            {path: 'ns1/svc/web', node: 'n1', rid: 'app#1,fs#2'},
            {path: 'ns1/svc/web', node: 'n2', rid: 'fs#1'},
        ]);
    });
});

describe('commonResourceActions', () => {
    const names = (lines) => commonResourceActions(lines).map((a) => a.name);

    test('those every resource takes: a sync its own, a fs its own, the two those of both', () => {
        const fs = line('o', 'n1', 'fs#1', 'fs.flag');
        const sync = line('o', 'n1', 'sync#1', 'sync.rsync');
        // A sync is no started nor stopped: it replicates.
        expect(names([sync])).toContain('sync update');
        expect(names([sync])).not.toContain('start');
        expect(names([fs])).toContain('start');
        const both = names([fs, sync]);
        expect(both).not.toContain('sync update');
        expect(both).not.toContain('start');
        expect(both.every((name) => names([fs]).includes(name) && names([sync]).includes(name))).toBe(true);
    });

    test('none selected, nothing', () => {
        expect(commonResourceActions([])).toEqual([]);
    });
});
