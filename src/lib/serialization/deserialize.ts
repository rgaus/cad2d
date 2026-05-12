import { ElementNode, parse, type Node } from 'svg-parser';
import type { Polygon, Rectangle, Ellipse, PolygonSegment } from '../tools/types';
import colorRgba from 'color-rgba';
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
function parseColor(color?: string): number | null {
  if (typeof color === 'undefined' || color === 'transparent') {
    return null;
  }
  const rgba = colorRgba(color);
  if (rgba.length !== 0) {
    return ((rgba[0] << 16) | (rgba[1] << 8) | rgba[2]) >>> 0;
  } else {
    return null;
  }
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

/** Parses a <path> element as a polygon by parsing the `d` attribute.
 *  Q = arc-quadratic, C = arc-cubic, M/L = point.
 *  Returns null if the element couldn't be parsed as a valid polygon. */
function parsePolygonPath(
  element: { id?: string; fill?: string; 'data-closed'?: string; 'data-open-at-index'?: string; d?: string },
  isFallback: boolean
): Polygon | null {
  if (typeof element.id !== 'string') {
    return null;
  }

  const id = element.id;
  const d = element.d || '';
  const fillColor = parseColor(element.fill);
  const closed = element['data-closed'] === 'true';
  const openAtIndex = parseInt(element['data-open-at-index'] || '0', 10);

  // Parse path commands
  const commands = d.match(/[MLQC][^MLQC]*/gi) || [];
  if (commands.length < 2) {
    return null;
  }

  const points: Array<PolygonSegment> = [];
  let currentX = 0;
  let currentY = 0;
  let isAllMoves = true;

  for (const cmd of commands) {
    const type = cmd[0].toUpperCase();
    const coords = cmd.slice(1).trim().split(/[\s,]+/).map(Number).filter(n => !isNaN(n));

    if (type === 'M' && coords.length >= 2) {
      currentX = coords[0];
      currentY = coords[1];
      points.push({ type: 'point', point: pixelsToSheetPosition(currentX, currentY) });
    } else if (type === 'L' && coords.length >= 2) {
      currentX = coords[0];
      currentY = coords[1];
      points.push({ type: 'point', point: pixelsToSheetPosition(currentX, currentY) });
      isAllMoves = false;
    } else if (type === 'Q' && coords.length >= 4) {
      const cpX = coords[0];
      const cpY = coords[1];
      const endX = coords[2];
      const endY = coords[3];
      points.push({
        type: 'arc-quadratic',
        point: pixelsToSheetPosition(endX, endY),
        controlPoint: pixelsToSheetPosition(cpX, cpY),
      });
      currentX = endX;
      currentY = endY;
      isAllMoves = false;
    } else if (type === 'C' && coords.length >= 6) {
      const cp1X = coords[0];
      const cp1Y = coords[1];
      const cp2X = coords[2];
      const cp2Y = coords[3];
      const endX = coords[4];
      const endY = coords[5];
      points.push({
        type: 'arc-cubic',
        point: pixelsToSheetPosition(endX, endY),
        controlPointA: pixelsToSheetPosition(cp1X, cp1Y),
        controlPointB: pixelsToSheetPosition(cp2X, cp2Y),
      });
      currentX = endX;
      currentY = endY;
      isAllMoves = false;
    }
  }

  // Parse the path to see if it contains only M (move) commands (which are "empty" for cad2d)
  if (isAllMoves) {
    console.warn(`[cad2d] path#${id}: ignoring path with only move commands - no geometry to extract`);
    return null;
  }

  if (points.length < 2) {
    return null;
  }

  if (isFallback) {
    console.warn(`[cad2d] path#${id}: arcs are linearized during fallback parse - arc semantics lost`);
  }

  return {
    id,
    points,
    closed,
    fillColor,
    openAtIndex,
  };
}

/** Parses a <polygon> element as a closed polygon by parsing the `points` attribute.
 *  Returns null if the element couldn't be parsed as a valid polygon. */
function parsePolygonPolygon(
  element: { id?: string; fill?: string; 'data-open-at-index'?: string; points?: string },
): Polygon | null {
  if (typeof element.id !== 'string') {
    return null;
  }

  const id = element.id;
  const fillColor = parseColor(element.fill);
  const openAtIndex = parseInt(element['data-open-at-index'] || '0', 10);

  if (!element.points) {
    return null;
  }

  const splitPoints = element.points
    .split(/[^0-9\.e]/i)
    .filter(entry => entry.length > 0)
    .map(point => {
      // Matches stuff like 1.2e3.4
      const result = point.match(/^([0-9]+(?:\.[0-9]*)?)e([0-9]+(?:\.[0-9]*)?)$/i);
      if (result) {
        const base = result[1];
        const pow = result[2];
        return parseFloat(base) * Math.pow(10, parseFloat(pow));
      } else {
        return parseFloat(point);
      }
    });
  if (splitPoints.length % 2 !== 0) {
    // Must have an even number of points
    return null;
  }
  const points: Array<PolygonSegment> = new Array(splitPoints.length / 2).fill(0).map((_, index) => {
    return { type: 'point', point: pixelsToSheetPosition(splitPoints[index*2], splitPoints[(index*2)+1]) };
  });
  if (points.length < 3) {
    // Must have enough points for a valid geometry
    return null;
  }

  // Duplicate the first point at the end, since it is a closed polygon
  points.push(points[0]);

  return {
    id,
    points,
    closed: true,
    fillColor,
    openAtIndex,
  };
}

/** Parses a <rect> element into a Rectangle. */
function parseRectangle(element: { id?: string; fill?: string; 'data-link-dimensions'?: string; x?: string; y?: string; width?: string; height?: string }): Rectangle | null {
  if (typeof element.id !== 'string') {
    return null;
  }

  const x = parseFloat(element.x || '0');
  const y = parseFloat(element.y || '0');
  const width = parseFloat(element.width || '0');
  const height = parseFloat(element.height || '0');
  const fillColor = parseColor(element.fill || 'none');
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
function parseEllipse(element: { id?: string; fill?: string; 'data-link-dimensions'?: string; cx?: string; cy?: string; rx?: string; ry?: string }): Ellipse | null {
  if (typeof element.id !== 'string') {
    return null;
  }

  const cx = parseFloat(element.cx || '0');
  const cy = parseFloat(element.cy || '0');
  const rx = parseFloat(element.rx || '0') / SHEET_UNITS_TO_PIXELS;
  const ry = parseFloat(element.ry || '0') / SHEET_UNITS_TO_PIXELS;
  const fillColor = parseColor(element.fill);
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

    switch (attrs['data-type']) {
      case 'rectangle':
        if (tagName === 'rect') {
          const rect = parseRectangle(attrs);
          if (rect) {
            result.rectangles.push(rect);
          }
        } else {
          warn(result, `data-type=rectangle was not rect, found ${tagName}`);
        }
        break;
      case 'ellipse':
        if (tagName === 'ellipse') {
          const ellipse = parseEllipse(attrs);
          if (ellipse) {
            result.ellipses.push(ellipse);
          }
        } else {
          warn(result, `data-type=ellipse was not ellipse, found ${tagName}`);
        }
        break;
      case 'polygon':
        let polygon;
        switch (tagName) {
          case 'path':
            polygon = parsePolygonPath(attrs, !result.isFallback);
            if (polygon) {
              result.polygons.push(polygon);
            }
            break;
          case 'polygon':
            polygon = parsePolygonPolygon(attrs);
            if (polygon) {
              result.polygons.push(polygon);
            }
            break;
        }
        break;
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
