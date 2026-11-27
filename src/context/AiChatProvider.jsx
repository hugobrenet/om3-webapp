import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {useLocation} from 'react-router-dom';
import {useTranslation} from 'react-i18next';
import {interfaceContext} from '../app/interface-context';
import {checkedRows} from '../app/checked-rows';
import {listFilters} from '../app/list-filters';
import {useAuth} from './AuthProvider.jsx';
import useClusterConfig from '../hooks/useClusterConfig.js';
import useAiAgent from '../hooks/useAiAgent.js';
import useAiChat from '../hooks/useAiChat.js';
import useTabNotice from '../hooks/useTabNotice.js';
import {AiActivityContext, AiChatContext, AiDockContext} from './AiChatContext.js';

/**
 * Holds the chat of the assistant for the whole application, rather than for its
 * page: a turn goes on while the user looks at another page, its answer or the
 * action it waits a decision on found when the user comes back. Closing the tab
 * or reloading still ends it.
 *
 * Two views show it: the page of the assistant, and the dock over the other
 * pages. What they share lives here: the message typed, the question a link
 * opened the chat with, and the state of the dock, folded at first.
 *
 * Nothing is read until a view opens once (`attach`). Another identity or
 * cluster, the scope of a conversation, starts the chat afresh, the turn of the
 * former one stopped (useAiChat), and waits for a view to open again: the views
 * shown attach again (`attach` changes with the scope), the dock folded.
 */
