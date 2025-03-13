import { type DOMElement } from './dom.js';
import type Output from './output.js';
export type OutputTransformerResult = {
    line: string;
    isPrompt?: boolean;
    [x: string]: any;
} | string;
export type OutputTransformer = (s: string, index: number) => OutputTransformerResult;
declare const renderNodeToOutput: (node: DOMElement, output: Output, options: {
    offsetX?: number;
    offsetY?: number;
    transformers?: OutputTransformer[];
    skipStaticElements: boolean;
}) => void;
export default renderNodeToOutput;
