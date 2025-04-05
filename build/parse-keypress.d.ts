import { Buffer } from 'node:buffer';
export type KeyParseState = {
    mode: 'NORMAL' | 'IN_PASTE';
    incomplete: string;
};
export type KeyParseResult = {
    state: KeyParseState;
    keys: ParsedKey[];
};
export declare const INITIAL_STATE: KeyParseState;
export declare function parseMultipleKeypresses(prevState: KeyParseState, input?: Buffer | string | null): [ParsedKey[], KeyParseState];
export declare const nonAlphanumericKeys: string[];
export type ParsedKey = {
    fn: boolean;
    name: string;
    ctrl: boolean;
    meta: boolean;
    shift: boolean;
    option: boolean;
    sequence: string;
    raw: string | undefined;
    code?: string;
    isPasted: boolean;
};
