import {useCallback, useEffect, useMemo, useRef} from 'react';
import {useAuth} from '../context/AuthProvider.jsx';
import {getAiAgentConfig} from '../config/ai-agent.js';
import {createAiAgentClient} from '../services/ai-agent.js';

// The caller supplies the cluster ID from useFetchDaemonStatus, not a user entry.
// The agent routes by cluster, to its VIP: no node is sent.
const useAiAgent = ({clusterId} = {}) => {
    const {accessToken, authChoice, user} = useAuth();
    const config = useMemo(() => getAiAgentConfig(), []);
    const ready = config.enabled && Boolean(accessToken && clusterId);
    const credentials = useRef();
    credentials.current = ready ? {accessToken, clusterId} : null;
    const getCredentials = useCallback(() => credentials.current, []);
    const client = useMemo(
        () => (config.enabled ? createAiAgentClient({baseUrl: config.url, getCredentials}) : null),
        [config.url, config.enabled, getCredentials]
    );

    // Cancel on logout, identity/target change or unmount, but not on token renewal.
    const hasToken = Boolean(accessToken);
    useEffect(
        () => () => client?.cancelAll(),
        [client, authChoice, user, hasToken, clusterId]
    );

    return {enabled: config.enabled, ready, configurationError: config.error, client};
};

export default useAiAgent;
