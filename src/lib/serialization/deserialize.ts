import colorRgba from 'color-rgba';
import { ElementNode, type Node, parse } from 'svg-parser';
import {
  ColinearConstraint,
  ConstraintComponent,
  ConstraintEndpoint,
  Datum,
  Ellipse,
  Entity,
  HorizontalConstraint,
  Id,
  LinearConstraint,
  ParallelConstraint,
  PerpendicularConstraint,
  Polygon,
  PolygonSegment,
  Rectangle,
  RenderOrderComponent,
  VerticalConstraint,
} from '@/lib/entity';
import { ID_PREFIXES } from '@/lib/entity/GeometryStore';
import {
  CentimetersLength,
  FeetLength,
  InchesLength,
  type Length,
  MetersLength,
  MillimetersLength,
} from '@/lib/units/length';
import { SheetPosition } from '@/lib/viewport/types';
import { SHEET_UNITS_TO_PIXELS } from '../sheet/Sheet';
import { CAD2D_STATE_COMMENT_PREFIX, type SerializedState, migrateState } from './versions';

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
  /** Parsed constraints. */
  constraints: Array<Entity<ConstraintComponent>>;
  /** Parsed datums. */
  datums: Array<Datum>;
  /** Validation warnings logged during parsing. */
  warnings: Array<string>;
};

/** Converts a pixel coordinate to SheetPosition. */
function pixelsToSheetPosition(x: number, y: number): SheetPosition {
  return new SheetPosition(x / SHEET_UNITS_TO_PIXELS, y / SHEET_UNITS_TO_PIXELS);
}

/** Extracts the render order from element data-render-order, or computes next. */
function parseRenderOrder(
  element: { 'data-render-order'?: string },
  lastRenderOrder?: number,
): number {
  if (element['data-render-order'] !== undefined) {
    return parseInt(element['data-render-order'], 10);
  }
  return (lastRenderOrder ?? 0) + 1;
}

