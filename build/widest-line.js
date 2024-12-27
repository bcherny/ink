export function widestLine(string) {
    let lineWidth = 0;
    for (const line of string.split('\n')) {
        lineWidth = Math.max(lineWidth, Bun.stringWidth(line));
    }
    return lineWidth;
}
//# sourceMappingURL=widest-line.js.map