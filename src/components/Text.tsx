import React, {type ReactNode} from 'react';
import chalk, {type ForegroundColorName} from 'chalk';
import {type LiteralUnion} from 'type-fest';
import colorize from '../colorize.js';
import {type Styles} from '../styles.js';
import {type OutputTransformerResult} from '../render-node-to-output.js';

export type Props = {
	/**
	 * Change text color. Ink uses chalk under the hood, so all its functionality is supported.
	 */
	readonly color?: LiteralUnion<ForegroundColorName, string>;

	/**
	 * Same as `color`, but for background.
	 */
	readonly backgroundColor?: LiteralUnion<ForegroundColorName, string>;

	/**
	 * Dim the color (emit a small amount of light).
	 */
	readonly dimColor?: boolean;

	/**
	 * Make the text bold.
	 */
	readonly bold?: boolean;

	/**
	 * Make the text italic.
	 */
	readonly italic?: boolean;

	/**
	 * Make the text underlined.
	 */
	readonly underline?: boolean;

	/**
	 * Make the text crossed with a line.
	 */
	readonly strikethrough?: boolean;

	/**
	 * Inverse background and foreground colors.
	 */
	readonly inverse?: boolean;

	/**
	 * This property tells Ink to wrap or truncate text if its width is larger than container.
	 * If `wrap` is passed (by default), Ink will wrap text and split it into multiple lines.
	 * If `truncate-*` is passed, Ink will truncate text instead, which will result in one line of text with the rest cut off.
	 */
	readonly wrap?: Styles['textWrap'];

	readonly children?: ReactNode;

        /**
         * This property tells Ink to mark any line containing
         * this text as a prompt using terminal control codes.  Many terminal
         * emulators have UI affordances for navigating between prompts and
         * segmenting the scrollback on prompt boundaries.
         */
	readonly osc133prompt?: boolean;
};

/**
 * This component can display text, and change its style to make it colorful, bold, underline, italic or strikethrough.
 */
export default function Text({
	color,
	backgroundColor,
	dimColor = false,
	bold = false,
	italic = false,
	underline = false,
	strikethrough = false,
	inverse = false,
	wrap = 'wrap',
	osc133prompt = false,
	children,
}: Props) {
	if (children === undefined || children === null) {
		return null;
	}

	const transform = (children: string): OutputTransformerResult => {
		if (dimColor) {
			children = chalk.dim(children);
		}

		if (color) {
			children = colorize(children, color, 'foreground');
		}

		if (backgroundColor) {
			children = colorize(children, backgroundColor, 'background');
		}

		if (bold) {
			children = chalk.bold(children);
		}

		if (italic) {
			children = chalk.italic(children);
		}

		if (underline) {
			children = chalk.underline(children);
		}

		if (strikethrough) {
			children = chalk.strikethrough(children);
		}

		if (inverse) {
			children = chalk.inverse(children);
		}

		return {
			line: children,
			isPrompt: osc133prompt,
		};
	};

	return (
		<ink-text
			style={{flexGrow: 0, flexShrink: 1, flexDirection: 'row', textWrap: wrap}}
			internal_transform={transform}
		>
			{children}
		</ink-text>
	);
}
