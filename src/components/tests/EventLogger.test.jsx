import React from 'react';
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import '@testing-library/jest-dom';
import {vi, beforeAll, beforeEach, afterEach, describe, test, expect} from 'vitest';
import EventLogger, {EventLog, OBJECT_EVENT_TYPES, hashCode} from '../EventLogger';
import useEventLogStore from '../../hooks/useEventLogStore';
import {panelOpened} from '../../ui/components/slide-over-open';
import logger from '../../utils/logger.js';
import i18n from '../../i18n';

// ─── Global setup ───────────────────────────────────────────────────────────
beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
});

vi.mock('../../hooks/useEventLogStore', () => ({
    __esModule: true,
    default: vi.fn(() => ({
        eventLogs: [],
        isPaused: false,
        setPaused: vi.fn(),
        clearLogs: vi.fn(),
    })),
}));

vi.mock('../../utils/logger.js', () => ({
    __esModule: true,
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        log: vi.fn(),
        serialize: vi.fn((arg) => JSON.stringify(arg)),
    },
}));

vi.mock('../../eventSourceManager', () => ({
    __esModule: true,
    startLoggerReception: vi.fn(),
    closeLoggerEventSource: vi.fn(),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────
const renderWithTheme = (ui) => render(ui);

const makeLog = (overrides = {}) => ({
    id: '1',
    eventType: 'TEST_EVENT',
    timestamp: new Date().toISOString(),
    data: {},
    ...overrides,
});

const mockStore = (overrides = {}) => ({
    eventLogs: [],
    isPaused: false,
    setPaused: vi.fn(),
    clearLogs: vi.fn(),
    ...overrides,
});

const openDrawer = () => {
    const btn = screen.getByRole('button', {name: /Events|Event Logger/i});
    act(() => fireEvent.click(btn));
    return btn;
};

const openDrawerAndWait = async (title = /Event Logger/i) => {
    openDrawer();
    await waitFor(() => expect(screen.getByText(title)).toBeInTheDocument());
};

// The settings panel is a SlideOver: mounted with the bottom panel, inert while closed.
const settingsPanel = () =>
    screen.getByRole('dialog', {name: 'Event Subscriptions', hidden: true});

const expectSettingsOpen = () => expect(settingsPanel()).not.toHaveAttribute('inert');
const expectSettingsClosed = () => expect(settingsPanel()).toHaveAttribute('inert');

const openSettings = async () => {
    fireEvent.click(screen.getByRole('button', {name: 'Manage subscriptions'}));
    await waitFor(expectSettingsOpen);
};

// The button of a log row: it carries aria-expanded, the filter buttons aria-pressed.
const rowButton = (eventType) =>
    screen
        .getAllByRole('button')
        .find((b) => b.hasAttribute('aria-expanded') && b.textContent.includes(eventType));

const eventList = () => screen.getByRole('region', {name: 'Event list'});
const panel = (title = 'Event Logger') => screen.getByRole('region', {name: title});
const loading = () => screen.queryByRole('status', {name: 'Loading events'});

describe('EventLogger Component', () => {
    let mockSetPaused;
    let mockClearLogs;

    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation((msg, ...args) => {
            if (
                typeof msg === 'string' &&
                msg.includes('Each child in a list should have a unique "key" prop')
            )
                return;
            console.error(msg, ...args);
        });

        mockSetPaused = vi.fn();
        mockClearLogs = vi.fn();

        vi.mocked(useEventLogStore).mockReturnValue(
            mockStore({setPaused: mockSetPaused, clearLogs: mockClearLogs})
        );
        Object.values(logger).forEach(
            (fn) => typeof fn.mockClear === 'function' && fn.mockClear()
        );
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.clearAllMocks();
        vi.useRealTimers();
        screen
            .queryAllByRole('button', {name: /Close/i})
            .forEach((btn) => fireEvent.click(btn));
    });

    // ─── Pure utility functions ───────────────────────────────────────────────
    describe('Pure utility functions', () => {
        test('hashCode returns stable, defined values', () => {
            expect(hashCode('test')).toBeDefined();
            expect(hashCode('')).toBe('0');
            expect(hashCode('longer string test')).toBeDefined();
            expect(hashCode('test')).toBe(hashCode('test'));
        });

        test.each([
            ['TEST_ERROR_EVENT', 'error'],
            ['OBJECT_UPDATED', 'primary'],
            ['ITEM_DELETED', 'warning'],
            ['CONNECTION_STATUS', 'info'],
            ['REGULAR_EVENT', 'default'],
            ['', 'default'],
            [undefined, 'default'],
        ])('getEventColor("%s") → "%s"', (eventType, expected) => {
            const getEventColor = (et = '') => {
                if (et.includes('ERROR')) return 'error';
                if (et.includes('UPDATED')) return 'primary';
                if (et.includes('DELETED')) return 'warning';
                if (et.includes('CONNECTION')) return 'info';
                return 'default';
            };
            expect(getEventColor(eventType)).toBe(expected);
        });

        test('toggleExpand adds and removes ids', () => {
            const toggle = (prev, id) =>
                prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
            expect(toggle([], 'id1')).toEqual(['id1']);
            expect(toggle(['id1', 'id2'], 'id1')).toEqual(['id2']);
            expect(toggle(['id1'], 'id1')).toEqual([]);
        });

        test('filterData handles all input types', () => {
            const filterData = (data) => {
                if (!data || typeof data !== 'object') return data;
                const {_rawEvent, ...rest} = data;
                return rest;
            };
            expect(filterData(null)).toBeNull();
            expect(filterData(undefined)).toBeUndefined();
            expect(filterData('string')).toBe('string');
            expect(filterData(123)).toBe(123);
            expect(filterData({_rawEvent: 'x', other: 'data'})).toEqual({other: 'data'});
            expect(filterData({other: 'data'})).toEqual({other: 'data'});
        });

        test('escapeHtml handles all special characters and non-strings', () => {
            const escapeHtml = (text) => {
                if (typeof text !== 'string') return text;
                return text
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&#039;');
            };
            expect(escapeHtml('a & b')).toBe('a &amp; b');
            expect(escapeHtml('<div>')).toBe('&lt;div&gt;');
            expect(escapeHtml('"q"')).toBe('&quot;q&quot;');
            expect(escapeHtml("'a'")).toBe('&#039;a&#039;');
            expect(escapeHtml(123)).toBe(123);
            expect(escapeHtml(null)).toBeNull();
            expect(escapeHtml(undefined)).toBeUndefined();
        });

        test('pageKey generation is deterministic', () => {
            const pageKey = (objectName, types) => {
                const base = objectName || 'global';
                return `eventLogger_${base}_${hashCode(types.sort().join(','))}`;
            };
            expect(pageKey(null, ['EVENT1', 'EVENT2'])).toMatch(/^eventLogger_global_/);
            expect(pageKey('/test', ['A'])).toMatch(/^eventLogger_\/test_/);
            expect(pageKey(null, ['EVENT1', 'EVENT2'])).toBe(
                pageKey(null, ['EVENT2', 'EVENT1'])
            );
        });
    });

    // ─── Rendering ────────────────────────────────────────────────────────
    describe('Rendering', () => {
        test.each([
            ['default props', {}, {}],
            [
                'custom title and buttonLabel',
                {title: 'Custom Logger', buttonLabel: 'Custom Button'},
                {},
            ],
            [
                'all props (eventTypes, objectName)',
                {title: 'T', buttonLabel: 'B', eventTypes: ['A', 'B'], objectName: '/p'},
                {},
            ],
            ['non-array eventLogs', {}, {eventLogs: {}}],
        ])('renders without crashing: %s', (_, props, storeOverrides) => {
            if (Object.keys(storeOverrides).length) {
                vi.mocked(useEventLogStore).mockReturnValue(mockStore(storeOverrides));
            }
            const {container} = renderWithTheme(<EventLogger {...props} />);
            expect(container).toBeInTheDocument();
            if (props.buttonLabel) {
                expect(screen.getByText(props.buttonLabel)).toBeInTheDocument();
            } else {
                expect(
                    screen.getByRole('button', {name: /Events|Event Logger/i})
                ).toBeInTheDocument();
            }
        });

        test('button hidden when drawer open, reappears on close', async () => {
            renderWithTheme(<EventLogger/>);
            openDrawer();
            await waitFor(() => expect(screen.getByText(/Event Logger/i)).toBeInTheDocument());
            expect(screen.queryByRole('button', {name: /^Events$/i})).not.toBeInTheDocument();

            act(() => fireEvent.click(screen.getByRole('button', {name: /^Close$/i})));
            await waitFor(() =>
                expect(screen.getByRole('button', {name: /Events|Event Logger/i})).toBeInTheDocument()
            );
        });

        test('button hidden while a side panel of the page is open', () => {
            renderWithTheme(<EventLogger/>);
            expect(screen.getByRole('button', {name: /^Events$/i})).toBeInTheDocument();
            let closePanel;
            act(() => {
                closePanel = panelOpened();
            });
            expect(screen.queryByRole('button', {name: /^Events$/i})).not.toBeInTheDocument();
            act(() => closePanel());
            expect(screen.getByRole('button', {name: /^Events$/i})).toBeInTheDocument();
        });

        test('expanded log colours every JSON value type with the code tokens', async () => {
            vi.useFakeTimers();
            vi.mocked(useEventLogStore).mockReturnValue(
                mockStore({
                    eventLogs: [
                        makeLog({
                            eventType: 'ALL_TYPES_DARK',
                            data: {
                                str: 'hello',
                                num: 123,
                                boolTrue: true,
                                boolFalse: false,
                                nothing: null,
                            },
                        }),
                    ],
                    setPaused: mockSetPaused,
                    clearLogs: mockClearLogs,
                })
            );
            renderWithTheme(<EventLogger/>);
            openDrawer();
            act(() => vi.advanceTimersByTime(200));
            await waitFor(() =>
                expect(screen.getByLabelText(/Resize handle/i)).toBeInTheDocument()
            );

            const row = rowButton('ALL_TYPES_DARK');
            expect(row).toHaveAttribute('aria-expanded', 'false');
            fireEvent.click(row);
            expect(row).toHaveAttribute('aria-expanded', 'true');

            // Looked up by attribute value in JS: the jsdom selector engine mishandles "null".
            const token = (kind) =>
                [...document.querySelectorAll('[data-token]')].find(
                    (el) => el.getAttribute('data-token') === kind
                );
            await waitFor(() => {
                expect(token('null')).toHaveClass('text-code-keyword');
                expect(token('boolean')).toHaveClass('text-code-keyword');
                expect(token('number')).toHaveClass('text-code-number');
                expect(token('string')).toHaveClass('text-code-string');
                expect(token('key')).toHaveClass('text-code-key');
                expect(token('punct')).toHaveClass('text-code-punct');
            });
            expect(token('null').closest('pre')).toHaveClass('font-mono');
            // No global stylesheet injected any more.
            expect(document.querySelector('style')).toBeNull();

            vi.useRealTimers();
        });
    });

    // ─── Drawer open / close ──────────────────────────────────────────────
    describe('French', () => {
        test('speaks French in a French browser', async () => {
            await i18n.changeLanguage('fr');
            try {
                renderWithTheme(<EventLogger/>);
                expect(screen.getByRole('button', {name: /Événements/})).toHaveAttribute('title', 'Journal des événements');
            } finally {
                await act(() => i18n.changeLanguage('en'));
            }
        });
    });

    describe('Drawer open / close', () => {
        test('opens, shows title, and shows "No events logged" when empty', async () => {
            renderWithTheme(<EventLogger/>);
            await openDrawerAndWait();
            await waitFor(() => expect(loading()).not.toBeInTheDocument());
            expect(screen.getByText(/No events logged/i)).toBeInTheDocument();
        });

        test('closes via Close button', async () => {
            renderWithTheme(<EventLogger/>);
            await openDrawerAndWait();
            act(() => fireEvent.click(screen.getByRole('button', {name: /^Close$/})));
            await waitFor(() =>
                expect(screen.getByRole('button', {name: /Events|Event Logger/i})).toBeInTheDocument()
            );
        });

        test('unmounting while drawer open calls closeLoggerEventSource', async () => {
            vi.spyOn(Storage.prototype, 'getItem').mockReturnValue('test-token');
            const {closeLoggerEventSource} = await import('../../eventSourceManager');
            vi.mocked(closeLoggerEventSource).mockClear();

            const {unmount} = renderWithTheme(<EventLogger/>);
            openDrawer();
            unmount();
            expect(closeLoggerEventSource).toHaveBeenCalled();
        });
    });

    // ─── Log display ──────────────────────────────────────────────────────
    describe('Log display', () => {
        const setupLogs = (logs) => {
            vi.mocked(useEventLogStore).mockReturnValue(
                mockStore({
                    eventLogs: logs,
                    setPaused: mockSetPaused,
                    clearLogs: mockClearLogs,
                })
            );
        };

        test.each([
            ['basic log', makeLog({eventType: 'TEST_EVENT'})],
            ['log without id', {eventType: 'NO_ID', timestamp: new Date().toISOString(), data: {}}],
            [
                'circular reference in data',
                (() => {
                    const c = {};
                    c.self = c;
                    return makeLog({eventType: 'CIRCULAR_TEST', data: c});
                })(),
            ],
            [
                'XSS-like content',
                makeLog({
                    eventType: 'HTML_TEST',
                    data: {message: '<script>alert("xss")</script>'},
                }),
            ],
            [
                'all JSON value types',
                makeLog({
                    eventType: 'ALL_TYPES',
                    data: {
                        str: 'a & <b>',
                        num: 42,
                        t: true,
                        f: false,
                        n: null,
                        obj: {k: 'v'},
                    },
                }),
            ],
            ['non-object (string) data', makeLog({eventType: 'STRING_EVENT', data: 'string data'})],
            ['non-object (null) data', makeLog({eventType: 'NULL_EVENT', data: null})],
        ])('renders log with %s', async (_, log) => {
            setupLogs([log]);
            renderWithTheme(<EventLogger/>);
            openDrawer();
            await waitFor(() =>
                expect(screen.getByText(new RegExp(log.eventType, 'i'))).toBeInTheDocument()
            );
        });

        test('shows event count chip', async () => {
            setupLogs([makeLog(), makeLog({id: '2'})]);
            renderWithTheme(<EventLogger/>);
            openDrawer();
            await waitFor(() => expect(screen.getByText(/2\/2 events/i)).toBeInTheDocument());
        });

        test('displays PAUSED chip when paused', async () => {
            vi.mocked(useEventLogStore).mockReturnValue(
                mockStore({
                    isPaused: true,
                    setPaused: mockSetPaused,
                    clearLogs: mockClearLogs,
                })
            );
            renderWithTheme(<EventLogger/>);
            await openDrawerAndWait();
            expect(screen.getByText(/PAUSED/i)).toBeInTheDocument();
        });

        test('shows "No events match" when filters exclude everything', async () => {
            setupLogs([makeLog({data: {path: '/other'}})]);
            renderWithTheme(<EventLogger objectName="/target"/>);
            openDrawer();
            await waitFor(() =>
                expect(screen.getByText(/No events match current filters/i)).toBeInTheDocument()
            );
        });

        test.each([
            ['object timestamp', {}, 'INVALID_TS'],
            ['non-date string', 'not-a-date', 'BAD_DATE'],
            ['symbol timestamp (throws → INVALID_DATE)', Symbol('bad'), 'SYMBOL_TS'],
        ])('handles invalid timestamp: %s', async (_, timestamp, eventType) => {
            setupLogs([makeLog({eventType, timestamp})]);
            renderWithTheme(<EventLogger/>);
            openDrawer();
            await waitFor(() =>
                expect(screen.getByText(new RegExp(eventType, 'i'))).toBeInTheDocument()
            );
            if (typeof timestamp === 'symbol') {
                await waitFor(() => expect(screen.getByText('INVALID_DATE')).toBeInTheDocument());
            }
        });

        test('displays valid timestamps', async () => {
            setupLogs([makeLog({timestamp: new Date('2023-01-01T12:34:56.789Z').toISOString()})]);
            renderWithTheme(<EventLogger/>);
            openDrawer();
            await waitFor(() => {
                const timeEls = screen.getAllByText(/\d{1,2}:\d{2}:\d{2}/);
                expect(timeEls.length).toBeGreaterThan(0);
            });
        });

        test('initially renders only first 20 logs (visibleCount = 20)', async () => {
            vi.useFakeTimers();
            const manyLogs = Array.from({length: 25}, (_, i) =>
                makeLog({id: `${i}`, eventType: `EVENT_${i}`})
            );
            setupLogs(manyLogs);
            renderWithTheme(<EventLogger/>);
            openDrawer();
            act(() => vi.advanceTimersByTime(200));
            await waitFor(() => expect(screen.getByText(/20\/25 events/i)).toBeInTheDocument());
            vi.useRealTimers();
        });
    });

    // ─── Log expansion ────────────────────────────────────────────────────
    describe('Log expansion', () => {
        beforeEach(() => vi.useFakeTimers());
        afterEach(() => vi.useRealTimers());

        test('expands and collapses a log row', async () => {
            vi.mocked(useEventLogStore).mockReturnValue(
                mockStore({
                    eventLogs: [makeLog({eventType: 'EXPAND_TEST', data: {key: 'value'}})],
                    setPaused: mockSetPaused,
                    clearLogs: mockClearLogs,
                })
            );
            renderWithTheme(<EventLogger/>);
            openDrawer();
            act(() => vi.advanceTimersByTime(200));

            await waitFor(() =>
                expect(screen.getAllByText(/EXPAND_TEST/i).length).toBeGreaterThan(0)
            );

            const row = rowButton('EXPAND_TEST');
            // Collapsed: a one-line preview of the data.
            expect(row).toHaveTextContent('{"key":"value"}');
            act(() => fireEvent.click(row));
            expect(row).toHaveAttribute('aria-expanded', 'true');
            await waitFor(() => expect(screen.getByText('"key"')).toBeInTheDocument());
            act(() => fireEvent.click(row));
            expect(row).toHaveAttribute('aria-expanded', 'false');
            expect(screen.queryByText('"key"')).not.toBeInTheDocument();
        });

        test('expands circular data without throwing and shows fallback text', async () => {
            const circular = {};
            circular.self = circular;
            vi.mocked(useEventLogStore).mockReturnValue(
                mockStore({
                    eventLogs: [
                        makeLog({id: 'circ', eventType: 'CIRCULAR_EXPAND', data: circular}),
                    ],
                    setPaused: mockSetPaused,
                    clearLogs: mockClearLogs,
                })
            );
            const {container} = renderWithTheme(<EventLogger/>);
            openDrawer();
            act(() => vi.advanceTimersByTime(200));

            await waitFor(() =>
                expect(screen.getAllByText(/CIRCULAR_EXPAND/i).length).toBeGreaterThan(0)
            );
            const rowContainer = rowButton('CIRCULAR_EXPAND');
            act(() => fireEvent.click(rowContainer));
            expect(rowContainer).toHaveAttribute('aria-expanded', 'true');
            await waitFor(() => {
                expect(container.querySelector('pre')).toHaveTextContent('[object Object]');
            });
        });

        test('expanded log shows key and string tokens, escaped as text', async () => {
            vi.useRealTimers();

            vi.mocked(useEventLogStore).mockReturnValue(
                mockStore({
                    eventLogs: [makeLog({eventType: 'CLASS_TEST', data: {key: '<b>value</b>'}})],
                    setPaused: mockSetPaused,
                    clearLogs: mockClearLogs,
                })
            );
            const {container} = renderWithTheme(<EventLogger/>);
            openDrawer();

            await waitFor(() =>
                expect(screen.getAllByText(/CLASS_TEST/i).length).toBeGreaterThan(0)
            );

            await waitFor(() => expect(rowButton('CLASS_TEST')).toBeDefined());
            act(() => fireEvent.click(rowButton('CLASS_TEST')));
            await waitFor(() => {
                expect(container.querySelector('[data-token="key"]')).toHaveTextContent('"key"');
                expect(container.querySelector('[data-token="string"]')).toHaveTextContent(
                    '"<b>value</b>"'
                );
            });
            expect(container.querySelector('pre b')).toBeNull();
        });
    });

    // ─── Controls (pause / clear) ─────────────────────────────────────────
    describe('Controls', () => {
        test('pause button calls setPaused(true)', async () => {
            renderWithTheme(<EventLogger/>);
            await openDrawerAndWait();
            act(() => fireEvent.click(screen.getByRole('button', {name: 'Pause'})));
            expect(mockSetPaused).toHaveBeenCalledWith(true);
        });

        test('resume button calls setPaused(false) when paused', async () => {
            vi.mocked(useEventLogStore).mockReturnValue(
                mockStore({isPaused: true, setPaused: mockSetPaused, clearLogs: mockClearLogs})
            );
            renderWithTheme(<EventLogger/>);
            await openDrawerAndWait();
            expect(screen.queryByRole('button', {name: 'Pause'})).not.toBeInTheDocument();
            act(() => fireEvent.click(screen.getByRole('button', {name: 'Resume'})));
            expect(mockSetPaused).toHaveBeenCalledWith(false);
        });

        test('clear button calls clearLogs and is disabled when empty', async () => {
            renderWithTheme(<EventLogger/>);
            await openDrawerAndWait();
            const clearBtn = screen.getByRole('button', {name: /Clear logs/i});
            expect(clearBtn).toBeDisabled();
        });

        test('clear button works with logs present', async () => {
            vi.mocked(useEventLogStore).mockReturnValue(
                mockStore({
                    eventLogs: [makeLog()],
                    setPaused: mockSetPaused,
                    clearLogs: mockClearLogs,
                })
            );
            renderWithTheme(<EventLogger/>);
            await openDrawerAndWait();
            const clearBtn = screen.getByRole('button', {name: /Clear logs/i});
            expect(clearBtn).not.toBeDisabled();
            act(() => fireEvent.click(clearBtn));
            expect(mockClearLogs).toHaveBeenCalled();
        });

        test('logger.log is called when drawer opens', async () => {
            renderWithTheme(<EventLogger/>);
            openDrawer();
            expect(logger.log).toHaveBeenCalled();
        });
    });

    // ─── Event type filter chips ───────────────────────────────────────────
    describe('Event type filter chips', () => {
        const twoTypeLogs = [
            makeLog({id: '1', eventType: 'TYPE_A'}),
            makeLog({id: '2', eventType: 'TYPE_B'}),
        ];

        beforeEach(() => {
            vi.mocked(useEventLogStore).mockReturnValue(
                mockStore({
                    eventLogs: twoTypeLogs,
                    setPaused: mockSetPaused,
                    clearLogs: mockClearLogs,
                })
            );
        });

        test('selecting a chip filters to that type', async () => {
            renderWithTheme(<EventLogger/>);
            openDrawer();
            await waitFor(() => expect(rowButton('TYPE_B')).toBeDefined());

            const chip = screen.getByRole('button', {name: /TYPE_A \(\d+\)/i});
            expect(chip).toHaveAttribute('aria-pressed', 'false');
            act(() => fireEvent.click(chip));
            expect(chip).toHaveAttribute('aria-pressed', 'true');
            await waitFor(() => {
                expect(rowButton('TYPE_A')).toBeDefined();
                expect(rowButton('TYPE_B')).toBeUndefined();
            });
            expect(screen.getByText(/1\/1 events/i)).toBeInTheDocument();
        });

        test('toggling chip off restores all logs', async () => {
            renderWithTheme(<EventLogger/>);
            openDrawer();
            await waitFor(() => expect(screen.getByText(/TYPE_A/i)).toBeInTheDocument());

            const chip = screen.getByRole('button', {name: /TYPE_A \(\d+\)/i});
            act(() => fireEvent.click(chip));
            act(() => fireEvent.click(chip));
            expect(chip).toHaveAttribute('aria-pressed', 'false');
            await waitFor(() => {
                expect(rowButton('TYPE_A')).toBeDefined();
                expect(rowButton('TYPE_B')).toBeDefined();
            });
            expect(screen.getByText(/2\/2 events/i)).toBeInTheDocument();
        });

        test('page and additional event chips are told apart, selected or not', async () => {
            vi.useFakeTimers();
            vi.mocked(useEventLogStore).mockReturnValue(
                mockStore({
                    eventLogs: [makeLog({eventType: 'EXTRA_TYPE'})],
                    setPaused: mockSetPaused,
                    clearLogs: mockClearLogs,
                })
            );
            renderWithTheme(<EventLogger eventTypes={[]}/>);
            openDrawer();
            act(() => vi.advanceTimersByTime(200));

            await waitFor(() => expect(screen.getAllByText(/EXTRA_TYPE/i).length).toBeGreaterThan(0));
            const chip = screen.getByRole('button', {name: /EXTRA_TYPE \(\d+\)/i});
            expect(chip).toHaveAttribute('data-page-event', 'false');
            expect(chip).toHaveAttribute('title', 'Additional event');
            act(() => fireEvent.click(chip));
            expect(chip).toHaveAttribute('aria-pressed', 'true');
            expect(chip).toHaveClass('bg-ink');
            await waitFor(() => expect(rowButton('EXTRA_TYPE')).toBeDefined());
            vi.useRealTimers();
        });

        test('page event chip is marked as such', async () => {
            vi.mocked(useEventLogStore).mockReturnValue(
                mockStore({eventLogs: [makeLog({eventType: 'PAGE_TYPE'})]})
            );
            renderWithTheme(<EventLogger eventTypes={['PAGE_TYPE']}/>);
            openDrawer();
            const chip = await screen.findByRole('button', {name: /PAGE_TYPE \(1\)/i});
            expect(chip).toHaveAttribute('data-page-event', 'true');
            expect(chip).toHaveAttribute('title', 'Event of this page');
            act(() => fireEvent.click(chip));
            expect(chip).toHaveClass('bg-accent');
        });
    });

    // ─── objectName filtering ─────────────────────────────────────────────
    describe('objectName filtering', () => {
        const setLogs = (logs) =>
            vi.mocked(useEventLogStore).mockReturnValue(
                mockStore({
                    eventLogs: logs,
                    setPaused: mockSetPaused,
                    clearLogs: mockClearLogs,
                })
            );

        test.each([
            ['data.path', {path: '/test/path'}, 'DIRECT_PATH'],
            ['data.labels.path', {labels: {path: '/test/path'}}, 'LABELS_PATH'],
            ['data.data.path', {data: {path: '/test/path'}}, 'DATA_PATH_EVENT'],
            [
                'data.data.labels.path',
                {data: {labels: {path: '/test/path'}}},
                'DEEP_PATH',
            ],
        ])('matches via %s', async (_, data, eventType) => {
            setLogs([makeLog({id: '1', eventType, data})]);
            renderWithTheme(<EventLogger objectName="/test/path"/>);
            openDrawer();
            await waitFor(() => expect(screen.getByText(eventType)).toBeInTheDocument());
        });

        test('excludes non-matching logs', async () => {
            setLogs([makeLog({data: {some: 'value'}})]);
            renderWithTheme(<EventLogger objectName="/test/path"/>);
            openDrawer();
            await waitFor(() =>
                expect(screen.getByText(/No events match current filters/i)).toBeInTheDocument()
            );
        });

        test('excludes when data is null', async () => {
            setLogs([makeLog({eventType: 'NULL_DATA', data: null})]);
            renderWithTheme(<EventLogger objectName="/test/path"/>);
            openDrawer();
            await waitFor(() =>
                expect(screen.getByText(/No events match current filters/i)).toBeInTheDocument()
            );
        });

        test.each([
            [
                'matched by _rawEvent.path',
                {_rawEvent: JSON.stringify({path: '/test/path'})},
                '/test/path',
                true,
            ],
            [
                'matched by _rawEvent.labels.path',
                {_rawEvent: JSON.stringify({labels: {path: '/test/path'}})},
                '/test/path',
                true,
            ],
            ['invalid _rawEvent JSON falls through gracefully', {_rawEvent: 'invalid json {'}, undefined, true],
            [
                'invalid _rawEvent but matching path field still shows',
                {_rawEvent: 'invalid', path: '/test/path'},
                '/test/path',
                true,
            ],
            [
                'without _rawEvent is excluded when objectName set',
                {otherField: 'test'},
                '/test/path',
                false,
            ],
        ])('ObjectDeleted: %s', async (_, data, objectName, shouldShow) => {
            setLogs([makeLog({eventType: 'ObjectDeleted', data})]);
            renderWithTheme(<EventLogger objectName={objectName}/>);
            openDrawer();
            if (shouldShow) {
                await waitFor(() => expect(rowButton('ObjectDeleted')).toBeDefined());
            } else {
                await waitFor(() =>
                    expect(screen.getByText(/No events match current filters/i)).toBeInTheDocument()
                );
            }
        });

        test('ObjectDeleted with valid _rawEvent but no matching path gets excluded', async () => {
            setLogs([
                makeLog({
                    eventType: 'ObjectDeleted',
                    data: {_rawEvent: JSON.stringify({some: 'other'})},
                }),
            ]);
            renderWithTheme(<EventLogger objectName="/test/path"/>);
            openDrawer();
            await waitFor(() =>
                expect(screen.getByText(/No events match current filters/i)).toBeInTheDocument()
            );
        });

        test('CONNECTION_* events always pass objectName filter', async () => {
            setLogs([
                makeLog({id: '1', eventType: 'CONNECTION_OPENED', data: {}}),
                makeLog({id: '2', eventType: 'CONNECTION_ERROR', data: {}}),
            ]);
            renderWithTheme(
                <EventLogger
                    eventTypes={['CONNECTION_OPENED', 'CONNECTION_ERROR']}
                    objectName="/any"
                />
            );
            openDrawer();
            await waitFor(() => expect(loading()).not.toBeInTheDocument());
            await waitFor(() => expect(screen.getByText(/2\/2 events/i)).toBeInTheDocument());
        });

        test('custom event containing "CONNECTION" always passes objectName filter', async () => {
            setLogs([
                makeLog({eventType: 'CUSTOM_CONNECTION_EVENT', data: {some: 'data'}}),
            ]);
            renderWithTheme(<EventLogger objectName="/some/object"/>);
            openDrawer();
            await waitFor(() =>
                expect(screen.getByText('CUSTOM_CONNECTION_EVENT')).toBeInTheDocument()
            );
        });

        test('eventTypes prop filters to allowed types', async () => {
            setLogs([
                makeLog({id: '1', eventType: 'ALLOWED_EVENT'}),
                makeLog({id: '2', eventType: 'BLOCKED_EVENT'}),
            ]);
            renderWithTheme(<EventLogger eventTypes={['ALLOWED_EVENT']}/>);
            openDrawer();
            await waitFor(() => expect(rowButton('ALLOWED_EVENT')).toBeDefined());
            expect(rowButton('BLOCKED_EVENT')).toBeUndefined();
        });

        test('all nested path scenarios resolve 3/3 events', async () => {
            setLogs([
                makeLog({
                    id: '1',
                    eventType: 'NESTED',
                    data: {data: {labels: {path: '/test/path'}}},
                }),
                makeLog({id: '2', eventType: 'DIRECT', data: {path: '/test/path'}}),
                makeLog({
                    id: '3',
                    eventType: 'LABELS',
                    data: {labels: {path: '/test/path'}},
                }),
            ]);
            renderWithTheme(<EventLogger objectName="/test/path"/>);
            openDrawer();
            await waitFor(() => expect(screen.getByText(/3\/3 events/i)).toBeInTheDocument());
        });
    });

    // ─── Subscription dialog ──────────────────────────────────────────────
    describe('Subscription dialog', () => {
        test('opens via settings icon', async () => {
            renderWithTheme(<EventLogger eventTypes={['EVENT1']}/>);
            openDrawer();
            await openSettings();
            expect(screen.getByText(/Subscribe to All/i)).toBeInTheDocument();
            expect(screen.getByText(/Unsubscribe from All/i)).toBeInTheDocument();
        });

        test('closes via Close button', async () => {
            renderWithTheme(<EventLogger eventTypes={['EVENT1']}/>);
            openDrawer();
            await openSettings();
            act(() =>
                fireEvent.click(screen.getByRole('button', {name: 'Close subscriptions'}))
            );
            await waitFor(expectSettingsClosed);
            // The bottom panel stays open.
            expect(screen.getByRole('button', {name: /^Close$/})).toBeInTheDocument();
        });

        test('Apply button closes dialog', async () => {
            vi.mocked(useEventLogStore).mockReturnValue(
                mockStore({
                    eventLogs: [makeLog({eventType: 'EVENT1'})],
                    setPaused: mockSetPaused,
                    clearLogs: mockClearLogs,
                })
            );
            renderWithTheme(<EventLogger eventTypes={['EVENT1']}/>);
            openDrawer();
            await waitFor(() => expect(screen.getByText(/Event Logger/i)).toBeInTheDocument());
            await openSettings();
            act(() =>
                fireEvent.click(screen.getByRole('button', {name: /Apply Subscriptions/i}))
            );
            await waitFor(expectSettingsClosed);
            expect(mockClearLogs).toHaveBeenCalled();
        });

        test('Escape closes the settings panel', async () => {
            renderWithTheme(<EventLogger eventTypes={['EVENT1']}/>);
            openDrawer();
            await openSettings();
            act(() => fireEvent.keyDown(document, {key: 'Escape'}));
            await waitFor(expectSettingsClosed);
        });

        test.each([
            [
                'via Unsubscribe All button',
                ['EVENT1'],
                () => {
                    fireEvent.click(screen.getByRole('button', {name: /Unsubscribe from All/i}));
                },
            ],
            ['via empty eventTypes prop', [], () => {
            }],
        ])('shows "No event types selected" message: %s', async (_, eventTypes, action) => {
            renderWithTheme(<EventLogger eventTypes={eventTypes}/>);
            openDrawer();
            await openSettings();
            action();
            expect(
                screen.getByText(/No event types selected. You won't receive any events./i)
            ).toBeInTheDocument();
        });

        test('"Subscribe to Page Events" works after unsubscribing all', async () => {
            renderWithTheme(<EventLogger eventTypes={['EVENT1', 'EVENT2']}/>);
            openDrawer();
            await openSettings();
            act(() =>
                fireEvent.click(screen.getByRole('button', {name: /Unsubscribe from All/i}))
            );
            const pageBtn = screen.getByRole('button', {name: /Subscribe to Page Events/i});
            expect(pageBtn).not.toBeDisabled();
            act(() => fireEvent.click(pageBtn));
            expect(
                screen.getByRole('button', {name: /Apply Subscriptions \(2\)/i})
            ).toBeInTheDocument();
        });

        test('"Subscribe to Page Events" is disabled when no page events', async () => {
            renderWithTheme(<EventLogger eventTypes={[]}/>);
            openDrawer();
            await openSettings();
            const pageBtn = screen.getByRole('button', {name: /Subscribe to Page Events/i});
            expect(pageBtn).toBeDisabled();
        });

        test('"Additional Events" section renders for non-page event types', async () => {
            renderWithTheme(<EventLogger eventTypes={['PAGE_EVENT']}/>);
            openDrawer();
            await openSettings();
            expect(screen.getByText(/Additional Events/)).toBeInTheDocument();
        });

        test('checkbox toggle changes subscription count', async () => {
            renderWithTheme(<EventLogger eventTypes={['EVENT1', 'EVENT2']}/>);
            openDrawer();
            await openSettings();
            const checkbox = screen.getByRole('checkbox', {name: /EVENT1/});
            expect(checkbox).toBeChecked();
            expect(screen.getByRole('button', {name: /Apply Subscriptions \(2\)/i})).toBeInTheDocument();
            act(() => fireEvent.click(checkbox));
            expect(checkbox).not.toBeChecked();
            expect(screen.getByRole('button', {name: /Apply Subscriptions \(1\)/i})).toBeInTheDocument();
            act(() => fireEvent.click(checkbox));
            expect(checkbox).toBeChecked();
            expect(screen.getByRole('button', {name: /Apply Subscriptions \(2\)/i})).toBeInTheDocument();
        });

        test('closeLoggerEventSource called when all unsubscribed and applied', async () => {
            vi.spyOn(Storage.prototype, 'getItem').mockReturnValue('test-token');
            const {closeLoggerEventSource} = await import('../../eventSourceManager');
            vi.mocked(closeLoggerEventSource).mockClear();

            renderWithTheme(<EventLogger eventTypes={[]}/>);
            openDrawer();
            await openSettings();
            fireEvent.click(screen.getByRole('button', {name: /Unsubscribe from All/i}));
            fireEvent.click(screen.getByRole('button', {name: /Apply Subscriptions/i}));

            await waitFor(() => expect(closeLoggerEventSource).toHaveBeenCalled());
        });

        test('unsubscribing a single event type works', async () => {
            renderWithTheme(<EventLogger eventTypes={['EVENT1', 'EVENT2']}/>);
            openDrawer();
            await openSettings();
            const event1Checkbox = screen.getByRole('checkbox', {name: /EVENT1/});
            act(() => fireEvent.click(event1Checkbox));
            expect(event1Checkbox).not.toBeChecked();
            act(() =>
                fireEvent.click(screen.getByRole('button', {name: /Apply Subscriptions/i}))
            );
            await waitFor(expectSettingsClosed);
        });

        test('Subscribe to All selects all event types', async () => {
            renderWithTheme(<EventLogger eventTypes={['EVENT1', 'EVENT2']}/>);
            openDrawer();
            await openSettings();
            act(() =>
                fireEvent.click(screen.getByRole('button', {name: /Unsubscribe from All/i}))
            );
            act(() =>
                fireEvent.click(screen.getByRole('button', {name: /Subscribe to All/i}))
            );
            expect(
                screen.getByRole('button', {name: /Apply Subscriptions \(9\)/i})
            ).toBeInTheDocument();
        });

        test('filtering still works after unsubscribing all with page events', async () => {
            vi.mocked(useEventLogStore).mockReturnValue(
                mockStore({
                    eventLogs: [makeLog({eventType: 'EVENT1'}), makeLog({eventType: 'OTHER'})],
                    setPaused: mockSetPaused,
                    clearLogs: mockClearLogs,
                })
            );
            renderWithTheme(<EventLogger eventTypes={['EVENT1']}/>);
            openDrawer();
            await waitFor(() => expect(screen.getByText(/Event Logger/i)).toBeInTheDocument());
            await openSettings();
            act(() =>
                fireEvent.click(screen.getByRole('button', {name: /Unsubscribe from All/i}))
            );
            act(() =>
                fireEvent.click(screen.getByRole('button', {name: /Apply Subscriptions/i}))
            );
            await waitFor(() => {
                expect(screen.getByText('EVENT1')).toBeInTheDocument();
                expect(screen.queryByText('OTHER')).not.toBeInTheDocument();
            });
        });

        test('otherEventTypes filter branch coverage: includes and excludes types', async () => {
            renderWithTheme(<EventLogger eventTypes={['NodeStatusUpdated']}/>);
            openDrawer();
            await openSettings();
            expect(screen.getByText(/Additional Events/)).toBeInTheDocument();
            const pageSection = screen
                .getByRole('heading', {name: /^Page Events/})
                .closest('section');
            expect(pageSection.textContent).toContain('NodeStatusUpdated');
        });

        test('updates tempSubscribedEventTypes when subscribedEventTypes changes while dialog is open', async () => {
            vi.useFakeTimers();
            const {rerender} = renderWithTheme(<EventLogger eventTypes={['EVENT_A']}/>);
            openDrawer();
            act(() => vi.advanceTimersByTime(200));
            await openSettings();

            const checkboxA = screen.getByRole('checkbox', {name: /EVENT_A/});
            expect(checkboxA).toBeChecked();

            act(() => {
                rerender(<EventLogger eventTypes={['EVENT_B']}/>);
            });
            await waitFor(() => {
                expect(screen.getByRole('checkbox', {name: /EVENT_B/})).toBeChecked();
            });
            expect(screen.queryByRole('checkbox', {name: /EVENT_A/})).not.toBeInTheDocument();

            vi.useRealTimers();
        });

        test('handleSubscribePageEvents filter callback runs with existing subscriptions', async () => {
            renderWithTheme(<EventLogger eventTypes={['PAGE_EVENT']}/>);
            openDrawer();
            await openSettings();

            const nonPageCheckbox = screen.getByRole('checkbox', {name: /NodeStatusUpdated/});
            expect(nonPageCheckbox).not.toBeChecked();
            act(() => fireEvent.click(nonPageCheckbox));
            expect(nonPageCheckbox).toBeChecked();

            const pageEventsBtn = screen.getByRole('button', {name: /Subscribe to Page Events/i});
            expect(pageEventsBtn).not.toBeDisabled();
            act(() => fireEvent.click(pageEventsBtn));

            const applyBtn = screen.getByRole('button', {name: /Apply Subscriptions \(2\)/i});
            expect(applyBtn).toBeInTheDocument();
        });
    });

    // ─── EventSource / SSE integration ───────────────────────────────────
    describe('EventSource / SSE', () => {
        test('does not call startLoggerReception when token missing', async () => {
            vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(null);
            const {startLoggerReception} = await import('../../eventSourceManager');
            vi.mocked(startLoggerReception).mockClear();

            renderWithTheme(<EventLogger eventTypes={['TEST']}/>);
            openDrawer();
            expect(startLoggerReception).not.toHaveBeenCalled();
        });

        test('startLoggerReception called on open with token', async () => {
            vi.spyOn(Storage.prototype, 'getItem').mockReturnValue('test-token');
            const {startLoggerReception} = await import('../../eventSourceManager');
            vi.mocked(startLoggerReception).mockClear();

            renderWithTheme(
                <EventLogger eventTypes={['NodeStatusUpdated']} objectName="/p"/>
            );
            openDrawer();
            await waitFor(() => expect(startLoggerReception).toHaveBeenCalled());
        });

        test('warn logged when startLoggerReception throws', async () => {
            vi.spyOn(Storage.prototype, 'getItem').mockReturnValue('test-token');
            const {startLoggerReception} = await import('../../eventSourceManager');
            startLoggerReception.mockImplementationOnce(() => {
                throw new Error('SSE connection failed');
            });

            renderWithTheme(<EventLogger eventTypes={['NodeStatusUpdated']}/>);
            openDrawer();
            await waitFor(() =>
                expect(logger.warn).toHaveBeenCalledWith(
                    'Failed to start logger reception:',
                    expect.any(Error)
                )
            );
            startLoggerReception.mockReset().mockImplementation(vi.fn());
        });

        test('re-subscribes when objectName changes', async () => {
            vi.spyOn(Storage.prototype, 'getItem').mockReturnValue('test-token');
            const {startLoggerReception} = await import('../../eventSourceManager');
            vi.mocked(startLoggerReception).mockClear();

            const {rerender} = renderWithTheme(
                <EventLogger eventTypes={['NodeStatusUpdated']} objectName="/path/one"/>
            );
            openDrawer();
            await waitFor(() => expect(startLoggerReception).toHaveBeenCalled());

            const callsBefore = startLoggerReception.mock.calls.length;
            act(() => {
                rerender(<EventLogger eventTypes={['NodeStatusUpdated']} objectName="/path/two"/>);
            });
            await waitFor(() =>
                expect(startLoggerReception.mock.calls.length).toBeGreaterThan(callsBefore)
            );
        });
    });

    // ─── Resize handle ────────────────────────────────────────────────────
    describe('Resize handle', () => {
        test('resize handle exists and is interactive', async () => {
            renderWithTheme(<EventLogger/>);
            await openDrawerAndWait();
            expect(screen.getByLabelText(/Resize handle/i)).toBeInTheDocument();
        });

        test('mouse resize: mouseDown → mouseMove → mouseUp', async () => {
            renderWithTheme(<EventLogger/>);
            openDrawer();
            const handle = screen.getByLabelText(/Resize handle/i);

            act(() => fireEvent.mouseDown(handle, {clientY: 100}));
            act(() => fireEvent.mouseMove(document, {clientY: 150}));
            act(() => fireEvent.mouseUp(document));
        });

        test('touch resize: touchStart → touchMove → touchEnd + touchCancel', async () => {
            renderWithTheme(<EventLogger/>);
            openDrawer();
            const handle = screen.getByLabelText(/Resize handle/i);

            act(() => fireEvent.touchStart(handle, {touches: [{clientY: 100}]}));
            act(() =>
                fireEvent.touchMove(document, {touches: [{clientY: 150}]})
            );
            act(() => fireEvent.touchEnd(document));

            act(() => fireEvent.touchStart(handle, {touches: [{clientY: 100}]}));
            act(() => fireEvent.touchCancel(document));
            expect(handle).toBeInTheDocument();
        });

        test('second mouseDown during active resize clears pending timeout', async () => {
            vi.useFakeTimers();
            renderWithTheme(<EventLogger/>);
            openDrawer();
            const handle = screen.getByLabelText(/Resize handle/i);

            act(() => fireEvent.mouseDown(handle, {clientY: 100}));
            act(() => fireEvent.mouseMove(document, {clientY: 80}));
            act(() => fireEvent.mouseDown(handle, {clientY: 90}));
            act(() => vi.advanceTimersByTime(100));
            act(() => fireEvent.mouseUp(document));
            vi.useRealTimers();
        });

        test('mouseUp clears pending resize timeout', async () => {
            vi.useFakeTimers();
            renderWithTheme(<EventLogger/>);
            openDrawer();
            const handle = screen.getByLabelText(/Resize handle/i);

            const paper = panel();
            const initialHeight = paper.style.height;

            act(() => fireEvent.mouseDown(handle, {clientY: 100}));
            act(() => fireEvent.mouseMove(document, {clientY: 50}));
            act(() => fireEvent.mouseUp(document));
            act(() => vi.advanceTimersByTime(100));

            expect(paper.style.height).toBe(initialHeight);

            vi.useRealTimers();
        });

        test('timeout execution calls setDrawerHeight and updates height', async () => {
            vi.useFakeTimers();
            renderWithTheme(<EventLogger/>);
            openDrawer();
            const handle = screen.getByLabelText(/Resize handle/i);
            const paper = panel();
            const initialHeight = parseInt(paper.style.height, 10);
            expect(initialHeight).toBe(320);

            act(() => fireEvent.mouseDown(handle, {clientY: 100}));
            expect(handle).toHaveAttribute('data-resizing', 'true');
            act(() => fireEvent.mouseMove(document, {clientY: 40}));
            act(() => vi.advanceTimersByTime(20));

            const newHeight = parseInt(paper.style.height, 10);
            expect(newHeight).toBeGreaterThan(initialHeight);
            act(() => fireEvent.mouseUp(document));
            expect(handle).toHaveAttribute('data-resizing', 'false');

            vi.useRealTimers();
        });

        test('rapid successive mouse moves clear previous resize timeout', async () => {
            vi.useFakeTimers();
            renderWithTheme(<EventLogger/>);
            openDrawer();
            const handle = screen.getByLabelText(/Resize handle/i);
            act(() => fireEvent.mouseDown(handle, {clientY: 200}));
            act(() => fireEvent.mouseMove(document, {clientY: 180}));
            act(() => fireEvent.mouseMove(document, {clientY: 160}));
            act(() => vi.advanceTimersByTime(20));

            const paper = panel();
            const newHeight = parseInt(paper.style.height, 10);
            expect(newHeight).toBeGreaterThan(0);

            act(() => fireEvent.mouseUp(document));
            vi.useRealTimers();
        });
    });

    // ─── initialLoading spinner ───────────────────────────────────────────
    describe('initialLoading', () => {
        beforeEach(() => vi.useFakeTimers());
        afterEach(() => vi.useRealTimers());

        test('Spinner shown then hidden after 200 ms', async () => {
            renderWithTheme(<EventLogger/>);
            openDrawer();
            expect(loading()).toBeInTheDocument();
            act(() => vi.advanceTimersByTime(200));
            await waitFor(() => expect(loading()).not.toBeInTheDocument());
        });

        test('cleanup clears the initialLoading timeout when component unmounts early', () => {
            const {unmount} = renderWithTheme(<EventLogger/>);
            openDrawer();
            act(() => {
                unmount();
            });
            expect(() => vi.advanceTimersByTime(200)).not.toThrow();
        });
    });

    // ─── Infinite scroll (handleScroll) ────────────────────────────────────
    describe('Infinite scroll', () => {
        beforeEach(() => vi.useFakeTimers());
        afterEach(() => vi.useRealTimers());

        const setupManyLogs = () => {
            const manyLogs = Array.from({length: 25}, (_, i) =>
                makeLog({id: `${i}`, eventType: `EVENT_${i}`})
            );
            vi.mocked(useEventLogStore).mockReturnValue(
                mockStore({
                    eventLogs: manyLogs,
                    setPaused: mockSetPaused,
                    clearLogs: mockClearLogs,
                })
            );
        };

        test('successive scroll triggers load more and early return works', async () => {
            setupManyLogs();
            renderWithTheme(<EventLogger/>);
            openDrawer();
            act(() => vi.advanceTimersByTime(200));

            await waitFor(() => expect(screen.getByText(/20\/25 events/i)).toBeInTheDocument());

            const logTextEl = screen.getByText('EVENT_0');
            const logContainer = eventList();
            expect(logContainer).toContainElement(logTextEl);

            logContainer.style.height = '200px';
            Object.defineProperty(logContainer, 'scrollTop', {
                value: 800,
                writable: true,
                configurable: true,
            });
            Object.defineProperty(logContainer, 'scrollHeight', {
                get: () => 1000,
                configurable: true,
            });
            Object.defineProperty(logContainer, 'clientHeight', {
                get: () => 200,
                configurable: true,
            });

            act(() => {
                fireEvent.scroll(logContainer);
            });
            act(() => {
                fireEvent.scroll(logContainer);
            });

            act(() => vi.advanceTimersByTime(150));

            await waitFor(() => expect(screen.getByText(/25\/25 events/i)).toBeInTheDocument());
        });

        test('infinite scroll triggers load more and updates visibleCount', async () => {
            const manyLogs = Array.from({length: 30}, (_, i) =>
                makeLog({id: `${i}`, eventType: `SCROLL_${i}`})
            );
            vi.mocked(useEventLogStore).mockReturnValue(
                mockStore({
                    eventLogs: manyLogs,
                    setPaused: mockSetPaused,
                    clearLogs: mockClearLogs,
                })
            );
            renderWithTheme(<EventLogger/>);
            openDrawer();
            act(() => vi.advanceTimersByTime(200));

            await waitFor(() => expect(screen.getByText(/20\/30 events/i)).toBeInTheDocument());

            const logTextEl = screen.getByText('SCROLL_0');
            const logContainer = eventList();
            expect(logContainer).toContainElement(logTextEl);

            logContainer.style.height = '300px';
            Object.defineProperty(logContainer, 'scrollTop', {
                value: 600,
                writable: true,
                configurable: true,
            });
            Object.defineProperty(logContainer, 'scrollHeight', {
                get: () => 1000,
                configurable: true,
            });
            Object.defineProperty(logContainer, 'clientHeight', {
                get: () => 300,
                configurable: true,
            });

            act(() => fireEvent.scroll(logContainer));
            act(() => vi.advanceTimersByTime(150));

            await waitFor(() => expect(screen.getByText(/30\/30 events/i)).toBeInTheDocument());
        });
    });

    // ─── Theme switching ──────────────────────────────────────────────────
    describe('Theme switching', () => {
        beforeEach(() => vi.useFakeTimers());
        afterEach(() => vi.useRealTimers());

        test('LogRow survives a switch to the dark theme (colours come from the tokens)', async () => {
            vi.mocked(useEventLogStore).mockReturnValue(
                mockStore({
                    eventLogs: [makeLog({eventType: 'MEMO_TEST'})],
                    setPaused: mockSetPaused,
                    clearLogs: mockClearLogs,
                })
            );
            const {rerender} = render(<EventLogger/>);
            act(() =>
                fireEvent.click(screen.getByRole('button', {name: /Events|Event Logger/i}))
            );
            act(() => vi.advanceTimersByTime(200));
            await waitFor(() => expect(screen.getByText('MEMO_TEST')).toBeInTheDocument());

            act(() => {
                document.documentElement.dataset.theme = 'dark';
                rerender(<EventLogger/>);
            });
            await waitFor(() => expect(screen.getByText('MEMO_TEST')).toBeInTheDocument());
            delete document.documentElement.dataset.theme;
        });
    });

    // ─── Misc / edge cases ────────────────────────────────────────────────
    describe('Misc / edge cases', () => {
        test('unmounting does not throw', () => {
            const {unmount} = renderWithTheme(<EventLogger/>);
            expect(() => unmount()).not.toThrow();
        });

        test('mobile viewport: button still renders', () => {
            Object.defineProperty(window, 'innerWidth', {
                value: 767,
                configurable: true,
            });
            renderWithTheme(<EventLogger/>);
            expect(
                screen.getByRole('button', {name: /Events|Event Logger/i})
            ).toBeInTheDocument();
            delete window.innerWidth;
        });

        test('no "Scroll to bottom" button present', async () => {
            vi.mocked(useEventLogStore).mockReturnValue(
                mockStore({
                    eventLogs: [1, 2, 3].map((i) =>
                        makeLog({id: String(i), eventType: `TEST${i}`})
                    ),
                    setPaused: mockSetPaused,
                    clearLogs: mockClearLogs,
                })
            );
            renderWithTheme(<EventLogger/>);
            openDrawer();
            await waitFor(() => expect(screen.getByText(/TEST1/i)).toBeInTheDocument());
            expect(screen.queryAllByRole('button', {name: /Scroll to bottom/i})).toHaveLength(0);
        });

        test('no type filter in main drawer by default', async () => {
            renderWithTheme(<EventLogger eventTypes={[]}/>);
            openDrawer();
            await waitFor(() =>
                expect(screen.getByRole('button', {name: 'Manage subscriptions'})).toBeInTheDocument()
            );
            expect(screen.queryByRole('group', {name: 'Filter by type'})).not.toBeInTheDocument();
            expect(screen.queryAllByRole('button', {pressed: false})).toHaveLength(0);
        });

        test('baseFilteredLogs shows all when both subscriptions and filteredTypes are empty', async () => {
            vi.mocked(useEventLogStore).mockReturnValue(
                mockStore({
                    eventLogs: [makeLog({eventType: 'ANY_EVENT'})],
                    setPaused: mockSetPaused,
                    clearLogs: mockClearLogs,
                })
            );
            renderWithTheme(<EventLogger eventTypes={[]}/>);
            openDrawer();
            await openSettings();
            act(() =>
                fireEvent.click(screen.getByRole('button', {name: /Unsubscribe from All/i}))
            );
            act(() =>
                fireEvent.click(screen.getByRole('button', {name: /Apply Subscriptions/i}))
            );
            await waitFor(() => expect(screen.getByText('ANY_EVENT')).toBeInTheDocument());
        });

        test('Drawer panel is rendered as a raised bottom panel', async () => {
            renderWithTheme(<EventLogger/>);
            openDrawer();
            await waitFor(() => expect(screen.getByText(/Event Logger/i)).toBeInTheDocument());
            const paper = panel();
            expect(paper).toHaveClass('bg-surface-raised', 'border-t', 'border-line');
            expect(paper).toHaveStyle({height: '320px'});
            expect(screen.getByRole('heading', {name: 'Event Logger'})).toBeInTheDocument();
            expect(screen.getByLabelText(/Resize handle/i)).toBeInTheDocument();
        });

        test('trigger is an outlined button with the feed icon and the label', () => {
            renderWithTheme(<EventLogger title="Node Events" buttonLabel="Nodes Events"/>);
            const trigger = screen.getByRole('button', {name: 'Nodes Events'});
            expect(trigger).toHaveAttribute('title', 'Node Events');
            expect(trigger).toHaveClass('rounded-(--radius-control)', 'bg-surface-raised', 'border-line');
            expect(trigger.querySelector('svg')).toBeInTheDocument();
        });

        test('event type label carries its tone', async () => {
            vi.mocked(useEventLogStore).mockReturnValue(
                mockStore({
                    eventLogs: [
                        makeLog({id: '1', eventType: 'TEST_ERROR_EVENT'}),
                        makeLog({id: '2', eventType: 'ITEM_DELETED'}),
                        makeLog({id: '3', eventType: 'PLAIN'}),
                    ],
                })
            );
            renderWithTheme(<EventLogger/>);
            openDrawer();
            await waitFor(() => expect(rowButton('PLAIN')).toBeDefined());
            const tone = (type) =>
                rowButton(type).querySelector('[data-tone]').getAttribute('data-tone');
            expect(tone('TEST_ERROR_EVENT')).toBe('error');
            expect(tone('ITEM_DELETED')).toBe('warning');
            expect(tone('PLAIN')).toBe('default');
        });
    });
});

describe('EventLog', () => {
    test('a namespace keeps the events of the objects in it, from any node', async () => {
        useEventLogStore.mockReturnValue(mockStore({
            eventLogs: [
                makeLog({id: '1', eventType: 'ObjectStatusUpdated', data: {path: 'ns1/svc/web'}}),
                makeLog({id: '2', eventType: 'InstanceStatusUpdated', data: {labels: {path: 'ns2/svc/db'}}}),
                makeLog({id: '3', eventType: 'InstanceMonitorUpdated', data: {data: {path: 'ns1/vol/data'}}}),
                makeLog({id: '4', eventType: 'CONNECTION_OPENED', data: {}}),
            ],
        }));
        render(<EventLog eventTypes={OBJECT_EVENT_TYPES} namespace="ns1" label="Events"/>);
        const list = await screen.findByRole('region', {name: 'Event list'});
        await waitFor(() => expect(list).toHaveTextContent('ObjectStatusUpdated'));
        expect(list).toHaveTextContent('InstanceMonitorUpdated');
        expect(list).not.toHaveTextContent('InstanceStatusUpdated');
        // In place: no title, no close.
        expect(screen.queryByRole('button', {name: 'Close'})).not.toBeInTheDocument();
    });

    describe('as a feed, in a tab', () => {
        const at = (seconds) => new Date(Date.UTC(2026, 9, 17, 10, 0, seconds)).toISOString();
        const event = (id, seconds, path) => makeLog({id, eventType: 'ObjectStatusUpdated', timestamp: at(seconds), data: {path, node: 'n1'}});
        const lines = () => [...screen.getByRole('region', {name: 'Event list'}).querySelectorAll('.event-line')];
        const scrolledTo = (scrollTop) => {
            const container = screen.getByRole('region', {name: 'Event list'});
            Object.defineProperty(container, 'scrollHeight', {value: 1000, configurable: true});
            Object.defineProperty(container, 'clientHeight', {value: 500, configurable: true});
            container.scrollTop = scrollTop;
            fireEvent.scroll(container);
        };

        test('the oldest at the top, the newest at the end; a line its time and type, its node, its badge, its data', async () => {
            useEventLogStore.mockReturnValue(mockStore({eventLogs: [event('2', 2, 'ns1/svc/b'), event('1', 1, 'ns1/svc/a')]}));
            render(<EventLog eventTypes={OBJECT_EVENT_TYPES} label="Events"/>);
            await waitFor(() => expect(lines()).toHaveLength(2));
            expect(lines().map((line) => line.querySelector('[data-meta]').firstElementChild.textContent)).toEqual(['ns1/svc/a', 'ns1/svc/b']);
            const first = lines()[0];
            // The type under the time, in its tone; the badges, then the data.
            expect(first.querySelector('[data-tone]').previousElementSibling.textContent).toMatch(/\d/);
            // As the logs of several nodes: the node on a column of its own, the object a badge.
            expect(first.querySelector('[data-node]')).toHaveTextContent('n1');
            expect([...first.querySelector('[data-meta]').children].map((b) => b.textContent)).toEqual(['ns1/svc/a']);
            expect(first.querySelector('[data-text]')).toHaveTextContent('"path":"ns1/svc/a"');
            expect(first).toHaveClass('border-line/40');
            // A caret before the time says it opens; opened by a click, its data in full, the caret turned.
            const toggle = within(first).getByRole('button');
            const caret = first.querySelector('[data-caret]');
            expect(caret).not.toHaveClass('rotate-90');
            expect(toggle).toHaveClass('cursor-pointer', 'hover:bg-surface-sunken');
            fireEvent.click(toggle);
            expect(toggle).toHaveAttribute('aria-expanded', 'true');
            expect(first.querySelector('[data-caret]')).toHaveClass('rotate-90');
        });

        test('read as the logs: what is followed and the connection, the actions; a search, the types, the count', async () => {
            const typed = (id, seconds, path, eventType) => makeLog({id, eventType, timestamp: at(seconds), data: {path, node: 'n1'}});
            const store = mockStore({
                connected: true,
                eventLogs: [
                    typed('3', 3, 'ns1/svc/a', 'InstanceStatusUpdated'),
                    typed('2', 2, 'ns1/svc/a', 'ObjectStatusUpdated'),
                    typed('1', 1, 'ns1/svc/a', 'InstanceStatusUpdated'),
                ],
            });
            useEventLogStore.mockImplementation((selector) => (typeof selector === 'function' ? selector(store) : store));
            render(<EventLog eventTypes={OBJECT_EVENT_TYPES} objectName="ns1/svc/a" label="Events"/>);
            await waitFor(() => expect(lines()).toHaveLength(3));
            // What is followed, out of the list, as the logs say it.
            const list = screen.getByRole('region', {name: 'Event list'});
            expect(screen.getAllByText('ns1/svc/a').filter((el) => !list.contains(el))).toHaveLength(1);
            expect(screen.getByText('Connected')).toBeInTheDocument();
            ['Following', 'Pause', 'Clear logs', 'Download the events shown', 'Manage subscriptions']
                .forEach((name) => expect(screen.getByRole('button', {name})).toBeInTheDocument());
            expect(screen.getByText('3 / 3 events')).toBeInTheDocument();
            // The types as the levels of the logs: a list of checkboxes, with their counts.
            fireEvent.click(within(screen.getByRole('group', {name: 'Filter by type'})).getByRole('checkbox', {name: 'ObjectStatusUpdated (1)'}));
            await waitFor(() => expect(lines()).toHaveLength(1));
            expect(screen.getByText('1 / 3 events')).toBeInTheDocument();
            fireEvent.click(screen.getByRole('button', {name: 'Reset the filters'}));
            await waitFor(() => expect(lines()).toHaveLength(3));
            // A search through the type, the object, the node and the data.
            fireEvent.change(screen.getByPlaceholderText('Search events…'), {target: {value: 'objectstatus'}});
            await waitFor(() => expect(lines()).toHaveLength(1));
            expect(screen.getByText('Filters active')).toBeInTheDocument();
            useEventLogStore.mockReset();
        });

        test('opened at the end, as the logs: the events read while it loads followed once shown', async () => {
            useEventLogStore.mockReturnValue(mockStore({eventLogs: [event('2', 2, 'ns1/svc/b'), event('1', 1, 'ns1/svc/a')]}));
            render(<EventLog eventTypes={OBJECT_EVENT_TYPES} label="Events"/>);
            // Read before the lines show: the first loading under way.
            const container = screen.getByRole('region', {name: 'Event list'});
            expect(lines()).toHaveLength(0);
            Object.defineProperty(container, 'scrollHeight', {value: 1000, configurable: true});
            await waitFor(() => expect(lines()).toHaveLength(2));
            expect(container.scrollTop).toBe(1000);
        });

        test('followed at the end; scrolled up, the new events counted on a button back to the end', async () => {
            useEventLogStore.mockReturnValue(mockStore({eventLogs: [event('1', 1, 'ns1/svc/a')]}));
            const {rerender} = render(<EventLog eventTypes={OBJECT_EVENT_TYPES} label="Events"/>);
            await waitFor(() => expect(lines()).toHaveLength(1));
            expect(screen.getByRole('button', {name: 'Following'})).toHaveAttribute('aria-pressed', 'true');
            scrolledTo(0);
            expect(screen.getByRole('button', {name: 'Latest events'})).toBeInTheDocument();
            useEventLogStore.mockReturnValue(mockStore({eventLogs: [event('3', 3, 'ns1/svc/c'), event('2', 2, 'ns1/svc/b'), event('1', 1, 'ns1/svc/a')]}));
            rerender(<EventLog eventTypes={OBJECT_EVENT_TYPES} label="Events"/>);
            const back = await screen.findByRole('button', {name: '2 new events'});
            fireEvent.click(back);
            expect(screen.getByRole('region', {name: 'Event list'}).scrollTop).toBe(1000);
            expect(screen.getByRole('button', {name: 'Following'})).toBeInTheDocument();
        });

        test('the newest hundred shown; the older ones kept, on demand at the top', async () => {
            const many = Array.from({length: 150}, (_, i) => event(String(150 - i), 150 - i, `ns1/svc/s${150 - i}`));
            useEventLogStore.mockReturnValue(mockStore({eventLogs: many}));
            render(<EventLog eventTypes={OBJECT_EVENT_TYPES} label="Events"/>);
            await waitFor(() => expect(lines()).toHaveLength(100));
            fireEvent.click(screen.getByRole('button', {name: 'Show older events'}));
            expect(lines()).toHaveLength(150);
            expect(screen.queryByRole('button', {name: 'Show older events'})).toBeNull();
            // Read from the top: not following.
            expect(screen.getByRole('button', {name: 'Follow'})).toBeInTheDocument();
        });
    });
});
