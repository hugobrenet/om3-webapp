import React from "react";
import {useTranslation} from "react-i18next";
import {usageState} from "../ui/components/UsageBar";
import {formatPercent} from "../ui/lib/format";

const RING_RADIUS = 52;
const RING_STROKE = {up: "stroke-state-up", warn: "stroke-state-warn", down: "stroke-state-down"};

/**
 * A count, readable: one too large to be told exactly by a number (an IPv6 range,
 * 2^64 addresses) said as a power of two.
 */
export function formatCount(n, locale) {
    if (typeof n !== "number" || !Number.isFinite(n)) return "–";
    if (n < 1e15) return n.toLocaleString(locale);
    return `≈ 2^${Math.round(Math.log2(n))}`;
}

/**
 * A usage as a ring, the gauge gone round from the top, in the colours of the usage
 * bars; in it, the share used, then `usedText` and `freeText`, what is used and what
 * is free, as the caller words them. A share too small to see still drawn, a sliver.
 */
export function UsageRing({used, size, usedText, freeText, label}) {
    const {i18n} = useTranslation();
    const pct = size ? (used / size) * 100 : 0;
    const round = 2 * Math.PI * RING_RADIUS;
    const length = used > 0 ? Math.max(2, (round * Math.min(pct, 100)) / 100) : 0;
    const state = usageState(pct);
    return (
        <div data-usage-ring={state} className="relative size-44">
            <svg viewBox="0 0 120 120" aria-hidden="true" className="size-full -rotate-90">
                <circle cx="60" cy="60" r={RING_RADIUS} fill="none" strokeWidth="8" className="stroke-surface-sunken"/>
                {length > 0 && (
                    <circle
                        cx="60"
                        cy="60"
                        r={RING_RADIUS}
                        fill="none"
                        strokeWidth="8"
                        strokeLinecap="round"
                        strokeDasharray={`${length} ${round}`}
                        className={RING_STROKE[state]}
                    />
                )}
            </svg>
            <div role="group" aria-label={label} className="absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-2xl font-semibold tabular-nums">{size ? formatPercent(pct, i18n.language, 1) : "–"}</span>
                <span className="tabular-nums">{usedText}</span>
                <span className="text-ink-muted tabular-nums">{freeText}</span>
            </div>
        </div>
    );
}
