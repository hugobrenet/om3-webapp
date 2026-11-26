import {describe, expect, test} from 'vitest';
import {STATE_FIELDS, countKept, fieldValueOf, fieldValues, objectFacets, parseCount, reversedOf, stateKept, statesOf} from '../object-facets';

const OBJECTS = {
    'ns1/svc/web': {avail: 'up', overall: 'up', provisioned: 'true', frozen: 'unfrozen', up_instances_count: 2},
    'ns1/svc/db': {avail: 'down', overall: 'down', provisioned: 'false', frozen: 'frozen', up_instances_count: 0},
    'ns1/vol/data': {avail: 'warn', overall: 'warn', provisioned: 'mixed', frozen: 'mixed', up_instances_count: 1},
    'ns2/svc/api': {avail: 'up', overall: 'warn', provisioned: true, frozen: 'unfrozen', up_instances_count: 1},
    'ns2/cfg/conf': {avail: 'n/a', provisioned: 'n/a'},
    'ns2/svc/new': undefined,
};
const NAMES = Object.keys(OBJECTS);
const opts = {
    objects: OBJECTS,
    namespaceOf: (name) => name.split('/')[0],
    kindOf: (name) => name.split('/')[1],
};
const field = (key) => STATE_FIELDS.find((f) => f.key === key);

describe('the fields of closed values', () => {
    test('their value as a string, none when the status has none', () => {
        expect(fieldValueOf({provisioned: true}, 'provisioned')).toBe('true');
        expect(fieldValueOf({frozen: 'mixed'}, 'frozen')).toBe('mixed');
        expect(fieldValueOf({frozen: ''}, 'frozen')).toBeUndefined();
        expect(fieldValueOf(undefined, 'avail')).toBeUndefined();
    });

    test('the values offered: those the objects have and those chosen, in the order of the field, any other after by name', () => {
        const statuses = Object.values(OBJECTS);
        expect(fieldValues(field('provisioned'), statuses)).toEqual(['mixed', 'true', 'false', 'n/a']);
        expect(fieldValues(field('frozen'), statuses, ['n/a'])).toEqual(['mixed', 'frozen', 'unfrozen', 'n/a']);
        expect(fieldValues(field('avail'), [{avail: 'zz'}, {avail: 'aa'}, {avail: 'up'}])).toEqual(['up', 'aa', 'zz']);
    });

    test('kept by the State filter: any value chosen of a field, every field; none chosen, every object', () => {
        const db = OBJECTS['ns1/svc/db'];
        expect(stateKept(db, {})).toBe(true);
        expect(stateKept(db, {avail: ['down', 'warn']})).toBe(true);
        expect(stateKept(db, {avail: ['down'], provisioned: ['false', 'mixed']})).toBe(true);
        expect(stateKept(db, {avail: ['down'], frozen: ['unfrozen']})).toBe(false);
        // No status, kept by no value chosen.
        expect(stateKept(undefined, {})).toBe(true);
        expect(stateKept(undefined, {avail: ['n/a']})).toBe(false);
    });

    test('a field reversed keeps the objects of none of its values chosen, the other fields as they are', () => {
        const db = OBJECTS['ns1/svc/db'];
        expect(stateKept(db, {avail: ['up']}, ['avail'])).toBe(true);
        expect(stateKept(db, {avail: ['down', 'warn']}, ['avail'])).toBe(false);
        expect(stateKept(db, {avail: ['up'], frozen: ['frozen']}, ['avail'])).toBe(true);
        expect(stateKept(db, {avail: ['up'], frozen: ['unfrozen']}, ['avail'])).toBe(false);
        // Reversed of nothing chosen, every object; no status, of none of them.
        expect(stateKept(db, {}, ['avail'])).toBe(true);
        expect(stateKept(undefined, {avail: ['n/a']}, ['avail'])).toBe(true);
    });
});

describe('the instances up, typed in', () => {
    test('a count, or one after a comparison; nothing, null; anything else, not one', () => {
        expect(parseCount('2')).toEqual({op: '=', value: 2});
        expect(parseCount(' >= 1 ')).toEqual({op: '>=', value: 1});
        expect(parseCount('<3')).toEqual({op: '<', value: 3});
        expect(parseCount('')).toBeNull();
        expect(parseCount('  ')).toBeNull();
        expect(parseCount('two')).toBeUndefined();
        expect(parseCount('>-1')).toBeUndefined();
    });

    test('a count kept by the comparison; none typed, every count; an object without one, by none', () => {
        expect(countKept(0, parseCount('0'))).toBe(true);
        expect(countKept(1, parseCount('>0'))).toBe(true);
        expect(countKept(0, parseCount('>0'))).toBe(false);
        expect(countKept(2, parseCount('<=1'))).toBe(false);
        expect(countKept(2, null)).toBe(true);
        expect(countKept(undefined, parseCount('0'))).toBe(false);
    });
});

