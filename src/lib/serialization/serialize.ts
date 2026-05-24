import { type Sheet } from '../sheet/Sheet';
import { type ConstraintEndpoint, type Polygon, type PolygonSegment, type Rectangle, type Ellipse, type LinearConstraint } from '@/lib/geometry';
import { type SheetPosition } from '../viewport/types';
import { type UnitType } from '../units/length';
import { SHEET_UNITS_TO_PIXELS } from '../sheet/Sheet';
import { CAD2D_STATE_COMMENT_PREFIX, CURRENT_VERSION, type SerializedState } from './versions';
import { InchesType, FeetType, MillimetersType, CentimetersType, MetersType } from '../units/length';
import { computeDimensionLinePoints, CONSTRAINT_LINE_WIDTH_PX, CONSTRAINT_COLOR } from '@/lib/viewport/dimension-line-utils';

/** Converts a SheetPosition to pixels (world coordinates). */
function positionToPixels(pos: SheetPosition): { x: number; y: number } {
  return {
    x: pos.x * SHEET_UNITS_TO_PIXELS,
    y: pos.y * SHEET_UNITS_TO_PIXELS,
  };
}

/** Converts a hex color number to a CSS hex string (e.g., 0xff0000 → "#ff0000"). */
function colorToHex(color: number | null): string {
  if (color === null) {
    return 'none';
  }
  return '#' + color.toString(16).padStart(6, '0');
}

/** Converts polygon segments to a SVG path `d` attribute value.
 *  The segment type is encoded in the command letter: M/L for point, Q for quadratic-arc, C for cubic-arc. */
function segmentsToPathData(segments: Array<PolygonSegment>): string {
  const dParts: Array<string> = [];

  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i];
    const pos = positionToPixels(seg.point);

    if (seg.type === 'point') {
      if (i === 0) {
        dParts.push(`M${pos.x.toFixed(2)},${pos.y.toFixed(2)}`);
      } else {
        dParts.push(`L${pos.x.toFixed(2)},${pos.y.toFixed(2)}`);
      }
    } else if (seg.type === 'arc-quadratic') {
      const cp = positionToPixels(seg.controlPoint);
      dParts.push(`Q${cp.x.toFixed(2)},${cp.y.toFixed(2)} ${pos.x.toFixed(2)},${pos.y.toFixed(2)}`);
    } else if (seg.type === 'arc-cubic') {
      const cpa = positionToPixels(seg.controlPointA);
      const cpb = positionToPixels(seg.controlPointB);
      dParts.push(`C${cpa.x.toFixed(2)},${cpa.y.toFixed(2)} ${cpb.x.toFixed(2)},${cpb.y.toFixed(2)} ${pos.x.toFixed(2)},${pos.y.toFixed(2)}`);
    }
  }

  return dParts.join(' ');
}

/** Serializes a polygon to an SVG <path> element string. */
export function serializePolygon(polygon: Polygon): string {
  const fillColor = colorToHex(polygon.fillColor);

  const attrs: Array<string> = [
    `data-type="polygon"`,
    `fill="${fillColor}"`,
    `stroke="#000"`,
    `stroke-width="2"`,
    `data-open-at-index="${polygon.openAtIndex}"`,
    `data-render-order="${polygon.renderOrder}"`,
  ];

  if (polygon.closed && polygon.points.every(p => p.type === "point")) {
    // For closed fully linear polygons, render as a polygon element
    // This is a more compact / human readable representation, especially for large polygons
    const pointsString = polygon.points
      .slice(0, -1 /* don't serialize last duplicate closed point */)
      .map(p => {
        const pos = positionToPixels(p.point);
        return `${pos.x},${pos.y}`;
      })
      .join(" ");
    return `<polygon id="${polygon.id}" ${attrs.join(' ')} points="${pointsString}"/>`;
  } else {
    let d = segmentsToPathData(polygon.points);
    if (polygon.closed) {
      return `<path id="${polygon.id}" ${attrs.join(' ')} d="${d} Z"/>`;
    } else {
      return `<path id="${polygon.id}" ${attrs.join(' ')} d="${d}"/>`;
    }
  }
}

