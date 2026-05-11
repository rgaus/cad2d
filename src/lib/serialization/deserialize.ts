import { ElementNode, parse, type Node } from 'svg-parser';
import type { Polygon, Rectangle, Ellipse, PolygonSegment } from '../tools/types';
import { SheetPosition } from '../viewport/types';
import { SHEET_UNITS_TO_PIXELS } from '../sheet/Sheet';
import { CAD2D_STATE_COMMENT_PREFIX, type SerializedState, migrateState } from './versions';
import { arcToLineSegments } from '../math';

/** Result of parsing an SVG file. */
export type ParseResult = {
  /** True if the file is a valid cad2d SVG (either native or fallback format). */
  isValid: boolean;
  /** The version number if found, null for fallback mode. */
  version: number | null;
  /** True if this was parsed as a fallback (plain SVG without cad2d magic comment). */
  isFallback: boolean;
  /** The parsed state (only valid if isValid is true). */
  state: SerializedState | null;
  /** Parsed polygons. */
  polygons: Array<Polygon>;
  /** Parsed rectangles. */
  rectangles: Array<Rectangle>;
  /** Parsed ellipses. */
  ellipses: Array<Ellipse>;
  /** Validation warnings logged during parsing. */
  warnings: Array<string>;
};

/** Converts a pixel coordinate to SheetPosition. */
function pixelsToSheetPosition(x: number, y: number): SheetPosition {
  return new SheetPosition(x / SHEET_UNITS_TO_PIXELS, y / SHEET_UNITS_TO_PIXELS);
}

/** Parses a hex color string to a number, or returns null for "none". */
function parseColor(color: string): number | null {
  if (color === 'none') {
    return null;
  }
  const hex = color.replace('#', '');
  return parseInt(hex, 16);
}

/** Extracts the magic cad2d state comment from SVG source. */
function extractStateComment(svg: string): { state: SerializedState; version: number } | null {
  const commentStart = svg.indexOf(`<!-- ${CAD2D_STATE_COMMENT_PREFIX}`);
  if (commentStart < 0) {
    return null;
  }
  const jsonStart = svg.indexOf('{', commentStart);
  const commentEnd = svg.indexOf('-->', commentStart);
  if (jsonStart < 0 || commentEnd < 0) {
    return null;
  }
  const jsonStr = svg.slice(jsonStart, commentEnd);
  try {
    const state = JSON.parse(jsonStr) as SerializedState;
    return { state, version: state.version };
  } catch {
    return null;
  }
}

/** Logs a warning during parsing. */
function warn(result: ParseResult, message: string): void {
  result.warnings.push(message);
  console.warn(`[cad2d] ${message}`);
}

/** Parses a <path> element as a polygon, handling both native cad2d format and fallback SVG paths.
 *  Returns null if the element couldn't be parsed as a valid polygon. */
function parsePolygonPath(
  element: { id?: string; 'data-type'?: string; 'data-segments'?: string; 'data-fill-color'?: string; 'data-closed'?: string; 'data-open-at-index'?: string; d?: string },
  svg: string,
  isNative: boolean
): Polygon | null {
  if (typeof element.id !== 'string') {
    return null;
  }

  if (isNative) {
    // Native cad2d format: use data-segments JSON
    try {
      const segments = JSON.parse(element['data-segments'] || '[]') as Array<PolygonSegment>;
      const fillColor = parseColor(element['data-fill-color'] || 'none');
      const closed = element['data-closed'] === 'true';
      const openAtIndex = parseInt(element['data-open-at-index'] || '0', 10);

      // Validate polygon has at least 3 points
      if (segments.length < 3) {
        return null;
      }

      return {
        id: element.id,
        points: segments,
        closed,
        fillColor,
        openAtIndex,
      };
    } catch {
      return null;
    }
  } else {
    // Fallback mode: parse SVG path d attribute
    const id = element.id;
    const d = element.d || '';
    const fillColor = parseColor(element['data-fill-color'] || 'none');

    // Parse the path to see if it contains only M (move) commands (which are "empty" for cad2d)
    const hasOnlyMoves = /^[\s,M]*$/.test(d);
    if (hasOnlyMoves) {
      console.warn(`[cad2d] path#${id}: ignoring path with only move commands - no geometry to extract`);
      return null;
    }

    // Parse path commands to detect arcs
    const commands = d.match(/[MLQC][^MLQC]*/gi) || [];

    // Check for quadratic (Q) or cubic (C) bezier commands - these indicate arcs
    const hasArc = /[QC]/i.test(d);
    if (hasArc) {
      // For fallback mode with arcs, we need to linearize the arc paths
      // This is a simplified approach - we parse the SVG path and convert arcs to line segments
      const polygon = parseFallbackArcPath(id, d, fillColor);
      if (polygon) {
        return polygon;
      }
    }

    // Parse as a simple line-only polygon
    const polygon = parseFallbackLinePath(id, d, fillColor);
    if (polygon) {
      return polygon;
    }

    return null;
  }
}

