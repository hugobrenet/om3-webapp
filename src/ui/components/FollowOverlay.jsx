import React from "react";
import {Button} from "./Button";
import {ChevronDownIcon} from "../icons";

/**
 * Over a stream read as a terminal (useFollowScroll): while scrolling, the age of
 * the lines shown by the scroll handle; scrolled up, what came since and the way
 * back to the end. In a positioned parent holding the scrolling view.
 */
export function FollowOverlay({scrollAge, following, shown, onEnd, label}) {
    return (
        <>
            {scrollAge !== null && (
                <span
                    aria-hidden="true"
                    data-scroll-age=""
                    style={{top: scrollAge.top}}
                    className="pointer-events-none absolute right-4 rounded-(--radius-control) bg-accent px-1.5 font-sans text-data font-medium whitespace-nowrap text-accent-ink shadow"
                >
                    {scrollAge.text}
                </span>
            )}
            {!following && shown && (
                <Button
                    size="sm"
                    className="absolute bottom-3 left-1/2 -translate-x-1/2 shadow-lg"
                    icon={<ChevronDownIcon className="h-3.5 w-3.5"/>}
                    onClick={onEnd}
                >
                    {label}
                </Button>
            )}
        </>
    );
}
