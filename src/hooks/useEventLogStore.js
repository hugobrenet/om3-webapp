import {create} from "zustand";

const useEventLogStore = create((set, get) => ({
    eventLogs: [],
    maxLogs: 500,
    isPaused: false,
    // Whether the stream of the events shown is open, as the logs say theirs.
    connected: false,

    setConnected: (connected) => set((state) => (state.connected === connected ? state : {connected})),

    addEventLog: (eventType, data, timestamp = new Date()) => {
        if (get().isPaused) return;

        const logEntry = {
            id: `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
            timestamp,
            eventType,
            data: data
        };

        set((state) => ({
            eventLogs: [logEntry, ...state.eventLogs.slice(0, state.maxLogs - 1)]
        }));
    },

    setPaused: (paused) => set({isPaused: paused}),

    clearLogs: () => {
        set({eventLogs: []});
    },

    getEventStats: () => {
        const logs = get().eventLogs;
        const stats = {};
        logs.forEach(log => {
            stats[log.eventType] = (stats[log.eventType] || 0) + 1;
        });
        return stats;
    }
}));

export default useEventLogStore;
