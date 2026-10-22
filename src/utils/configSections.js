/*
 * The sections of a configuration file, as om3 writes it: a `[name]` line opens a
 * section, which runs to the next one or to the end of the file.
 */

const HEADER = /^\s*\[([^\]]+)\]\s*$/;

/** The lines of the section `name`, from its header to the next one excluded; null when absent. */
const sectionRange = (lines, name) => {
    const start = lines.findIndex((line) => HEADER.exec(line)?.[1].trim() === name);
    if (start === -1) return null;
    let end = start + 1;
    while (end < lines.length && !HEADER.test(lines[end])) end++;
    return {start, end};
};

/** The section `name` of a file, its header included, without the blank lines closing it; null when absent. */
export const extractSection = (text, name) => {
    const lines = (text ?? "").split("\n");
    const range = sectionRange(lines, name);
    if (range === null) return null;
    return lines.slice(range.start, range.end).join("\n").trimEnd() + "\n";
};

/**
 * The file with its section `name` replaced by `section`, a blank line kept before
 * the next one; the section appended at the end of a file that has none.
 */
export const replaceSection = (text, name, section) => {
    const lines = (text ?? "").split("\n");
    const body = section.trimEnd();
    const range = sectionRange(lines, name);
    if (range === null) {
        const head = (text ?? "").trimEnd();
        return `${head === "" ? "" : `${head}\n\n`}${body}\n`;
    }
    const before = lines.slice(0, range.start);
    const after = lines.slice(range.end);
    return [...before, body, ...(after.length > 0 ? ["", ...after] : [""])].join("\n");
};
