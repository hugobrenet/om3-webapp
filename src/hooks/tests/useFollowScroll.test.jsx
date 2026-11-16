import React, {useRef, useState} from "react";
import {act, fireEvent, render, screen} from "@testing-library/react";
import {describe, expect, test} from "vitest";
import {useFollowScroll} from "../useFollowScroll.js";

/** A stream of lines in the order of their time: a late one lands above those shown. */
function Stream() {
    const containerRef = useRef(null);
    const [items, setItems] = useState([10, 20]);
    useFollowScroll({containerRef, items, lineSelector: ".line", locale: "en"});
    const add = (...times) => setItems((l) => [...l, ...times].sort((a, b) => a - b));
    return (
        <>
            <button type="button" onClick={() => add(30, 40)}>later</button>
            <button type="button" onClick={() => add(15)}>late</button>
            <div ref={containerRef}>
                {items.map((at) => <div key={at} id={`line-${at}`} className="line" data-at={at}>{at}</div>)}
            </div>
        </>
    );
}

const fresh = () => [...document.querySelectorAll("[data-fresh]")].map((e) => e.id);
const click = (name) => act(() => fireEvent.click(screen.getByRole("button", {name})));

describe("useFollowScroll, the lines that came", () => {
    test("the first lines shown not marked; those that came after tinted, wherever their time places them", () => {
        render(<Stream/>);
        expect(fresh()).toEqual([]);
        click("later");
        expect(fresh()).toEqual(["line-30", "line-40"]);
        // A line come late, of an earlier time: above lines shown before it, tinted too.
        click("late");
        expect(fresh()).toEqual(["line-15", "line-30", "line-40"]);
        expect(document.getElementById("line-20")).not.toHaveAttribute("data-fresh");
        // No rule of a previous end.
        expect(document.querySelectorAll("[data-end-mark]")).toHaveLength(0);
    });
});