/** Parses a fallback SVG path that contains only lines (M and L commands). */
function parseFallbackLinePath(id: string, d: string, fillColor: number | null): Polygon | null {
  const points: Array<SheetPosition> = [];
  const commands = d.match(/[ML][^ML]*/gi) || [];

  for (const cmd of commands) {
    const type = cmd[0].toUpperCase();
    const coords = cmd.slice(1).trim().split(/[\s,]+/).map(Number);

    if (coords.length >= 2 && !isNaN(coords[0]) && !isNaN(coords[1])) {
      const x = parseFloat(coords[0].toFixed(2));
      const y = parseFloat(coords[1].toFixed(2));
      points.push(pixelsToSheetPosition(x, y));
    }
  }

  // Need at least 3 points for a valid polygon
  if (points.length < 3) {
    return null;
  }

  // Convert points to polygon segments
  const segments: Array<PolygonSegment> = points.map((point, i) => ({
    type: 'point' as const,
    point,
  }));

  return {
    id,
    points: segments,
    closed: false, // Fallback paths don't have explicit closed state
    fillColor,
    openAtIndex: 0,
  };
}

/** Parses a fallback SVG path that contains arcs (Q or C commands), linearizing them. */
function parseFallbackArcPath(id: string, d: string, fillColor: number | null): Polygon | null {
  const points: Array<SheetPosition> = [];
  const commands = d.match(/[MLQC][^MLQC]*/gi) || [];

  let currentX = 0;
  let currentY = 0;
  let startX = 0;
  let startY = 0;
  let segmentIndex = 0;

  for (const cmd of commands) {
    const type = cmd[0].toUpperCase();
    const coords = cmd.slice(1).trim().split(/[\s,]+/).map(Number);

    if (type === 'M') {
      // Move command
      if (coords.length >= 2) {
        currentX = parseFloat(coords[0].toFixed(2));
        currentY = parseFloat(coords[1].toFixed(2));
        startX = currentX;
        startY = currentY;
        points.push(pixelsToSheetPosition(currentX, currentY));
      }
    } else if (type === 'L') {
      // Line command
      if (coords.length >= 2) {
        currentX = parseFloat(coords[0].toFixed(2));
        currentY = parseFloat(coords[1].toFixed(2));
        points.push(pixelsToSheetPosition(currentX, currentY));
      }
    } else if (type === 'Q') {
      // Quadratic bezier - linearize it
      if (coords.length >= 4) {
        const cpX = parseFloat(coords[0].toFixed(2));
        const cpY = parseFloat(coords[1].toFixed(2));
        const endX = parseFloat(coords[2].toFixed(2));
        const endY = parseFloat(coords[3].toFixed(2));

        const curve = {
          start: new SheetPosition(currentX / SHEET_UNITS_TO_PIXELS, currentY / SHEET_UNITS_TO_PIXELS),
          controlPoint: new SheetPosition(cpX / SHEET_UNITS_TO_PIXELS, cpY / SHEET_UNITS_TO_PIXELS),
          end: new SheetPosition(endX / SHEET_UNITS_TO_PIXELS, endY / SHEET_UNITS_TO_PIXELS),
        };

        const samples = arcToLineSegments(curve);
        console.warn(`[cad2d] path#${id}: arc at segment index ${segmentIndex} (quadratic bezier) converted to ${samples.length - 1} line segments - arc semantics lost`);

        // Add all sample points except the first (already added as current point)
        for (let i = 1; i < samples.length; i++) {
          points.push(samples[i]);
        }

        currentX = endX;
        currentY = endY;
        segmentIndex++;
      }
    } else if (type === 'C') {
      // Cubic bezier - linearize it
      if (coords.length >= 6) {
        const cp1X = parseFloat(coords[0].toFixed(2));
        const cp1Y = parseFloat(coords[1].toFixed(2));
        const cp2X = parseFloat(coords[2].toFixed(2));
        const cp2Y = parseFloat(coords[3].toFixed(2));
        const endX = parseFloat(coords[4].toFixed(2));
        const endY = parseFloat(coords[5].toFixed(2));

        const curve = {
          start: new SheetPosition(currentX / SHEET_UNITS_TO_PIXELS, currentY / SHEET_UNITS_TO_PIXELS),
          controlPointA: new SheetPosition(cp1X / SHEET_UNITS_TO_PIXELS, cp1Y / SHEET_UNITS_TO_PIXELS),
          controlPointB: new SheetPosition(cp2X / SHEET_UNITS_TO_PIXELS, cp2Y / SHEET_UNITS_TO_PIXELS),
          end: new SheetPosition(endX / SHEET_UNITS_TO_PIXELS, endY / SHEET_UNITS_TO_PIXELS),
        };

        const samples = arcToLineSegments(curve);
        console.warn(`[cad2d] path#${id}: arc at segment index ${segmentIndex} (cubic bezier with 2 control points) converted to ${samples.length - 1} line segments - arc semantics lost`);

        // Add all sample points except the first (already added as current point)
        for (let i = 1; i < samples.length; i++) {
          points.push(samples[i]);
        }

        currentX = endX;
        currentY = endY;
        segmentIndex++;
      }
    }
  }

  // Need at least 3 points for a valid polygon
  if (points.length < 3) {
    return null;
  }

  // Convert points to polygon segments
  const segments: Array<PolygonSegment> = points.map((point) => ({
    type: 'point' as const,
    point,
  }));

  return {
    id,
    points: segments,
    closed: false,
    fillColor,
    openAtIndex: 0,
  };
}

