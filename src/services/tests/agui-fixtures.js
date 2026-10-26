import {ReadableStream} from 'node:stream/web';
import streams from './fixtures/agui-streams.json';
import {createAiAgentClient} from '../ai-agent.js';

// The AG-UI streams the agent serves in the scenarios of a client, exported by
// the test TestGoldenAGUIStreams of the agent (internal/api/testdata/agui/
// streams.json): the webapp replays what the agent emits, and a change of the
// protocol breaks its tests. Each runs on the conversation conversation-id as
// the run run-1.
export const GOLDEN_THREAD = 'conversation-id';
export const GOLDEN_RUN = 'run-1';

export const goldenStream = (name) => {
    const stream = streams.find((item) => item.name === name);
    if (!stream) throw new Error(`no golden AG-UI stream ${name}`);
    return stream;
};

// A response with chunks of a body, each a string or bytes.
export const streamResponse = (chunks, {status = 200, contentType = 'text/event-stream; charset=utf-8'} = {}) =>
    new Response(
        new ReadableStream({
            start(controller) {
                for (const chunk of chunks)
                    controller.enqueue(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk);
                controller.close();
            },
        }),
        {status, headers: {'Content-Type': contentType}}
    );

// The response of the agent in a golden scenario.
export const goldenResponse = (name) => {
    const stream = goldenStream(name);
    return streamResponse([stream.body], {status: stream.status, contentType: stream.contentType});
};

// One AG-UI event as the agent frames it.
export const aguiFrame = (event) => `data: ${JSON.stringify(event)}\n\n`;
export const runStarted = {type: 'RUN_STARTED', threadId: GOLDEN_THREAD, runId: GOLDEN_RUN};
export const runFinished = (fields = {}) => ({
    type: 'RUN_FINISHED',
    threadId: GOLDEN_THREAD,
    runId: GOLDEN_RUN,
    outcome: {type: 'success'},
    result: {turnId: 'turn-1'},
    ...fields,
});

// A run of a client of the agent that replays a golden scenario through the
// reader of the webapp, whatever the conversation: for the tests of the hook
// and the component.
export const replayRun = (name) => replayResponse(() => goldenResponse(name));

// A run of a client of the agent that replays the events given, as the agent
// frames them, through the reader of the webapp.
export const replayEvents = (events) => replayResponse(() => streamResponse([events.map(aguiFrame).join('')]));

const replayResponse = (response) => async (_id, input, options) => {
    const client = createAiAgentClient({
        baseUrl: 'https://agent.example.com',
        getCredentials: () => ({accessToken: 'token', clusterId: 'cluster-id'}),
        newId: () => GOLDEN_RUN,
    });
    const fetch = globalThis.fetch;
    globalThis.fetch = async () => response();
    try {
        return await client.run(GOLDEN_THREAD, input, options);
    } finally {
        globalThis.fetch = fetch;
    }
};
