import React, {useRef} from 'react';
import {fireEvent, render, screen} from '@testing-library/react';
import {describe, expect, test} from 'vitest';
import useStickToBottom from '../useStickToBottom.js';

/** A transcript of `height` pixels of content in a box of 100, its scroll as the browser keeps it. */
function measure(element, height) {
    let top = 0;
    Object.defineProperty(element, 'clientHeight', {configurable: true, value: 100});
    Object.defineProperty(element, 'scrollHeight', {configurable: true, get: () => height()});
    Object.defineProperty(element, 'scrollTop', {
        configurable: true,
        get: () => top,
        set: (value) => {
            top = Math.max(0, Math.min(value, height() - 100));
        },
    });
}

function Transcript({messages, conversationId = 'c1', restore}) {
    const ref = useRef(null);
    const onScroll = useStickToBottom(ref, {messages, conversationId, restore});
    return (
        <div ref={ref} onScroll={onScroll} data-testid="log">
            {messages.map((message) => <p key={message.id}>{message.text}</p>)}
        </div>
    );
}

const prompt = (id) => ({id, role: 'user', text: id});
const answer = (text) => ({id: 'a1', role: 'assistant', text});

describe('the end of a transcript in sight', () => {
    // The content grows by 100 pixels per message, and by the length of the answer.
    const setup = () => {
        let messages = [prompt('p1'), answer('')];
        const height = () => 100 * messages.length + messages.reduce((sum, message) => sum + message.text.length, 0);
        const view = render(<Transcript messages={messages}/>);
        const log = screen.getByTestId('log');
        measure(log, height);
        const show = (next, props = {}) => {
            messages = next;
            view.rerender(<Transcript messages={messages} {...props}/>);
        };
        return {log, show, get messages() { return messages; }};
    };

    test('follows an answer streamed while the user reads its end', () => {
        const {log, show} = setup();
        show([prompt('p1'), answer('x'.repeat(50))]);
        expect(log.scrollTop).toBe(log.scrollHeight - 100);
        show([prompt('p1'), answer('x'.repeat(150))]);
        expect(log.scrollTop).toBe(log.scrollHeight - 100);
    });

    test('leaves the scroll to the user who went up, the answer streaming on', () => {
        const {log, show} = setup();
        show([prompt('p1'), answer('x'.repeat(300))]);
        log.scrollTop = 20;
        fireEvent.scroll(log);
        show([prompt('p1'), answer('x'.repeat(600))]);
        expect(log.scrollTop).toBe(20);
        // Back at the end, followed again.
        log.scrollTop = log.scrollHeight - 100;
        fireEvent.scroll(log);
        show([prompt('p1'), answer('x'.repeat(900))]);
        expect(log.scrollTop).toBe(log.scrollHeight - 100);
    });

    test('brings the end back on a prompt sent', () => {
        const {log, show} = setup();
        show([prompt('p1'), answer('x'.repeat(300))]);
        log.scrollTop = 0;
        fireEvent.scroll(log);
        show([prompt('p1'), answer('x'.repeat(300)), prompt('p2')]);
        expect(log.scrollTop).toBe(log.scrollHeight - 100);
    });

    test('brings the end back on another conversation', () => {
        const {log, show} = setup();
        show([prompt('p1'), answer('x'.repeat(300))]);
        log.scrollTop = 0;
        fireEvent.scroll(log);
        show([prompt('p1'), answer('x'.repeat(400))], {conversationId: 'c2'});
        expect(log.scrollTop).toBe(log.scrollHeight - 100);
    });

    test('lets the caller keep another position', () => {
        const {log, show} = setup();
        show([prompt('p1'), answer('x'.repeat(300))]);
        show([prompt('p0'), prompt('p1'), answer('x'.repeat(300))], {
            restore: (element) => {
                element.scrollTop = 42;
                return true;
            },
        });
        expect(log.scrollTop).toBe(42);
    });
});
