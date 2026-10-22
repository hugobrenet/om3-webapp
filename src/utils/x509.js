/**
 * X.509 certificates read in the browser, as `openssl x509 -text` tells them: the
 * PEM blocks of a key found, each decoded from its DER. No dependency: a reader of
 * the few ASN.1 types a certificate holds is enough.
 */

const PEM_CERTIFICATE = /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/g;

/** Whether a text holds at least a PEM certificate: a chain, or one with its key. */
export const hasPemCertificate = (text) =>
    typeof text === "string" && text.includes("-----BEGIN CERTIFICATE-----");

const base64ToBytes = (base64) => {
    const binary = atob(base64.replace(/[^A-Za-z0-9+/=]/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
};

/** One element of DER: its tag byte, and where its content starts and ends. */
const readTlv = (bytes, offset) => {
    if (offset + 2 > bytes.length) throw new Error("truncated DER");
    const tag = bytes[offset];
    let length = bytes[offset + 1];
    let start = offset + 2;
    if (length & 0x80) {
        const count = length & 0x7f;
        if (count === 0 || count > 4) throw new Error("unsupported DER length");
        length = 0;
        for (let i = 0; i < count; i++) length = length * 256 + bytes[start + i];
        start += count;
    }
    const end = start + length;
    if (end > bytes.length) throw new Error("truncated DER");
    return {tag, start, end, bytes};
};

const content = (tlv) => tlv.bytes.subarray(tlv.start, tlv.end);

/** The elements a constructed one holds. */
const children = (tlv) => {
    const list = [];
    for (let offset = tlv.start; offset < tlv.end;) {
        const child = readTlv(tlv.bytes, offset);
        list.push(child);
        offset = child.end;
    }
    return list;
};

const expect = (tlv, tag) => {
    if (tlv?.tag !== tag) throw new Error(`unexpected DER tag ${tlv?.tag}`);
    return tlv;
};

const SEQUENCE = 0x30;
const SET = 0x31;
const INTEGER = 0x02;
const BIT_STRING = 0x03;
const OCTET_STRING = 0x04;
const OID = 0x06;
const BOOLEAN = 0x01;
const UTC_TIME = 0x17;
const GENERALIZED_TIME = 0x18;

const decodeOid = (bytes) => {
    const parts = [];
    let value = 0;
    for (let i = 0; i < bytes.length; i++) {
        value = value * 128 + (bytes[i] & 0x7f);
        if (!(bytes[i] & 0x80)) {
            if (parts.length === 0) {
                const first = Math.min(Math.floor(value / 40), 2);
                parts.push(first, value - first * 40);
            } else {
                parts.push(value);
            }
            value = 0;
        }
    }
    return parts.join(".");
};

const hex = (bytes, separator = ":") =>
    Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(separator);

const decodeString = (tlv) => {
    const bytes = content(tlv);
    // BMPString, UTF-16 big endian.
    if (tlv.tag === 0x1e) {
        let text = "";
        for (let i = 0; i + 1 < bytes.length; i += 2) text += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
        return text;
    }
    return new TextDecoder("utf-8").decode(bytes);
};

const decodeTime = (tlv) => {
    const text = new TextDecoder("ascii").decode(content(tlv));
    const match = tlv.tag === UTC_TIME
        ? /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?Z$/.exec(text)
        : /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(?:\.\d+)?Z$/.exec(text);
    if (!match) throw new Error(`unsupported time ${text}`);
    let year = Number(match[1]);
    // UTCTime years: 50 to 99 are of the 1900s, as RFC 5280 says.
    if (tlv.tag === UTC_TIME) year += year >= 50 ? 1900 : 2000;
    return new Date(Date.UTC(year, Number(match[2]) - 1, Number(match[3]),
        Number(match[4]), Number(match[5]), Number(match[6] ?? 0)));
};

const NAME_ATTRIBUTES = {
    "2.5.4.3": "CN",
    "2.5.4.4": "SN",
    "2.5.4.5": "serialNumber",
    "2.5.4.6": "C",
    "2.5.4.7": "L",
    "2.5.4.8": "ST",
    "2.5.4.9": "street",
    "2.5.4.10": "O",
    "2.5.4.11": "OU",
    "2.5.4.12": "title",
    "2.5.4.42": "GN",
    "1.2.840.113549.1.9.1": "emailAddress",
    "0.9.2342.19200300.100.1.25": "DC",
    "0.9.2342.19200300.100.1.1": "UID",
};

/** A distinguished name, in the order it is stored, as openssl prints it. */
const decodeName = (tlv) => {
    const attributes = [];
    for (const rdn of children(expect(tlv, SEQUENCE))) {
        for (const pair of children(expect(rdn, SET))) {
            const [type, value] = children(expect(pair, SEQUENCE));
            const oid = decodeOid(content(expect(type, OID)));
            attributes.push({type: NAME_ATTRIBUTES[oid] ?? oid, value: decodeString(value)});
        }
    }
    return attributes;
};

export const formatName = (attributes) =>
    attributes.map(({type, value}) => `${type}=${value}`).join(", ");

const ALGORITHMS = {
    "1.2.840.113549.1.1.1": "RSA",
    "1.2.840.113549.1.1.4": "md5WithRSAEncryption",
    "1.2.840.113549.1.1.5": "sha1WithRSAEncryption",
    "1.2.840.113549.1.1.10": "RSASSA-PSS",
    "1.2.840.113549.1.1.11": "sha256WithRSAEncryption",
    "1.2.840.113549.1.1.12": "sha384WithRSAEncryption",
    "1.2.840.113549.1.1.13": "sha512WithRSAEncryption",
    "1.2.840.10045.2.1": "EC",
    "1.2.840.10045.4.1": "ecdsa-with-SHA1",
    "1.2.840.10045.4.3.2": "ecdsa-with-SHA256",
    "1.2.840.10045.4.3.3": "ecdsa-with-SHA384",
    "1.2.840.10045.4.3.4": "ecdsa-with-SHA512",
    "1.3.101.110": "X25519",
    "1.3.101.111": "X448",
    "1.3.101.112": "Ed25519",
    "1.3.101.113": "Ed448",
    "1.2.840.10040.4.1": "DSA",
};

const CURVES = {
    "1.2.840.10045.3.1.7": "P-256",
    "1.3.132.0.34": "P-384",
    "1.3.132.0.35": "P-521",
    "1.3.132.0.10": "secp256k1",
};

const algorithmOf = (tlv) => {
    const [oid, parameters] = children(expect(tlv, SEQUENCE));
    const id = decodeOid(content(expect(oid, OID)));
    return {id, name: ALGORITHMS[id] ?? id, parameters};
};

/** The bits of a positive integer, its leading zeros left out. */
const integerBits = (bytes) => {
    let i = 0;
    while (i < bytes.length - 1 && bytes[i] === 0) i++;
    return (bytes.length - i - 1) * 8 + (bytes[i] === 0 ? 0 : Math.floor(Math.log2(bytes[i])) + 1);
};

const decodePublicKey = (tlv) => {
    const [algorithmTlv, keyTlv] = children(expect(tlv, SEQUENCE));
    const algorithm = algorithmOf(algorithmTlv);
    // A BIT STRING: its first byte the count of unused bits.
    const key = content(expect(keyTlv, BIT_STRING)).subarray(1);
    if (algorithm.name === "RSA") {
        const [modulus] = children(expect(readTlv(key, 0), SEQUENCE));
        return {algorithm: "RSA", bits: integerBits(content(modulus))};
    }
    if (algorithm.name === "EC") {
        const curve = algorithm.parameters?.tag === OID ? decodeOid(content(algorithm.parameters)) : null;
        return {algorithm: "EC", curve: curve && (CURVES[curve] ?? curve)};
    }
    return {algorithm: algorithm.name};
};

const KEY_USAGES = [
    "Digital Signature", "Non Repudiation", "Key Encipherment", "Data Encipherment",
    "Key Agreement", "Certificate Sign", "CRL Sign", "Encipher Only", "Decipher Only",
];

const EXTENDED_KEY_USAGES = {
    "2.5.29.37.0": "Any",
    "1.3.6.1.5.5.7.3.1": "TLS Web Server Authentication",
    "1.3.6.1.5.5.7.3.2": "TLS Web Client Authentication",
    "1.3.6.1.5.5.7.3.3": "Code Signing",
    "1.3.6.1.5.5.7.3.4": "E-mail Protection",
    "1.3.6.1.5.5.7.3.8": "Time Stamping",
    "1.3.6.1.5.5.7.3.9": "OCSP Signing",
};

const decodeIp = (bytes) => {
    if (bytes.length === 4) return Array.from(bytes).join(".");
    if (bytes.length === 16) {
        const groups = [];
        for (let i = 0; i < 16; i += 2) groups.push(((bytes[i] << 8) | bytes[i + 1]).toString(16));
        // The longest run of zero groups shortened, as RFC 5952 writes it.
        const text = groups.join(":");
        const runs = text.match(/(?:^|:)0(?::0)+(?::|$)/g);
        if (!runs) return text;
        const longest = runs.reduce((a, b) => (b.length > a.length ? b : a));
        return text.replace(longest, "::");
    }
    return hex(bytes);
};

/** The alternative names, as openssl tells them: `DNS:`, `IP Address:`, … */
const decodeAltNames = (bytes) => {
    const names = [];
    for (const name of children(expect(readTlv(bytes, 0), SEQUENCE))) {
        const value = content(name);
        switch (name.tag) {
            case 0x81: names.push(`email:${new TextDecoder().decode(value)}`); break;
            case 0x82: names.push(`DNS:${new TextDecoder().decode(value)}`); break;
            case 0x86: names.push(`URI:${new TextDecoder().decode(value)}`); break;
            case 0x87: names.push(`IP Address:${decodeIp(value)}`); break;
            case 0xa4: names.push(`DirName:${formatName(decodeName(readTlv(value, 0)))}`); break;
            default: names.push(`[${name.tag & 0x1f}]`);
        }
    }
    return names;
};

const decodeExtensions = (tlv) => {
    const extensions = {};
    // [3] EXPLICIT: the sequence of the extensions inside.
    for (const extension of children(expect(children(tlv)[0], SEQUENCE))) {
        const parts = children(expect(extension, SEQUENCE));
        const id = decodeOid(content(expect(parts[0], OID)));
        const critical = parts[1].tag === BOOLEAN && content(parts[1])[0] !== 0;
        const value = content(expect(parts[parts.length - 1], OCTET_STRING));
        try {
            switch (id) {
                case "2.5.29.17":
                    extensions.subjectAltName = decodeAltNames(value);
                    break;
                case "2.5.29.15": {
                    const bits = content(expect(readTlv(value, 0), BIT_STRING)).subarray(1);
                    extensions.keyUsage = KEY_USAGES.filter((_, i) => (bits[i >> 3] ?? 0) & (0x80 >> (i & 7)));
                    break;
                }
                case "2.5.29.37":
                    extensions.extendedKeyUsage = children(expect(readTlv(value, 0), SEQUENCE))
                        .map((oid) => decodeOid(content(oid)))
                        .map((oid) => EXTENDED_KEY_USAGES[oid] ?? oid);
                    break;
                case "2.5.29.19": {
                    const fields = children(expect(readTlv(value, 0), SEQUENCE));
                    const ca = fields[0]?.tag === BOOLEAN && content(fields[0])[0] !== 0;
                    const pathLength = fields.find((f) => f.tag === INTEGER);
                    extensions.basicConstraints = {
                        ca,
                        pathLength: pathLength ? content(pathLength).reduce((n, b) => n * 256 + b, 0) : null,
                    };
                    break;
                }
                case "2.5.29.14":
                    extensions.subjectKeyId = hex(content(expect(readTlv(value, 0), OCTET_STRING))).toUpperCase();
                    break;
                case "2.5.29.35": {
                    const keyId = children(expect(readTlv(value, 0), SEQUENCE)).find((f) => f.tag === 0x80);
                    if (keyId) extensions.authorityKeyId = hex(content(keyId)).toUpperCase();
                    break;
                }
                default:
                    break;
            }
        } catch {
            // An extension not read is left out: the rest of the certificate still tells.
        }
        if (critical) (extensions.critical ??= []).push(id);
    }
    return extensions;
};

/** A DER certificate decoded; throws if it is not one. */
export const decodeCertificate = (der) => {
    const certificate = expect(readTlv(der, 0), SEQUENCE);
    const [tbs, signatureAlgorithm] = children(certificate);
    const fields = children(expect(tbs, SEQUENCE));
    let i = 0;
    let version = 1;
    if (fields[i].tag === 0xa0) {
        version = content(expect(children(fields[i])[0], INTEGER))[0] + 1;
        i++;
    }
    const serial = content(expect(fields[i++], INTEGER));
    i++; // The signature algorithm, again.
    const issuer = decodeName(fields[i++]);
    const [notBefore, notAfter] = children(expect(fields[i++], SEQUENCE)).map(decodeTime);
    const subject = decodeName(fields[i++]);
    const publicKey = decodePublicKey(fields[i++]);
    const extensionsTlv = fields.slice(i).find((f) => f.tag === 0xa3);
    const extensions = extensionsTlv ? decodeExtensions(extensionsTlv) : {};
    // The serial without the zero byte keeping it positive, as openssl prints it.
    const serialBytes = serial.length > 1 && serial[0] === 0 ? serial.subarray(1) : serial;
    return {
        version,
        serialNumber: hex(serialBytes),
        signatureAlgorithm: algorithmOf(signatureAlgorithm).name,
        issuer,
        subject,
        notBefore,
        notAfter,
        publicKey,
        extensions,
        der: der.subarray(0, certificate.end),
    };
};

/** The certificates of the PEM blocks of a text, each decoded, or the error it gave. */
export const decodePemCertificates = (text) =>
    Array.from(text.matchAll(PEM_CERTIFICATE), ([, body]) => {
        try {
            return decodeCertificate(base64ToBytes(body));
        } catch (error) {
            return {error: error.message};
        }
    });

/** The fingerprint of a certificate, as `openssl x509 -fingerprint` prints it; null without WebCrypto (plain http). */
export const fingerprint = async (der, algorithm = "SHA-256") => {
    if (!globalThis.crypto?.subtle) return null;
    const digest = await globalThis.crypto.subtle.digest(algorithm, der);
    return hex(new Uint8Array(digest)).toUpperCase();
};