describe('objectFacets', () => {
    test('no filter: every value of each field counted over every object; an object of no status, in none', () => {
        const facets = objectFacets(NAMES, {}, opts);
        expect(facets.avail).toEqual({up: 2, down: 1, warn: 1, 'n/a': 1});
        expect(facets.provisioned).toEqual({true: 2, false: 1, mixed: 1, 'n/a': 1});
        expect(facets.frozen).toEqual({unfrozen: 2, frozen: 1, mixed: 1});
        expect(facets.namespace).toEqual({ns1: 3, ns2: 3});
        expect(facets.kind).toEqual({svc: 4, vol: 1, cfg: 1});
    });

    test('each field counted under the other filters, not its own', () => {
        const facets = objectFacets(NAMES, {namespaces: ['ns1'], states: {avail: ['up', 'down'], provisioned: ['true']}}, opts);
        // The availabilities of ns1 provisioned: its own field set aside.
        expect(facets.avail).toEqual({up: 1});
        // Provisioned or not, of the objects of ns1 up or down: its own field set aside.
        expect(facets.provisioned).toEqual({true: 1, false: 1});
        // The namespaces of the objects up or down, provisioned.
        expect(facets.namespace).toEqual({ns1: 1, ns2: 1});
    });

    test('a field reversed counted the same, the others counted among the objects of none of its values', () => {
        const facets = objectFacets(NAMES, {states: {avail: ['up']}, reversed: ['avail']}, opts);
        expect(facets.avail).toEqual({up: 2, down: 1, warn: 1, 'n/a': 1});
        // Of the objects not up: the down, the warn, the n/a and the one of no status.
        expect(facets.provisioned).toEqual({false: 1, mixed: 1, 'n/a': 1});
        expect(facets.namespace).toEqual({ns1: 2, ns2: 2});
    });

    test('the name searched and the instances up narrow every facet', () => {
        expect(objectFacets(NAMES, {search: 'A'}, opts).avail).toEqual({up: 1, warn: 1});
        expect(objectFacets(NAMES, {upInstances: parseCount('1')}, opts).avail).toEqual({up: 1, warn: 1});
        expect(objectFacets(NAMES, {upInstances: parseCount('>0')}, opts).namespace).toEqual({ns1: 2, ns2: 1});
    });

    test('a filter the tab has not keeps every object', () => {
        const facets = objectFacets(NAMES, {kinds: ['vol'], states: {avail: ['down']}, upInstances: parseCount('5')}, {...opts, useKind: false, useState: false});
        expect(facets.namespace).toEqual({ns1: 3, ns2: 3});
    });
});

describe('statesOf', () => {
    const of = (search) => statesOf(new URLSearchParams(search));

    test('a field a parameter each', () => {
        const states = of('avail=up,warn&provisioned=false,mixed&placement=non-optimal&policy=nodes%20order');
        expect(states.avail).toEqual(['up', 'warn']);
        expect(states.provisioned).toEqual(['false', 'mixed']);
        expect(states.placement_state).toEqual(['non-optimal']);
        expect(states.placement_policy).toEqual(['nodes order']);
        expect(states.frozen).toEqual([]);
        expect(of('avail=all').avail).toEqual([]);
    });

    test('an older address\'s global state read as it: its availabilities, unprovisioned the object not provisioned', () => {
        const states = of('globalState=down,unprovisioned&avail=up');
        expect(states.avail).toEqual(['up', 'down']);
        expect(states.provisioned).toEqual(['false']);
    });
});

describe('reversedOf', () => {
    const of = (search) => reversedOf(new URLSearchParams(search));

    test('the fields `not` names by their parameters, by their keys, those of a value chosen only', () => {
        expect(of('avail=up&placement=optimal&not=avail,placement')).toEqual(['avail', 'placement_state']);
        expect(of('avail=up&not=avail,frozen')).toEqual(['avail']);
        expect(of('avail=up')).toEqual([]);
    });
});
