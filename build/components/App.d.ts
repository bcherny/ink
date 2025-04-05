import { EventEmitter } from 'node:events';
import React, { PureComponent, type ReactNode } from 'react';
type Props = {
    readonly children: ReactNode;
    readonly stdin: NodeJS.ReadStream;
    readonly stdout: NodeJS.WriteStream;
    readonly stderr: NodeJS.WriteStream;
    readonly writeToStdout: (data: string) => void;
    readonly writeToStderr: (data: string) => void;
    readonly exitOnCtrlC: boolean;
    readonly onExit: (error?: Error) => void;
};
type State = {
    readonly isFocusEnabled: boolean;
    readonly activeFocusId?: string;
    readonly focusables: Focusable[];
    readonly error?: Error;
};
type Focusable = {
    readonly id: string;
    readonly isActive: boolean;
};
export default class App extends PureComponent<Props, State> {
    static displayName: string;
    static getDerivedStateFromError(error: Error): {
        error: Error;
    };
    state: {
        isFocusEnabled: boolean;
        activeFocusId: undefined;
        focusables: never[];
        error: undefined;
    };
    rawModeEnabledCount: number;
    internal_eventEmitter: EventEmitter<[never]>;
    keyParseState: import("../parse-keypress.js").KeyParseState;
    incompleteEscapeTimer: NodeJS.Timeout | null;
    readonly NORMAL_TIMEOUT = 50;
    readonly PASTE_TIMEOUT = 500;
    isRawModeSupported(): boolean;
    render(): React.JSX.Element;
    componentDidMount(): void;
    componentWillUnmount(): void;
    componentDidCatch(error: Error): void;
    handleSetRawMode: (isEnabled: boolean) => void;
    flushIncomplete: () => void;
    processInput: (input: string | Buffer | null) => void;
    handleReadable: () => void;
    handleInput: (input: string) => void;
    handleExit: (error?: Error) => void;
    enableFocus: () => void;
    disableFocus: () => void;
    focus: (id: string) => void;
    focusNext: () => void;
    focusPrevious: () => void;
    addFocusable: (id: string, { autoFocus }: {
        autoFocus: boolean;
    }) => void;
    removeFocusable: (id: string) => void;
    activateFocusable: (id: string) => void;
    deactivateFocusable: (id: string) => void;
    findNextFocusable: (state: State) => string | undefined;
    findPreviousFocusable: (state: State) => string | undefined;
}
export {};
