import React, {StrictMode} from 'react';
import {render, waitFor} from '@testing-library/react';
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
        document.documentElement.classList.remove('dark');
    });

    test('makes the sheet ready in a frame of its own, in the light theme, under StrictMode, the page as it is', async () => {
        document.documentElement.classList.add('dark');
        document.title = 'Lab cluster';
        const onReady = vi.fn();
        const view = render(
            <StrictMode>
                <AiPrintView doc={doc} onReady={onReady}/>
            </StrictMode>
        );
        await waitFor(() => expect(onReady).toHaveBeenCalled());
        const frame = document.querySelector('iframe[aria-hidden="true"]');
        expect(onReady).toHaveBeenLastCalledWith(frame.contentWindow);
        const sheet = frame.contentDocument;
        expect(sheet.title).toBe('why-is-web-down-2026-11-26');
        expect(sheet.documentElement).not.toHaveClass('dark');
        expect(sheet.body.querySelectorAll('.ai-print')).toHaveLength(1);
        expect(sheet.body.textContent).toContain('Why?');
        expect(sheet.body.querySelector('a[href="https://docs.example/"]')).not.toBeNull();
        // The page is not touched.
        expect(document.documentElement).toHaveClass('dark');
        expect(document.title).toBe('Lab cluster');
        expect(document.body.querySelector(':scope > .ai-print')).toBeNull();
        view.unmount();
        expect(document.querySelector('iframe[aria-hidden="true"]')).toBeNull();
    });
});
