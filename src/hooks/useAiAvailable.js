import {useAuthSession} from '../context/AuthProvider.jsx';
import {getAiAgentConfig} from '../config/ai-agent.js';
import useClusterConfig from './useClusterConfig.js';

/**
 * Whether the assistant is offered: the cluster names its agent, the user signed
 * in with OpenID, the agent taking no other session. The entry of the menu and the
 * button of the dock show then, the latter greyed until the assistant can be used.
 */
export function useAiOffered() {
    const auth = useAuthSession();
    const {agentUrl} = useClusterConfig();
    return getAiAgentConfig(agentUrl).enabled && auth?.authChoice === 'openid';
}

/**
 * Whether the assistant can be used now: the cluster names its agent, the user
 * signed in with OpenID, the cluster read. What useAiAgent tells as `ready`,
 * without making a client: the links to the assistant read it, in the panels,
 * which may render outside an AuthProvider, false there.
 */
export default function useAiAvailable() {
    const auth = useAuthSession();
    const {clusterId, agentUrl} = useClusterConfig();
    return getAiAgentConfig(agentUrl).enabled && auth?.authChoice === 'openid' && Boolean(auth.accessToken && clusterId);
}
