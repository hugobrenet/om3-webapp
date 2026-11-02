import React, {useCallback, useEffect, useRef, useState} from "react";
import {Alert} from "../ui/components/Alert";
import {Terminal} from "@xterm/xterm";
import {FitAddon} from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import {
    CONSOLE_REASON_ERROR,
    consoleCertificateUrl,
    consoleUrl,
    openConsoleSession,
    requestConsoleTicket,
} from "../services/console-service.js";
import logger from "../utils/logger.js";
import {Trans, useTranslation} from "react-i18next";
import i18n from "../i18n";

// The colours of the terminal, read from the design tokens: xterm draws in a
// canvas, where CSS classes do not reach. An empty value (tokens not loaded)
// leaves the xterm default.
const TERMINAL_COLOURS = {
    background: "--surface-sunken",
    foreground: "--ink",
    cursor: "--accent",
    cursorAccent: "--surface-sunken",
    selectionBackground: "--accent-soft",
    black: "--ink-muted",
    red: "--state-down",
    green: "--state-up",
    yellow: "--state-warn",
    blue: "--code-key",
    magenta: "--code-keyword",
    cyan: "--accent",
    white: "--ink",
    brightBlack: "--ink-muted",
    brightRed: "--state-down",
    brightGreen: "--state-up",
    brightYellow: "--state-warn",
    brightBlue: "--code-key",
    brightMagenta: "--code-keyword",
    brightCyan: "--accent",
    brightWhite: "--ink",
};

const terminalTheme = () => {
    const style = getComputedStyle(document.documentElement);
    const theme = {};
    for (const [key, token] of Object.entries(TERMINAL_COLOURS)) {
        const value = style.getPropertyValue(token).trim();
        if (value) {
            theme[key] = value;
        }
    }
    return theme;
};

export const CONSOLE_STATUS = {
    connecting: "connecting",
    open: "open",
    ended: "ended",
    failed: "failed",
};

/**
 * A terminal attached to a console session of a container resource.
 *
 * The session is opened when it mounts, and ended when it unmounts: a session
 * lasts as long as its client connection. `onStatus` is told where it stands.
 *
 * @param {{
 *   target: null | {node: string, namespace: string, kind: string, name: string, rid?: string},
 *   onStatus?: (status: string) => void,
 * }} props
 */
const ConsoleTerminal = ({target, onStatus}) => {
    const {t} = useTranslation();
    // The element the terminal is drawn in is kept in a state, not in a ref: the
    // session starts when there is something to draw the terminal in.
    const [container, setContainer] = useState(/** @type {HTMLDivElement | null} */ (null));
    const fitRef = useRef(/** @type {any} */ (null));
    const [status, setStatus] = useState(CONSOLE_STATUS.connecting);
    const [message, setMessage] = useState("");
    const [certificateUrl, setCertificateUrl] = useState("");

    const node = target?.node;
    const namespace = target?.namespace;
    const kind = target?.kind;
    const name = target?.name;
    const rid = target?.rid;

    const fit = useCallback(() => {
        try {
            fitRef.current?.fit();
        } catch (err) {
            logger.warn("[ConsoleTerminal] fit failed:", err);
        }
    }, []);

    useEffect(() => {
        onStatus?.(status);
    }, [status, onStatus]);

    useEffect(() => {
        if (!container || !node || !name) {
            return undefined;
        }
        let cancelled = false;
        let session = null;

        setStatus(CONSOLE_STATUS.connecting);
        setMessage("");
        setCertificateUrl("");

        const term = new Terminal({cursorBlink: true, fontSize: 14, scrollback: 5000, theme: terminalTheme()});
        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        fitRef.current = fitAddon;
        term.open(container);
        fit();

        const fail = (text) => {
            setStatus(CONSOLE_STATUS.failed);
            setMessage(text);
        };

        const dataListener = term.onData((data) => session?.send(data));
        const resizeListener = term.onResize(({cols, rows}) => session?.resize(cols, rows));
        // The room changes with the panel, the full screen, a tab shown again; hidden, it has none.
        const roomObserver = typeof ResizeObserver === "function"
            ? new ResizeObserver(() => {
                if (container.clientHeight > 0) {
                    fit();
                }
            })
            : null;
        roomObserver?.observe(container);
        // The theme (light, dark, high contrast) is a class of the root element:
        // the terminal takes the new colours when it changes.
        const themeObserver = typeof MutationObserver === "function"
            ? new MutationObserver(() => {
                term.options.theme = terminalTheme();
            })
            : null;
        themeObserver?.observe(document.documentElement, {attributes: true, attributeFilter: ["class", "data-theme"]});

        const token = localStorage.getItem("authToken");
        if (!token) {
            fail(i18n.t("console.errors.tokenNotFound"));
        } else {
            requestConsoleTicket({node, namespace, kind, name, rid, token})
                .then((ticket) => {
                    if (cancelled) {
                        return;
                    }
                    const url = consoleUrl(ticket);
                    session = openConsoleSession(url, {
                        onOpen: () => {
                            setStatus(CONSOLE_STATUS.open);
                            session.resize(term.cols, term.rows);
                            term.focus();
                        },
                        onData: (bytes) => term.write(bytes),
                        onEnd: ({opened, exit}) => {
                            if (cancelled) {
                                return;
                            }
                            if (exit && exit.reason === CONSOLE_REASON_ERROR) {
                                fail(exit.text || i18n.t("console.errors.sessionFailed"));
                            } else if (exit) {
                                setStatus(CONSOLE_STATUS.ended);
                                setMessage(i18n.t("console.ended", {code: exit.code}));
                            } else if (!opened) {
                                // The browser does not say why a websocket
                                // is refused. A certificate it does not
                                // trust on the console port is the usual
                                // reason, and one the user can fix.
                                setCertificateUrl(consoleCertificateUrl(url));
                                fail(i18n.t("console.errors.unreachable"));
                            } else {
                                fail(i18n.t("console.errors.lost"));
                            }
                        },
                    });
                })
                .catch((err) => {
                    if (!cancelled) {
                        fail(i18n.t("console.errors.openFailed", {message: err.message}));
                    }
                });
        }

        return () => {
            cancelled = true;
            roomObserver?.disconnect();
            themeObserver?.disconnect();
            dataListener?.dispose();
            resizeListener?.dispose();
            session?.close();
            term.dispose();
            fitRef.current = null;
        };
    }, [container, node, namespace, kind, name, rid, fit]);

    return (
        <div className="flex h-full min-h-0 flex-col gap-2">
            {status === CONSOLE_STATUS.connecting && (
                <p className="text-ink-muted">{t("console.opening")}</p>
            )}
            {status === CONSOLE_STATUS.ended && <Alert tone="info">{message}</Alert>}
            {status === CONSOLE_STATUS.failed && (
                <Alert tone="error">
                    {message}
                    {certificateUrl && (
                        <>
                            {" "}
                            <Trans
                                i18nKey="console.certificateHint"
                                values={{url: certificateUrl}}
                                components={{
                                    // Trans puts the URL in the link (not named "link": a void HTML element).
                                    certLink: <a
                                        href={certificateUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="break-all text-accent underline"
                                    />,
                                }}
                            />
                        </>
                    )}
                </Alert>
            )}
            <div
                ref={setContainer}
                data-testid="console-terminal"
                className="min-h-0 flex-1 overflow-hidden rounded-(--radius-control) border border-line bg-surface-sunken p-1"
            />
        </div>
    );
};

export default ConsoleTerminal;
