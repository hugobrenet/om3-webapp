import {useCallback, useEffect, useRef, useState} from 'react';
import {AGENT_TOOLS, AiAgentError} from '../services/ai-agent.js';

const emptyState = (scope) => ({
    scope,
    conversations: [],
    conversation: null,
    messages: [],
    resumed: false,
    historyReady: true,
    historyCursor: '',
    // The thread was given without its oldest turns, which selecting the
    // conversation again reads.
    partial: false,
    pending: '',
    error: '',
    notice: '',
    // The tool call the current conversation waits on, as the agent sent it.
    confirmation: null,
    // The feedback of the user per turn ID: {feedback, pending, error}.
    ratings: {},
});
const errorMessage = (error) =>
    error instanceof AiAgentError ? error.message : 'The AI request failed. It was not retried.';

// An answer of the agent: one message of the webapp per turn, holding the
// AG-UI messages of the turn (messageIds), which tell the agent the webapp is
// in phase, and the text message last streamed into it (textId).
const assistantMessage = (id, fields = {}) => ({
    id,
    role: 'assistant',
    text: '',
    tools: [],
    status: 'running',
    usage: null,
    messageIds: [],
    textId: '',
    ...fields,
});
const historyMessages = (messages) =>
    messages.map(({feedback, ...message}) =>
        message.role === 'assistant'
            ? assistantMessage(message.id, {...message, status: 'completed', messageIds: [message.id], textId: message.id})
            : {...message, status: 'completed', tools: [], usage: null}
    );
// The feedback the agent returned with the messages, per turn, without
// replacing what the user changed since.
const historyRatings = (messages, ratings = {}) => {
    const result = {...ratings};
    for (const message of messages)
        if (message.feedback && !result[message.turn_id])
            result[message.turn_id] = {feedback: message.feedback, pending: false, error: ''};
    return result;
};
// The messages the webapp holds, by their AG-UI IDs, for the agent to tell
// whether it is in phase.
const heldMessages = (messages) =>
    messages.flatMap((message) =>
        message.role === 'user'
            ? [{id: message.id, role: 'user'}]
            : (message.messageIds || []).map((id) => ({id, role: 'assistant'}))
    );
// The turn a message of the agent belongs to: it goes by <turn ID>:<sequence>.
const turnOf = (id) => /^([A-Za-z0-9_.~-]{1,128}):[1-9]\d{0,18}$/.exec(id)?.[1] || '';

// Name the message after an AG-UI message of its turn.
const holding = (message, id) =>
    !id || message.messageIds.includes(id)
        ? message
        : {...message, messageIds: [...message.messageIds, id], turn_id: message.turn_id || turnOf(id) || undefined};

// Apply one event of a run to the answer it streams. resumedTool names the
// call a resumed run gives the result of, when the answer does not hold it.
const applyRunEvent = (message, event, resumedTool) => {
    switch (event.type) {
        case 'TEXT_MESSAGE_START':
            return holding(message, event.messageId);
        case 'TEXT_MESSAGE_CONTENT': {
            // The answers of the model in a turn read as paragraphs of one message.
            const separate = message.text && message.textId !== event.messageId;
            return {...message, text: message.text + (separate ? '\n\n' : '') + event.delta, textId: event.messageId};
        }
        case 'TOOL_CALL_START': {
            const next = holding(message, event.parentMessageId);
            // The tools of the agent itself, searching its catalog, are not shown.
            if (AGENT_TOOLS.has(event.toolCallName)) return next;
            return {...next, tools: [...next.tools, {id: event.toolCallId, name: event.toolCallName, status: 'running'}]};
        }
        case 'TOOL_CALL_RESULT': {
            const status = event.rejected ? 'rejected' : 'completed';
            if (message.tools.some((tool) => tool.id === event.toolCallId))
                return {
                    ...message,
                    tools: message.tools.map((tool) => (tool.id === event.toolCallId ? {...tool, status} : tool)),
                };
            return resumedTool
                ? {...message, tools: [...message.tools, {id: event.toolCallId, name: resumedTool, status}]}
                : message;
        }
        default:
            return message;
    }
};

// End the answer with the result of its run: a completed turn, named for its
// feedback, or a call waiting for a decision. A turn resumed after a
// confirmation counts the tokens of all its runs.
const finishRun = (message, result) => {
    const usage =
        result.tokens === null ? message.usage : {total_tokens: (message.usage?.total_tokens || 0) + result.tokens};
    // The call a run ends on waits for the decision of the user.
    return result.outcome === 'interrupt'
        ? {
              ...message,
              status: 'awaiting_confirmation',
              usage,
              turn_id: message.turn_id || result.turnId,
              tools: message.tools.map((tool) => (tool.status === 'running' ? {...tool, status: 'pending'} : tool)),
          }
        : {...message, status: 'completed', usage, turn_id: result.turnId || message.turn_id};
};

