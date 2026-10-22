import {vi, expect} from 'vitest';
import {TextEncoder, TextDecoder} from 'util';
import '@testing-library/jest-dom';
// The webapp strings, in English: jsdom's navigator is en-US.
import './src/i18n';
import * as matchers from 'vitest-axe';

expect.extend(matchers);

globalThis.jest = vi;

globalThis.jest.mocked = vi.mocked;   // ← pour jest.mocked()
globalThis.jest.setTimeout = (ms) => {
    vi.setConfig({testTimeout: ms});
};

global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

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
