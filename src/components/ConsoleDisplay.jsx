import React, {useEffect, useRef, useState} from "react";
import {Alert} from "../ui/components/Alert";
import {Button} from "../ui/components/Button";
import {Trans, useTranslation} from "react-i18next";
import i18n from "../i18n";
import {consoleCertificateUrl, consoleUrl, requestConsoleTicket} from "../services/console-service.js";

const DISPLAY_STATUS = {
    connecting: "connecting",
    open: "open",
    ended: "ended",
    failed: "failed",
};

/** The client of the display protocol, loaded with the first display opened. */
const loadRFB = () => import("@novnc/novnc").then((m) => m.default);

/**
 * The screen of a guest, in a console session of its resource.
 *
 * The session is opened when it mounts, and ended when it unmounts. The websocket
 * is opened here rather than by the client of the protocol: what refuses a display
 * is the reason of its close message, which that client does not tell. `onStatus`
 * is told where it stands.
 *
 * @param {{
 *   target: null | {node: string, namespace: string, kind: string, name: string, rid?: string},
 *   onStatus?: (status: string) => void,
 * }} props
 */
const ConsoleDisplay = ({target, onStatus}) => {
    const {t} = useTranslation();
    const [container, setContainer] = useState(/** @type {HTMLDivElement | null} */ (null));
    const clientRef = useRef(/** @type {any} */ (null));
    const [status, setStatus] = useState(DISPLAY_STATUS.connecting);
    const [message, setMessage] = useState("");
    const [certificateUrl, setCertificateUrl] = useState("");

    const node = target?.node;
    const namespace = target?.namespace;
    const kind = target?.kind;
    const name = target?.name;
    const rid = target?.rid;

    useEffect(() => {
        onStatus?.(status);
    }, [status, onStatus]);

    useEffect(() => {
        if (!container || !node || !name) {
            return undefined;
        }
        let cancelled = false;
        let opened = false;
        let ws = null;

        setStatus(DISPLAY_STATUS.connecting);
        setMessage("");
        setCertificateUrl("");

        const fail = (text) => {
            setStatus(DISPLAY_STATUS.failed);
            setMessage(text);
        };

        const connect = async () => {
            const token = localStorage.getItem("authToken");
            if (!token) {
                fail(i18n.t("console.errors.tokenNotFound"));
                return;
            }
            const [RFB, ticket] = await Promise.all([
                loadRFB(),
                requestConsoleTicket({node, namespace, kind, name, rid, graphics: true, token}),
            ]);
            if (cancelled) {
                return;
            }
            const url = consoleUrl(ticket);
            ws = new WebSocket(url);
            ws.binaryType = "arraybuffer";
            ws.addEventListener("open", () => {
                opened = true;
            });
            ws.addEventListener("close", (event) => {
                if (cancelled) {
                    return;
                }
                if (event.reason) {
                    fail(event.reason);
                } else if (!opened) {
                    // The browser does not say why a websocket is refused: see
                    // the terminal.
                    setCertificateUrl(consoleCertificateUrl(url));
                    fail(i18n.t("console.errors.unreachable"));
                } else {
                    setStatus(DISPLAY_STATUS.ended);
                    setMessage(i18n.t("console.display.ended"));
                }
            });
            const client = new RFB(container, ws);
            client.scaleViewport = true;
            client.focusOnClick = true;
            client.addEventListener("connect", () => {
                setStatus(DISPLAY_STATUS.open);
                client.focus();
            });
            clientRef.current = client;
        };
        connect().catch((err) => {
            if (!cancelled) {
                fail(i18n.t("console.errors.openFailed", {message: err.message}));
            }
        });

        return () => {
            cancelled = true;
            try {
                clientRef.current?.disconnect();
            } catch {
                // It closed by itself.
            }
            clientRef.current = null;
            ws?.close();
        };
    }, [container, node, namespace, kind, name, rid]);

    return (
        <div className="flex h-full min-h-0 flex-col gap-2">
            {status === DISPLAY_STATUS.connecting && <p className="text-ink-muted">{t("console.opening")}</p>}
            {status === DISPLAY_STATUS.ended && <Alert tone="info">{message}</Alert>}
            {status === DISPLAY_STATUS.failed && (
                <Alert tone="error">
                    {message}
                    {certificateUrl && (
                        <>
                            {" "}
                            <Trans
                                i18nKey="console.certificateHint"
                                values={{url: certificateUrl}}
                                components={{
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
                data-testid="console-display"
                className="min-h-0 flex-1 overflow-hidden rounded-(--radius-control) border border-line bg-black"
            />
            <div className="flex justify-end">
                <Button
                    size="sm"
                    disabled={status !== DISPLAY_STATUS.open}
                    onClick={() => clientRef.current?.sendCtrlAltDel()}
                >
                    {t("console.display.ctrlAltDel")}
                </Button>
            </div>
        </div>
    );
};

export default ConsoleDisplay;
