import {useMemo} from "react";
import {useMenuState} from "./useSidebarAlerts";

/**
 * The configuration of the cluster, as the event stream of the menu keeps it,
 * ClusterConfigUpdated: its ID, its name and the URL of the AI agent it names,
 * empty until read, `loaded` once read. Some hundred bytes, live, where the whole
 * cluster status grows with the cluster.
 */
export default function useClusterConfig() {
    const config = useMenuState((state) => state.clusterConfig);
    return useMemo(() => ({
        loaded: config !== null && config !== undefined,
        clusterId: typeof config?.id === "string" ? config.id : "",
        clusterName: typeof config?.name === "string" ? config.name : "",
        agentUrl: typeof config?.ai?.agent_url === "string" ? config.ai.agent_url : "",
    }), [config]);
}
