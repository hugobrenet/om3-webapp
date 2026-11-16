import {createContext, useContext} from 'react';

/**
 * The chat of the assistant the application holds (AiChatProvider), shown by
 * the page of the assistant and by its dock:
 *
 * - `agent`, what useAiAgent tells: `enabled`, `openid`, `ready`,
 *   `configurationError`, `client`; `clusterName`;
 * - `chat`, what useAiChat gives, `ready` once a view opened it;
 * - `attach`, called by a view while it shows the chat, gives back its release;
 * - `draft`, `setDraft`, what the user types in the message box, held here, not
 *   by a view: it goes with the conversation from the dock to the page;
 * - `prompt`, a question to open the chat with, {text, send} (`ask(text, {send})`),
 *   until the view on display takes it (`takePrompt`) on a new conversation:
 *   sent, `send`, asked by a click in the application; put in the message box
 *   otherwise, as one an address carries, which never starts a turn alone;
 *   `promptDropped`, the last one asked was dropped: a turn ran, or an action
 *   waited; `clearPromptDropped`.
 */
export const AiChatContext = createContext(null);

/**
 * What the assistant does while no view shows it, all false while one does:
 * `answering`, a turn runs; `ended`, a turn ended meanwhile, answered, stopped or
 * failed; `waiting`, an action waits for the decision of the user. The menu and
 * the folded dock read it, rendered when it changes only.
 */
export const AiActivityContext = createContext(null);

/**
 * The dock of the assistant, the chat over the page on display: `state`, open
 * or folded to its button, always there; `openWith(prompt, origin)` sends the
 * question then opens the dock on it, `origin`, the element that opened it,
 * getting the focus back when it folds; `open`, `fold`; `origin()`, that
 * element, while still in the page. Its callbacks are stable: the links that
 * open it do not render at every piece of an answer.
 */
export const AiDockContext = createContext(null);

/** The chat the application holds, or null outside of a provider. */
export const useSharedAiChat = () => useContext(AiChatContext);

/** What the assistant does, for the menu and the folded dock; null outside of a provider. */
export const useAiActivity = () => useContext(AiActivityContext);

/** The dock of the assistant, or null outside of a provider. */
export const useAiDock = () => useContext(AiDockContext);

/** What the assistant does, the most pressing first: `waiting`, `answering`, `ended`; null when nothing. */
export function activityState(activity) {
    if (!activity) return null;
    if (activity.waiting) return 'waiting';
    if (activity.answering) return 'answering';
    if (activity.ended) return 'ended';
    return null;
}
