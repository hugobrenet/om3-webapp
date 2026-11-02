import {useMemo, useRef} from 'react';
import useEventStore from './useEventStore';

/** No instance there, or one the daemon deleted: one value, for the selector to give the same. */
const NO_INSTANCE = Object.freeze({
    avail: null,
    frozen: 'unfrozen',
    state: null,
    provisioned: null,
});

export const useNodeData = (objectName, node) => {
    const prevDataRef = useRef(null);

    const selectNodeData = useMemo(
        () => (state) => {
            const instanceStatus = state.objectInstanceStatus?.[objectName]?.[node];
            const monitorKey = `${node}:${objectName}`;
            const monitor = state.instanceMonitor?.[monitorKey] || {};

            // Gone, deleted while shown: said gone, not as it was.
            if (!instanceStatus) {
                prevDataRef.current = NO_INSTANCE;
                return NO_INSTANCE;
            }

            const avail = instanceStatus.avail;
            const frozen = instanceStatus.frozen_at &&
            instanceStatus.frozen_at !== "0001-01-01T00:00:00Z" ? "frozen" : "unfrozen";
            const stateValue = monitor.state !== "idle" ? monitor.state : null;
            const provisioned = instanceStatus.provisioned;

            const newData = {
                avail,
                frozen,
                state: stateValue,
                provisioned,
            };

            if (prevDataRef.current &&
                prevDataRef.current.avail === newData.avail &&
                prevDataRef.current.frozen === newData.frozen &&
                prevDataRef.current.state === newData.state &&
                prevDataRef.current.provisioned === newData.provisioned) {
                return prevDataRef.current;
            }

            prevDataRef.current = newData;
            return newData;
        },
        [objectName, node]
    );

    return useEventStore(selectNodeData);
};
