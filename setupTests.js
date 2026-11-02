import {vi, expect, afterEach} from 'vitest';
import {TextEncoder, TextDecoder} from 'util';
import '@testing-library/jest-dom';
// The webapp strings, in English: jsdom's navigator is en-US.
import './src/i18n';
import {clearEditDrafts} from './src/app/edit-drafts';
import * as matchers from 'vitest-axe';

expect.extend(matchers);

globalThis.jest = vi;

globalThis.jest.mocked = vi.mocked;   // ← pour jest.mocked()
globalThis.jest.setTimeout = (ms) => {
    vi.setConfig({testTimeout: ms});
};

global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// jsdom draws no canvas, and says so on stderr at each getContext: answered
// null, as a browser answers a context it does not offer, the terminal of a
// console (xterm) takes its way without canvas, silently.
HTMLCanvasElement.prototype.getContext = () => null;

const originalError = console.error;
const originalWarn = console.warn;

beforeAll(() => {
    console.error = vi.fn();
    console.warn = vi.fn();
});

afterAll(() => {
    console.error = originalError;
    console.warn = originalWarn;
});

beforeEach(() => {
    vi.clearAllMocks();
});

// The edits the configuration editors keep while the page lives: none from one test to the next.
afterEach(() => clearEditDrafts());
