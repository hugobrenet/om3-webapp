import React, {StrictMode} from 'react';
import {render} from '@testing-library/react';
import {afterEach, describe, expect, test, vi} from 'vitest';
import AiPrintView from '../AiPrintView.jsx';

const doc = {
    title: 'Why is web down',
    clusterName: 'Lab cluster',
    messages: [
        {id: 't1:1', turn_id: 't1', role: 'user', text: 'Why?', created_at: '2026-11-26T09:00:00Z'},
        {id: 't1:2', turn_id: 't1', role: 'assistant', text: 'See [docs](https://docs.example).', created_at: '2026-11-26T09:00:10Z'},
    ],
    exportedAt: new Date('2026-11-26T10:00:00Z'),
    timeZone: 'UTC',
};

describe('the print of a conversation', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        document.documentElement.classList.remove('dark');
        localStorage.removeItem('om3.theme');
    });

    test('prints once under StrictMode, and gives the page back', async () => {
        localStorage.setItem('om3.theme', 'dark');
        document.documentElement.classList.add('dark');
        document.title = 'Lab cluster';
        const print = vi.spyOn(window, 'print').mockImplementation(() => window.dispatchEvent(new Event('afterprint')));
        const onDone = vi.fn();
        render(
            <StrictMode>
                <AiPrintView doc={doc} onDone={onDone}/>
            </StrictMode>
        );
        expect(document.documentElement).not.toHaveClass('dark');
        expect(document.title).toBe('why-is-web-down-2026-11-26');
        await vi.waitFor(() => expect(onDone).toHaveBeenCalledWith(false));
        expect(print).toHaveBeenCalledTimes(1);
        expect(onDone).toHaveBeenCalledTimes(1);
        expect(document.documentElement).toHaveClass('dark');
        expect(document.title).toBe('Lab cluster');
    });

    test('gives the page back, without a word, when unmounted before it printed', () => {
        document.title = 'Lab cluster';
        const print = vi.spyOn(window, 'print').mockImplementation(() => {});
        const onDone = vi.fn();
        const view = render(<AiPrintView doc={doc} onDone={onDone}/>);
        expect(document.title).toBe('why-is-web-down-2026-11-26');
        view.unmount();
        expect(document.title).toBe('Lab cluster');
        expect(document.body.querySelector(':scope > .ai-print')).toBeNull();
        return new Promise((resolve) => setTimeout(resolve, 0)).then(() => {
            expect(print).not.toHaveBeenCalled();
            expect(onDone).not.toHaveBeenCalled();
        });
    });

    test('ends a print that did not block once the user is back, or on afterprint', async () => {
        vi.spyOn(window, 'print').mockImplementation(() => {});
        const onDone = vi.fn();
        render(<AiPrintView doc={doc} onDone={onDone}/>);
        await vi.waitFor(() => expect(window.print).toHaveBeenCalled());
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(onDone).not.toHaveBeenCalled();
        window.dispatchEvent(new Event('afterprint'));
        expect(onDone).toHaveBeenCalledTimes(1);
        // The interaction that follows ends nothing more.
        window.dispatchEvent(new Event('focus'));
        expect(onDone).toHaveBeenCalledTimes(1);
    });
});
