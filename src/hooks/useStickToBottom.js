import {useCallback, useLayoutEffect, useRef} from 'react';

/** How near the bottom, in pixels, the transcript still counts as at its end. */
export const STICK_DISTANCE = 48;

/** The ID of the last message of the user, which a new prompt changes. */
const lastPromptOf = (messages) => {
    for (let index = messages.length - 1; index >= 0; index--) {
        if (messages[index].role === 'user') return messages[index].id;
    }
    return null;
};

/**
 * Keeps the latest message of a transcript in sight while the user reads its
 * end, without taking the scroll from one who went up to read: an answer
 * streamed, or the steps of its timeline unfolded, stay where the user put
 * them. A prompt sent, or another conversation shown, brings the end back.
 *
 * `ref`, the scrolling element; `messages`, the messages it shows; `conversationId`,
 * the conversation; `restore`, called first, before paint, which keeps another
 * position, such as that of older messages prepended, when it answers true.
 * Gives back the scroll handler of the element.
 */
export default function useStickToBottom(ref, {messages, conversationId = null, restore}) {
    // At the end at first, as the transcript opens.
    const stuck = useRef(true);
    const shown = useRef({conversationId, prompt: lastPromptOf(messages)});

    const onScroll = useCallback(() => {
        const element = ref.current;
        if (!element) return;
        stuck.current = element.scrollHeight - element.scrollTop - element.clientHeight <= STICK_DISTANCE;
    }, [ref]);

    // Before paint, on every message streamed.
    useLayoutEffect(() => {
        const element = ref.current;
        const prompt = lastPromptOf(messages);
        const previous = shown.current;
        shown.current = {conversationId, prompt};
        if (!element) return;
        if (previous.conversationId !== conversationId || previous.prompt !== prompt) stuck.current = true;
        if (restore?.(element)) return;
        if (stuck.current) element.scrollTop = element.scrollHeight;
        // On the messages only: the conversation and the prompt are read from them.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [messages]);

    return onScroll;
}
