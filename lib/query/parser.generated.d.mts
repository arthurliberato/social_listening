import type { Node } from "./ast";

export class SyntaxError extends Error {
  location: { start: { offset: number }; end: { offset: number } };
  expected: { type: string; text?: string; description?: string }[] | null;
  found: string | null;
}
export function parse(input: string): Node;
