import sliceAnsi from 'slice-ansi';
import {widestLine} from './widest-line.js';
import {
	type StyledChar,
	styledCharsFromTokens,
	styledCharsToString,
	tokenize,
} from '@alcalzone/ansi-tokenize';
import {type OutputTransformer} from './render-node-to-output.js';
import stringWidth from 'string-width';

/**
 * "Virtual" output class
 *
 * Handles the positioning and saving of the output of each node in the tree.
 * Also responsible for applying transformations to each character of the output.
 *
 * Used to generate the final output of all nodes before writing it to actual output stream (e.g. stdout)
 */

type Options = {
	width: number;
	height: number;
	startOscPrompt?: string;
	endOscPrompt?: string;
};

type Operation = WriteOperation | ClipOperation | UnclipOperation;

type WriteOperation = {
	type: 'write';
	x: number;
	y: number;
	text: string;
	transformers: OutputTransformer[];
};

type ClipOperation = {
	type: 'clip';
	clip: Clip;
};

type Clip = {
	x1: number | undefined;
	x2: number | undefined;
	y1: number | undefined;
	y2: number | undefined;
};

type UnclipOperation = {
	type: 'unclip';
};

export default class Output {
	width: number;
	height: number;
	startOscPrompt: string;
	endOscPrompt: string;

	private readonly operations: Operation[] = [];

	private charCache: {[line: string]: StyledChar[]} = {};
	private styledCharsToStringCache: {[serializedStyledChars: string]: string} = {};

	constructor({width, height, startOscPrompt, endOscPrompt}: Options) {
		this.width = width;
		// Sometimes we get bogus heights like 8.529591648468016e-40
		this.height = height < 1 ? 0 : height;
		this.startOscPrompt = startOscPrompt || '';
		this.endOscPrompt = endOscPrompt || '';
	}

	write(
		x: number,
		y: number,
		text: string,
		options: {transformers: OutputTransformer[]},
	): void {
		const {transformers} = options;

		if (!text) {
			return;
		}

		this.operations.push({
			type: 'write',
			x,
			y,
			text,
			transformers,
		});
	}

	clip(clip: Clip) {
		this.operations.push({
			type: 'clip',
			clip,
		});
	}

	unclip() {
		this.operations.push({
			type: 'unclip',
		});
	}

	get(): {output: string; height: number} {
		// Initialize output array with a specific set of rows
		const output: StyledChar[][] = [];
		// Create local array to track prompt lines for this render
		const isPromptLine = new Array(this.height).fill(false);

		for (let y = 0; y < this.height; y++) {
			const row: StyledChar[] = [];

			for (let x = 0; x < this.width; x++) {
				row.push({
					type: 'char',
					value: ' ',
					fullWidth: false,
					styles: [],
				});
			}

			output.push(row);
		}

		const clips: Clip[] = [];

		for (const operation of this.operations) {
			if (operation.type === 'clip') {
				clips.push(operation.clip);
			}

			if (operation.type === 'unclip') {
				clips.pop();
			}

			if (operation.type === 'write') {
				const {text, transformers} = operation;
				let {x, y} = operation;
				let lines = text.split('\n');

				const clip = clips.at(-1);

				if (clip) {
					const clipHorizontally =
						typeof clip?.x1 === 'number' && typeof clip?.x2 === 'number';

					const clipVertically =
						typeof clip?.y1 === 'number' && typeof clip?.y2 === 'number';

					// If text is positioned outside of clipping area altogether,
					// skip to the next operation to avoid unnecessary calculations
					if (clipHorizontally) {
						const width = widestLine(text);

						if (x + width < clip.x1! || x > clip.x2!) {
							continue;
						}
					}

					if (clipVertically) {
						const height = lines.length;

						if (y + height < clip.y1! || y > clip.y2!) {
							continue;
						}
					}

					if (clipHorizontally) {
						lines = lines.map(line => {
							const from = x < clip.x1! ? clip.x1! - x : 0;
							const width = stringWidth(line);
							const to = x + width > clip.x2! ? clip.x2! - x : width;

							return sliceAnsi(line, from, to);
						});

						if (x < clip.x1!) {
							x = clip.x1!;
						}
					}

					if (clipVertically) {
						const from = y < clip.y1! ? clip.y1! - y : 0;
						const height = lines.length;
						const to = y + height > clip.y2! ? clip.y2! - y : height;

						lines = lines.slice(from, to);

						if (y < clip.y1!) {
							y = clip.y1!;
						}
					}
				}

				let offsetY = 0;

				for (let [index, line] of lines.entries()) {
					const currentY = y + offsetY;
					const currentLine = output[currentY];

					// Line can be missing if `text` is taller than height of pre-initialized output
					if (!currentLine) {
						continue;
					}

					for (const transformer of transformers) {
						let result = transformer(line, index);
                                                if (typeof result == 'string') {
                                                        result = {line: result};
                                                }

                                                if (result?.isPrompt) {
                                                        isPromptLine[currentY] = true;
                                                }

						line = result.line;
					}

					if (!this.charCache.hasOwnProperty(line)) {
						this.charCache[line] = styledCharsFromTokens(tokenize(line));
					}
					const characters = this.charCache[line]!;

					let offsetX = x;

					for (const character of characters) {
						currentLine[offsetX] = character;

						// Some characters take up more than one column. In that case, the following
						// pixels need to be cleared to avoid printing extra characters
						const isWideCharacter =
							character.fullWidth || character.value.length > 1;

						if (isWideCharacter) {
							currentLine[offsetX + 1] = {
								type: 'char',
								value: '',
								fullWidth: false,
								styles: character.styles,
							};
						}

						offsetX += isWideCharacter ? 2 : 1;
					}

					offsetY++;
				}
			}
		}

		// Group lines by isPrompt to add OSC control sequences at boundaries
		let currentIsPrompt = false;
		let result = '';

		// Process output lines and add OSC prompt markers at group boundaries
		for (let i = 0; i < output.length; i++) {
			const line = output[i]!;

			// Skip empty lines at the end
			if (i === output.length - 1 && line.every(char => char.value === ' ')) {
				continue;
			}

			// See https://github.com/vadimdemedes/ink/pull/564#issuecomment-1637022742
			const lineWithoutEmptyItems = line.filter(item => item !== undefined);

			const key = JSON.stringify(lineWithoutEmptyItems);
			if (!this.styledCharsToStringCache.hasOwnProperty(key)) {
				const result = styledCharsToString(lineWithoutEmptyItems).trimEnd();
				this.styledCharsToStringCache[key] = result;
			}

			const lineText = this.styledCharsToStringCache[key];

			// Use our local tracking array
			const isPromptLineValue = isPromptLine[i];

			// Add prompt start marker at group boundaries
			if (!currentIsPrompt && isPromptLineValue) {
				result += this.startOscPrompt;
				currentIsPrompt = true;
			}

			// Add prompt end marker at group boundaries
			if (currentIsPrompt && !isPromptLineValue) {
				result += this.endOscPrompt;
				currentIsPrompt = false;
			}

			// Add the line
			result += lineText;

			// Add newline if not the last line
			if (i < output.length - 1) {
				result += '\n';
			}
		}

		// Ensure prompt is closed at the end if needed
		if (currentIsPrompt) {
			result += this.endOscPrompt;
		}

		return {
			output: result,
			height: output.length,
		};
	}
}
