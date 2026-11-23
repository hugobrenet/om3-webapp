/**
 * The Authorization header of a user and its password, as RFC 7617 has them: in
 * UTF-8, then base64. btoa alone takes one byte a character, Latin-1: it throws on
 * a "€" and sends an "é" as one byte, where the daemon compares the UTF-8 of the
 * password its user holds.
 */
export function basicAuthorization(username, password) {
    const bytes = new TextEncoder().encode(`${username}:${password}`);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return `Basic ${btoa(binary)}`;
}
