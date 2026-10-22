/*
 * The prefixes of a log message, as the daemon and om write them before the text:
 * "daemon: imon: kvm/svc/vm1: …", "daemon: api: ux: POST …". A prefix is a word
 * without blank nor colon, followed by ": ".
 */

const PREFIX = /^([^\s:]+): /;
/** The most prefixes split off a message: the text after a longer chain stays text. */
const MAX_PREFIXES = 6;

/** The prefixes of a message, and the text after them. */
export function splitPrefixes(message) {
    let text = message ?? "";
    const prefixes = [];
    while (prefixes.length < MAX_PREFIXES) {
        const match = PREFIX.exec(text);
        if (match === null) break;
        prefixes.push(match[1]);
        text = text.slice(match[0].length);
    }
    return {prefixes, text};
}