export function AiChatProvider({children}) {
    const {t} = useTranslation();
    const auth = useAuth();
    // The configuration of the cluster, from the event stream of the menu,
    // names the cluster and its agent: no cluster status is read.
    const {clusterId, agentUrl, clusterName} = useClusterConfig();
    const agent = useAiAgent({clusterId, agentUrl});
    // A conversation belongs to an identity on a cluster: changing either resets the chat.
    const scope = JSON.stringify([auth.authChoice, auth.user, clusterId]);

    const [enabled, setEnabled] = useState(false);
    const [viewing, setViewing] = useState(false);
    const [ended, setEnded] = useState(false);
    // The turn that ended so failed: its answer is incomplete.
    const [endedFailed, setEndedFailed] = useState(false);
    // An action began to wait for the decision of the user while no view
    // showed the chat: one seen waiting is not told again.
    const [waitedUnseen, setWaitedUnseen] = useState(false);
    const [draft, setDraft] = useState('');
    // The skill the message typed asks, chosen with / in the message box: it
    // goes with the draft from the dock to the page.
    const [draftSkill, setDraftSkill] = useState(null);
    const [prompt, setPrompt] = useState(null);
    const [promptDropped, setPromptDropped] = useState(false);
    const [dock, setDock] = useState('folded');
    const viewers = useRef(0);
    const origin = useRef(null);

    // Another scope: not enabled until a view opens again, the page attaching
    // again, the dock folded rather; nothing ended, typed or asked for it. Set
    // during the render, so that the chat does not read for it meanwhile.
    const [shownScope, setShownScope] = useState(scope);
    if (shownScope !== scope) {
        setShownScope(scope);
        setEnabled(false);
        setEnded(false);
        setEndedFailed(false);
        setWaitedUnseen(false);
        setDraft('');
        setDraftSkill(null);
        setPrompt(null);
        setPromptDropped(false);
        setDock('folded');
    }
    const ready = agent.ready && enabled;
    // What the page under the dock shows, read when a prompt is sent or queued,
    // with the filters of its list, the rows ticked there and the clock of the user: the clock only on
    // the page of the assistant, nothing being under the conversation there.
    const location = useLocation();
    const page = useRef(location);
    page.current = location;
    const pageContext = useCallback(
        () => interfaceContext(page.current.pathname, new URLSearchParams(page.current.search), {
            now: new Date(),
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            filters: listFilters(),
            checked: checkedRows(),
        }),
        []
    );
    const chat = useAiChat({client: agent.client, ready, scope, interfaceContext: pageContext});

    // Another for each scope: a view shown attaches again, which opens the chat
    // for the new one.
    const attach = useCallback(() => {
        viewers.current++;
        setViewing(true);
        setEnabled(true);
        setEnded(false);
        setWaitedUnseen(false);
        return () => {
            viewers.current--;
            if (viewers.current === 0) setViewing(false);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scope]);

    const answering = chat.pending === 'turn' || chat.pending === 'confirming';
    const waiting = Boolean(chat.confirmation);

    // A question asked while a turn runs, or an action waits, is dropped, and the
    // view says so, rather than send it, or replace what the user reads or types,
    // later, at the end of the turn. Else it waits for the view on display, to be
    // sent (`send`) or put in the message box.
    const blocked = useRef(false);
    blocked.current = answering || waiting;
    const ask = useCallback((text, {send = false} = {}) => {
        if (blocked.current) {
            setPrompt(null);
            setPromptDropped(true);
            return;
        }
        setPrompt({text, send});
        setPromptDropped(false);
    }, []);
    const takePrompt = useCallback(() => setPrompt(null), []);
    const clearPromptDropped = useCallback(() => setPromptDropped(false), []);

    // Another conversation on display, or another identity or cluster: the
    // message box starts from the message queued, given back, or empty. The
    // conversation the first turn creates is the one on display: what the user
    // types meanwhile stays. A conversation being resumed passes through none,
    // its history not ready: only the arrival of the conversation it goes to
    // counts. At the commit, before any click on what the view shows.
    const shownConversation = useRef(null);
    useLayoutEffect(() => {
        if (!chat.historyReady) return;
        const key = JSON.stringify([scope, ready, chat.conversation?.id ?? null]);
        const previous = shownConversation.current;
        if (previous === key) return;
        shownConversation.current = key;
        if (chat.pending === 'turn' && previous === JSON.stringify([scope, ready, null])) return;
        const skill = chat.queued?.skill ?? null;
        setDraft(chat.takeQueued() ?? '');
        setDraftSkill(skill);
        // The conversation shown only: the queue is read when it changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scope, ready, chat.conversation?.id, chat.pending, chat.historyReady]);

    // A turn that ends while no view shows it, answered, stopped or failed, is to
    // be seen: the folded dock counts as not shown. The scope it ran for is kept:
    // one stopped by another identity or cluster is not the new one's to see.
    // The tab hidden meanwhile says it in its title, the view shown or not.
    const tab = useTabNotice(t);
    const turnError = useRef(chat.error);
    turnError.current = chat.error;
    const waitingNow = useRef(waiting);
    waitingNow.current = waiting;
    const viewingNow = useRef(viewing);
    viewingNow.current = viewing;
    const answeringScope = useRef(null);
    useEffect(() => {
        const endedHere = answeringScope.current === scope && !answering;
        answeringScope.current = answering ? scope : null;
        // A turn runs again, such as a message queued: what the title and the
        // dock told is over, the end of this one to be told in turn.
        if (answering) {
            setEnded(false);
            setEndedFailed(false);
            tab.clear();
            return;
        }
        if (!endedHere) return;
        // Failed when the chat tells an error: an answer stopped tells none.
        const failedTurn = turnError.current !== '';
        if (!viewing) {
            setEnded(true);
            setEndedFailed(failedTurn);
        }
        // A turn that ends on an action waiting tells that rather.
        if (!waitingNow.current) tab.tell(failedTurn ? 'failed' : 'ended');
    }, [answering, viewing, scope, tab]);

    // An action that begins to wait, for the scope shown.
    const waitingScope = useRef(null);
    useEffect(() => {
        const began = waiting && waitingScope.current !== scope;
        waitingScope.current = waiting ? scope : null;
        if (!waiting) {
            setWaitedUnseen(false);
            tab.clear('waiting');
            return;
        }
        if (!began) return;
        if (!viewingNow.current) setWaitedUnseen(true);
        tab.tell('waiting');
    }, [waiting, scope, tab]);

    // Another identity or cluster: the title told nothing of it.
    useEffect(() => () => tab.clear(), [scope, tab]);

    // What the menu and the folded dock show while no view shows the chat: in
    // one, the chat says so.
    const activity = useMemo(
        () => ({
            answering: answering && !viewing,
            ended: ended && !viewing,
            failed: ended && endedFailed && !viewing,
            waiting: waiting && !viewing,
            // What the folded dock tells, once: an action that began to wait
            // out of sight, else a turn that ended so.
            notice: viewing ? null : waiting && waitedUnseen ? 'waiting' : ended ? (endedFailed ? 'failed' : 'ended') : null,
        }),
        [answering, ended, endedFailed, viewing, waiting, waitedUnseen]
    );

    const dockControls = useMemo(
        () => ({
            state: dock,
            // A click in the application: the question goes at once.
            openWith: (text, from) => {
                origin.current = from ?? null;
                ask(text, {send: true});
                setDock('open');
            },
            // Opened by its button or its key: no link to give the focus back to.
            open: () => {
                origin.current = null;
                setDock('open');
            },
            fold: () => setDock('folded'),
            origin: () => (origin.current?.isConnected === true ? origin.current : null),
        }),
        [dock, ask]
    );

    return (
        <AiChatContext.Provider
            value={{
                agent,
                clusterName,
                chat,
                ready,
                attach,
                draft,
                setDraft,
                draftSkill,
                setDraftSkill,
                prompt,
                ask,
                takePrompt,
                promptDropped,
                clearPromptDropped,
            }}
        >
            <AiActivityContext.Provider value={activity}>
                <AiDockContext.Provider value={dockControls}>{children}</AiDockContext.Provider>
            </AiActivityContext.Provider>
        </AiChatContext.Provider>
    );
}