/** Serializes a rectangle to an SVG <rect> element string. */
export function serializeRectangle(rect: Rectangle): string {
  const upperLeft = positionToPixels(rect.upperLeft);
  const lowerRight = positionToPixels(rect.lowerRight);
  const width = Math.abs(lowerRight.x - upperLeft.x);
  const height = Math.abs(lowerRight.y - upperLeft.y);
  const x = Math.min(upperLeft.x, lowerRight.x);
  const y = Math.min(upperLeft.y, lowerRight.y);
  const fillColor = colorToHex(rect.fillColor);

  const attrs: Array<string> = [
    `data-type="rectangle"`,
    `fill="${fillColor}"`,
    `stroke="#000"`,
    `stroke-width="2"`,
    `data-link-dimensions="${rect.linkDimensions}"`,
    `data-render-order="${rect.renderOrder}"`,
  ];

  return `<rect id="${rect.id}" ${attrs.join(' ')} x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${width.toFixed(2)}" height="${height.toFixed(2)}"/>`;
}

/** Serializes an ellipse to an SVG <ellipse> element string. */
export function serializeEllipse(ellipse: Ellipse): string {
  const center = positionToPixels(ellipse.center);
  const fillColor = colorToHex(ellipse.fillColor);

  const attrs: Array<string> = [
    `data-type="ellipse"`,
    `fill="${fillColor}"`,
    `stroke="#000"`,
    `stroke-width="2"`,
    `data-link-dimensions="${ellipse.linkDimensions}"`,
    `data-render-order="${ellipse.renderOrder}"`,
  ];

  return `<ellipse id="${ellipse.id}" ${attrs.join(' ')} cx="${center.x.toFixed(2)}" cy="${center.y.toFixed(2)}" rx="${ellipse.radiusX * SHEET_UNITS_TO_PIXELS}" ry="${ellipse.radiusY * SHEET_UNITS_TO_PIXELS}"/>`;
}

/** Converts a Length to a SerializedLength object. */
function serializeLength(length: { magnitude: number; type: symbol }): { type: UnitType; magnitude: number } {
  if (length.type === InchesType) {
    return { type: 'in', magnitude: length.magnitude };
  } else if (length.type === FeetType) {
    return { type: 'ft', magnitude: length.magnitude };
  } else if (length.type === MillimetersType) {
    return { type: 'mm', magnitude: length.magnitude };
  } else if (length.type === CentimetersType) {
    return { type: 'cm', magnitude: length.magnitude };
  } else if (length.type === MetersType) {
    return { type: 'm', magnitude: length.magnitude };
  }
  // Default to cm if unknown
  return { type: 'cm', magnitude: length.magnitude };
}

function serializeEndpointAttrs(prefix: string, endpoint: ConstraintEndpoint): Array<string> {
  const attrs: Array<string> = [
    `data-${prefix}-type="${endpoint.type}"`,
  ];
  switch (endpoint.type) {
    case "point":
      attrs.push(
        `data-${prefix}-x="${endpoint.point.x}"`,
        `data-${prefix}-y="${endpoint.point.y}"`,
      );
      break;
    case "locked-rectangle":
      attrs.push(
        `data-${prefix}-id="${endpoint.id}"`,
        `data-${prefix}-point="${endpoint.point}"`,
      );
      break;
    case "locked-ellipse":
      attrs.push(
        `data-${prefix}-id="${endpoint.id}"`,
        `data-${prefix}-point="${endpoint.point}"`,
      );
      break;
    case "locked-polygon":
      attrs.push(
        `data-${prefix}-id="${endpoint.id}"`,
        `data-${prefix}-point-index="${endpoint.pointIndex}"`,
      );
      break;
  }
  return attrs;
}

/** Serializes a linear constraint to an SVG <g> element string.
 *  The inner SVG renders a visual approximation of the dimension line.
 *  resolveEndpoint is optional and only used for rendering the visual dimension line. */
