// Copied from https://github.com/enquirer/enquirer/blob/36785f3399a41cd61e9d28d1eb9c2fcd73d69b4c/lib/keypress.js
import { Buffer } from 'node:buffer';
const metaKeyCodeRe = /^(?:\x1b)([a-zA-Z0-9])$/;
const fnKeyRe = /^(?:\x1b+)(O|N|\[|\[\[)(?:(\d+)(?:;(\d+))?([~^$])|(?:1;)?(\d+)?([a-zA-Z]))/;
// Bracketed paste mode constants
const pasteBegin = '\x1b[200~';
const pasteEnd = '\x1b[201~';
// Helper function to create a paste key event
function createPasteKey(content) {
    return {
        name: '', // No special key name for pastes
        fn: false,
        ctrl: false,
        meta: false,
        shift: false,
        option: false,
        sequence: content, // Use the full content as-is
        raw: content,
        isPasted: true // Mark this key as coming from paste content
    };
}
const anyEscapeRe = new RegExp('^(.*?)(' + [
    // Order from longest to shortest patterns to favor longer matches
    // OSC: Operating System Command (ESC ])
    '\\x1b\\][0-9]*(?:;[^\\x07\\x1b]*)*(?:\\x07|\\x1b\\\\)',
    // DCS: Device Control String (ESC P)
    '\\x1bP[^\\x1b]*\\x1b\\\\',
    // CSI: Control Sequence Introducer (ESC [)
    '\\x1b\\[[0-9]*(?:;[0-9]*)*[A-Za-z~]',
    // SS3: Single Shift 3 (ESC O)
    '\\x1bO[A-Za-z]',
    // Meta + character
    '\\x1b[\\x00-\\x7F]',
    // Double ESC
    '\\x1b\\x1b',
    // Treat end of string as escape (simplifies logic)
    // Place this last to ensure it's only used as a last resort
    '$',
].map(part => `(?:${part})`).join('|') + ')', 's'); // Add 's' flag for dotall mode
// Enhanced regex that always matches the entire string, separating it into:
// Group 1: Everything before any incomplete escape sequence
// Group 2: The incomplete escape sequence itself (or empty if none)
const incompleteEscapeRe = new RegExp('(.*?)(' + [
    // Order from longest to shortest patterns to favor longer matches
    // Partial OSC
    '\\x1b\\][0-9]*(?:;[^\\x07\\x1b]*)*$',
    // Partial DCS
    '\\x1bP[^\\x1b]*$',
    // Partial CSI
    '\\x1b\\[[0-9]*(?:;[0-9]*)*$',
    // Partial SS3
    '\\x1bO$',
    // Just ESC at the end
    '\\x1b$',
    // No incomplete sequence - match end of text (put this last)
    '$'
].map(part => `(?:${part})`).join('|') + ')', 's');
export const INITIAL_STATE = {
    mode: 'NORMAL',
    incomplete: ''
};
function inputToString(input) {
    if (Buffer.isBuffer(input)) {
        if (input[0] > 127 && input[1] === undefined) {
            input[0] -= 128;
            return '\x1b' + String(input);
        }
        else {
            return String(input);
        }
    }
    else if (input !== undefined && typeof input !== 'string') {
        return String(input);
    }
    else if (!input) {
        return '';
    }
    else {
        return input;
    }
}
export function parseMultipleKeypresses(prevState, input = '') {
    // Special case: input=null is a "flush" operation
    const isFlush = input === null;
    const inputString = isFlush ? '' : inputToString(input);
    // Avoid superlinear compute for large pastes in small chunks.
    // If we're already in paste mode, we don't need to search ALL of
    // our saved incomplete text for the end-paste marker --- just like
    // last bit of it.  If the end paste marker occurred before the very
    // end of the incomplete string, it would have ended already and we
    // wouldn't be here.
    if (prevState.mode === 'IN_PASTE') {
        const search = prevState.incomplete.slice(-pasteEnd.length + 1) + inputString;
        if (search.indexOf(pasteEnd) === -1) {
            return [[], { ...prevState, incomplete: prevState.incomplete + inputString }];
        }
    }
    // Normal processing path
    let text = prevState.incomplete + inputString;
    let state = { ...prevState, incomplete: '' };
    const keys = [];
    const matchers = {
        'NORMAL': () => {
            const m = anyEscapeRe.exec(text); // Always matches
            text = text.substring(m[0].length);
            let prefix = m[1];
            // Only check for incomplete sequences if we're not flushing
            if (!m[2] && !isFlush) { // End of input: check for incomplete escapes
                const incompleteMatch = incompleteEscapeRe.exec(prefix);
                state.incomplete = incompleteMatch[2];
                prefix = incompleteMatch[1];
            }
            if (prefix) {
                keys.push(parseKeypress(prefix));
            }
            if (m[2] === pasteBegin) {
                state.mode = 'IN_PASTE';
            }
            else if (m[2]) {
                keys.push(parseKeypress(m[2]));
            }
        },
        'IN_PASTE': () => {
            let indx = text.indexOf(pasteEnd);
            if (indx === -1) { // no terminator
                if (!isFlush) { // keep accumulating
                    state.incomplete = text;
                    text = '';
                    return;
                }
                indx = text.length;
            }
            // We found paste end. Create a paste key event for the content
            const pasteContent = text.substring(0, indx);
            if (pasteContent) {
                keys.push(createPasteKey(pasteContent));
            }
            text = text.substring(indx + pasteEnd.length);
            state.mode = 'NORMAL';
        },
    };
    while (text) {
        matchers[state.mode]();
    }
    return [keys, state];
}
const keyName = {
    /* xterm/gnome ESC O letter */
    OP: 'f1',
    OQ: 'f2',
    OR: 'f3',
    OS: 'f4',
    /* xterm/rxvt ESC [ number ~ */
    '[11~': 'f1',
    '[12~': 'f2',
    '[13~': 'f3',
    '[14~': 'f4',
    /* from Cygwin and used in libuv */
    '[[A': 'f1',
    '[[B': 'f2',
    '[[C': 'f3',
    '[[D': 'f4',
    '[[E': 'f5',
    /* common */
    '[15~': 'f5',
    '[17~': 'f6',
    '[18~': 'f7',
    '[19~': 'f8',
    '[20~': 'f9',
    '[21~': 'f10',
    '[23~': 'f11',
    '[24~': 'f12',
    /* xterm ESC [ letter */
    '[A': 'up',
    '[B': 'down',
    '[C': 'right',
    '[D': 'left',
    '[E': 'clear',
    '[F': 'end',
    '[H': 'home',
    /* xterm/gnome ESC O letter */
    OA: 'up',
    OB: 'down',
    OC: 'right',
    OD: 'left',
    OE: 'clear',
    OF: 'end',
    OH: 'home',
    /* xterm/rxvt ESC [ number ~ */
    '[1~': 'home',
    '[2~': 'insert',
    '[3~': 'delete',
    '[4~': 'end',
    '[5~': 'pageup',
    '[6~': 'pagedown',
    /* putty */
    '[[5~': 'pageup',
    '[[6~': 'pagedown',
    /* rxvt */
    '[7~': 'home',
    '[8~': 'end',
    /* rxvt keys with modifiers */
    '[a': 'up',
    '[b': 'down',
    '[c': 'right',
    '[d': 'left',
    '[e': 'clear',
    '[2$': 'insert',
    '[3$': 'delete',
    '[5$': 'pageup',
    '[6$': 'pagedown',
    '[7$': 'home',
    '[8$': 'end',
    Oa: 'up',
    Ob: 'down',
    Oc: 'right',
    Od: 'left',
    Oe: 'clear',
    '[2^': 'insert',
    '[3^': 'delete',
    '[5^': 'pageup',
    '[6^': 'pagedown',
    '[7^': 'home',
    '[8^': 'end',
    /* misc. */
    '[Z': 'tab',
};
export const nonAlphanumericKeys = [...Object.values(keyName), 'backspace'];
const isShiftKey = (code) => {
    return [
        '[a',
        '[b',
        '[c',
        '[d',
        '[e',
        '[2$',
        '[3$',
        '[5$',
        '[6$',
        '[7$',
        '[8$',
        '[Z',
    ].includes(code);
};
const isCtrlKey = (code) => {
    return [
        'Oa',
        'Ob',
        'Oc',
        'Od',
        'Oe',
        '[2^',
        '[3^',
        '[5^',
        '[6^',
        '[7^',
        '[8^',
    ].includes(code);
};
const parseKeypress = (s = '') => {
    let parts;
    const key = {
        name: '',
        fn: false,
        ctrl: false,
        meta: false,
        shift: false,
        option: false,
        sequence: s,
        raw: s,
        isPasted: false, // Default to false for regular keypresses
    };
    key.sequence = key.sequence || s || key.name;
    if (s === '\r') {
        // carriage return
        key.raw = undefined;
        key.name = 'return';
    }
    else if (s === '\n') {
        // enter, should have been called linefeed
        key.name = 'enter';
    }
    else if (s === '\t') {
        // tab
        key.name = 'tab';
    }
    else if (s === '\b' || s === '\x1b\b') {
        // backspace or ctrl+h
        key.name = 'backspace';
        key.meta = s.charAt(0) === '\x1b';
    }
    else if (s === '\x7f' || s === '\x1b\x7f') {
        // ink incorrectly sends "delete" here. we changed this in our fork
        key.name = 'backspace';
        key.meta = s.charAt(0) === '\x1b';
    }
    else if (s === '\x1b' || s === '\x1b\x1b') {
        // escape key
        key.name = 'escape';
        key.meta = s.length === 2;
    }
    else if (s === ' ' || s === '\x1b ') {
        key.name = 'space';
        key.meta = s.length === 2;
    }
    else if (s <= '\x1a' && s.length == 1) {
        // ctrl+letter
        key.name = String.fromCharCode(s.charCodeAt(0) + 'a'.charCodeAt(0) - 1);
        key.ctrl = true;
    }
    else if (s.length === 1 && s >= '0' && s <= '9') {
        // number
        key.name = 'number';
    }
    else if (s.length === 1 && s >= 'a' && s <= 'z') {
        // lowercase letter
        key.name = s;
    }
    else if (s.length === 1 && s >= 'A' && s <= 'Z') {
        // shift+letter
        key.name = s.toLowerCase();
        key.shift = true;
    }
    else if ((parts = metaKeyCodeRe.exec(s))) {
        // meta+character key
        key.meta = true;
        key.shift = /^[A-Z]$/.test(parts[1]);
    }
    else if ((parts = fnKeyRe.exec(s))) {
        const segs = [...s];
        if (segs[0] === '\u001b' && segs[1] === '\u001b') {
            key.option = true;
        }
        // ansi escape sequence
        // reassemble the key code leaving out leading \x1b's,
        // the modifier key bitflag and any meaningless "1;" sequence
        const code = [parts[1], parts[2], parts[4], parts[6]]
            .filter(Boolean)
            .join('');
        const modifier = (parts[3] || parts[5] || 1) - 1;
        // Parse the key modifier
        key.ctrl = !!(modifier & 4);
        key.meta = !!(modifier & 10);
        key.shift = !!(modifier & 1);
        key.code = code;
        key.name = keyName[code];
        key.shift = isShiftKey(code) || key.shift;
        key.ctrl = isCtrlKey(code) || key.ctrl;
    }
    // iTerm in natural text editing mode
    if (key.raw === '\x1Bb') {
        key.meta = true;
        key.name = 'left';
    }
    else if (key.raw === '\x1Bf') {
        key.meta = true;
        key.name = 'right';
    }
    switch (s) {
        case '\u001b[1~':
            return {
                name: 'home',
                ctrl: false,
                meta: false,
                shift: false,
                option: false,
                fn: false,
                sequence: s,
                raw: s,
                isPasted: false,
            };
        case '\u001b[4~':
            return {
                name: 'end',
                ctrl: false,
                meta: false,
                shift: false,
                option: false,
                fn: false,
                sequence: s,
                raw: s,
                isPasted: false,
            };
        case '\u001b[5~':
            return {
                name: 'pageup',
                ctrl: false,
                meta: false,
                shift: false,
                option: false,
                fn: false,
                sequence: s,
                raw: s,
                isPasted: false,
            };
        case '\u001b[6~':
            return {
                name: 'pagedown',
                ctrl: false,
                meta: false,
                shift: false,
                option: false,
                fn: false,
                sequence: s,
                raw: s,
                isPasted: false,
            };
        case '\u001b[1;5D':
            return {
                name: 'left',
                ctrl: true,
                meta: false,
                shift: false,
                option: false,
                fn: false,
                sequence: s,
                raw: s,
                isPasted: false,
            };
        case '\u001b[1;5C':
            return {
                name: 'right',
                ctrl: true,
                meta: false,
                shift: false,
                option: false,
                fn: false,
                sequence: s,
                raw: s,
                isPasted: false,
            };
        case '\u001b[1~':
            return {
                name: 'left',
                ctrl: true,
                fn: true,
                meta: false,
                shift: false,
                option: false,
                sequence: s,
                raw: s,
                isPasted: false,
            };
        case '\u001b[4~':
            return {
                name: 'right',
                ctrl: true,
                fn: true,
                meta: false,
                shift: false,
                option: false,
                sequence: s,
                raw: s,
                isPasted: false,
            };
    }
    return key;
};
//# sourceMappingURL=parse-keypress.js.map