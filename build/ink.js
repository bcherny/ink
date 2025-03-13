import process from 'node:process';
import React from 'react';
import { throttle } from 'es-toolkit/compat';
import ansiEscapes from 'ansi-escapes';
import autoBind from 'auto-bind';
import signalExit from 'signal-exit';
import patchConsole from 'patch-console';
import reconciler from './reconciler.js';
import render from './renderer.js';
import * as dom from './dom.js';
import logUpdate from './log-update.js';
import instances from './instances.js';
import App from './components/App.js';
import Yoga from 'yoga-wasm-web/auto';
const isInCi = Boolean(process.env["CI"]);
const isTTY = process.stdout.isTTY;
const noop = () => { };
// Regex to match OSC133 escape sequences
// These sequences start with ESC ] 133; and end with BEL (x07) or ESC \
// We need to strip these from non-static output to prevent terminal state desynchronization
const anyOsc133Regex = /\x1b\]133;[^\x07\x1b]*(\x07|\x1b\\)/g;
// OSC133 terminal escapes for marking parts of the output
// as prompt or command output, as if we were a shell.
//
// We need both prompt and command markers: terminal UI affordances
// use both.  For example, kitty has a command
// (bound to control-shift-g by default) that displays the last output
// chunkin a pager.
//
// See https://gitlab.freedesktop.org/Per_Bothner/specifications/blob/master/proposals/semantic-prompts.md
// and https://iterm2.com/documentation-escape-codes.html
const oscPromptStartRefreshLine = '\x1b]133;A\x07';
const oscPromptEnd = '\x1b]133;B\x07';
const oscCommandStart = '\x1b]133;C\x07';
const oscCommandEnd = '\x1b]133;D\x07';
// Control codes to start and stop atomic updates.
// This way, the user doesn't observe flickering in the middle of big updates
// like scrollback refresh.
// https://gitlab.com/gnachman/iterm2/-/wikis/synchronized-updates-spec
// These are enabled unconditionally because there is only upside.
// Terminals that don't know about these sequences ignore them, and
// those that do (kitty, iTerm2, Wezterm, conhost.exe, etc.) get a
// big performance win.
const atomicUpdateStart = '\x1b[?2026h';
const atomicUpdateEnd = '\x1b[?2026l';
const stripPrefixIfPresent = (prefix, s) => {
    return s.startsWith(prefix)
        ? s.substring(prefix.length)
        : s;
};
function stripOsc133(s) {
    return s.replace(anyOsc133Regex, '');
}
export default class Ink {
    options;
    log;
    throttledLog;
    // Ignore last render after unmounting a tree to prevent empty output before exit
    isUnmounted;
    lastOutput;
    lastOutputHeight;
    container;
    rootNode = null;
    // This variable is used only in debug mode to store full static output
    // so that it's rerendered every time, not just new static parts, like in non-debug mode
    fullStaticOutput;
    exitPromise;
    restoreConsole;
    unsubscribeResize;
    constructor(options) {
        autoBind(this);
        this.options = options;
        this.log = logUpdate.create(options.stdout);
        this.throttledLog = options.debug
            ? this.log
            : throttle(this.log, undefined, {
                leading: true,
                trailing: true,
            });
        // Ignore last render after unmounting a tree to prevent empty output before exit
        this.isUnmounted = false;
        // Store last output to only rerender when needed
        this.lastOutput = '';
        // Store last output height so we know to clear the terminal when the previous output
        // height is greater than the current terminal height
        this.lastOutputHeight = 0;
        // This variable is used only in debug mode to store full static output
        // so that it's rerendered every time, not just new static parts, like in non-debug mode
        this.fullStaticOutput = '';
        // Emit initial OSC 133 prompt start escape
        if (!isInCi && options.osc133) {
            options.stdout.write(oscPromptStartRefreshLine);
        }
        // Unmount when process exits
        this.unsubscribeExit = signalExit(this.unmount, { alwaysLast: false });
        if (options.patchConsole) {
            this.patchConsole();
        }
        if (!isInCi) {
            options.stdout.on('resize', this.resized);
            this.unsubscribeResize = () => {
                options.stdout.off('resize', this.resized);
            };
        }
        this.rootNode = dom.createNode('ink-root');
        this.rootNode.onComputeLayout = this.calculateLayout;
        this.rootNode.onRender = options.debug
            ? this.onRender
            : throttle(this.onRender, 32, {
                leading: true,
                trailing: true,
            });
        this.rootNode.onImmediateRender = this.onRender;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        this.container = reconciler.createContainer(this.rootNode, 
        // Legacy mode
        0, null, false, null, 'id', () => { }, null);
        if (process.env['DEV'] === 'true') {
            reconciler.injectIntoDevTools({
                bundleType: 0,
                // Reporting React DOM's version, not Ink's
                // See https://github.com/facebook/react/issues/16666#issuecomment-532639905
                version: '16.13.1',
                rendererPackageName: 'ink',
            });
        }
    }
    resized = () => {
        this.calculateLayout();
        this.onRender(true);
    };
    resolveExitPromise = () => { };
    rejectExitPromise = () => { };
    unsubscribeExit = () => { };
    calculateLayout = () => {
        // The 'columns' property can be undefined or 0 when not using a TTY.
        // In that case we fall back to 80.
        const terminalWidth = this.options.stdout.columns || 80;
        if (!this.rootNode) {
            // Yoga is not initialized yet
            return;
        }
        this.rootNode.yogaNode.setWidth(terminalWidth);
        this.rootNode.yogaNode.calculateLayout(undefined, undefined, Yoga.DIRECTION_LTR);
    };
    onRender(didResize = false) {
        // Ask terminal emulators not to redraw the framebuffer
        // while we're in the middle of a atomic update.  Avoids flicker.
        try {
            if (!isInCi && isTTY) {
                this.options.stdout.write(atomicUpdateStart);
            }
            this.onRenderInternal(didResize);
        }
        finally {
            if (!isInCi && isTTY) {
                this.options.stdout.write(atomicUpdateEnd);
            }
        }
    }
    ;
    onRenderInternal(didResize) {
        if (this.isUnmounted) {
            return;
        }
        if (!this.rootNode) {
            // Yoga is not initialized yet
            return;
        }
        // Need to use oscPromptStartRefreshLine because iTerm2 doesn't
        // support the more flexible oscPromptStart; the Output class has
        // logic for making sure that we send oscPromptStartRefreshLine only
        // at the start of the line, where it won't move cursor.
        let startOscPrompt;
        let endOscPrompt;
        let startOscCommand;
        let endOscCommand;
        if (isInCi || !isTTY || !this.options.osc133) {
            startOscPrompt = '';
            endOscPrompt = '';
            startOscCommand = '';
            endOscCommand = '';
        }
        else {
            startOscPrompt = oscPromptStartRefreshLine;
            endOscPrompt = oscPromptEnd;
            startOscCommand = oscCommandStart;
            endOscCommand = oscCommandEnd;
        }
        // Colors make everything more fun.
        if (this.options.debug && isTTY) {
            // Dark blue is for prompt mode.  Exiting prompt
            // mode resets the background color.
            startOscPrompt += '\x1b[48;5;17m';
            endOscPrompt = '\x1b[49m' + endOscPrompt;
            // Dark red for command mode.  Likewise, reset
            // color on exit.
            startOscCommand += '\x1b[48;5;52m';
            endOscCommand = '\x1b[49m' + endOscCommand;
        }
        // For render() output purposes, we assume we're in command mode,
        // so whenever we enter prompt mode we leave command mode, and whenever
        // we leave prompt mode, we re-enter command mode.
        const { output, outputHeight, staticOutput } = render(this.rootNode, endOscCommand + startOscPrompt, endOscPrompt + startOscCommand);
        // If <Static> output isn't empty, it means new children have been added to it
        const hasStaticOutput = staticOutput && staticOutput !== '\n';
        // For static output, we assume we're in prompt mode to start.
        const wrappedStaticOutput = hasStaticOutput
            ? (endOscPrompt +
                startOscCommand +
                staticOutput /* assume ends with \n */ +
                startOscPrompt)
            : staticOutput;
        if (this.options.debug) {
            if (hasStaticOutput) {
                this.fullStaticOutput += wrappedStaticOutput;
            }
            this.options.stdout.write(this.fullStaticOutput + output);
            return;
        }
        if (isInCi) {
            if (hasStaticOutput) {
                this.options.stdout.write(wrappedStaticOutput);
            }
            this.lastOutput = output;
            this.lastOutputHeight = outputHeight;
            return;
        }
        if (hasStaticOutput) {
            this.fullStaticOutput += wrappedStaticOutput;
        }
        const writeFullStaticOutput = () => {
            // fullStaticOutput has embedded prompt-end prompt-start OSC133
            // sequences; it expects to be printed in the in-prompt state.
            // Strip any leading prompt-stop off the string when we print
            // it so that it's appropriate to print in our non-prompt-start
            // context.  We add an extra newline to match what logOutput does.
            this.options.stdout.write(endOscPrompt +
                ansiEscapes.clearTerminal +
                stripPrefixIfPresent(endOscPrompt, this.fullStaticOutput) +
                output + '\n');
        };
        if (outputHeight >= this.options.stdout.rows ||
            this.lastOutputHeight >= this.options.stdout.rows) {
            if (this.options.onFlicker) {
                this.options.onFlicker();
            }
            writeFullStaticOutput();
            this.lastOutput = output;
            this.lastOutputHeight = outputHeight;
            // Account for the extra newline
            this.log.updateLineCount(output + '\n');
            return;
        }
        if (didResize) {
            writeFullStaticOutput();
            this.lastOutput = output;
            this.lastOutputHeight = outputHeight;
            this.log.updateLineCount(output + '\n');
            return;
        }
        // To ensure static output is cleanly rendered before main output, clear main output first
        if (hasStaticOutput) {
            this.log.clear();
            // wrappedStaticOutput sends prompt-end, command-out-start,
            // the incremental static output, and then prompt-start.
            // Pre- and post-condition: in OSC133 prompt mode
            this.options.stdout.write(wrappedStaticOutput);
            this.throttledLog(stripOsc133(output));
        }
        if (!hasStaticOutput && output !== this.lastOutput) {
            this.throttledLog(stripOsc133(output));
        }
        this.lastOutput = output;
        this.lastOutputHeight = outputHeight;
    }
    render(node) {
        const tree = (React.createElement(App, { stdin: this.options.stdin, stdout: this.options.stdout, stderr: this.options.stderr, writeToStdout: this.writeToStdout, writeToStderr: this.writeToStderr, exitOnCtrlC: this.options.exitOnCtrlC, onExit: this.unmount }, node));
        reconciler.updateContainer(tree, this.container, null, noop);
    }
    writeToStdout(data) {
        if (this.isUnmounted) {
            return;
        }
        if (this.options.debug) {
            this.options.stdout.write(data + this.fullStaticOutput + this.lastOutput);
            return;
        }
        if (isInCi) {
            this.options.stdout.write(data);
            return;
        }
        this.log.clear();
        this.options.stdout.write(stripOsc133(data));
        this.log(this.lastOutput);
    }
    writeToStderr(data) {
        if (this.isUnmounted) {
            return;
        }
        if (this.options.debug) {
            this.options.stderr.write(data);
            this.options.stdout.write(this.fullStaticOutput + this.lastOutput);
            return;
        }
        if (isInCi) {
            this.options.stderr.write(data);
            return;
        }
        this.log.clear();
        this.options.stderr.write(stripOsc133(data));
        this.log(this.lastOutput);
    }
    // eslint-disable-next-line @typescript-eslint/ban-types
    unmount(error) {
        if (this.isUnmounted) {
            return;
        }
        this.calculateLayout();
        this.onRender();
        this.unsubscribeExit();
        if (typeof this.restoreConsole === 'function') {
            this.restoreConsole();
        }
        if (typeof this.unsubscribeResize === 'function') {
            this.unsubscribeResize();
        }
        // CIs don't handle erasing ansi escapes well, so it's better to
        // only render last frame of non-static output
        if (isInCi) {
            this.options.stdout.write(this.lastOutput + '\n');
        }
        else {
            if (!this.options.debug) {
                this.log.done();
            }
            // End the prompt at unmount.  Reset background color
            // if we were debugging.
            if (this.options.debug) {
                this.options.stdout.write('\x1b[49m');
            }
            this.options.stdout.write(oscPromptEnd);
        }
        this.isUnmounted = true;
        reconciler.updateContainer(null, this.container, null, noop);
        instances.delete(this.options.stdout);
        if (error instanceof Error) {
            this.rejectExitPromise(error);
        }
        else {
            this.resolveExitPromise();
        }
    }
    async waitUntilExit() {
        this.exitPromise ||= new Promise((resolve, reject) => {
            this.resolveExitPromise = resolve;
            this.rejectExitPromise = reject;
        });
        return this.exitPromise;
    }
    clear() {
        if (!isInCi && !this.options.debug) {
            this.log.clear();
        }
    }
    patchConsole() {
        if (this.options.debug) {
            return;
        }
        this.restoreConsole = patchConsole((stream, data) => {
            if (stream === 'stdout') {
                this.writeToStdout(data);
            }
            if (stream === 'stderr') {
                const isReactMessage = data.startsWith('The above error occurred');
                if (!isReactMessage) {
                    this.writeToStderr(data);
                }
            }
        });
    }
}
//# sourceMappingURL=ink.js.map