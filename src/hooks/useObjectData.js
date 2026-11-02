import {useMemo, useRef} from 'react';
import useEventStore from './useEventStore';

/** No object there, or one the daemon deleted: one value, for the selector to give the same. */
const NO_OBJECT = Object.freeze({
    avail: 'n/a',
    frozen: 'unfrozen',
    globalExpect: null,
    isNotProvisioned: false,
    isFrozen: false,
    hasAnyNodeFrozen: false,
    rawStatus: undefined,
});

export const useObjectData = (objectName) => {
    const prevDataRef = useRef(null);

    const selectObjectData = useMemo(
        () => (state) => {
            const status = state.objectStatus?.[objectName];
            const instances = state.objectInstanceStatus?.[objectName] || {};

            // Gone, deleted while shown: said gone, not as it was.
            if (!status && Object.keys(instances).length === 0) {
                prevDataRef.current = NO_OBJECT;
                return NO_OBJECT;
            }

            let globalExpect = null;
            const nodes = Object.keys(instances);
            for (const node of nodes) {
                const monitorKey = `${node}:${objectName}`;
                const monitor = state.instanceMonitor?.[monitorKey];
                if (monitor?.global_expect && monitor.global_expect !== "none") {
                    globalExpect = monitor.global_expect;
                    break;
                }
            }

            const rawAvail = status?.avail;
            const validStatuses = ["up", "down", "warn"];
            const avail = validStatuses.includes(rawAvail) ? rawAvail : "n/a";
            const frozen = status?.frozen || "unfrozen";
            const provisioned = status?.provisioned;
            const isNotProvisioned = provisioned === "false" || provisioned === false;
            const isFrozen = frozen === "frozen";

            const hasAnyNodeFrozen = nodes.some((node) => {
                const nodeInstanceStatus = instances[node];
                return nodeInstanceStatus?.frozen_at &&
                    nodeInstanceStatus.frozen_at !== "0001-01-01T00:00:00Z";
            });

            const newData = {
                avail,
                frozen,
                globalExpect,
                isNotProvisioned,
                isFrozen,
                hasAnyNodeFrozen,
                rawStatus: status,
                nodes,
            };

            if (prevDataRef.current &&
                prevDataRef.current.avail === newData.avail &&
                prevDataRef.current.frozen === newData.frozen &&
                prevDataRef.current.globalExpect === newData.globalExpect &&
                prevDataRef.current.isNotProvisioned === newData.isNotProvisioned &&
                prevDataRef.current.isFrozen === newData.isFrozen &&
                prevDataRef.current.hasAnyNodeFrozen === newData.hasAnyNodeFrozen) {
                return prevDataRef.current;
            }

            prevDataRef.current = newData;
            return newData;
        },
        [objectName]
    );

    return useEventStore(selectObjectData);
};
