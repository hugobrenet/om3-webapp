import {act, renderHook} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import useTabNotice from '../useTabNotice.js';

const words = {'ai.notice.tab.ended': 'Done', 'ai.notice.tab.failed': 'Failed', 'ai.notice.tab.waiting': 'Waiting'};
const t = (key) => words[key];

describe('the title of a hidden tab', () => {
    let visibility;
    beforeEach(() => {
        visibility = 'hidden';
        vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
        document.title = 'Lab cluster';
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });
    const show = () =>
        act(() => {
            visibility = 'visible';
            document.dispatchEvent(new Event('visibilitychange'));
        });

    test('tells one notice at a time, without stacking the words, until the tab is shown', () => {
        const {result} = renderHook(() => useTabNotice(t));
        result.current.tell('failed');
        expect(document.title).toBe('Failed · Lab cluster');
        result.current.tell('waiting');
        expect(document.title).toBe('Waiting · Lab cluster');
        show();
        expect(document.title).toBe('Lab cluster');
    });

    test('tells nothing while the tab is shown', () => {
        visibility = 'visible';
        const {result} = renderHook(() => useTabNotice(t));
        result.current.tell('ended');
        expect(document.title).toBe('Lab cluster');
    });

    test('gives the title back once what it told is over, the waiting only for the end of the wait', () => {
        const {result} = renderHook(() => useTabNotice(t));
        result.current.tell('ended');
        result.current.clear('waiting');
        expect(document.title).toBe('Done · Lab cluster');
        result.current.clear();
        expect(document.title).toBe('Lab cluster');
        result.current.tell('waiting');
        result.current.clear('waiting');
        expect(document.title).toBe('Lab cluster');
    });

    test('keeps a title the page set meanwhile, and gives the title back once unmounted', () => {
        const view = renderHook(() => useTabNotice(t));
        view.result.current.tell('ended');
        document.title = 'Another cluster';
        show();
        expect(document.title).toBe('Another cluster');
        visibility = 'hidden';
        view.result.current.tell('ended');
        expect(document.title).toBe('Done · Another cluster');
        view.unmount();
        expect(document.title).toBe('Another cluster');
    });

    test('gives back an empty title, as the browser reads it', () => {
        document.title = '';
        const {result} = renderHook(() => useTabNotice(t));
        result.current.tell('ended');
        result.current.tell('ended');
        expect(document.title).toBe('Done ·');
        show();
        expect(document.title).toBe('');
    });
});
