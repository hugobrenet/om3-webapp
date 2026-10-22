// A production build is told by Vite (import.meta.env.PROD, replaced at build time):
// `process` does not exist in a browser, and its absence must not read as development.
// NODE_ENV=production says it too, where `process` exists (tests).
const isProd = (() => {
    try {
        if (String(import.meta.env.PROD) === 'true') return true;
    } catch (e) {
        // No import.meta.env: not built by Vite.
    }
    try {
        return typeof process !== 'undefined' && process.env?.NODE_ENV === 'production';
    } catch (e) {
        return false;
    }
})();

const safeSerialize = (arg) => {
    try {
        if (typeof arg === 'string') return arg;
        if (arg === undefined) return 'undefined';
        if (arg === null) return 'null';
        return JSON.stringify(arg);
    } catch (e) {
        return String(arg);
    }
};

// In production, only what went wrong: warnings and errors. The traces (log, info,
// debug) carry events, payloads and configuration, not to be left in a console.
const shouldTrace = !isProd;

const LOGGER_BEHAVIOR = {
    log: 'log',
    info: 'info',
    error: 'error',
    debug: 'debug',
    warn: 'warn',
};

const callConsoleMethod = (method, args) => {
    if (typeof console[method] !== 'undefined') {
        console[method](...args);
    } else if (typeof console.log !== 'undefined') {
        // Fallback sur console.log sans préfixe pour les tests
        console.log(...args);
    }
};

const logger = {
    log: (...args) => {
        if (shouldTrace) callConsoleMethod(LOGGER_BEHAVIOR.log, args);
    },
    info: (...args) => {
        if (shouldTrace) callConsoleMethod(LOGGER_BEHAVIOR.info, args);
    },
    warn: (...args) => {
        callConsoleMethod(LOGGER_BEHAVIOR.warn, args);
    },
    error: (...args) => {
        callConsoleMethod(LOGGER_BEHAVIOR.error, args);
    },
    debug: (...args) => {
        if (shouldTrace) callConsoleMethod(LOGGER_BEHAVIOR.debug, args);
    },
    serialize: safeSerialize,
};

export default logger;
