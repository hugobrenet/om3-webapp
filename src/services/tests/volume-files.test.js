import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {readFileHead} from '../volume-files.js';

const LIMIT = 8;

/** An answer whose body comes in these chunks, with these headers. */
const answer = (chunks, {status = 200, headers = {}} = {}) => {
    let pulled = 0;
    const body = new ReadableStream({
        pull(controller) {
            if (pulled === chunks.length) controller.close();
            else controller.enqueue(new TextEncoder().encode(chunks[pulled++]));
        },
    // Pulled as read, none ahead: the chunks counted are those asked for.
    }, {highWaterMark: 0});
    return {pulled: () => pulled, response: new Response(body, {status, headers})};
};

/** What a blob holds, read as a browser reads it: jsdom gives a Blob no arrayBuffer(). */
const text = (blob) => new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsText(blob);
});

describe('readFileHead', () => {
    let served;

    beforeEach(() => {
        localStorage.setItem('authToken', 'tok');
        global.fetch = vi.fn(async (url, options = {}) => {
            if (options.method === 'POST') {
                expect(url).toBe('/api/node/name/n1/instance/path/ns1/vol/data/file/download?dir=etc&name=big.log');
                return new Response(JSON.stringify({port: 1215, ticket: 't1'}), {status: 200, headers: {'Content-Type': 'application/json'}});
            }
            expect(options.headers).toEqual({Range: `bytes=0-${LIMIT - 1}`});
            return served.response;
        });
    });

    afterEach(() => {
        localStorage.clear();
    });

    const read = () => readFileHead('ns1/vol/data', 'n1', 'big.log', 'etc', LIMIT);

    test('the range answered: its bytes, the size the range tells, partial when the file goes on', async () => {
        served = answer(['abcd', 'efgh'], {status: 206, headers: {'Content-Range': 'bytes 0-7/20', 'Content-Length': '8'}});
        const head = await read();
        expect(await text(head.blob)).toBe('abcdefgh');
        expect(head).toMatchObject({total: 20, partial: true});
    });

    test('the range answered, the file no longer than it: whole', async () => {
        served = answer(['abc'], {status: 206, headers: {'Content-Range': 'bytes 0-2/3'}});
        expect(await read()).toMatchObject({total: 3, partial: false});
    });

    test('the range ignored, no length told: the bytes past the limit say it partial, its size unknown', async () => {
        served = answer(['abcdef', 'ghijkl', 'mnop']);
        const head = await read();
        expect(await text(head.blob)).toBe('abcdefgh');
        expect(head).toMatchObject({total: undefined, partial: true});
        // Read no further than to know.
        expect(served.pulled()).toBe(2);
    });

    test('the range ignored, the file the limit exactly, then more: partial, not taken for whole', async () => {
        served = answer(['abcdefgh', 'i']);
        expect(await read()).toMatchObject({total: undefined, partial: true});
    });

    test('the range ignored, the length of a compressed body told: partial still, the length kept only when beyond the limit', async () => {
        served = answer(['abcdefgh', 'ijkl'], {headers: {'Content-Length': '5'}});
        expect(await read()).toMatchObject({total: undefined, partial: true});
        served = answer(['abcdefgh', 'ijkl'], {headers: {'Content-Length': '12'}});
        expect(await read()).toMatchObject({total: 12, partial: true});
    });

    test('the range ignored, the file within the limit: whole, its size the bytes read', async () => {
        served = answer(['abc', 'de'], {headers: {'Content-Length': '99'}});
        const head = await read();
        expect(await text(head.blob)).toBe('abcde');
        expect(head).toMatchObject({total: 5, partial: false});
        served = answer(['abcdefgh']);
        expect(await read()).toMatchObject({total: 8, partial: false});
    });

    test('empty: whole, of no byte', async () => {
        served = answer([]);
        expect(await read()).toMatchObject({total: 0, partial: false});
    });
});