/** Parses a <rect> element into a Rectangle. */
function parseRectangle(element: { id?: string; 'data-type'?: string; 'data-fill-color'?: string; 'data-link-dimensions'?: string; x?: string; y?: string; width?: string; height?: string }): Rectangle | null {
  if (typeof element.id !== 'string') {
    return null;
  }

  const x = parseFloat(element.x || '0');
  const y = parseFloat(element.y || '0');
  const width = parseFloat(element.width || '0');
  const height = parseFloat(element.height || '0');
  const fillColor = parseColor(element['data-fill-color'] || 'none');
  const linkDimensions = element['data-link-dimensions'] === 'true';

  if (width <= 0 || height <= 0) {
    warn({ isValid: false, version: null, isFallback: false, state: null, polygons: [], rectangles: [], ellipses: [], warnings: [] } as any, `rect#${element.id}: width and height must be positive, got ${width}x${height}`);
    return null;
  }

  const upperLeft = pixelsToSheetPosition(x, y);
  const lowerRight = pixelsToSheetPosition(x + width, y + height);

  return {
    id: element.id,
    upperLeft,
    lowerRight,
    fillColor,
    linkDimensions,
  };
}

/** Parses an <ellipse> element into an Ellipse. */
function parseEllipse(element: { id?: string; 'data-type'?: string; 'data-fill-color'?: string; 'data-link-dimensions'?: string; cx?: string; cy?: string; rx?: string; ry?: string }): Ellipse | null {
  if (typeof element.id !== 'string') {
    return null;
  }

  const cx = parseFloat(element.cx || '0');
  const cy = parseFloat(element.cy || '0');
  const rx = parseFloat(element.rx || '0');
  const ry = parseFloat(element.ry || '0');
  const fillColor = parseColor(element['data-fill-color'] || 'none');
  const linkDimensions = element['data-link-dimensions'] === 'true';

  if (rx <= 0 || ry <= 0) {
    return null;
  }

  const center = pixelsToSheetPosition(cx, cy);

  return {
    id: element.id,
    center,
    radiusX: rx,
    radiusY: ry,
    fillColor,
    linkDimensions,
  };
}

