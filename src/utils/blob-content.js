/**
 * The content of a key or a file, as its dialog shows it: text, when it is UTF-8 with
 * no control character but tab and line ends; else binary, shown as a hex dump of
 * `hexLimit` bytes at most (all of them by default).
 */
export const parseBlobContent = async (blob, {hexLimit = Infinity} = {}) => {
    // A blob of no arrayBuffer (an older engine) read by a FileReader.
    const arrayBuffer = await (typeof blob.arrayBuffer === "function" ? blob.arrayBuffer() : new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(blob);
    }));
    const uint8Array = new Uint8Array(arrayBuffer);
    let isText = true;
    let textContent = "";
    try {
        textContent = new TextDecoder('utf-8', {fatal: true}).decode(uint8Array);
        for (let i = 0; i < textContent.length; i++) {
            const code = textContent.charCodeAt(i);
            if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
                isText = false;
                break;
            }
        }
    } catch (e) {
        isText = false;
    }

    if (isText && textContent.length > 0) {
        return {type: "text", content: textContent};
    } else {
        const hexLines = [];
        for (let i = 0; i < Math.min(uint8Array.length, hexLimit); i += 16) {
            const chunk = uint8Array.slice(i, i + 16);
            const hex = Array.from(chunk)
                .map(b => b.toString(16).padStart(2, '0'))
                .join(' ');
            const ascii = Array.from(chunk)
                .map(b => (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.')
                .join('');
            hexLines.push(`${i.toString(16).padStart(8, '0')}  ${hex.padEnd(48, ' ')}  ${ascii}`);
        }
        return {type: "binary", content: hexLines.join('\n')};
    }
};