/** Parses a hex color string to a number, or returns null for "none". */
function parseColor(color?: string): number | null {
  if (typeof color === 'undefined' || color === 'transparent' || color === 'none') {
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
 *  Q = arc-quadratic, C = arc-cubic, M/L/H/V = point.
 *  Returns null if the element couldn't be parsed as a valid polygon.
 *  @param lastRenderOrder - The render order to use if data-render-order is not set (auto-incrementing)
 *  @returns [polygon, nextRenderOrder] */
function parsePolygonPath(
  element: {
    id?: string;
    fill?: string;
    'data-closed'?: string;
    'data-open-at-index'?: string;
    'data-render-order'?: string;
    d?: string;
  },
  generateId: (prefix?: string) => Id,
  rewrittenIdMap: Map<Id, Id>,
  doesIdExist: (id: Id) => boolean,
  lastRenderOrder?: number,
): [Polygon, number] | null {
  let id = element.id;
  if (typeof id === 'undefined' || doesIdExist(id)) {
    // Generate id if the id was missing or already exists
    id = generateId(ID_PREFIXES.polygon);
    if (typeof element.id !== 'undefined') {
      rewrittenIdMap.set(element.id, id);
    }
  } else {
    // Rewrite the id if it was previously marked as rewritten
    const rewritten = rewrittenIdMap.get(id);
    if (rewritten) {
      id = rewritten;
    }
  }

  const d = element.d || '';
  const fillColor = parseColor(element.fill);
  // NOTE: data-closed is deprecated / is here for backwards compatibility.
  let closed = element['data-closed'] === 'true';
  const openAtIndex = parseInt(element['data-open-at-index'] || '0', 10);
  const renderOrder = parseRenderOrder(element, lastRenderOrder);

  // Parse path commands
  const commands = d.match(/[MLQCZHV][^MLQCZHV]*/gi) || [];
  if (commands.length < 2) {
    return null;
  }

  const points: Array<PolygonSegment> = [];
  let currentX = 0;
  let currentY = 0;
  let isAllMoves = true;

  for (const cmd of commands) {
    const type = cmd[0].toUpperCase();
    const coords = cmd
      .slice(1)
      .trim()
      .split(/[\s,]+/)
      .map(Number)
      .filter((n) => !isNaN(n));

    if (type === 'M' && coords.length >= 2) {
      currentX = coords[0];
      currentY = coords[1];
      points.push({ type: 'point', point: pixelsToSheetPosition(currentX, currentY) });
    } else if (type === 'L' && coords.length >= 2) {
      currentX = coords[0];
      currentY = coords[1];
      points.push({ type: 'point', point: pixelsToSheetPosition(currentX, currentY) });
      isAllMoves = false;
    } else if (type === 'H' && coords.length >= 1) {
      currentX = coords[0];
      points.push({ type: 'point', point: pixelsToSheetPosition(currentX, currentY) });
      isAllMoves = false;
    } else if (type === 'V' && coords.length >= 1) {
      currentY = coords[0];
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
    } else if (
      type === 'Z' &&
      points.length >= 3 /* a less than 3 point polygon cannot be closed. */
    ) {
      closed = true;

      // Add a point segment to close the polygon, if it wasn't already closed
      const firstPoint = points[0];
      const firstPointSheetPosX = firstPoint ? firstPoint.point.x * SHEET_UNITS_TO_PIXELS : null;
      const firstPointSheetPosY = firstPoint ? firstPoint.point.y * SHEET_UNITS_TO_PIXELS : null;
      if (firstPointSheetPosX !== currentX || firstPointSheetPosY !== currentY) {
        points.push({
          type: 'point',
          point: firstPoint.point,
        });
      }
    }
  }

  // Parse the path to see if it contains only M (move) commands (which are "empty" for cad2d)
  if (isAllMoves) {
    console.warn(
      `[cad2d] path#${id}: ignoring path with only move commands - no geometry to extract`,
    );
    return null;
  }

  if (points.length < 2) {
    return null;
  }

  const polygonTemplate = Polygon.create(points, {
    closed,
    fillColor,
    openAtIndex,
  });

  return [
    {
      id,
      ...polygonTemplate,
      components: {
        ...polygonTemplate.components,
        ...RenderOrderComponent.create(renderOrder),
      },
    },
    renderOrder,
  ];
}

/** Parses a <polygon> element as a closed polygon by parsing the `points` attribute.
 *  Returns null if the element couldn't be parsed as a valid polygon.
 *  @param lastRenderOrder - The render order to use if data-render-order is not set (auto-incrementing)
 *  @returns [polygon, nextRenderOrder] */
function parsePolygonPolygon(
  element: {
    id?: string;
    fill?: string;
    'data-open-at-index'?: string;
    'data-render-order'?: string;
    points?: string;
  },
  generateId: (prefix?: string) => Id,
  rewrittenIdMap: Map<Id, Id>,
  doesIdExist: (id: Id) => boolean,
  lastRenderOrder?: number,
): [Polygon, number] | null {
  let id = element.id;
  if (typeof id === 'undefined' || doesIdExist(id)) {
    // Generate id if the id was missing or already exists
    id = generateId(ID_PREFIXES.polygon);
    if (typeof element.id !== 'undefined') {
      rewrittenIdMap.set(element.id, id);
    }
  } else {
    // Rewrite the id if it was previously marked as rewritten
    const rewritten = rewrittenIdMap.get(id);
    if (rewritten) {
      id = rewritten;
    }
  }

  const fillColor = parseColor(element.fill);
  const openAtIndex = parseInt(element['data-open-at-index'] || '0', 10);
  const renderOrder = parseRenderOrder(element, lastRenderOrder);

  if (!element.points) {
    return null;
  }

  const splitPoints = element.points
    .split(/[^0-9\.e]/i)
    .filter((entry) => entry.length > 0)
    .map((point) => {
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
  const points: Array<PolygonSegment> = new Array(splitPoints.length / 2)
    .fill(0)
    .map((_, index) => {
      return {
        type: 'point',
        point: pixelsToSheetPosition(splitPoints[index * 2], splitPoints[index * 2 + 1]),
      };
    });
  if (points.length < 3) {
    // Must have enough points for a valid geometry
    return null;
  }

  // Duplicate the first point at the end, since it is a closed polygon
  points.push(points[0]);

  const polygonTemplate = Polygon.create(points, {
    closed: true,
    fillColor,
    openAtIndex,
  });

  return [
    {
      id,
      ...polygonTemplate,
      components: {
        ...polygonTemplate.components,
        ...RenderOrderComponent.create(renderOrder),
      },
    },
    renderOrder,
  ];
}

/** Parses a <rect> element into a Rectangle.
 *  @param lastRenderOrder - The render order to use if data-render-order is not set (auto-incrementing)
 *  @returns [rectangle, nextRenderOrder] */
function parseRectangle(
  element: {
    id?: string;
    fill?: string;
    'data-link-dimensions'?: string;
    'data-render-order'?: string;
    x?: string;
    y?: string;
    width?: string;
    height?: string;
  },
  generateId: (prefix?: string) => Id,
  rewrittenIdMap: Map<Id, Id>,
  doesIdExist: (id: Id) => boolean,
  lastRenderOrder?: number,
): [Rectangle, number] | null {
  let id = element.id;
  if (typeof id === 'undefined' || doesIdExist(id)) {
    // Generate id if the id was missing or already exists
    id = generateId(ID_PREFIXES.rectangle);
    if (typeof element.id !== 'undefined') {
      rewrittenIdMap.set(element.id, id);
    }
  } else {
    // Rewrite the id if it was previously marked as rewritten
    const rewritten = rewrittenIdMap.get(id);
    if (rewritten) {
      id = rewritten;
    }
  }

  const x = parseFloat(element.x || '0');
  const y = parseFloat(element.y || '0');
  const width = parseFloat(element.width || '0');
  const height = parseFloat(element.height || '0');
  const fillColor = parseColor(element.fill || 'none');
  const linkDimensions = element['data-link-dimensions'] === 'true';
  const renderOrder = parseRenderOrder(element, lastRenderOrder);

  if (width <= 0 || height <= 0) {
    warn(
      {
        isValid: false,
        version: null,
        isFallback: false,
        state: null,
        polygons: [],
        rectangles: [],
        ellipses: [],
        warnings: [],
      } as any,
      `rect#${element.id}: width and height must be positive, got ${width}x${height}`,
    );
    return null;
  }

  const upperLeft = pixelsToSheetPosition(x, y);
  const lowerRight = pixelsToSheetPosition(x + width, y + height);

  const rectangleTemplate = Rectangle.create(upperLeft, lowerRight, {
    fillColor,
    linkDimensions,
  });

  return [
    {
      id,
      ...rectangleTemplate,
      components: {
        ...rectangleTemplate.components,
        ...RenderOrderComponent.create(renderOrder),
      },
    },
    renderOrder,
  ];
}

/** Parses an <ellipse> element into an Ellipse.
 *  @param lastRenderOrder - The render order to use if data-render-order is not set (auto-incrementing)
 *  @returns [ellipse, nextRenderOrder] */
function parseEllipse(
  element: {
    id?: string;
    fill?: string;
    'data-link-dimensions'?: string;
    'data-render-order'?: string;
    cx?: string;
    cy?: string;
    rx?: string;
    ry?: string;
  },
  generateId: (prefix?: string) => Id,
  rewrittenIdMap: Map<Id, Id>,
  doesIdExist: (id: Id) => boolean,
  lastRenderOrder?: number,
): [Ellipse, number] | null {
  let id = element.id;
  if (typeof id === 'undefined' || doesIdExist(id)) {
    // Generate id if the id was missing or already exists
    id = generateId(ID_PREFIXES.ellipse);
    if (typeof element.id !== 'undefined') {
      rewrittenIdMap.set(element.id, id);
    }
  } else {
    // Rewrite the id if it was previously marked as rewritten
    const rewritten = rewrittenIdMap.get(id);
    if (rewritten) {
      id = rewritten;
    }
  }

  const cx = parseFloat(element.cx || '0');
  const cy = parseFloat(element.cy || '0');
  const rx = parseFloat(element.rx || '0') / SHEET_UNITS_TO_PIXELS;
  const ry = parseFloat(element.ry || '0') / SHEET_UNITS_TO_PIXELS;
  const fillColor = parseColor(element.fill);
  const linkDimensions = element['data-link-dimensions'] === 'true';
  const renderOrder = parseRenderOrder(element, lastRenderOrder);

  if (rx <= 0 || ry <= 0) {
    return null;
  }

  const center = pixelsToSheetPosition(cx, cy);

  const ellipseTemplate = Ellipse.create(center, {
    radiusX: rx,
    radiusY: ry,
    fillColor,
    linkDimensions,
  });

  return [
    {
      id,
      ...ellipseTemplate,
      components: {
        ...ellipseTemplate.components,
        ...RenderOrderComponent.create(renderOrder),
      },
    },
    renderOrder,
  ];
}

/** Parses a <g data-type="datum"> element into a Datum.
 *  Render order is hardcoded to 0 since datums always render above geometry. */
function parseDatum(
  element: {
    id?: string;
    'data-x'?: string;
    'data-y'?: string;
  },
  generateId: (prefix?: string) => Id,
  rewrittenIdMap: Map<Id, Id>,
  doesIdExist: (id: Id) => boolean,
): [Datum, number] | null {
  let id = element.id;
  if (typeof id === 'undefined' || doesIdExist(id)) {
    id = generateId(ID_PREFIXES.datum);
    if (typeof element.id !== 'undefined') {
      rewrittenIdMap.set(element.id, id);
    }
  } else {
    const rewritten = rewrittenIdMap.get(id);
    if (rewritten) {
      id = rewritten;
    }
  }

  const x = parseFloat(element['data-x'] || '0');
  const y = parseFloat(element['data-y'] || '0');

  const template = Datum.create(new SheetPosition(x, y));

  return [
    {
      id,
      ...template,
      components: {
        ...template.components,
        ...RenderOrderComponent.create(0),
      },
    },
    0,
  ];
}

/** Parses a single ConstraintEndpoint from SVG data attributes. */
function parseEndpoint(
  attrs: Record<string, string | number>,
  rewrittenIdMap: Map<Id, Id>,
  prefix: string,
): ConstraintEndpoint | null {
  const type = attrs[`data-${prefix}-type`];
  if (!type) {
    // Old format: data-point-a-x/y for endpoint-a, data-point-b-x/y for endpoint-b
    const oldSuffix = prefix === 'endpoint-a' ? 'a' : 'b';
    const xKey = `data-point-${oldSuffix}-x`;
    const yKey = `data-point-${oldSuffix}-y`;
    const x = typeof attrs[xKey] === 'number' ? attrs[xKey] : parseFloat(`${attrs[xKey]}`);
    const y = typeof attrs[yKey] === 'number' ? attrs[yKey] : parseFloat(`${attrs[yKey]}`);
    if (Number.isNaN(x) || Number.isNaN(y)) {
      return null;
    }
    return { type: 'point', point: new SheetPosition(x, y) };
  }

  const getId = (id: string) => {
    // Rewrite the id if it was previously marked as rewritten
    const rewritten = rewrittenIdMap.get(id);
    if (rewritten) {
      return rewritten;
    } else {
      return id;
    }
  };

  switch (type) {
    case 'point': {
      const rawX = attrs[`data-${prefix}-x`];
      const rawY = attrs[`data-${prefix}-y`];
      const x: number = typeof rawX === 'number' ? rawX : parseFloat(`${rawX}`);
      const y: number = typeof rawY === 'number' ? rawY : parseFloat(`${rawY}`);
      if (Number.isNaN(x) || Number.isNaN(y)) {
        return null;
      }
      return ConstraintEndpoint.point(new SheetPosition(x, y));
    }
    case 'locked-rectangle': {
      const id = getId(`${attrs[`data-${prefix}-id`]}`);
      const point = `${attrs[`data-${prefix}-point`]}` as any;
      return ConstraintEndpoint.lockedToRectangle(id, point);
    }
    case 'locked-ellipse': {
      const id = getId(`${attrs[`data-${prefix}-id`]}`);
      const point = `${attrs[`data-${prefix}-point`]}` as any;
      return ConstraintEndpoint.lockedToEllipse(id, point);
    }
    case 'locked-polygon': {
      const id = getId(`${attrs[`data-${prefix}-id`]}`);
      const rawIndex = attrs[`data-${prefix}-point-index`];
      const pointIndex: number =
        typeof rawIndex === 'number' ? rawIndex : parseInt(`${rawIndex}`, 10);
      if (Number.isNaN(pointIndex)) {
        return null;
      }
      return ConstraintEndpoint.lockedToPolygon(id, pointIndex);
    }
    case 'locked-datum': {
      const id = getId(`${attrs[`data-${prefix}-id`]}`);
      return ConstraintEndpoint.lockedToDatum(id);
    }
    default:
      return null;
  }
}

/** Parses a <g> element with data-type="linear-constraint" into a Constraint object.
 *  Ignores inner children - all data comes from data-* attributes. */
function parseConstraint(
  attrs: Record<string, string | number>,
  rewrittenIdMap: Map<Id, Id>,
  doesIdExist: (id: Id) => boolean,
  generateId: (prefix?: string) => string,
): Entity<ConstraintComponent> | null {
  let id = attrs.id as string | undefined;
  if (typeof id === 'undefined' || doesIdExist(id)) {
    // Generate id if the id was missing or already exists
    id = generateId(ID_PREFIXES.constraint);
    if (typeof attrs.id !== 'undefined') {
      rewrittenIdMap.set(attrs.id as Id, id);
    }
  } else {
    // Rewrite the id if it was previously marked as rewritten
    const rewritten = rewrittenIdMap.get(id);
    if (rewritten) {
      id = rewritten;
    }
  }

  const offset =
    typeof attrs['data-offset'] === 'number'
      ? attrs['data-offset']
      : parseFloat(`${attrs['data-offset']}`);
  const lengthMag =
    typeof attrs['data-length-mag'] === 'number'
      ? attrs['data-length-mag']
      : parseFloat(`${attrs['data-length-mag']}`);
  const lengthType =
    typeof attrs['data-length-type'] === 'string'
      ? attrs['data-length-type']
      : `${attrs['data-length-type']}`;

  if (Number.isNaN(offset) || Number.isNaN(lengthMag)) {
    warn(
      {
        isValid: false,
        version: null,
        isFallback: false,
        state: null,
        polygons: [],
        rectangles: [],
        ellipses: [],
        constraints: [],
        warnings: [],
      } as any,
      `constraint: missing or invalid required attributes`,
    );
    return null;
  }

  const pointA = parseEndpoint(attrs, rewrittenIdMap, 'endpoint-a');
  const pointB = parseEndpoint(attrs, rewrittenIdMap, 'endpoint-b');
  if (!pointA || !pointB) {
    warn(
      {
        isValid: false,
        version: null,
        isFallback: false,
        state: null,
        polygons: [],
        rectangles: [],
        ellipses: [],
        constraints: [],
        warnings: [],
      } as any,
      `constraint: missing or invalid endpoint`,
    );
    return null;
  }

  let constrainedLength: Length;
  switch (lengthType) {
    case 'in':
      constrainedLength = new InchesLength(lengthMag);
      break;
    case 'ft':
      constrainedLength = new FeetLength(lengthMag);
      break;
    case 'mm':
      constrainedLength = new MillimetersLength(lengthMag);
      break;
    case 'cm':
      constrainedLength = new CentimetersLength(lengthMag);
      break;
    case 'm':
      constrainedLength = new MetersLength(lengthMag);
      break;
    default:
      constrainedLength = new CentimetersLength(lengthMag);
  }

  return {
    id,
    ...LinearConstraint.create(pointA, pointB, constrainedLength, {
      connectorLineOffsetPx: offset,
      axis: typeof attrs['data-axis'] === 'string' ? (attrs['data-axis'] as 'x' | 'y') : null,
    }),
  };
}

/** Parses a <g> element with data-type="perpendicular-constraint" into a PerpendicularConstraint object. */
function parsePerpendicularConstraint(
  attrs: Record<string, string | number>,
  rewrittenIdMap: Map<Id, Id>,
  doesIdExist: (id: Id) => boolean,
  generateId: (prefix?: string) => string,
): Entity<ConstraintComponent> | null {
  let id = attrs.id as string | undefined;
  if (typeof id === 'undefined' || doesIdExist(id)) {
    // Generate id if the id was missing or already exists
    id = generateId(ID_PREFIXES.constraint);
    if (typeof attrs.id !== 'undefined') {
      rewrittenIdMap.set(attrs.id as Id, id);
    }
  } else {
    // Rewrite the id if it was previously marked as rewritten
    const rewritten = rewrittenIdMap.get(id);
    if (rewritten) {
      id = rewritten;
    }
  }

  const pointA = parseEndpoint(attrs, rewrittenIdMap, 'endpoint-a');
  const pointCenter = parseEndpoint(attrs, rewrittenIdMap, 'endpoint-center');
  const pointC = parseEndpoint(attrs, rewrittenIdMap, 'endpoint-c');
  if (!pointA || !pointCenter || !pointC) {
    warn(
      {
        isValid: false,
        version: null,
        isFallback: false,
        state: null,
        polygons: [],
        rectangles: [],
        ellipses: [],
        constraints: [],
        warnings: [],
      } as any,
      `perpendicular constraint: missing or invalid endpoint`,
    );
    return null;
  }

  return {
    id,
    ...PerpendicularConstraint.create(pointA, pointCenter, pointC),
  };
}

/** Parses a <g> element with data-type="parallel-constraint" into a ParallelConstraint object. */
function parseParallelConstraint(
  attrs: Record<string, string | number>,
  rewrittenIdMap: Map<Id, Id>,
  doesIdExist: (id: Id) => boolean,
  generateId: (prefix?: string) => string,
): Entity<ConstraintComponent> | null {
  let id = attrs.id as string | undefined;
  if (typeof id === 'undefined' || doesIdExist(id)) {
    // Generate id if the id was missing or already exists
    id = generateId(ID_PREFIXES.constraint);
    if (typeof attrs.id !== 'undefined') {
      rewrittenIdMap.set(attrs.id as Id, id);
    }
  } else {
    // Rewrite the id if it was previously marked as rewritten
    const rewritten = rewrittenIdMap.get(id);
    if (rewritten) {
      id = rewritten;
    }
  }

  const pointA = parseEndpoint(attrs, rewrittenIdMap, 'endpoint-a');
  const pointB = parseEndpoint(attrs, rewrittenIdMap, 'endpoint-b');
  const pointC = parseEndpoint(attrs, rewrittenIdMap, 'endpoint-c');
  const pointD = parseEndpoint(attrs, rewrittenIdMap, 'endpoint-d');
  if (!pointA || !pointB || !pointC || !pointD) {
    warn(
      {
        isValid: false,
        version: null,
        isFallback: false,
        state: null,
        polygons: [],
        rectangles: [],
        ellipses: [],
        constraints: [],
        warnings: [],
      } as any,
      `parallel constraint: missing or invalid endpoint`,
    );
    return null;
  }

  return {
    id,
    ...ParallelConstraint.create(pointA, pointB, pointC, pointD),
  };
}

/** Parses a <g> element with data-type="horizontal-constraint" into a HorizontalConstraint object. */
function parseHorizontalConstraint(
  attrs: Record<string, string | number>,
  rewrittenIdMap: Map<Id, Id>,
  doesIdExist: (id: Id) => boolean,
  generateId: (prefix?: string) => string,
): Entity<ConstraintComponent> | null {
  let id = attrs.id as string | undefined;
  if (typeof id === 'undefined' || doesIdExist(id)) {
    id = generateId(ID_PREFIXES.constraint);
    if (typeof attrs.id !== 'undefined') {
      rewrittenIdMap.set(attrs.id as Id, id);
    }
  } else {
    const rewritten = rewrittenIdMap.get(id);
    if (rewritten) {
      id = rewritten;
    }
  }

  const pointA = parseEndpoint(attrs, rewrittenIdMap, 'endpoint-a');
  const pointB = parseEndpoint(attrs, rewrittenIdMap, 'endpoint-b');
  if (!pointA || !pointB) {
    warn(
      {
        isValid: false,
        version: null,
        isFallback: false,
        state: null,
        polygons: [],
        rectangles: [],
        ellipses: [],
        constraints: [],
        warnings: [],
      } as any,
      `horizontal constraint: missing or invalid endpoint`,
    );
    return null;
  }

  return {
    id,
    ...HorizontalConstraint.create(pointA, pointB),
  };
}

/** Parses a <g> element with data-type="vertical-constraint" into a VerticalConstraint object. */
function parseVerticalConstraint(
  attrs: Record<string, string | number>,
  rewrittenIdMap: Map<Id, Id>,
  doesIdExist: (id: Id) => boolean,
  generateId: (prefix?: string) => string,
): Entity<ConstraintComponent> | null {
  let id = attrs.id as string | undefined;
  if (typeof id === 'undefined' || doesIdExist(id)) {
    id = generateId(ID_PREFIXES.constraint);
    if (typeof attrs.id !== 'undefined') {
      rewrittenIdMap.set(attrs.id as Id, id);
    }
  } else {
    const rewritten = rewrittenIdMap.get(id);
    if (rewritten) {
      id = rewritten;
    }
  }

  const pointA = parseEndpoint(attrs, rewrittenIdMap, 'endpoint-a');
  const pointB = parseEndpoint(attrs, rewrittenIdMap, 'endpoint-b');
  if (!pointA || !pointB) {
    warn(
      {
        isValid: false,
        version: null,
        isFallback: false,
        state: null,
        polygons: [],
        rectangles: [],
        ellipses: [],
        constraints: [],
        warnings: [],
      } as any,
      `vertical constraint: missing or invalid endpoint`,
    );
    return null;
  }

  return {
    id,
    ...VerticalConstraint.create(pointA, pointB),
  };
}

/** Parses a <g> element with data-type="colinear-constraint" into a ColinearConstraint object. */
function parseColinearConstraint(
  attrs: Record<string, string | number>,
  rewrittenIdMap: Map<Id, Id>,
  doesIdExist: (id: Id) => boolean,
  generateId: (prefix?: string) => string,
): Entity<ConstraintComponent> | null {
  let id = attrs.id as string | undefined;
  if (typeof id === 'undefined' || doesIdExist(id)) {
    id = generateId(ID_PREFIXES.constraint);
    if (typeof attrs.id !== 'undefined') {
      rewrittenIdMap.set(attrs.id as Id, id);
    }
  } else {
    const rewritten = rewrittenIdMap.get(id);
    if (rewritten) {
      id = rewritten;
    }
  }

  const pointTarget = parseEndpoint(attrs, rewrittenIdMap, 'endpoint-target');
  const pointA = parseEndpoint(attrs, rewrittenIdMap, 'endpoint-a');
  const pointB = parseEndpoint(attrs, rewrittenIdMap, 'endpoint-b');
  if (!pointTarget || !pointA || !pointB) {
    warn(
      {
        isValid: false,
        version: null,
        isFallback: false,
        state: null,
        polygons: [],
        rectangles: [],
        ellipses: [],
        constraints: [],
        warnings: [],
      } as any,
      `colinear constraint: missing or invalid endpoint`,
    );
    return null;
  }

  return {
    id,
    ...ColinearConstraint.create(pointTarget, pointA, pointB),
  };
}

/**
 * Parses an SVG string into cad2d geometry and state.
 * Supports both native cad2d SVG (with magic comment) and fallback plain SVG.
 */
export function parseSvg(
  svg: string,
  generateId: (prefix?: string) => Id,
  doesIdExist: (id: Id) => boolean = () => false,
): ParseResult {
  const result: ParseResult = {
    isValid: false,
    version: null,
    isFallback: false,
    state: null,
    polygons: [],
    rectangles: [],
    ellipses: [],
    constraints: [],
    datums: [],
    warnings: [],
  };
  const rewrittenIdMap = new Map<Id, Id>();

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
  const svgTag = parsed.children.find(
    (c): c is ElementNode => c.type === 'element' && c.tagName === 'svg',
  );
  if (svgTag) {
    const parsedVersion = parseInt(`${svgTag.properties?.['data-cad2d-version'] ?? 0}`, 10);
    result.version = !Number.isNaN(parsedVersion) ? parsedVersion : null;
  }

  // Track render order for auto-incrementing when data-render-order is not set
  let lastRenderOrder = 0;

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
          const rectangleAndOrder = parseRectangle(
            attrs,
            generateId,
            rewrittenIdMap,
            doesIdExist,
            lastRenderOrder,
          );
          if (rectangleAndOrder) {
            result.rectangles.push(rectangleAndOrder[0]);
            lastRenderOrder = rectangleAndOrder[1];
          }
        } else {
          warn(result, `data-type=rectangle was not rect, found ${tagName}`);
        }
        break;
      case 'ellipse':
        if (tagName === 'ellipse') {
          const ellipseAndOrder = parseEllipse(
            attrs,
            generateId,
            rewrittenIdMap,
            doesIdExist,
            lastRenderOrder,
          );
          if (ellipseAndOrder) {
            result.ellipses.push(ellipseAndOrder[0]);
            lastRenderOrder = ellipseAndOrder[1];
          }
        } else {
          warn(result, `data-type=ellipse was not ellipse, found ${tagName}`);
        }
        break;
      case 'polygon':
        switch (tagName) {
          case 'path': {
            const polygonAndOrder = parsePolygonPath(
              attrs,
              generateId,
              rewrittenIdMap,
              doesIdExist,
              lastRenderOrder,
            );
            if (polygonAndOrder) {
              result.polygons.push(polygonAndOrder[0]);
              lastRenderOrder = polygonAndOrder[1];
            }
            break;
          }
          case 'polygon': {
            const polygonAndOrder = parsePolygonPolygon(
              attrs,
              generateId,
              rewrittenIdMap,
              doesIdExist,
              lastRenderOrder,
            );
            if (polygonAndOrder) {
              result.polygons.push(polygonAndOrder[0]);
              lastRenderOrder = polygonAndOrder[1];
            }
            break;
          }
        }
        break;
      case 'linear-constraint':
        if (tagName === 'g') {
          const constraint = parseConstraint(attrs, rewrittenIdMap, doesIdExist, generateId);
          if (constraint) {
            result.constraints.push(constraint);
            // Bail out early, there will never ne nested data within a constraint
            return;
          }
        } else {
          warn(result, `data-type=constraint was not g, found ${tagName}`);
        }
        break;
      case 'perpendicular-constraint':
        if (tagName === 'g') {
          const constraint = parsePerpendicularConstraint(
            attrs,
            rewrittenIdMap,
            doesIdExist,
            generateId,
          );
          if (constraint) {
            result.constraints.push(constraint);
            return;
          }
        } else {
          warn(result, `data-type=perpendicular-constraint was not g, found ${tagName}`);
        }
        break;
      case 'parallel-constraint':
        if (tagName === 'g') {
          const constraint = parseParallelConstraint(
            attrs,
            rewrittenIdMap,
            doesIdExist,
            generateId,
          );
          if (constraint) {
            result.constraints.push(constraint);
            return;
          }
        } else {
          warn(result, `data-type=parallel-constraint was not g, found ${tagName}`);
        }
        break;
      case 'horizontal-constraint':
        if (tagName === 'g') {
          const constraint = parseHorizontalConstraint(
            attrs,
            rewrittenIdMap,
            doesIdExist,
            generateId,
          );
          if (constraint) {
            result.constraints.push(constraint);
            return;
          }
        } else {
          warn(result, `data-type=horizontal-constraint was not g, found ${tagName}`);
        }
        break;
      case 'vertical-constraint':
        if (tagName === 'g') {
          const constraint = parseVerticalConstraint(
            attrs,
            rewrittenIdMap,
            doesIdExist,
            generateId,
          );
          if (constraint) {
            result.constraints.push(constraint);
            return;
          }
        } else {
          warn(result, `data-type=vertical-constraint was not g, found ${tagName}`);
        }
        break;
      case 'colinear-constraint':
        if (tagName === 'g') {
          const constraint = parseColinearConstraint(
            attrs,
            rewrittenIdMap,
            doesIdExist,
            generateId,
          );
          if (constraint) {
            result.constraints.push(constraint);
            return;
          }
        } else {
          warn(result, `data-type=colinear-constraint was not g, found ${tagName}`);
        }
        break;
      case 'datum':
        if (tagName === 'g') {
          const datumAndOrder = parseDatum(attrs, generateId, rewrittenIdMap, doesIdExist);
          if (datumAndOrder) {
            result.datums.push(datumAndOrder[0]);
          }
        }
        break;
      default:
        // No data-type, so fallback to defaults for each element type
        // This gets hit for `isFallback` type cases.
        switch (tagName) {
          case 'rect': {
            const rectangleAndOrder = parseRectangle(
              attrs,
              generateId,
              rewrittenIdMap,
              doesIdExist,
              lastRenderOrder,
            );
            if (rectangleAndOrder) {
              result.rectangles.push(rectangleAndOrder[0]);
              lastRenderOrder = rectangleAndOrder[1];
            }
            break;
          }
          case 'ellipse': {
            const ellipseAndOrder = parseEllipse(
              attrs,
              generateId,
              rewrittenIdMap,
              doesIdExist,
              lastRenderOrder,
            );
            if (ellipseAndOrder) {
              result.ellipses.push(ellipseAndOrder[0]);
              lastRenderOrder = ellipseAndOrder[1];
            }
            break;
          }
          case 'path': {
            const polygonAndOrder = parsePolygonPath(
              attrs,
              generateId,
              rewrittenIdMap,
              doesIdExist,
              lastRenderOrder,
            );
            if (polygonAndOrder) {
              result.polygons.push(polygonAndOrder[0]);
              lastRenderOrder = polygonAndOrder[1];
            }
            break;
          }
          case 'polygon': {
            const polygonAndOrder = parsePolygonPolygon(
              attrs,
              generateId,
              rewrittenIdMap,
              doesIdExist,
              lastRenderOrder,
            );
            if (polygonAndOrder) {
              result.polygons.push(polygonAndOrder[0]);
              lastRenderOrder = polygonAndOrder[1];
            }
            break;
          }
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
    result.isValid =
      result.polygons.length > 0 ||
      result.rectangles.length > 0 ||
      result.ellipses.length > 0 ||
      result.constraints.length > 0;
  }

  return result;
}

/**
 * Checks if an SVG string is a valid cad2d file (either native or fallback).
 */
export function canLoad(svg: string): {
  isValid: boolean;
  version: number | null;
  isFallback: boolean;
} {
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
