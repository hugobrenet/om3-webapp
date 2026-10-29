import {useEffect, useState} from 'react';
import {useAuth} from '../context/AuthProvider.jsx';
import {AI_RELAY_PATH, getAiAgentConfig} from '../config/ai-agent.js';

// The codes of the relay of the cluster saying the assistant is not for this
// session: no agent configured on the cluster, or a session that is not
// OpenID, which the agent does not take.
const UNAVAILABLE = {ai_not_configured: 'not_configured', ai_openid_required: 'openid_required'};

// The answer of the relay, asked once per sign-in: a renewed token keeps it.
// A sign-out drops it through a mounted consumer, the top bar, which App
// renders on every page.
let probe = null;

const askRelay = async (accessToken) => {
    try {
        const response = await fetch(`${AI_RELAY_PATH}/capabilities`, {
            method: 'GET',
            headers: {Accept: 'application/json', Authorization: `Bearer ${accessToken}`},
            credentials: 'omit',
            redirect: 'error',
            cache: 'no-store',
        });
        if (response.ok) {
            await response.body?.cancel().catch(() => {});
            return {available: true, reason: null};
        }
        let code = '';
        try {
            code = (await response.json())?.error?.code || '';
        } catch {
            // Not an answer of the relay: the assistant tells the error itself.
        }
        // A 404 without the code of an error is no answer of the relay: a
        // daemon without it, such as one not yet upgraded, has no agent.
        const reason = UNAVAILABLE[code] || (response.status === 404 && !code ? 'not_configured' : '');
        return reason ? {available: false, reason} : {available: true, reason: null};
    } catch {
        // A network error is no proof the cluster has no agent: the
        // assistant shows the error when it is opened.
        return {available: true, reason: null};
    }
};

// Whether the assistant is offered: with the agent on its own origin, as the
// build configuration says; through the relay of the cluster, as the relay
// answers once signed in, the entry hidden on a cluster without agent or for
// a session that is not OpenID. available is null while the relay is asked.
const useAiAvailability = () => {
    const config = getAiAgentConfig();
    const relayed = config.enabled && config.url === AI_RELAY_PATH;
    const {accessToken} = useAuth();
    const [state, setState] = useState(() => (relayed && probe?.result ? probe.result : null));

    useEffect(() => {
        if (!relayed) return undefined;
        if (!accessToken) {
            probe = null;
            setState(null);
            return undefined;
        }
        let active = true;
        if (!probe) {
            const entry = {result: null};
            entry.promise = askRelay(accessToken).then((result) => {
                entry.result = result;
                return result;
            });
            probe = entry;
        }
        probe.promise.then((result) => active && setState(result));
        return () => {
            active = false;
        };
    }, [relayed, accessToken]);

    if (!config.enabled) return {available: false, reason: null};
    if (!relayed) return {available: true, reason: null};
    return state ? {available: state.available, reason: state.reason} : {available: null, reason: null};
};

// For the tests: the next sign-in asks the relay again.
export const resetAiAvailability = () => {
    probe = null;
};

export default useAiAvailability;
