import {useCallback, useEffect, useMemo, useRef} from 'react';
import {useAuth} from '../context/AuthProvider.jsx';
import {createAiAgentClient} from '../services/ai-agent.js';

// The agent, through the relay of the cluster: the daemon names the cluster,
// and the token is all the webapp needs.
const useAiAgent = () => {
    const {accessToken, authChoice, user} = useAuth();
    const ready = Boolean(accessToken);
    const credentials = useRef();
    credentials.current = ready ? {accessToken} : null;
    const getCredentials = useCallback(() => credentials.current, []);
    const client = useMemo(() => createAiAgentClient({getCredentials}), [getCredentials]);

    // Cancel on logout, identity change or unmount, but not on token renewal.
    const hasToken = Boolean(accessToken);
    useEffect(
        () => () => client.cancelAll(),
        [client, authChoice, user, hasToken]
    );

    return {ready, client};
};

export default useAiAgent;