export function serializeLinearConstraint(
  constraint: LinearConstraint,
  resolveEndpoint?: (endpoint: ConstraintEndpoint) => SheetPosition | null,
): string {
  const resolvedA = resolveEndpoint ? resolveEndpoint(constraint.pointA) : null;
  const resolvedB = resolveEndpoint ? resolveEndpoint(constraint.pointB) : null;

  const pointAPx = resolvedA ? positionToPixels(resolvedA) : { x: 0, y: 0 };
  const pointBPx = resolvedB ? positionToPixels(resolvedB) : { x: 0, y: 0 };

  const pts = computeDimensionLinePoints(
    { x: pointAPx.x, y: pointAPx.y },
    { x: pointBPx.x, y: pointBPx.y },
    constraint.connectorLineOffsetPx,
  );

  const displayText = constraint.constrainedLength.toDisplayString();

  const lengthTypeStr = (constraint.constrainedLength.type === InchesType) ? 'in'
    : constraint.constrainedLength.type === FeetType ? 'ft'
    : constraint.constrainedLength.type === MillimetersType ? 'mm'
    : constraint.constrainedLength.type === CentimetersType ? 'cm' : 'm';

  const attrs: Array<string> = [
    `data-type="linear-constraint"`,
    `id="${constraint.id}"`,
    ...serializeEndpointAttrs("endpoint-a", constraint.pointA),
    ...serializeEndpointAttrs("endpoint-b", constraint.pointB),
    `data-offset="${constraint.connectorLineOffsetPx}"`,
    `data-length-mag="${constraint.constrainedLength.magnitude}"`,
    `data-length-type="${lengthTypeStr}"`,
  ];

  const pathD = [
    `M${pts.lineStart.x},${pts.lineStart.y}`,
    `L${pts.lineEnd.x},${pts.lineEnd.y}`,
    `M${pts.tickANormalStart.x.toFixed(2)},${pts.tickANormalStart.y.toFixed(2)}`,
    `L${pts.tickANormalEnd.x.toFixed(2)},${pts.tickANormalEnd.y.toFixed(2)}`,
    `M${pts.tickBNormalStart.x.toFixed(2)},${pts.tickBNormalStart.y.toFixed(2)}`,
    `L${pts.tickBNormalEnd.x.toFixed(2)},${pts.tickBNormalEnd.y.toFixed(2)}`,
  ].join(' ');

  return `<g ${attrs.join(' ')}>
  <path d="${pathD}" stroke="${CONSTRAINT_COLOR}" stroke-width="${CONSTRAINT_LINE_WIDTH_PX}"/>
  <text
    x="${pts.midpoint.x.toFixed(2)}"
    y="${pts.midpoint.y.toFixed(2)}"
    fill="${CONSTRAINT_COLOR}"
    font-size="18"
    text-anchor="middle"
    dominant-baseline="middle"
    font-family="monospace"
    transform="translate(${pts.labelOffset.x.toFixed(2)}, ${pts.labelOffset.y.toFixed(2)})"
  >${displayText}</text>
</g>`;
}

/**
 * Serializes the full state of the system into an SVG string.
 * The SVG is a valid superset that includes all geometry plus cad2d metadata
 * in data attributes and a magic state comment.
 */
export function serializeToSvg(
  sheet: Sheet,
  viewportPosition: { x: number; y: number },
  viewportScale: number,
  selectedIds: Array<string>,
  activeTool: string
): string {
  const geometryStore = sheet.geometryStore;

  const svgParts: Array<string> = [];

  // SVG header with viewBox sized to sheet in pixels
  const widthPx = sheet.width.toSheetUnits(sheet.defaultUnit).magnitude * SHEET_UNITS_TO_PIXELS;
  const heightPx = sheet.height.toSheetUnits(sheet.defaultUnit).magnitude * SHEET_UNITS_TO_PIXELS;
  svgParts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${widthPx} ${heightPx}" data-cad2d-version="${CURRENT_VERSION}">`);

  // Serialize rectangles
  for (const rect of geometryStore.rectangles) {
    svgParts.push(serializeRectangle(rect));
  }

  // Serialize ellipses
  for (const ellipse of geometryStore.ellipses) {
    svgParts.push(serializeEllipse(ellipse));
  }

  // Serialize polygons
  for (const polygon of geometryStore.polygons) {
    svgParts.push(serializePolygon(polygon));
  }

  // Serialize constraints
  for (const constraint of geometryStore.constraints) {
    switch (constraint.type) {
      case "linear":
        svgParts.push(serializeLinearConstraint(constraint, (ep) => geometryStore.resolveConstraintEndpoint(ep)));
        break;
    }
  }

  // Build state object for the magic comment
  const historyManager = sheet.historyManager;
  const state: SerializedState = {
    version: CURRENT_VERSION,
    sheet: {
      width: serializeLength(sheet.width),
      height: serializeLength(sheet.height),
      defaultUnit: sheet.defaultUnit,
    },
    viewport: {
      position: viewportPosition,
      scale: viewportScale,
    },
    selection: Array.from(selectedIds),
    history: {
      undoStack: historyManager.getUndoStack(),
      redoStack: historyManager.getRedoStack(),
      stableIdCounter: historyManager.getStableIdCounter(),
    },
    activeTool: activeTool as any,
  };

  svgParts.push(`<!-- ${CAD2D_STATE_COMMENT_PREFIX}${JSON.stringify(state)} -->`);
  svgParts.push('</svg>');

  return svgParts.join('\n');
}
