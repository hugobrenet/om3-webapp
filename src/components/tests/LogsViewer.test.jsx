import React from 'react';
import {render, screen, fireEvent, waitFor, act} from '@testing-library/react';
import '@testing-library/jest-dom';
import {vi, beforeAll, afterAll, beforeEach, afterEach, describe, test, expect} from 'vitest';
import LogsViewer from '../LogsViewer';
import {resetClusterStatus} from '../../hooks/clusterStatusOnce';
import i18n from '../../i18n';

// Hoist mocked functions for use in vi.mock factories
const {
    mockLocalStorage,
    mockLogger,
} = vi.hoisted(() => ({
    mockLocalStorage: {
        getItem: vi.fn().mockReturnValue('mock-token'),
    },
    mockLogger: {
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

// ── Mocks ──────────────────────────────────────────────────────────────
vi.mock('../../config/apiPath.js', () => ({
    URL_NODE: 'http://mock-api',
    URL_CLUSTER_STATUS: '/api/cluster/status',
}));

vi.mock('../../utils/logger.js', () => ({
    default: mockLogger,
}));

Object.defineProperty(window, 'localStorage', {value: mockLocalStorage});

global.Blob = vi.fn();
global.URL.createObjectURL = vi.fn().mockReturnValue('blob-url');
global.URL.revokeObjectURL = vi.fn();

// Simulate a readable stream for testing SSE
/**
 * The body of a followed log: its chunks, then open, as the daemon keeps it, with
 * nothing more to read; `ends`, closed after them, as a daemon restarting closes it.
 */
class MockReadableStream {
    constructor(chunks, delay = 0, {ends = false} = {}) {
        this.chunks = chunks || [];
        this.cancelled = false;
        this.delay = delay;
        this.ends = ends;
    }

    getReader() {
        let index = 0;
        const {chunks, delay, ends} = this;
        const stream = this;
        return {
            read: async () => {
                if (stream.cancelled) return {done: true};
                if (index < chunks.length) {
                    const chunk = chunks[index++];
                    if (delay > 0) await new Promise(r => setTimeout(r, delay));
                    return {value: new TextEncoder().encode(chunk), done: false};
                }
                if (!ends) return new Promise(() => {});
                return {done: true};
            },
            releaseLock: vi.fn(),
            cancel: vi.fn(() => {
                stream.cancelled = true;
                return Promise.resolve();
            }),
        };
    }

    cancel() {
        this.cancelled = true;
        return Promise.resolve();
    }
}

// --- Helpers ---
const mockSuccessfulFetch = (logData = [], delay = 0) => {
    const streamChunks = logData.map(log => `data: ${JSON.stringify(log)}\n\n`);
    global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: new MockReadableStream(streamChunks, delay),
    });
};

const mockErrorFetch = (status, message) => {
    global.fetch = vi.fn().mockRejectedValue(new Error(message));
};

const mockHttpErrorFetch = (status) => {
    global.fetch = vi.fn().mockResolvedValue({ok: false, status});
};

const renderComponent = (props = {}) =>
    render(<LogsViewer nodename="test-node" {...props} />);

const findLogsContainer = () => screen.getByRole('log', {name: 'Log lines'});

// Opens the level picker and ticks (or unticks) a level.
const toggleLevel = (name) => {
    fireEvent.click(screen.getByText('Levels').nextElementSibling.querySelector('summary'));
    fireEvent.click(screen.getByRole('checkbox', {name}));
};

const originalConsoleError = console.error;

describe('LogsViewer', () => {
    beforeAll(() => {
        console.error = vi.fn();
        HTMLElement.prototype.scrollIntoView = vi.fn();
    });

    afterAll(() => {
        console.error = originalConsoleError;
        delete HTMLElement.prototype.scrollIntoView;
    });

    beforeEach(() => {
        vi.clearAllMocks();
        mockLocalStorage.getItem.mockReturnValue('mock-token');
    });

    describe('Rendering', () => {
        test('renders nodename subtitle for node type', async () => {
            mockSuccessfulFetch([]);
            renderComponent();
            expect(await screen.findByText('test-node', {exact: false})).toBeInTheDocument();
        });

        test('renders instance subtitle', async () => {
            mockSuccessfulFetch([]);
            renderComponent({type: 'instance', instanceName: 'test-instance', namespace: 'test-ns', kind: 'test-kind'});
            await screen.findByText('test-instance', {exact: false});
            expect(screen.getByText('test-node', {exact: false})).toBeInTheDocument();
        });

        test('shows error when instanceName missing for instance type', async () => {
            mockSuccessfulFetch([]);
            renderComponent({type: 'instance', instanceName: ''});
            expect(await screen.findByText('Instance name is required', {exact: false})).toBeInTheDocument();
        });

        test('speaks French in a French browser', async () => {
            await i18n.changeLanguage('fr');
            try {
                mockSuccessfulFetch([]);
                renderComponent();
                expect(await screen.findByText('Aucun journal disponible')).toBeInTheDocument();
                expect(screen.getByPlaceholderText('Rechercher dans les journaux...')).toBeInTheDocument();
            } finally {
                await act(() => i18n.changeLanguage('en'));
            }
        });

        test('shows loading spinner during fetch', async () => {
            global.fetch = vi.fn(() => new Promise(() => {
            }));
            renderComponent();
            expect(screen.getByRole('status', {name: 'Loading logs'})).toBeInTheDocument();
            expect(screen.getByText('Loading logs...')).toBeInTheDocument();
        });

        test('displays "No logs available" when empty', async () => {
            mockSuccessfulFetch([]);
            renderComponent();
            await screen.findByText('No logs available');
        });
    });

    describe('Fetch URL and Headers', () => {
        test('fetches correct URL for node type', async () => {
            mockSuccessfulFetch([]);
            renderComponent();
            await waitFor(() => {
                expect(global.fetch).toHaveBeenCalledWith(
                    'http://mock-api/test-node/log?follow=true',
                    expect.objectContaining({
                        method: 'GET',
                        headers: expect.objectContaining({
                            Authorization: 'Bearer mock-token',
                            Accept: 'text/event-stream',
                        }),
                    })
                );
            });
        });

        test('reads only the journal entries the filters match, as the logs of one orchestration', async () => {
            mockSuccessfulFetch([]);
            renderComponent({type: 'instance', instanceName: 'inst', namespace: 'ns', kind: 'kind', filters: ['ORCHESTRATION_ID=o-1']});
            await waitFor(() => {
                expect(global.fetch).toHaveBeenCalledWith(
                    'http://mock-api/test-node/instance/path/ns/kind/inst/log?follow=true&filter=ORCHESTRATION_ID%3Do-1',
                    expect.objectContaining({method: 'GET'}),
                );
            });
        });

        test('fetches correct URL for instance type', async () => {
            mockSuccessfulFetch([]);
            renderComponent({type: 'instance', instanceName: 'inst', namespace: 'ns', kind: 'kind'});
            await waitFor(() => {
                expect(global.fetch).toHaveBeenCalledWith(
                    'http://mock-api/test-node/instance/path/ns/kind/inst/log?follow=true',
                    expect.objectContaining({
                        method: 'GET',
                        headers: expect.objectContaining({
                            Authorization: 'Bearer mock-token',
                            Accept: 'text/event-stream',
                        }),
                    })
                );
            });
        });
    });

    describe('Error handling', () => {
        test('shows authentication token error when token missing', async () => {
            mockLocalStorage.getItem.mockReturnValue(null);
            renderComponent();
            await screen.findByText('Authentication token not found');
        });

        test('handles HTTP error status 401', async () => {
            mockHttpErrorFetch(401);
            renderComponent();
            await screen.findByText('HTTP error! status: 401');
        });

        test('handles HTTP error status 500', async () => {
            mockHttpErrorFetch(500);
            renderComponent();
            await screen.findByText('HTTP error! status: 500');
        });

        test('shows node not found error for 404 in node type', async () => {
            mockErrorFetch(404, '404');
            renderComponent();
            await screen.findByText('Node logs endpoint not found for node test-node');
        });

        test('shows instance not found error for 404 in instance type', async () => {
            mockErrorFetch(404, '404');
            renderComponent({type: 'instance', instanceName: 'inst', namespace: 'ns', kind: 'kind'});
            await screen.findByText('Instance logs endpoint not found for inst on node test-node');
        });

        test('handles network error', async () => {
            mockErrorFetch(500, 'Network error');
            renderComponent();
            await screen.findByText('Failed to fetch logs: Network error');
        });

        test('handles response without body', async () => {
            global.fetch = vi.fn().mockResolvedValue({ok: true, status: 200, body: null});
            renderComponent();
            await screen.findByText('Response has no readable stream');
        });

        test('shows retry button on error and reconnects', async () => {
            mockHttpErrorFetch(401);
            renderComponent();
            await screen.findByText('HTTP error! status: 401');
            mockSuccessfulFetch([]);
            fireEvent.click(screen.getByText('Retry'));
            await screen.findByText('Connected');
        });

        test('shows authentication failed error when fetch rejects with 401', async () => {
            mockErrorFetch(401, '401 Unauthorized');
            renderComponent();
            await screen.findByText('Authentication failed. Please refresh your token.');
        });
    });

    describe('Log streaming and pause/resume', () => {
        test('shows connected status after fetch', async () => {
            mockSuccessfulFetch([]);
            renderComponent();
            expect(screen.getByText('Disconnected').parentElement).toHaveAttribute('data-state', 'down');
            const connected = await screen.findByText('Connected');
            expect(connected.parentElement).toHaveAttribute('data-state', 'up');
        });

        test('the pause button says whether streaming is paused', async () => {
            mockSuccessfulFetch([]);
            renderComponent();
            await screen.findByText('Connected');
            const pause = screen.getByRole('button', {name: 'Pause'});
            expect(pause).toHaveAttribute('aria-pressed', 'false');
            fireEvent.click(pause);
            expect(screen.getByRole('button', {name: 'Resume'})).toHaveAttribute('aria-pressed', 'true');
        });

        test('pauses and resumes streaming - covers abort during reading', async () => {
            const now = Date.now();
            mockSuccessfulFetch([{__REALTIME_TIMESTAMP: now * 1000, MESSAGE: 'First log'}], 50);

            renderComponent();
            await screen.findByText('First log');

            const pauseBtn = screen.getByRole('button', {name: /pause/i});
            fireEvent.click(pauseBtn);

            const resumeBtn = await screen.findByRole('button', {name: /resume/i});
            expect(resumeBtn).toBeInTheDocument();

            await waitFor(() => {
                expect(screen.queryByText('Second log')).not.toBeInTheDocument();
            });

            mockSuccessfulFetch([{__REALTIME_TIMESTAMP: (now + 200) * 1000, MESSAGE: 'New log after resume'}]);
            fireEvent.click(resumeBtn);
            await screen.findByText('New log after resume');
        });

        test('does not update logs when paused', async () => {
            const now = Date.now() * 1000;
            mockSuccessfulFetch([{__REALTIME_TIMESTAMP: now, MESSAGE: 'Initial log'}]);
            renderComponent();
            await screen.findByText('Initial log');

            fireEvent.click(screen.getByRole('button', {name: /pause/i}));

            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                body: new MockReadableStream([
                    `data: ${JSON.stringify({__REALTIME_TIMESTAMP: now + 1000, MESSAGE: 'Buffered log'})}\n\n`,
                ]),
            });
            await expect(screen.findByText('Buffered log', {}, {timeout: 1000})).rejects.toThrow();
        });
    });

    describe('Log parsing', () => {
        const baseTs = Date.now();

        test('handles non-JSON log', async () => {
            mockSuccessfulFetch([{__REALTIME_TIMESTAMP: baseTs * 1000, MESSAGE: 'Plain message'}]);
            renderComponent();
            await screen.findByText('Plain message');
            expect(screen.getByText('INFO')).toHaveClass('text-ink');
            // The level a word, not bold; the message apart from the metadata by a line.
            expect(screen.getByText('INFO')).not.toHaveClass('font-semibold');
            // Under the time, in the same cell.
            expect(screen.getByText('INFO').previousElementSibling.textContent).toMatch(/\d{2}:\d{2}:\d{2}/);
            expect(screen.getByText('INFO').parentElement).toHaveClass('flex-col');
            expect(screen.getByText('Plain message').parentElement).toHaveClass('border-l', 'pl-2');
            // No prefix: the text alone, no line of badges.
            expect(screen.getByText('Plain message').parentElement.querySelector('[data-meta]')).toBeNull();
            // No frame nor background, a very light line between entries.
            expect(findLogsContainer()).not.toHaveClass('bg-surface-sunken', 'border');
            expect(screen.getByText('Plain message').closest('.log-line')).toHaveClass('border-line/40');
        });

        test('parses JSON log with all fields', async () => {
            const log = {
                JSON: JSON.stringify({
                    time: baseTs,
                    level: 'debug',
                    message: 'JSON msg',
                    method: 'GET',
                    path: '/api/test',
                    node: 'test-node',
                    request_uuid: 'uuid',
                    pkg: 'test-pkg',
                }),
                __REALTIME_TIMESTAMP: baseTs * 1000,
            };
            mockSuccessfulFetch([log]);
            renderComponent();
            await screen.findByText('JSON msg');
            expect(screen.getByText('DEBUG')).toBeInTheDocument();
            expect(screen.getByText('GET')).toBeInTheDocument();
            expect(screen.getByText('/api/test')).toBeInTheDocument();
        });

        test('deduplicates logs by timestamp', async () => {
            const ts = baseTs * 1000;
            mockSuccessfulFetch([
                {__REALTIME_TIMESTAMP: ts, MESSAGE: 'dup'},
                {__REALTIME_TIMESTAMP: ts, MESSAGE: 'dup'},
                {__REALTIME_TIMESTAMP: ts + 1000, MESSAGE: 'unique'},
            ]);
            renderComponent();
            await screen.findByText('unique');
            expect(screen.getAllByText('dup', {exact: false}).length).toBe(1);
        });

        test('handles malformed JSON in parse', async () => {
            mockSuccessfulFetch([{__REALTIME_TIMESTAMP: baseTs * 1000, JSON: '{malformed'}]);
            renderComponent();
            await screen.findByText((content, element) => content.includes('{malformed'));
        });

        test('logs warning for invalid JSON line in stream', async () => {
            const streamChunks = [
                'data: not json\n\n',
                'data: {"__REALTIME_TIMESTAMP":1234567890, "MESSAGE": "valid"}\n\n',
            ];
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                body: new MockReadableStream(streamChunks),
            });
            renderComponent();
            await screen.findByText('valid');
            expect(mockLogger.warn).toHaveBeenCalledWith(
                'Failed to parse log line:',
                expect.any(Error),
                'data: not json'
            );
        });

        test('processes partial lines across chunks', async () => {
            const chunk1 = 'data: {"__REALTIME_TIMESTAMP":1234567890, "MESSAGE": "Hello';
            const chunk2 = ' world"}\n\n';
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                body: new MockReadableStream([chunk1, chunk2]),
            });
            renderComponent();
            await screen.findByText('Hello world');
            expect(screen.queryByText('Hello')).not.toBeInTheDocument();
        });

        test('ignores non-data lines and empty data', async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                body: new MockReadableStream([
                    'event: log\n',
                    'data: \n\n',
                    'data: {"__REALTIME_TIMESTAMP":1234567890, "MESSAGE": "Valid"}\n\n',
                ]),
            });
            renderComponent();
            await screen.findByText('Valid');
        });
    });

    describe('Filters and search', () => {
        beforeEach(() => {
            const ts = Date.now();
            mockSuccessfulFetch([
                {__REALTIME_TIMESTAMP: ts * 1000, JSON: JSON.stringify({level: 'debug', message: 'Debug log'})},
                {__REALTIME_TIMESTAMP: (ts + 1) * 1000, JSON: JSON.stringify({level: 'error', message: 'Error log'})},
                {__REALTIME_TIMESTAMP: (ts + 2) * 1000, JSON: JSON.stringify({level: 'warn', message: 'Warn log'})},
            ]);
        });

        test('filters by search term', async () => {
            renderComponent();
            await screen.findByText('Debug log');
            await screen.findByText('Error log');

            fireEvent.change(screen.getByPlaceholderText('Search logs...'), {target: {value: 'debug'}});
            expect(await screen.findByText('Debug log')).toBeInTheDocument();
            await waitFor(() => expect(screen.queryByText('Error log')).not.toBeInTheDocument());
            expect(screen.getByText(/Filters active/)).toBeInTheDocument();
        });

        test('filters by log level', async () => {
            renderComponent();
            await screen.findByText('Debug log');

            expect(screen.getByText('All levels')).toBeInTheDocument();
            toggleLevel('Debug');
            expect(screen.getByRole('checkbox', {name: 'Debug'})).toBeChecked();
            expect(screen.getByText('debug', {selector: 'summary'})).toBeInTheDocument();

            expect(await screen.findByText('Debug log')).toBeInTheDocument();
            await waitFor(() => expect(screen.queryByText('Error log')).not.toBeInTheDocument());
        });

        test('clicking a log clears filters', async () => {
            renderComponent();
            await screen.findByText('Debug log');

            toggleLevel('Debug');
            await screen.findByText('Debug log');

            fireEvent.click(screen.getByText('Debug log'));
            await screen.findByText('Error log');
            expect(screen.queryByText(/Filters active/)).not.toBeInTheDocument();
        });

        test('unticking a level shows its logs again', async () => {
            renderComponent();
            await screen.findByText('Debug log');

            toggleLevel('Debug');
            toggleLevel('Error');
            expect(screen.getByText('debug, error', {selector: 'summary'})).toBeInTheDocument();
            await waitFor(() => expect(screen.queryByText('Warn log')).not.toBeInTheDocument());
            expect(screen.getByText('Error log')).toBeInTheDocument();

            toggleLevel('Error');
            await waitFor(() => expect(screen.queryByText('Error log')).not.toBeInTheDocument());
            toggleLevel('Debug');
            await screen.findByText('Warn log');
            expect(screen.getByText('All levels')).toBeInTheDocument();
            expect(screen.queryByText(/Filters active/)).not.toBeInTheDocument();
        });

        test('shows filtered log count', async () => {
            renderComponent();
            await screen.findByText('3 / 3 logs');

            toggleLevel('Debug');
            await screen.findByText('1 / 3 logs');
        });

        test('clicking filter chip delete clears all filters', async () => {
            renderComponent();
            await screen.findByText('Debug log');

            fireEvent.change(screen.getByPlaceholderText('Search logs...'), {target: {value: 'debug'}});
            await screen.findByText(/Filters active/);

            fireEvent.click(screen.getByRole('button', {name: 'Reset filters'}));

            expect(screen.queryByText(/Filters active/)).not.toBeInTheDocument();
            expect(screen.getByPlaceholderText('Search logs...')).toHaveValue('');
            expect(screen.getByText('Debug log')).toBeInTheDocument();
            expect(screen.getByText('Error log')).toBeInTheDocument();
            expect(screen.getByText('Warn log')).toBeInTheDocument();
        });

        test('displays warning log with correct color', async () => {
            renderComponent();
            await screen.findByText('Warn log');
            // The level says itself in a state colour.
            expect(screen.getByText('WARN')).toHaveClass('text-state-warn');
            expect(screen.getByText('ERROR')).toHaveClass('text-state-down');
            expect(screen.getByText('DEBUG')).toHaveClass('text-ink-muted');
        });
    });

    describe('Clear and Download', () => {
        test('clears logs', async () => {
            mockSuccessfulFetch([{__REALTIME_TIMESTAMP: Date.now() * 1000, MESSAGE: 'Test log'}]);
            renderComponent();
            await screen.findByText('Test log');

            fireEvent.click(screen.getByRole('button', {name: /clear/i}));
            await screen.findByText('No logs available');
        });

        test('disables clear and download when no logs', async () => {
            mockSuccessfulFetch([]);
            renderComponent();
            await screen.findByText('No logs available');
            expect(screen.getByRole('button', {name: /clear/i})).toBeDisabled();
            expect(screen.getByRole('button', {name: /download/i})).toBeDisabled();
        });

        test('download creates blob and triggers download', async () => {
            mockSuccessfulFetch([{__REALTIME_TIMESTAMP: Date.now() * 1000, MESSAGE: 'Download test'}]);
            renderComponent();
            await screen.findByText('Download test');

            fireEvent.click(screen.getByRole('button', {name: /download/i}));
            expect(global.URL.createObjectURL).toHaveBeenCalled();
            expect(global.URL.revokeObjectURL).toHaveBeenCalled();
        });

        test('downloads logs for instance type with correct filename', async () => {
            const now = Date.now();
            mockSuccessfulFetch([{__REALTIME_TIMESTAMP: now * 1000, MESSAGE: 'Instance log'}]);
            renderComponent({type: 'instance', instanceName: 'test-instance', namespace: 'ns', kind: 'kind'});
            await screen.findByText('Instance log');

            const originalCreateElement = document.createElement.bind(document);
            const createElementSpy = vi.spyOn(document, 'createElement');
            let anchorElement = null;
            createElementSpy.mockImplementation((tag) => {
                const element = originalCreateElement(tag);
                if (tag === 'a') {
                    anchorElement = element;
                }
                return element;
            });

            try {
                fireEvent.click(screen.getByRole('button', {name: /download/i}));
                expect(anchorElement).not.toBeNull();
                expect(anchorElement.download).toContain('test-instance-logs');
                expect(global.URL.createObjectURL).toHaveBeenCalled();
            } finally {
                createElementSpy.mockRestore();
            }
        });
    });

    describe('Scroll and selection', () => {
        test('highlights selected log and scrolls', async () => {
            const ts = Date.now() * 1000;
            const logs = Array.from({length: 10}, (_, i) => ({
                __REALTIME_TIMESTAMP: ts + i * 1000,
                MESSAGE: `Log ${i + 1}`,
            }));
            mockSuccessfulFetch(logs);
            renderComponent();
            await screen.findByText('Log 10');

            fireEvent.change(screen.getByPlaceholderText('Search logs...'), {target: {value: 'Log 5'}});
            await screen.findByText('Log 5');
            fireEvent.click(screen.getByText('Log 5'));

            await screen.findByText('Log 10');
            expect(screen.getByText('Log 5')).toBeInTheDocument();
        });

        test('scrolls to log and resets background after timeout, handles unmount', async () => {
            vi.useFakeTimers();

            const ts = Date.now() * 1000;
            const logs = Array.from({length: 5}, (_, i) => ({
                __REALTIME_TIMESTAMP: ts + i * 1000,
                MESSAGE: `Log ${i + 1}`,
            }));
            mockSuccessfulFetch(logs);
            const {unmount} = renderComponent();
            await screen.findByText('Log 5');

            const logsContainer = findLogsContainer();
            expect(logsContainer).toBeInTheDocument();
            logsContainer.scrollTo = vi.fn();

            fireEvent.change(screen.getByPlaceholderText('Search logs...'), {target: {value: 'Log 3'}});
            await screen.findByText('Log 3');
            fireEvent.click(screen.getByText('Log 3'));

            act(() => {
                vi.advanceTimersByTime(100);
            });
            expect(logsContainer.scrollTo).toHaveBeenCalledWith({
                top: expect.any(Number),
                behavior: 'smooth',
            });

            // The line found is highlighted for a while.
            const line = () => screen.getByText('Log 3').closest('.log-line');
            act(() => {
                vi.advanceTimersByTime(0);
            });
            expect(line()).toHaveClass('bg-accent-soft');

            act(() => {
                vi.advanceTimersByTime(2000);
            });
            expect(line()).not.toHaveClass('bg-accent-soft');
            unmount();
            vi.useRealTimers();
        });

        /** Streams that lines are pushed into when the test says: one a request, the last one fed. */
        const controlledStreams = () => {
            const streams = [];
            global.fetch = vi.fn(() => {
                const queue = [];
                let wake = null;
                const reader = {
                    read: () => (queue.length ? Promise.resolve(queue.shift()) : new Promise((resolve) => {
                        wake = resolve;
                    })),
                    releaseLock: () => {},
                };
                streams.push((log) => {
                    const chunk = {value: new TextEncoder().encode(`data: ${JSON.stringify(log)}\n\n`), done: false};
                    if (wake) {
                        const w = wake;
                        wake = null;
                        w(chunk);
                    } else {
                        queue.push(chunk);
                    }
                });
                return Promise.resolve({ok: true, status: 200, body: {getReader: () => reader}});
            });
            return (log) => act(async () => streams.at(-1)(log));
        };
        const scrolledTo = (container, scrollTop) => {
            Object.defineProperty(container, 'scrollHeight', {value: 1000, configurable: true});
            Object.defineProperty(container, 'clientHeight', {value: 500, configurable: true});
            container.scrollTop = scrollTop;
            fireEvent.scroll(container);
        };

        test('opened following; scrolled up, the new lines counted on a button back to the end', async () => {
            const push = controlledStreams();
            renderComponent();
            const ts = Date.now() * 1000;
            await push({__REALTIME_TIMESTAMP: ts, MESSAGE: 'first'});
            await screen.findByText('first');
            expect(screen.getByRole('button', {name: 'Following'})).toHaveAttribute('aria-pressed', 'true');
            expect(screen.queryByRole('button', {name: /new line|Latest lines/})).toBeNull();

            scrolledTo(findLogsContainer(), 0);
            expect(screen.getByRole('button', {name: 'Follow'})).toHaveAttribute('aria-pressed', 'false');
            expect(screen.getByRole('button', {name: 'Latest lines'})).toBeInTheDocument();
            await push({__REALTIME_TIMESTAMP: ts + 1000, MESSAGE: 'second'});
            await push({__REALTIME_TIMESTAMP: ts + 2000, MESSAGE: 'third'});
            const back = await screen.findByRole('button', {name: '2 new lines'});
            // Not following: the view not moved to the end.
            expect(findLogsContainer().scrollTop).toBe(0);

            fireEvent.click(back);
            expect(findLogsContainer().scrollTop).toBe(1000);
            expect(screen.getByRole('button', {name: 'Following'})).toHaveAttribute('aria-pressed', 'true');
            expect(screen.queryByRole('button', {name: /new line|Latest lines/})).toBeNull();
        });

        test('scrolled up, the age of the lines shown by the scroll handle, for a while; none at the end', async () => {
            const push = controlledStreams();
            renderComponent();
            await push({__REALTIME_TIMESTAMP: String((Date.now() - 5 * 60 * 1000) * 1000), MESSAGE: 'five minutes ago'});
            await screen.findByText('five minutes ago');
            const container = findLogsContainer();
            const age = () => document.querySelector('[data-scroll-age]');
            scrolledTo(container, 250);
            expect(age()).toHaveTextContent('5 minutes ago');
            expect(age()).toHaveClass('bg-accent', 'text-accent-ink');
            // Where the handle is: halfway down, within the view.
            expect(age().style.top).toBe(`${Math.round(0.5 * (500 - 22))}px`);
            await waitFor(() => expect(age()).toBeNull(), {timeout: 2500});
            scrolledTo(container, 490);
            expect(age()).toBeNull();
        });

        test('back at the end by scrolling, following again', async () => {
            const push = controlledStreams();
            renderComponent();
            await push({__REALTIME_TIMESTAMP: Date.now() * 1000, MESSAGE: 'first'});
            await screen.findByText('first');
            scrolledTo(findLogsContainer(), 0);
            expect(screen.getByRole('button', {name: 'Latest lines'})).toBeInTheDocument();
            scrolledTo(findLogsContainer(), 490);
            await waitFor(() => expect(screen.queryByRole('button', {name: 'Latest lines'})).toBeNull());
            expect(screen.getByRole('button', {name: 'Following'})).toBeInTheDocument();
        });

        test('older lines read on demand, the journal again further back, put in their place; none left, said', async () => {
            const ts = Date.now() * 1000;
            const entry = (offset, message) => ({__REALTIME_TIMESTAMP: String(ts + offset), MESSAGE: message});
            const older = [entry(-2000, 'older one'), entry(-1000, 'older two'), entry(0, 'recent')];
            const asText = (logs) => logs.map((log) => `data: ${JSON.stringify(log)}\n\n`).join('');
            global.fetch = vi.fn((url) => Promise.resolve(url.includes('follow=false')
                ? {ok: true, status: 200, text: () => Promise.resolve(asText(older))}
                : {ok: true, status: 200, body: new MockReadableStream([asText([entry(0, 'recent')])], 0)}));
            renderComponent();
            await screen.findByText('recent');
            fireEvent.click(screen.getByRole('button', {name: 'Load older lines'}));
            await screen.findByText('older one');
            expect(global.fetch).toHaveBeenCalledWith('http://mock-api/test-node/log?follow=false&lines=250', expect.anything());
            const messages = [...findLogsContainer().querySelectorAll('.log-line')].map((line) => line.lastElementChild.textContent);
            expect(messages).toEqual(['older one', 'older two', 'recent']);
            // Read from the top: the view stays where it is.
            expect(screen.getByRole('button', {name: 'Follow'})).toBeInTheDocument();

            fireEvent.click(screen.getByRole('button', {name: 'Load older lines'}));
            expect(await screen.findByText('No older lines')).toBeInTheDocument();
            expect(global.fetch).toHaveBeenCalledWith('http://mock-api/test-node/log?follow=false&lines=450', expect.anything());
        });
    });

    describe('Miscellaneous', () => {
        test('limits logs to maxLogs', async () => {
            const ts = Date.now() * 1000;
            const logs = Array.from({length: 5}, (_, i) => ({
                __REALTIME_TIMESTAMP: ts + i * 1000,
                MESSAGE: `Log ${i + 1}`,
            }));
            mockSuccessfulFetch(logs);
            renderComponent({maxLogs: 3});
            await screen.findByText('Log 5');
            await waitFor(() => {
                expect(screen.queryByText('Log 1')).not.toBeInTheDocument();
                expect(screen.queryByText('Log 2')).not.toBeInTheDocument();
            });
        });

        test('handles empty log message', async () => {
            mockSuccessfulFetch([{__REALTIME_TIMESTAMP: Date.now() * 1000, MESSAGE: ''}]);
            renderComponent();
            await screen.findByText('INFO');
        });
    });

    describe('several nodes', () => {
        beforeEach(() => resetClusterStatus());

        test('a block a node: its marker in the order of the cluster and its name on its first line, faint after', async () => {
            const entry = (ts, message) => ({__REALTIME_TIMESTAMP: String(ts), MESSAGE: message});
            const streams = {
                n1: [entry(1000, 'n1 one'), entry(2000, 'n1 two'), entry(3000, 'n1 three')],
                n2: [entry(4000, 'n2 one')],
            };
            global.fetch = vi.fn((url) => {
                if (url === '/api/cluster/status') {
                    return Promise.resolve({ok: true, status: 200, json: () => Promise.resolve({cluster: {config: {nodes: ['n2', 'n1']}}})});
                }
                const node = Object.keys(streams).find((n) => url.includes(`/${n}/`));
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    body: new MockReadableStream(streams[node].map((log) => `data: ${JSON.stringify(log)}\n\n`), 0),
                });
            });
            render(<LogsViewer nodenames={['n1', 'n2']} type="instance" namespace="prod" kind="svc" instanceName="web"/>);
            await waitFor(() => expect(findLogsContainer()).toHaveTextContent('n2 one'));
            await waitFor(() => expect(findLogsContainer()).toHaveTextContent('n1 three'));
            const lines = [...findLogsContainer().querySelectorAll('.log-line')];
            // n2 first in the cluster: column 0; n1 column 1.
            await waitFor(() => expect(lines[0].querySelector('[data-node-marker]')).toHaveAttribute('data-node-marker', '1'));
            expect(lines[3].querySelector('[data-node-marker]')).toHaveAttribute('data-node-marker', '0');
            // The block of n1: its name on its first line, kept for assistive tools after, the marker faint.
            expect(lines.map((line) => line.hasAttribute('data-block-start'))).toEqual([true, false, false, true]);
            expect(lines[1].querySelector('[data-node] .sr-only')).toHaveTextContent('n1');
            expect(lines[1].querySelector('[data-node-marker]')).toHaveClass('opacity-40');
            expect(lines[0].querySelector('[data-node-marker]')).not.toHaveClass('opacity-40');
            // A plainer line where the next node begins.
            expect(lines[2]).toHaveClass('border-line');
            expect(lines[1]).toHaveClass('border-line/40');
        });

        test('the time, the level and the node in columns shared; the message on two lines, its prefixes small badges, then its text', async () => {
            mockSuccessfulFetch([{__REALTIME_TIMESTAMP: String(Date.now() * 1000), MESSAGE: 'daemon: imon: kvm/svc/vm1: started'}]);
            renderComponent();
            const text = await screen.findByText('started');
            const cell = text.parentElement;
            expect(cell).toHaveClass('border-l', 'flex-col');
            const meta = cell.querySelector('[data-meta]');
            expect([...meta.children].map((badge) => badge.textContent)).toEqual(['daemon', 'imon', 'kvm/svc/vm1']);
            expect(meta.firstElementChild).toHaveClass('rounded-full', 'text-ink-muted');
            expect(meta.nextElementSibling).toBe(text);
            expect(text.closest('.log-line')).toHaveClass('grid-cols-subgrid', 'col-span-full');
            expect(text.closest('.log-line').querySelectorAll('button')).toHaveLength(0);
        });

        test('one node: no marker, no block', async () => {
            mockSuccessfulFetch([{__REALTIME_TIMESTAMP: Date.now() * 1000, MESSAGE: 'alone'}]);
            renderComponent();
            await screen.findByText('alone');
            expect(document.querySelector('[data-node-marker]')).toBeNull();
            expect(document.querySelector('[data-block-start]')).toBeNull();
        });

        test('a stream a node, merged in the order of their time, each line saying its node', async () => {
            const entry = (ts, message) => ({__REALTIME_TIMESTAMP: String(ts), MESSAGE: message});
            const streams = {
                n1: [entry(1000, 'first on n1'), entry(3000, 'third on n1')],
                n2: [entry(2000, 'second on n2'), entry(3000, 'same instant on n2')],
            };
            global.fetch = vi.fn((url) => {
                const node = Object.keys(streams).find((n) => url.includes(`/${n}/`));
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    body: new MockReadableStream(streams[node].map((log) => `data: ${JSON.stringify(log)}\n\n`), 0),
                });
            });
            render(<LogsViewer nodenames={['n1', 'n2']} type="instance" namespace="prod" kind="svc" instanceName="web" filters={['RID=app#1']}/>);
            await waitFor(() => expect(findLogsContainer()).toHaveTextContent('same instant on n2'));
            // The log streams, beside the cluster status read for the order of the nodes.
            expect([...new Set(global.fetch.mock.calls.map(([url]) => url))].filter((url) => url !== '/api/cluster/status')).toEqual([
                'http://mock-api/n1/instance/path/prod/svc/web/log?follow=true&filter=RID%3Dapp%231',
                'http://mock-api/n2/instance/path/prod/svc/web/log?follow=true&filter=RID%3Dapp%231',
            ]);
            await waitFor(() => expect(findLogsContainer()).toHaveTextContent('third on n1'));
            const lines = [...findLogsContainer().querySelectorAll('.log-line')];
            expect(lines.map((line) => line.querySelector('[data-node]').textContent)).toEqual(['n1', 'n2', 'n1', 'n2']);
            expect(lines[0]).toHaveTextContent('first on n1');
            expect(lines[1]).toHaveTextContent('second on n2');
            expect(screen.getByText('web on n1, n2')).toBeInTheDocument();
        });
    });

    describe('a stream lost', () => {
        const line = (ms, message) => `data: ${JSON.stringify({__REALTIME_TIMESTAMP: String(ms * 1000), MESSAGE: message})}\n\n`;
        const status = () => screen.getByText(/^(Connected|Disconnected)$/).parentElement;
        // The reads of the log not stopped at once.
        const logReads = () => global.fetch.mock.calls.filter(([url, options]) => url.includes('/log?') && !options?.signal?.aborted).length;

        /** Answered once its reading still goes on: one stopped at once (a second start) takes no body. */
        const unlessAborted = (options, answer) => Promise.resolve().then(() => (options?.signal?.aborted
            ? Promise.reject(Object.assign(new Error('aborted'), {name: 'AbortError'}))
            : answer()));

        /** The bodies of the successive reads of the log, the last one again past them. */
        const answers = (...bodies) => {
            let read = 0;
            global.fetch = vi.fn((url, options) => {
                if (url === '/api/cluster/status') {
                    return Promise.resolve({ok: true, status: 200, json: () => Promise.resolve({cluster: {config: {nodes: ['test-node']}}})});
                }
                return unlessAborted(options, () => ({ok: true, status: 200, body: bodies[Math.min(read++, bodies.length - 1)]()}));
            });
        };

        test('ended by the daemon, it is said, read again, and its lines not shown twice', async () => {
            const now = Date.now();
            answers(
                () => new MockReadableStream([line(now, 'before restart')], 0, {ends: true}),
                // The daemon back, its stream replays the last lines, then follows.
                () => new MockReadableStream([line(now, 'before restart'), line(now + 1, 'after restart')]),
            );
            renderComponent();
            await waitFor(() => expect(screen.getByText(/was lost: reconnecting/)).toBeInTheDocument());
            expect(status()).toHaveAttribute('data-state', 'down');
            await waitFor(() => expect(findLogsContainer()).toHaveTextContent('after restart'), {timeout: 3000});
            expect(status()).toHaveAttribute('data-state', 'up');
            expect(screen.queryByText(/was lost: reconnecting/)).not.toBeInTheDocument();
            expect(screen.getAllByText('before restart')).toHaveLength(1);
            expect(logReads()).toBe(2);
        });

        test('cut (the daemon or the network gone), it is read again', async () => {
            const now = Date.now();
            const cut = () => ({
                getReader: () => ({
                    read: () => Promise.reject(new TypeError('network error')),
                    releaseLock: vi.fn(),
                }),
            });
            answers(cut, () => new MockReadableStream([line(now, 'back')]));
            renderComponent();
            await waitFor(() => expect(findLogsContainer()).toHaveTextContent('back'), {timeout: 3000});
            expect(status()).toHaveAttribute('data-state', 'up');
            expect(screen.queryByText(/Failed to fetch logs/)).not.toBeInTheDocument();
        });

        test('connected only while the stream of every node is open', async () => {
            const reads = {n1: 0, n2: 0};
            global.fetch = vi.fn((url, options) => {
                if (url === '/api/cluster/status') {
                    return Promise.resolve({ok: true, status: 200, json: () => Promise.resolve({cluster: {config: {nodes: ['n1', 'n2']}}})});
                }
                return unlessAborted(options, () => {
                    const node = url.includes('/n1/') ? 'n1' : 'n2';
                    reads[node] += 1;
                    // The stream of n2 ends once, then follows.
                    const ends = node === 'n2' && reads.n2 === 1;
                    return {ok: true, status: 200, body: new MockReadableStream([], 0, {ends})};
                });
            });
            render(<LogsViewer nodenames={['n1', 'n2']}/>);
            await waitFor(() => expect(screen.getByText(/stream of n2 was lost/)).toBeInTheDocument());
            expect(status()).toHaveAttribute('data-state', 'down');
            await waitFor(() => expect(status()).toHaveAttribute('data-state', 'up'), {timeout: 3000});
            expect(reads).toEqual({n1: 1, n2: 2});
        });

        test('closed meanwhile, the viewer reads nothing again', async () => {
            answers(() => new MockReadableStream([], 0, {ends: true}));
            const {unmount} = renderComponent();
            await waitFor(() => expect(screen.getByText(/was lost: reconnecting/)).toBeInTheDocument());
            const before = global.fetch.mock.calls.length;
            unmount();
            await new Promise((r) => setTimeout(r, 1500));
            expect(global.fetch.mock.calls.length).toBe(before);
        });
    });
});