// The thread of a snapshot, as the webapp shows it: the prompts, and one
// answer per turn with its texts and the calls of its tools.
const snapshotThread = (messages) => {
    const thread = [];
    for (const message of messages) {
        if (message.role === 'user') {
            thread.push({id: message.id, role: 'user', text: message.content, status: 'completed', tools: [], usage: null});
            continue;
        }
        if (message.role === 'tool') {
            const index = thread.findLastIndex(
                (item) => item.role === 'assistant' && item.tools.some((tool) => tool.id === message.toolCallId)
            );
            if (index >= 0)
                thread[index] = applyRunEvent(thread[index], {type: 'TOOL_CALL_RESULT', ...message});
            continue;
        }
        const turnId = turnOf(message.id);
        const last = thread[thread.length - 1];
        const answer =
            last?.role === 'assistant' && turnId && last.turn_id === turnId
                ? last
                : assistantMessage(message.id, {status: 'completed', ...(turnId ? {turn_id: turnId} : {})});
        if (answer !== last) thread.push(answer);
        let next = holding(answer, message.id);
        if (message.content)
            next = applyRunEvent(next, {type: 'TEXT_MESSAGE_CONTENT', messageId: message.id, delta: message.content});
        // A call without its result is the one the turn waits on.
        next = {
            ...next,
            tools: [
                ...next.tools,
                ...message.toolCalls
                    .filter((call) => !AGENT_TOOLS.has(call.name))
                    .map((call) => ({id: call.id, name: call.name, status: 'pending'})),
            ],
        };
        thread[thread.length - 1] = next;
    }
    return thread;
};

// Show the thread a snapshot gives a webapp out of phase, such as after
// another tab ran turns: it replaces the messages, the answer the run streams
// following it, or going on with the answer so far of the turn it resumes.
// The ratings are kept by turn.
const applySnapshot = (previous, snapshot, answerId) => {
    const thread = snapshotThread(snapshot.messages);
    const running = previous.messages.find((message) => message.id === answerId);
    const last = thread[thread.length - 1];
    const messages =
        running && running.turn_id && last?.role === 'assistant' && last.turn_id === running.turn_id
            ? [...thread.slice(0, -1), {...last, id: running.id, status: running.status, usage: running.usage}]
            : [...thread, ...(running ? [running] : [])];
    return {
        ...previous,
        messages,
        historyCursor: '',
        partial: snapshot.omittedTurns > 0,
        notice:
            snapshot.omittedTurns > 0
                ? 'Earlier messages of this conversation are not shown: select it again to read them.'
                : previous.notice,
    };
};

