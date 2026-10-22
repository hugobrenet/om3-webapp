import {describe, expect, test} from 'vitest';
import {splitPrefixes} from '../logPrefixes';

describe('splitPrefixes', () => {
    test('the words followed by ": " before the text, a blank ending them', () => {
        expect(splitPrefixes('daemon: api: ux: POST /api/node/name/n1/log: <- exec om')).toEqual({
            prefixes: ['daemon', 'api', 'ux'],
            text: 'POST /api/node/name/n1/log: <- exec om',
        });
        expect(splitPrefixes('daemon: imon: kvm/svc/vm1: fs#1: started')).toEqual({
            prefixes: ['daemon', 'imon', 'kvm/svc/vm1', 'fs#1'],
            text: 'started',
        });
    });

    test('none, the whole text; six at most', () => {
        expect(splitPrefixes('plain text')).toEqual({prefixes: [], text: 'plain text'});
        expect(splitPrefixes(undefined)).toEqual({prefixes: [], text: ''});
        expect(splitPrefixes('a: b: c: d: e: f: g: h').prefixes).toHaveLength(6);
    });
});
