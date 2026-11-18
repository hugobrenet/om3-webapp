import {describe, expect, test} from 'vitest';
import {addressesSignature, resourceAddresses} from '../network-addresses';

describe('network-addresses', () => {
    test('the addresses of a resource as the daemon reads them: all of ipaddrs, else ipaddr, none while down', () => {
        expect(resourceAddresses({info: {ipaddrs: ['10.0.0.2', 'fd00::2', ''], ipaddr: '10.0.0.2'}})).toEqual(['10.0.0.2', 'fd00::2']);
        expect(resourceAddresses({info: {ipaddr: '10.0.0.3'}})).toEqual(['10.0.0.3']);
        expect(resourceAddresses({status: 'down', info: {}})).toEqual([]);
        expect(resourceAddresses(undefined)).toEqual([]);
    });

    test('one string of the addresses of all instances, sorted; the rest of a status not in it', () => {
        const status = (ipaddr, extra = {}) => ({resources: {'ip#0': {status: 'up', info: {ipaddr}}, 'fs#1': {status: 'up', info: {mnt: '/srv'}}}, ...extra});
        const a = {'t/svc/b': {n2: status('10.0.0.66')}, 't/svc/a': {n1: status('10.0.0.2')}};
        expect(addressesSignature(a)).toBe('t/svc/a@n1 ip#0=10.0.0.2\nt/svc/b@n2 ip#0=10.0.0.66');
        // Another state, the same addresses: the same signature.
        expect(addressesSignature({...a, 't/svc/a': {n1: status('10.0.0.2', {overall: 'warn'})}})).toBe(addressesSignature(a));
        // An address given back: another one.
        expect(addressesSignature({...a, 't/svc/b': {n2: {resources: {'ip#0': {status: 'down', info: {}}}}}})).toBe('t/svc/a@n1 ip#0=10.0.0.2');
        expect(addressesSignature(undefined)).toBe('');
    });
});
