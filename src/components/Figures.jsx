import React from "react";

/** The figures behind a cell, in its hover card: a title, then a label and a value a line. */
export function Figures({title, lines, notes = []}) {
    return (
        <div className="space-y-1.5">
            <p className="font-semibold">{title}</p>
            <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5">
                {lines.map(([label, value]) => (
                    <React.Fragment key={label}>
                        <dt className="text-ink-muted">{label}</dt>
                        <dd className="text-right tabular-nums">{value}</dd>
                    </React.Fragment>
                ))}
            </dl>
            {notes.length > 0 && (
                <ul className="space-y-0.5 border-t border-line pt-1.5">
                    {notes.map((note) => <li key={note}>{note}</li>)}
                </ul>
            )}
        </div>
    );
}
