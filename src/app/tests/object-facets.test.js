import {describe, expect, test} from 'vitest';
import {globalStatesOf, objectFacets} from '../object-facets';

const OBJECTS = {
    'ns1/svc/web': {avail: 'up'},
    'ns1/svc/db': {avail: 'down', provisioned: 'false'},
    'ns1/vol/data': {avail: 'warn'},
    'ns2/svc/api': {avail: 'up'},
    'ns2/cfg/conf': {avail: 'n/a'},
    'ns2/svc/new': undefined,
};
const NAMES = Object.keys(OBJECTS);
const opts = {
    objects: OBJECTS,
    namespaceOf: (name) => name.split('/')[0],
    kindOf: (name) => name.split('/')[1],
};

describe('globalStatesOf', () => {
    test('its availability, n/a for any other; unprovisioned besides when one of its instances is', () => {
        expect(globalStatesOf({avail: 'up'})).toEqual(['up']);
        expect(globalStatesOf({avail: 'stdby up'})).toEqual(['n/a']);
        expect(globalStatesOf({avail: 'down', provisioned: false})).toEqual(['down', 'unprovisioned']);
        expect(globalStatesOf({avail: 'warn', provisioned: 'false'})).toEqual(['warn', 'unprovisioned']);
        // Provisioned on a node, not on another.
        expect(globalStatesOf({avail: 'up', provisioned: 'mixed'})).toEqual(['up', 'unprovisioned']);
        // Nothing to provision, or not known: not unprovisioned.
        for (const provisioned of ['true', true, 'n/a', 'undef', undefined]) {
            expect(globalStatesOf({avail: 'up', provisioned})).toEqual(['up']);
        }
    });
});

describe('objectFacets', () => {
    test('no filter: every value counted over every object; an object of no status, in no global state', () => {
        expect(objectFacets(NAMES, {}, opts)).toEqual({
            globalState: {up: 2, down: 1, unprovisioned: 1, warn: 1, 'n/a': 1},
            namespace: {ns1: 3, ns2: 3},
            kind: {svc: 4, vol: 1, cfg: 1},
        });
    });

    test('each facet counted under the other filters, not its own', () => {
        const facets = objectFacets(NAMES, {namespaces: ['ns1'], globalStates: ['up']}, opts);
        // The states of ns1: its own filter set aside.
        expect(facets.globalState).toEqual({up: 1, down: 1, unprovisioned: 1, warn: 1});
        // The namespaces of the objects up: its own filter set aside.
        expect(facets.namespace).toEqual({ns1: 1, ns2: 1});
        // The kinds of the objects of ns1 up.
        expect(facets.kind).toEqual({svc: 1});
    });

    test('the name search narrows every facet', () => {
        expect(objectFacets(NAMES, {search: 'A'}, opts)).toEqual({
            globalState: {up: 1, warn: 1},
            namespace: {ns1: 1, ns2: 1},
            kind: {vol: 1, svc: 1},
        });
    });

    test('a filter the tab has not keeps every object', () => {
        const facets = objectFacets(NAMES, {kinds: ['vol'], globalStates: ['down']}, {...opts, useKind: false, useGlobalState: false});
        expect(facets.namespace).toEqual({ns1: 3, ns2: 3});
    });
});
