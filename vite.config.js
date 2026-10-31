import {execSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {viteSingleFile} from 'vite-plugin-singlefile';
import tailwindcss from '@tailwindcss/vite';
import {
    URL_AUTH_INFO,
    URL_CLUSTER_STATUS,
    URL_NODE,
    URL_NODE_EVENT,
    URL_OBJECT,
    URL_POOL,
    URL_TOKEN,
    URL_AUTH_WHOAMI,
    URL_NETWORK,
    URL_NETWORK_IP,
    URL_METRICS_PG
} from './src/config/apiPath.js';

const baseUrl = process.env.BASE_URL || 'https://localhost:1215/';

/**
 * The version of the webapp built, embedded in it: the release tag of the commit
 * built, or how far past one ("v1.0.0-rc7-2-gb70a232"), "-dirty" with changes not
 * committed; the version of package.json without git.
 */
const appVersion = (() => {
    try {
        return execSync('git describe --tags --always --dirty', {stdio: ['ignore', 'pipe', 'ignore']}).toString().trim();
    } catch {
        return JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
    }
})();

/**
 * noVNC probes the H.264 decoder of the browser at load, with a top-level await. The
 * single-file build holds all the modules in one script, which stops there: what
 * fires meanwhile reaches the code after it, not initialized yet, and the page stays
 * blank, in Firefox and Safari. The probe runs aside: until it ends, the decoder reads
 * as absent, which an encoding falls back from. A noVNC writing it otherwise fails
 * the build, the bundle not holding it any better then.
 */
const noVNCProbeAside = {
    name: 'novnc-probe-aside',
    enforce: 'pre',
    transform(code, id) {
        if (!id.includes('@novnc/novnc/core/util/browser.js')) return null;
        const line = 'supportsWebCodecsH264Decode = await _checkWebCodecsH264DecodeSupport();';
        if (!code.includes(line)) this.error('noVNC changed its H.264 probe: see noVNCProbeAside');
        return code.replace(line, '_checkWebCodecsH264DecodeSupport().then((v) => { supportsWebCodecsH264Decode = v; });');
    },
};

export default defineConfig({
    define: {
        __APP_VERSION__: JSON.stringify(appVersion),
    },
    plugins: [
        noVNCProbeAside,
        react({
            babel: {
                presets: ['@babel/preset-typescript'],
                plugins: [
                    ['@babel/plugin-transform-react-jsx', {runtime: 'automatic'}]
                ]
            }
        }),
        tailwindcss(),
        viteSingleFile()
    ],
    server: {
        proxy: {
            [URL_AUTH_INFO]: {
                target: baseUrl,
                changeOrigin: true,
                secure: false,
            },
            [URL_TOKEN]: {
                target: baseUrl,
                changeOrigin: true,
                secure: false,
            },
            [URL_CLUSTER_STATUS]: {
                target: baseUrl,
                changeOrigin: true,
                secure: false,
            },
            [URL_NODE]: {
                target: baseUrl,
                changeOrigin: true,
                secure: false,
            },
            [URL_OBJECT]: {
                target: baseUrl,
                changeOrigin: true,
                secure: false,
            },
            [URL_POOL]: {
                target: baseUrl,
                changeOrigin: true,
                secure: false,
            },
            [URL_NODE_EVENT]: {
                target: baseUrl,
                changeOrigin: true,
                secure: false,
            },
            [URL_AUTH_WHOAMI]: {
                target: baseUrl,
                changeOrigin: true,
                secure: false,
            },
            [URL_NETWORK]: {
                target: baseUrl,
                changeOrigin: true,
                secure: false,
            },
            [URL_NETWORK_IP]: {
                target: baseUrl,
                changeOrigin: true,
                secure: false,
            },
            [URL_METRICS_PG]: {
                target: baseUrl,
                changeOrigin: true,
                secure: false,
            },
        },
        historyApiFallback: true,
    },
    build: {
        assetsInlineLimit: Infinity,
        cssCodeSplit: false,
        target: 'esnext',
    },
    resolve: {
        alias: {
            '@': '/src'
        }
    },
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: ['./setupTests.js'],
        css: {
            modules: {
                classNameStrategy: 'non-scoped'
            }
        },
        testTimeout: 20000,
    }
});
