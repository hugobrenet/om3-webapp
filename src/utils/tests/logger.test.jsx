import {vi, describe, beforeAll, afterAll, beforeEach, afterEach, test, expect} from 'vitest';
import loggerDefault from '../logger';

describe('logger', () => {
    let originalEnv;

    beforeAll(() => {
        originalEnv = process.env.NODE_ENV;
    });

    afterAll(() => {
        process.env.NODE_ENV = originalEnv;
    });

    beforeEach(() => {
        vi.restoreAllMocks();
    });

    describe('in development mode', () => {
        beforeEach(() => {
            process.env.NODE_ENV = 'development';
        });

        test('log calls console.log with arguments', () => {
            const spy = vi.spyOn(console, 'log').mockImplementation(() => {
            });
            loggerDefault.log('test message', 123);
            expect(spy).toHaveBeenCalledWith('test message', 123);
        });

        test('info calls console.info with arguments', () => {
            const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {
            });
            loggerDefault.info('info message', {key: 'value'});
            expect(infoSpy).toHaveBeenCalledWith('info message', {key: 'value'});
        });

        test('warn calls console.warn with arguments', () => {
            const spy = vi.spyOn(console, 'warn').mockImplementation(() => {
            });
            loggerDefault.warn('warn message');
            expect(spy).toHaveBeenCalledWith('warn message');
        });

        test('error calls console.error with arguments', () => {
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {
            });
            const error = new Error('test error');
            loggerDefault.error('error message', error);
            expect(errorSpy).toHaveBeenCalledWith('error message', error);
        });

        test('debug calls console.debug with arguments', () => {
            const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {
            });
            loggerDefault.debug('debug message');
            expect(debugSpy).toHaveBeenCalledWith('debug message');
        });

        test('info handles missing console.info', () => {
            const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {
            });
            const originalInfo = console.info;
            console.info = undefined;
            loggerDefault.info('info message');
            expect(logSpy).toHaveBeenCalledWith('info message');
            console.info = originalInfo;
        });

        test('error handles missing console.error', () => {
            const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {
            });
            const originalError = console.error;
            console.error = undefined;
            loggerDefault.error('error message');
            expect(logSpy).toHaveBeenCalledWith('error message');
            console.error = originalError;
        });

        test('debug handles missing console.debug', () => {
            const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {
            });
            const originalDebug = console.debug;
            console.debug = undefined;
            loggerDefault.debug('debug message');
            expect(logSpy).toHaveBeenCalledWith('debug message');
            console.debug = originalDebug;
        });
    });

    describe('in production mode', () => {
        beforeEach(() => {
            vi.resetModules();
            process.env.NODE_ENV = 'production';
        });

        afterEach(() => {
            vi.resetModules();
        });

        test('log does not call console.log', async () => {
            const loggerProd = (await import('../logger')).default;
            const spy = vi.spyOn(console, 'log').mockImplementation(() => {
            });
            loggerProd.log('test message');
            expect(spy).not.toHaveBeenCalled();
        });

        test('info does not call console methods', async () => {
            const loggerProd = (await import('../logger')).default;
            const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {
            });
            const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {
            });
            loggerProd.info('info message');
            expect(logSpy).not.toHaveBeenCalled();
            expect(infoSpy).not.toHaveBeenCalled();
        });

        test('debug does not call console methods', async () => {
            const loggerProd = (await import('../logger')).default;
            const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {
            });
            const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {
            });
            loggerProd.debug('debug message');
            expect(logSpy).not.toHaveBeenCalled();
            expect(debugSpy).not.toHaveBeenCalled();
        });

        test('warn and error still call the console: what went wrong is said', async () => {
            const loggerProd = (await import('../logger')).default;
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
            });
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {
            });
            loggerProd.warn('warn message');
            loggerProd.error('error message');
            expect(warnSpy).toHaveBeenCalledWith('warn message');
            expect(errorSpy).toHaveBeenCalledWith('error message');
        });
    });

    describe('in a Vite production build, in a browser', () => {
        let originalProcess;

        beforeEach(() => {
            // As in the browser: built by Vite for production, no process to say so.
            process.env.NODE_ENV = 'development';
            vi.stubEnv('PROD', 'true');
            originalProcess = global.process;
            vi.resetModules();
        });

        afterEach(() => {
            global.process = originalProcess;
            vi.unstubAllEnvs();
            vi.resetModules();
        });

        test('traces are silent, warnings and errors said', async () => {
            const loggerBuilt = (await import('../logger')).default;
            delete global.process;
            const spies = ['log', 'info', 'debug', 'warn', 'error'].map((m) => vi.spyOn(console, m).mockImplementation(() => {
            }));
            ['log', 'info', 'debug', 'warn', 'error'].forEach((m) => loggerBuilt[m](`${m} message`));
            global.process = originalProcess;
            const [log, info, debug, warn, error] = spies;
            expect(log).not.toHaveBeenCalled();
            expect(info).not.toHaveBeenCalled();
            expect(debug).not.toHaveBeenCalled();
            expect(warn).toHaveBeenCalledWith('warn message');
            expect(error).toHaveBeenCalledWith('error message');
        });
    });

    describe('serialize', () => {
        test('returns string as is', () => {
            expect(loggerDefault.serialize('hello')).toBe('hello');
        });

        test('stringifies JSON-serializable values', () => {
            expect(loggerDefault.serialize({a: 1, b: 'test'})).toBe('{"a":1,"b":"test"}');
            expect(loggerDefault.serialize([1, 2, 3])).toBe('[1,2,3]');
        });

        test('handles circular references', () => {
            const circular = {};
            circular.self = circular;
            const result = loggerDefault.serialize(circular);
            expect(result).toContain('[object Object]');
        });

        test('handles non-serializable objects', () => {
            const specialObj = {};
            Object.defineProperty(specialObj, 'toJSON', {
                value: () => {
                    throw new Error('Not serializable');
                },
                writable: true,
                configurable: true,
            });
            const result = loggerDefault.serialize(specialObj);
            expect(result).toBe(String(specialObj));
        });

        test('handles undefined and null', () => {
            expect(loggerDefault.serialize(undefined)).toBe('undefined');
            expect(loggerDefault.serialize(null)).toBe('null');
        });
    });

    describe('environment handling', () => {
        test('works without process object', async () => {
            const originalProcess = global.process;
            delete global.process;
            vi.resetModules();
            const loggerWithoutProcess = (await import('../logger')).default;
            const spy = vi.spyOn(console, 'log').mockImplementation(() => {
            });
            loggerWithoutProcess.log('test');
            expect(spy).toHaveBeenCalledWith('test');
            global.process = originalProcess;
            vi.resetModules();
        });

        test('handles missing process.env', async () => {
            const originalEnv = process.env;
            delete process.env;
            vi.resetModules();
            const loggerWithoutEnv = (await import('../logger')).default;
            const spy = vi.spyOn(console, 'log').mockImplementation(() => {
            });
            loggerWithoutEnv.log('test');
            expect(spy).toHaveBeenCalledWith('test');
            process.env = originalEnv;
            vi.resetModules();
        });

        test('handles missing process.env.NODE_ENV', async () => {
            const originalNodeEnv = process.env.NODE_ENV;
            delete process.env.NODE_ENV;
            vi.resetModules();
            const loggerWithoutNodeEnv = (await import('../logger')).default;
            const spy = vi.spyOn(console, 'log').mockImplementation(() => {
            });
            loggerWithoutNodeEnv.log('test');
            expect(spy).toHaveBeenCalledWith('test');
            process.env.NODE_ENV = originalNodeEnv;
            vi.resetModules();
        });
    });
});
