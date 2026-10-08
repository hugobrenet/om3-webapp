import {useCallback, useEffect, useRef, useState} from 'react';
import {AiAgentError} from '../services/ai-agent.js';

const emptyState = (scope) => ({
    scope,
    conversations: [],
    conversation: null,
    messages: [],
    resumed: false,
    historyReady: true,
    historyCursor: '',
    pending: '',
    error: '',
    notice: '',
});
const errorMessage = (error) =>
    error instanceof AiAgentError ? error.message : 'The AI request failed. It was not retried.';
const historyMessages = (messages) =>
    messages.map((message) => ({...message, status: 'completed', tools: [], usage: null}));

// Only metadata is loaded automatically. Creation and turns require explicit user actions.
const useAiChat = ({client, ready, scope}) => {
    const [state, setState] = useState(() => emptyState(scope));
    const epoch = useRef(0);
    const active = useRef(null);
    const nextId = useRef(0);

    const perform = useCallback(
        async (kind, action) => {
            if (!ready || !client || active.current) return undefined;
            const operation = {controller: new AbortController(), epoch: epoch.current};
            active.current = operation;
            const current = () => operation.epoch === epoch.current && active.current === operation;
            const update = (change) => {
                if (current() && !operation.controller.signal.aborted)
                    setState((previous) =>
                        previous.scope === scope ? change(previous) : previous
                    );
            };
            setState((previous) => ({
                ...(previous.scope === scope ? previous : emptyState(scope)),
                pending: kind,
                error: '',
                notice: '',
            }));
            try {
                const result = await action({signal: operation.controller.signal, update});
                return current() && !operation.controller.signal.aborted ? result : undefined;
            } catch (error) {
                if (current()) {
                    const stopped =
                        operation.controller.signal.aborted || error?.name === 'AbortError';
                    setState((previous) => ({
                        ...previous,
                        error: stopped ? '' : errorMessage(error),
                        notice: stopped
                            ? 'Stopped. The turn was not retried. Actions already performed are not undone.'
                            : '',
                        messages: previous.messages.map((message) =>
                            message.status !== 'running'
                                ? message
                                : {
                                      ...message,
                                      status: stopped ? 'stopped' : 'failed',
                                      tools: message.tools.map((tool) =>
                                          tool.status === 'running'
                                              ? {...tool, status: 'interrupted'}
                                              : tool
                                      ),
                                  }
                        ),
                    }));
                }
                return undefined;
            } finally {
                if (current()) {
                    active.current = null;
                    setState((previous) => ({...previous, pending: ''}));
                }
            }
        },
        [client, ready, scope]
    );

    const refreshConversations = useCallback(
        () =>
            perform('loading', async ({signal, update}) => {
                const conversations = await client.listConversations({signal});
                update((previous) => ({
                    ...previous,
                    conversations,
                    conversation:
                        conversations.find((item) => item.id === previous.conversation?.id) ||
                        previous.conversation,
                }));
            }),
        [client, perform]
    );

    useEffect(() => {
        epoch.current++;
        setState(emptyState(scope));
        if (ready) void refreshConversations();
        return () => {
            epoch.current++;
            active.current?.controller.abort();
            active.current = null;
        };
    }, [ready, scope, refreshConversations]);

    const createConversation = () =>
        perform('creating', async ({signal, update}) => {
            const conversation = await client.createConversation({signal});
            update((previous) => ({
                ...previous,
                conversation,
                conversations: [conversation, ...previous.conversations],
                messages: [],
                resumed: false,
                historyReady: true,
                historyCursor: '',
            }));
            return conversation;
        });

    const resumeConversation = (id) => {
        if (state.scope === scope && state.conversation?.id === id) return;
        return perform('resuming', async ({signal, update}) => {
            update((previous) => ({
                ...previous,
                conversation: null,
                messages: [],
                resumed: false,
                historyReady: false,
                historyCursor: '',
            }));
            const conversation = await client.getConversation(id, {signal});
            if (signal.aborted) return;
            const page = await client.getMessages(id, {signal});
            update((previous) => ({
                ...previous,
                conversation,
                messages: historyMessages(page.messages),
                resumed: true,
                historyReady: true,
                historyCursor: page.next_cursor,
            }));
            return conversation;
        });
    };

    const loadOlderMessages = () => {
        if (
            state.scope !== scope ||
            !state.conversation ||
            !state.historyReady ||
            !state.historyCursor
        )
            return;
        return perform('history', async ({signal, update}) => {
            const page = await client.getMessages(state.conversation.id, {
                before: state.historyCursor,
                signal,
            });
            update((previous) => {
                const ids = new Set(previous.messages.map((message) => message.id));
                return {
                    ...previous,
                    messages: [
                        ...historyMessages(page.messages).filter((message) => !ids.has(message.id)),
                        ...previous.messages,
                    ],
                    historyCursor: page.next_cursor,
                };
            });
            return true;
        });
    };

    const renameConversation = (title) => {
        if (state.scope !== scope || !state.conversation) return;
        return perform('renaming', async ({signal, update}) => {
            const conversation = await client.renameConversation(state.conversation.id, title, {
                signal,
            });
            update((previous) => ({
                ...previous,
                conversation,
                conversations: previous.conversations.map((item) =>
                    item.id === conversation.id ? conversation : item
                ),
            }));
            return conversation;
        });
    };

    const deleteConversation = () => {
        if (state.scope !== scope || !state.conversation) return;
        const id = state.conversation.id;
        return perform('deleting', async ({signal, update}) => {
            await client.deleteConversation(id, {signal});
            update((previous) => ({
                ...previous,
                conversation: null,
                messages: [],
                resumed: false,
                conversations: previous.conversations.filter((item) => item.id !== id),
                historyReady: true,
                historyCursor: '',
            }));
            return true;
        });
    };

    const send = (prompt) => {
        if (!state.historyReady || typeof prompt !== 'string' || !prompt.trim()) return;
        return perform('turn', async ({signal, update}) => {
            const userId = ++nextId.current;
            const assistantId = ++nextId.current;
            // Keep the submitted prompt visible even if creating the conversation fails.
            update((previous) => ({
                ...previous,
                messages: [
                    ...previous.messages,
                    {id: userId, role: 'user', text: prompt},
                    {
                        id: assistantId,
                        role: 'assistant',
                        text: '',
                        tools: [],
                        status: 'running',
                        usage: null,
                    },
                ],
            }));
            let conversation = state.scope === scope ? state.conversation : null;
            if (!conversation) {
                conversation = await client.createConversation({signal});
                update((previous) => ({
                    ...previous,
                    conversation,
                    conversations: [conversation, ...previous.conversations],
                    resumed: false,
                }));
            }
            if (signal.aborted) return;
            await client.sendTurn(conversation.id, prompt, {
                signal,
                onEvent: (event) => {
                    const toolId = event.type === 'tool_started' ? ++nextId.current : null;
                    const toolName = typeof event.tool_name === 'string' ? event.tool_name : 'Tool';
                    update((previous) => ({
                        ...previous,
                        messages: previous.messages.map((message) => {
                            if (message.id !== assistantId) return message;
                            switch (event.type) {
                                case 'text_delta':
                                    return typeof event.text_delta === 'string'
                                        ? {...message, text: message.text + event.text_delta}
                                        : message;
                                case 'tool_started':
                                    return {
                                        ...message,
                                        tools: [
                                            ...message.tools,
                                            {id: toolId, name: toolName, status: 'running'},
                                        ],
                                    };
                                case 'tool_finished': {
                                    const index = message.tools.findIndex(
                                        (tool) =>
                                            tool.name === toolName && tool.status === 'running'
                                    );
                                    return {
                                        ...message,
                                        tools: message.tools.map((tool, i) =>
                                            i === index
                                                ? {
                                                      ...tool,
                                                      status: event.tool_error
                                                          ? 'failed'
                                                          : 'completed',
                                                  }
                                                : tool
                                        ),
                                    };
                                }
                                case 'usage':
                                    return {...message, usage: event.usage};
                                case 'completed':
                                    return {...message, status: 'completed'};
                                default:
                                    return message;
                            }
                        }),
                    }));
                },
            });
            return true;
        });
    };

    const stop = () => {
        if (active.current) {
            active.current.controller.abort();
            setState((previous) => ({...previous, notice: 'Stopping…'}));
        }
    };

    // Never render a transcript belonging to a previous session or target.
    const visible = ready && state.scope === scope ? state : emptyState(scope);
    return {
        ...visible,
        createConversation,
        resumeConversation,
        renameConversation,
        deleteConversation,
        refreshConversations,
        loadOlderMessages,
        send,
        stop,
    };
};

export default useAiChat;