// Only metadata is loaded automatically. Creation and turns require explicit user actions.
const useAiChat = ({client, ready, scope}) => {
    const [state, setState] = useState(() => emptyState(scope));
    const epoch = useRef(0);
    const active = useRef(null);
    const nextId = useRef(0);
    // Feedback requests run beside turns and are canceled with the scope.
    const feedbackRequests = useRef(new Set());

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
                                          ['running', 'pending'].includes(tool.status)
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
            for (const controller of feedbackRequests.current) controller.abort();
            feedbackRequests.current.clear();
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
                partial: false,
                confirmation: null,
                ratings: {},
            }));
            return conversation;
        });

    const resumeConversation = (id) => {
        if (state.scope === scope && state.conversation?.id === id && !state.partial) return;
        return perform('resuming', async ({signal, update}) => {
            update((previous) => ({
                ...previous,
                conversation: null,
                messages: [],
                resumed: false,
                historyReady: false,
                historyCursor: '',
                partial: false,
                confirmation: null,
                ratings: {},
            }));
            const {conversation, confirmation} = await client.getConversationState(id, {signal});
            if (signal.aborted) return;
            const page = await client.getMessages(id, {signal});
            update((previous) => ({
                ...previous,
                conversation,
                messages: historyMessages(page.messages),
                ratings: historyRatings(page.messages),
                resumed: true,
                historyReady: true,
                historyCursor: page.next_cursor,
                // A confirmation left waiting is shown again after a reload.
                confirmation: confirmation ? {...confirmation, conversationId: conversation.id, assistantId: null} : null,
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
                    ratings: historyRatings(page.messages, previous.ratings),
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
                partial: false,
                confirmation: null,
                ratings: {},
            }));
            return true;
        });
    };

    // Give, replace (feedback) or withdraw (null) the feedback of the user on
    // the turn of an answer of the current conversation.
    const rateTurn = async (turnId, feedback) => {
        const conversationId = state.scope === scope ? state.conversation?.id : null;
        if (!ready || !client || !conversationId || typeof turnId !== 'string' || state.ratings[turnId]?.pending) return false;
        const requestEpoch = epoch.current;
        const controller = new AbortController();
        feedbackRequests.current.add(controller);
        const setRating = (change) =>
            setState((previous) =>
                previous.scope === scope && previous.conversation?.id === conversationId && epoch.current === requestEpoch
                    ? {...previous, ratings: {...previous.ratings, [turnId]: change(previous.ratings[turnId])}}
                    : previous
            );
        setRating((rating) => ({feedback: rating?.feedback || null, pending: true, error: ''}));
        try {
            const stored = feedback
                ? await client.setFeedback(conversationId, turnId, feedback, {signal: controller.signal})
                : (await client.deleteFeedback(conversationId, turnId, {signal: controller.signal}), null);
            setRating(() => ({feedback: stored, pending: false, error: ''}));
            return true;
        } catch (error) {
            if (!controller.signal.aborted && error?.name !== 'AbortError')
                setRating((rating) => ({feedback: rating?.feedback || null, pending: false, error: errorMessage(error)}));
            return false;
        } finally {
            feedbackRequests.current.delete(controller);
        }
    };

    // Stream the events of a run into the answer it belongs to; a snapshot
    // replaces the thread first.
    const runEvents = (answerId, update, resumedTool) => (event) =>
        update((previous) =>
            event.type === 'MESSAGES_SNAPSHOT'
                ? applySnapshot(previous, event, answerId)
                : {
                      ...previous,
                      messages: previous.messages.map((message) =>
                          message.id === answerId ? applyRunEvent(message, event, resumedTool) : message
                      ),
                  }
        );

    // End the answer with the result of its run, and show the call it waits
    // on for a decision.
    const finish = (result, conversationId, answerId, update) =>
        update((previous) => ({
            ...previous,
            messages: previous.messages.map((message) =>
                message.id === answerId ? finishRun(message, result) : message
            ),
            confirmation:
                result.outcome === 'interrupt'
                    ? {...result.confirmation, conversationId, assistantId: answerId}
                    : previous.confirmation,
        }));

    // Answer the tool call the conversation waits on with a run that resumes
    // it, streamed into the answer of its turn, or a new one after a reload.
    const decide = (approved) => {
        const confirmation = state.scope === scope ? state.confirmation : null;
        if (!confirmation || typeof approved !== 'boolean') return;
        const held = heldMessages(state.messages);
        return perform('confirming', async ({signal, update}) => {
            let answerId = confirmation.assistantId;
            const exists = state.messages.some((message) => message.id === answerId);
            if (!exists) answerId = `local:${++nextId.current}`;
            update((previous) => ({
                ...previous,
                confirmation: null,
                messages: exists
                    ? previous.messages.map((message) =>
                          message.id === answerId ? {...message, status: 'running'} : message
                      )
                    : [...previous.messages, assistantMessage(answerId, {turn_id: confirmation.turn_id})],
            }));
            const result = await client.run(
                confirmation.conversationId,
                {held, resume: {interruptId: confirmation.id, approved}},
                {signal, onEvent: runEvents(answerId, update, confirmation.tool.name)}
            );
            finish(result, confirmation.conversationId, answerId, update);
            return true;
        });
    };

    const send = (prompt) => {
        if (!state.historyReady || state.confirmation || typeof prompt !== 'string' || !prompt.trim()) return;
        const current = state.scope === scope ? state.conversation : null;
        const held = current ? heldMessages(state.messages) : [];
        return perform('turn', async ({signal, update}) => {
            // The prompt goes by the ID the webapp gives it, which the agent keeps.
            const promptId = client.newId();
            const answerId = `local:${++nextId.current}`;
            // Keep the submitted prompt visible even if creating the conversation fails.
            update((previous) => ({
                ...previous,
                messages: [
                    ...previous.messages,
                    {id: promptId, role: 'user', text: prompt},
                    assistantMessage(answerId),
                ],
            }));
            let conversation = current;
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
            const result = await client.run(
                conversation.id,
                {prompt, promptId, held},
                {signal, onEvent: runEvents(answerId, update)}
            );
            finish(result, conversation.id, answerId, update);
            if (result.outcome === 'interrupt') return true;
            // The agent titles a conversation after its first completed turn: read
            // it back, so the list does not keep an untitled entry.
            if (!conversation.title && !signal.aborted) {
                try {
                    const titled = await client.getConversation(conversation.id, {signal});
                    update((previous) => ({
                        ...previous,
                        conversation:
                            previous.conversation?.id === titled.id ? titled : previous.conversation,
                        conversations: previous.conversations.map((item) =>
                            item.id === titled.id ? titled : item
                        ),
                    }));
                } catch {
                    // The title is cosmetic: the turn itself succeeded.
                }
            }
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
        approve: () => decide(true),
        reject: () => decide(false),
        rate: (turnId, feedback) => rateTurn(turnId, feedback),
        unrate: (turnId) => rateTurn(turnId, null),
    };
};

export default useAiChat;
