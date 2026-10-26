import {describe, expect, test} from 'vitest';
import i18n from '../../i18n';
import {untrustedT} from '../untrustedText';

describe('untrustedT', () => {
    test('puts each value in its place, never read again', () => {
        const t = i18n.getFixedT('en');
        expect(untrustedT(t, 'ai.confirm.summary.stop_instance', {path: '{{node}} <b>x</b> $t(ai.title)', node: 'n1'})).toBe(
            'Stop {{node}} <b>x</b> $t(ai.title) on n1'
        );
        expect(untrustedT(t, 'ai.starters.object', {path: 'ns/svc/{{state}}', state: 'down'})).toBe('Why is ns/svc/{{state}} down?');
    });
    test('keeps the plural forms of a count', () => {
        const t = i18n.getFixedT('en');
        expect(untrustedT(t, 'ai.confirm.deleted', {section: 'fs#{{count}}'}, {count: 2})).toBe('Deletes the section fs#{{count}} and its 2 keys:');
    });
});
