import {describe, expect, test} from 'vitest';
import {parseBlobContent} from '../blob-content';

const blob = (bytes) => ({arrayBuffer: async () => new Uint8Array(bytes).buffer});
const text = (s) => blob([...new TextEncoder().encode(s)]);

describe('parseBlobContent', () => {
    test('UTF-8 with tabs and line ends: text, as it is', async () => {
        expect(await parseBlobContent(text('a\tb\r\nc é\n'))).toEqual({type: 'text', content: 'a\tb\r\nc é\n'});
    });

    test('empty: text, empty, to be edited as any', async () => {
        expect(await parseBlobContent(blob([]))).toEqual({type: 'text', content: ''});
    });

    test('a control character, or bytes not UTF-8: binary, in hex, as far as asked', async () => {
        expect(await parseBlobContent(blob([0x61, 0x00]))).toEqual({type: 'binary', content: '00000000  61 00' + ' '.repeat(43) + '  a.'});
        expect((await parseBlobContent(blob([0xff, 0xfe]))).type).toBe('binary');
        expect((await parseBlobContent(blob(new Array(40).fill(0)), {hexLimit: 16})).content.split('\n')).toHaveLength(1);
    });
});