/**
 * Parses an SVG string into cad2d geometry and state.
 * Supports both native cad2d SVG (with magic comment) and fallback plain SVG.
 */
export function parseSvg(svg: string): ParseResult {
  const result: ParseResult = {
    isValid: false,
    version: null,
    isFallback: false,
    state: null,
    polygons: [],
    rectangles: [],
    ellipses: [],
    warnings: [],
  };

  // Check if this is a native cad2d file
  const stateInfo = extractStateComment(svg);
  if (stateInfo !== null) {
    result.isFallback = true;
  }

  // Try to parse the SVG
  let parsed;
  try {
    parsed = parse(svg);
  } catch (e) {
    warn(result, `Failed to parse SVG: ${e}`);
    return result;
  }

  if (!parsed || !parsed.children || parsed.children.length <= 0) {
    warn(result, 'SVG has no children elements');
    return result;
  }

  // Extract version from data attribute or state comment
  const svgTag = parsed.children.find((c): c is ElementNode => c.type === 'element' && c.tagName === 'svg');
  if (svgTag) {
    const parsedVersion = parseInt(`${svgTag.properties?.['data-cad2d-version'] ?? 0}`, 10);
    result.version = !Number.isNaN(parsedVersion) ? parsedVersion : null;
  }

  // Iterate through all elements in the SVG
  function processElement(element: Node): void {
    if (element.type !== 'element') {
      return;
    }

    const tagName = element.tagName?.toLowerCase();
    const attrs = element.properties ?? {};

    if (tagName === 'rect') {
      const rect = parseRectangle(attrs);
      if (rect) {
        result.rectangles.push(rect);
      }
    } else if (tagName === 'ellipse') {
      const ellipse = parseEllipse(attrs);
      if (ellipse) {
        result.ellipses.push(ellipse);
      }
    } else if (tagName === 'path') {
      const polygon = parsePolygonPath(attrs, svg, !result.isFallback);
      if (polygon) {
        result.polygons.push(polygon);
      }
    }

    // Process children if any
    if (element.children) {
      for (const child of element.children) {
        if (typeof child === 'string') {
          continue;
        }
        processElement(child);
      }
    }
  }

  // Process all top-level elements
  for (const child of parsed.children) {
    processElement(child);
  }

  // If we have a magic comment, parse and migrate the state
  if (stateInfo) {
    try {
      result.state = migrateState(stateInfo.state);
      result.isValid = true;
    } catch (e) {
      warn(result, `Failed to migrate state: ${e}`);
      return result;
    }
  } else {
    // Fallback mode: construct a reasonable default state
    result.isValid = result.polygons.length > 0 || result.rectangles.length > 0 || result.ellipses.length > 0;
  }

  return result;
}

/**
 * Checks if an SVG string is a valid cad2d file (either native or fallback).
 */
export function canLoad(svg: string): { isValid: boolean; version: number | null; isFallback: boolean } {
  if (typeof svg !== 'string' || svg.trim().length === 0) {
    return { isValid: false, version: null, isFallback: false };
  }

  if (!svg.includes('<svg')) {
    return { isValid: false, version: null, isFallback: false };
  }

  const hasMagic = hasCad2DMagicComment(svg);
  const stateInfo = extractStateComment(svg);

  if (stateInfo) {
    return { isValid: true, version: stateInfo.version, isFallback: false };
  }

  // Check if it looks like a fallback SVG with drawable geometry
  if (svg.includes('<path') || svg.includes('<rect') || svg.includes('<ellipse')) {
    return { isValid: true, version: null, isFallback: true };
  }

  return { isValid: false, version: null, isFallback: false };
}
