/**
 * Thrown when a geometry element fails to parse from an SVG document. These
 * errors are caught at a higher level and collected into {@link ParseResult}'s
 * `warnings` array rather than aborting the whole parse.
 */
export class ParseSvgWarningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseSvgWarningError';
  }
}
