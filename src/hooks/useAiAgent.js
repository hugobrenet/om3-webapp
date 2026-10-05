import {useCallback, useEffect, useMemo, useRef} from 'react';
import {useAuth} from '../context/AuthProvider.jsx';
import {getAiAgentConfig} from '../config/ai-agent.js';
import {createAiAgentClient} from '../services/ai-agent.js';

// The caller supplies the target from useFetchDaemonStatus, not a user-entered URL.
const useAiAgent = ({clusterId, daemon} = {}) => {
    const {accessToken, authChoice, user} = useAuth();
    const node = daemon?.nodename;
    const config = useMemo(() => getAiAgentConfig(), []);
    const ready = config.enabled && Boolean(accessToken && clusterId && node);
    const credentials = useRef();
    credentials.current = ready ? {accessToken, clusterId, node} : null;
    const getCredentials = useCallback(() => credentials.current, []);
    const client = useMemo(
        () => (config.enabled ? createAiAgentClient({baseUrl: config.url, getCredentials}) : null),
        [config.url, config.enabled, getCredentials]
    );

    // Cancel on logout, identity/target change or unmount, but not on token renewal.
    const hasToken = Boolean(accessToken);
    useEffect(
        () => () => client?.cancelAll(),
        [client, authChoice, user, hasToken, clusterId, node]
    );

    return {enabled: config.enabled, ready, configurationError: config.error, client};
};

export default useAiAgent;
