import {
  ConstraintComponent,
  type ConstraintEndpoint,
  DatumComponent,
  EllipseComponent,
  Entity,
  FillColorComponent,
  LinkDimensionsComponent,
  type Polygon,
  PolygonComponent,
  type PolygonSegment,
  RectangleComponent,
  RenderOrderComponent,
} from '@/lib/entity';
import {
  type ColinearConstraintData,
  type ConstraintData,
  type HorizontalConstraintData,
  type LinearConstraintData,
  type ParallelConstraintData,
  type PerpendicularConstraintData,
  type VerticalConstraintData,
} from '@/lib/entity/constraints';
import { DATUM_CIRCLE_RADIUS_PX } from '@/lib/entity/datum';
import {
  CONSTRAINT_COLOR,
  CONSTRAINT_LINE_WIDTH_PX,
  computeDimensionLinePoints,
} from '@/lib/viewport/dimension-line-utils';
import { type Sheet } from '../sheet/Sheet';
import { SHEET_UNITS_TO_PIXELS } from '../sheet/Sheet';
import { type UnitType } from '../units/length';
import {
  CentimetersType,
  FeetType,
  InchesType,
  MetersType,
  MillimetersType,
} from '../units/length';
import { type SheetPosition } from '../viewport/types';
import { CAD2D_STATE_COMMENT_PREFIX, CURRENT_VERSION, type SerializedState } from './versions';

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
      dParts.push(
        `C${cpa.x.toFixed(2)},${cpa.y.toFixed(2)} ${cpb.x.toFixed(2)},${cpb.y.toFixed(2)} ${pos.x.toFixed(2)},${pos.y.toFixed(2)}`,
      );
    }
  }

  return dParts.join(' ');
}

/** Serializes a polygon to an SVG <path> element string. */
export function serializePolygon(polygon: Polygon): string {
  const fillColor = colorToHex(FillColorComponent.getOptional(polygon) ?? null);

  const attrs: Array<string> = [
    `data-type="polygon"`,
    `fill="${fillColor}"`,
    `stroke="#000"`,
    `stroke-width="2"`,
    `data-open-at-index="${PolygonComponent.get(polygon).openAtIndex}"`,
    `data-render-order="${RenderOrderComponent.get(polygon)}"`,
  ];

  const polygonData = PolygonComponent.get(polygon);
  if (polygonData.closed && polygonData.points.every((p) => p.type === 'point')) {
    // For closed fully linear polygons, render as a polygon element
    // This is a more compact / human readable representation, especially for large polygons
    const pointsString = polygonData.points
      .slice(0, -1 /* don't serialize last duplicate closed point */)
      .map((p) => {
        const pos = positionToPixels(p.point);
        return `${pos.x},${pos.y}`;
      })
      .join(' ');
    return `<polygon id="${polygon.id}" ${attrs.join(' ')} points="${pointsString}"/>`;
  } else {
    let d = segmentsToPathData(polygonData.points);
    if (polygonData.closed) {
      return `<path id="${polygon.id}" ${attrs.join(' ')} d="${d} Z"/>`;
    } else {
      return `<path id="${polygon.id}" ${attrs.join(' ')} d="${d}"/>`;
    }
  }
}

/** Serializes a rectangle to an SVG <rect> element string. */
export function serializeRectangle(
  geometry: Entity<
    RectangleComponent & LinkDimensionsComponent & FillColorComponent & RenderOrderComponent
  >,
): string {
  const rectangle = RectangleComponent.get(geometry);
  const upperLeft = positionToPixels(rectangle.upperLeft);
  const lowerRight = positionToPixels(rectangle.lowerRight);
  const width = Math.abs(lowerRight.x - upperLeft.x);
  const height = Math.abs(lowerRight.y - upperLeft.y);
  const x = Math.min(upperLeft.x, lowerRight.x);
  const y = Math.min(upperLeft.y, lowerRight.y);
  const fillColor = colorToHex(FillColorComponent.get(geometry));

  const attrs: Array<string> = [
    `data-type="rectangle"`,
    `fill="${fillColor}"`,
    `stroke="#000"`,
    `stroke-width="2"`,
    `data-link-dimensions="${LinkDimensionsComponent.get(geometry)}"`,
    `data-render-order="${RenderOrderComponent.get(geometry)}"`,
  ];

  return `<rect id="${geometry.id}" ${attrs.join(' ')} x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${width.toFixed(2)}" height="${height.toFixed(2)}"/>`;
}

/** Serializes an ellipse to an SVG <ellipse> element string. */
export function serializeEllipse(
  ellipse: Entity<
    EllipseComponent & LinkDimensionsComponent & FillColorComponent & RenderOrderComponent
  >,
): string {
  const ellipseData = EllipseComponent.get(ellipse);
  const center = positionToPixels(ellipseData.center);
  const fillColor = colorToHex(FillColorComponent.get(ellipse));

  const attrs: Array<string> = [
    `data-type="ellipse"`,
    `fill="${fillColor}"`,
    `stroke="#000"`,
    `stroke-width="2"`,
    `data-link-dimensions="${LinkDimensionsComponent.get(ellipse)}"`,
    `data-render-order="${RenderOrderComponent.get(ellipse)}"`,
  ];

  return `<ellipse id="${ellipse.id}" ${attrs.join(' ')} cx="${center.x.toFixed(2)}" cy="${center.y.toFixed(2)}" rx="${ellipseData.radiusX * SHEET_UNITS_TO_PIXELS}" ry="${ellipseData.radiusY * SHEET_UNITS_TO_PIXELS}"/>`;
}

/** Serializes a datum to an SVG <g> element with crosshair + circle children. */
export function serializeDatum(datum: Entity<DatumComponent>): string {
  const pos = DatumComponent.get(datum);
  const px = pos.x * SHEET_UNITS_TO_PIXELS;
  const py = pos.y * SHEET_UNITS_TO_PIXELS;
  const r = DATUM_CIRCLE_RADIUS_PX;

  const attrs: Array<string> = [`data-type="datum"`, `data-x="${pos.x}"`, `data-y="${pos.y}"`];

  return `<g id="${datum.id}" ${attrs.join(' ')}>
  <line x1="${(px - r).toFixed(2)}" y1="${py.toFixed(2)}" x2="${(px + r).toFixed(2)}" y2="${py.toFixed(2)}" stroke="#888" stroke-width="1"/>
  <line x1="${px.toFixed(2)}" y1="${(py - r).toFixed(2)}" x2="${px.toFixed(2)}" y2="${(py + r).toFixed(2)}" stroke="#888" stroke-width="1"/>
  <circle cx="${px.toFixed(2)}" cy="${py.toFixed(2)}" r="${r}" stroke="#888" stroke-width="1" fill="none"/>
</g>`;
}

/** Converts a Length to a SerializedLength object. */
function serializeLength(length: { magnitude: number; type: symbol }): {
  type: UnitType;
  magnitude: number;
} {
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
  const attrs: Array<string> = [`data-${prefix}-type="${endpoint.type}"`];
  switch (endpoint.type) {
    case 'point':
      attrs.push(
        `data-${prefix}-x="${endpoint.point.x}"`,
        `data-${prefix}-y="${endpoint.point.y}"`,
      );
      break;
    case 'locked-rectangle':
      attrs.push(`data-${prefix}-id="${endpoint.id}"`, `data-${prefix}-point="${endpoint.point}"`);
      break;
    case 'locked-ellipse':
      attrs.push(`data-${prefix}-id="${endpoint.id}"`, `data-${prefix}-point="${endpoint.point}"`);
      break;
    case 'locked-polygon':
      attrs.push(
        `data-${prefix}-id="${endpoint.id}"`,
        `data-${prefix}-point-index="${endpoint.pointIndex}"`,
      );
      break;
    case 'locked-datum':
      attrs.push(`data-${prefix}-id="${endpoint.id}"`);
      break;
    default:
      endpoint satisfies never;
      throw new Error(`serializeEndpointAttrs: unexpected endpoint type ${(endpoint as any).type}`);
  }
  return attrs;
}

/** Serializes a perpendicular constraint to an SVG <g> element string.
 *  resolveEndpoint is optional and only used for rendering the visual dimension line. */
export function serializePerpendicularConstraint(
  constraint: PerpendicularConstraintData,
  resolveEndpoint: ((endpoint: ConstraintEndpoint) => SheetPosition | null) | undefined,
  constraintId: string,
): string {
  const resolvedA = resolveEndpoint ? resolveEndpoint(constraint.pointA) : null;
  const resolvedCenter = resolveEndpoint ? resolveEndpoint(constraint.pointCenter) : null;
  const resolvedB = resolveEndpoint ? resolveEndpoint(constraint.pointB) : null;

  const pointAPx = resolvedA ? positionToPixels(resolvedA) : { x: 0, y: 0 };
  const centerPx = resolvedCenter ? positionToPixels(resolvedCenter) : { x: 0, y: 0 };
  const pointBPx = resolvedB ? positionToPixels(resolvedB) : { x: 0, y: 0 };

  // Compute unit vectors from center to pointA and center to pointB
  const dxA = pointAPx.x - centerPx.x;
  const dyA = pointAPx.y - centerPx.y;
  const lenA = Math.sqrt(dxA * dxA + dyA * dyA);
  const uAx = lenA > 0 ? dxA / lenA : 0;
  const uAy = lenA > 0 ? dyA / lenA : 0;

  const dxB = pointBPx.x - centerPx.x;
  const dyB = pointBPx.y - centerPx.y;
  const lenB = Math.sqrt(dxB * dxB + dyB * dyB);
  const uBx = lenB > 0 ? dxB / lenB : 0;
  const uBy = lenB > 0 ? dyB / lenB : 0;

  // Bisector direction of the exterior (opposite the angle interior)
  const bisectX = -(uAx + uBx);
  const bisectY = -(uAy + uBy);
  const bisectLen = Math.sqrt(bisectX * bisectX + bisectY * bisectY);
  const normBisectX = bisectLen > 0 ? bisectX / bisectLen : 0;
  const normBisectY = bisectLen > 0 ? bisectY / bisectLen : 0;

  // Square corner indicator on the exterior side (16px arm length)
  const S = 16;
  const cornerAx = centerPx.x - uAx * S;
  const cornerAy = centerPx.y - uAy * S;
  const cornerFarX = centerPx.x - uAx * S - uBx * S;
  const cornerFarY = centerPx.y - uAy * S - uBy * S;
  const cornerBx = centerPx.x - uBx * S;
  const cornerBy = centerPx.y - uBy * S;

  // Label position: outside the square, along the exterior bisector
  const labelOffset = 10;
  const labelX = cornerFarX + normBisectX * labelOffset;
  const labelY = cornerFarY + normBisectY * labelOffset;

  // Build the path: A→center, center→B, and the square corner indicator
  const pathD = [
    `M${pointAPx.x.toFixed(2)},${pointAPx.y.toFixed(2)} L${centerPx.x.toFixed(2)},${centerPx.y.toFixed(2)}`,
    `M${centerPx.x.toFixed(2)},${centerPx.y.toFixed(2)} L${pointBPx.x.toFixed(2)},${pointBPx.y.toFixed(2)}`,
    `M${cornerAx.toFixed(2)},${cornerAy.toFixed(2)} L${cornerFarX.toFixed(2)},${cornerFarY.toFixed(2)} L${cornerBx.toFixed(2)},${cornerBy.toFixed(2)}`,
  ].join(' ');

  const attrs: Array<string> = [
    `data-type="perpendicular-constraint"`,
    `id="${constraintId}"`,
    ...serializeEndpointAttrs('endpoint-a', constraint.pointA),
    ...serializeEndpointAttrs('endpoint-center', constraint.pointCenter),
    ...serializeEndpointAttrs('endpoint-c', constraint.pointB),
  ];

  return `<g ${attrs.join(' ')}>
  <path d="${pathD}" stroke="${CONSTRAINT_COLOR}" stroke-width="${CONSTRAINT_LINE_WIDTH_PX}" fill="none"/>
  <text x="${labelX.toFixed(2)}" y="${labelY.toFixed(2)}" fill="${CONSTRAINT_COLOR}" font-size="14" text-anchor="middle" dominant-baseline="middle" font-family="monospace">90°</text>
</g>`;
}

/** Serializes a parallel constraint to an SVG <g> element string.
 *  resolveEndpoint is optional and only used for rendering the visual lines. */
export function serializeParallelConstraint(
  constraint: ParallelConstraintData,
  resolveEndpoint: ((endpoint: ConstraintEndpoint) => SheetPosition | null) | undefined,
  constraintId: string,
): string {
  const resolvedA = resolveEndpoint ? resolveEndpoint(constraint.pointA) : null;
  const resolvedB = resolveEndpoint ? resolveEndpoint(constraint.pointB) : null;
  const resolvedC = resolveEndpoint ? resolveEndpoint(constraint.pointC) : null;
  const resolvedD = resolveEndpoint ? resolveEndpoint(constraint.pointD) : null;

  const pointAPx = resolvedA ? positionToPixels(resolvedA) : { x: 0, y: 0 };
  const pointBPx = resolvedB ? positionToPixels(resolvedB) : { x: 0, y: 0 };
  const pointCPx = resolvedC ? positionToPixels(resolvedC) : { x: 0, y: 0 };
  const pointDPx = resolvedD ? positionToPixels(resolvedD) : { x: 0, y: 0 };

  // Build the path: segment A→B and segment C→D
  const pathD = [
    `M${pointAPx.x.toFixed(2)},${pointAPx.y.toFixed(2)} L${pointBPx.x.toFixed(2)},${pointBPx.y.toFixed(2)}`,
    `M${pointCPx.x.toFixed(2)},${pointCPx.y.toFixed(2)} L${pointDPx.x.toFixed(2)},${pointDPx.y.toFixed(2)}`,
  ].join(' ');

  // Label at midpoint between the two segments' midpoints
  const midABx = (pointAPx.x + pointBPx.x) / 2;
  const midABy = (pointAPx.y + pointBPx.y) / 2;
  const midCDx = (pointCPx.x + pointDPx.x) / 2;
  const midCDy = (pointCPx.y + pointDPx.y) / 2;
  const labelX = (midABx + midCDx) / 2;
  const labelY = (midABy + midCDy) / 2;

  const attrs: Array<string> = [
    `data-type="parallel-constraint"`,
    `id="${constraintId}"`,
    ...serializeEndpointAttrs('endpoint-a', constraint.pointA),
    ...serializeEndpointAttrs('endpoint-b', constraint.pointB),
    ...serializeEndpointAttrs('endpoint-c', constraint.pointC),
    ...serializeEndpointAttrs('endpoint-d', constraint.pointD),
  ];

  return `<g ${attrs.join(' ')}>
  <path d="${pathD}" stroke="${CONSTRAINT_COLOR}" stroke-width="${CONSTRAINT_LINE_WIDTH_PX}" fill="none"/>
  <text x="${labelX.toFixed(2)}" y="${labelY.toFixed(2)}" fill="${CONSTRAINT_COLOR}" font-size="14" text-anchor="middle" dominant-baseline="middle" font-family="monospace">∥</text>
</g>`;
}

/** Serializes a horizontal constraint to an SVG <g> element string. */
export function serializeHorizontalConstraint(
  constraint: HorizontalConstraintData,
  resolveEndpoint: ((endpoint: ConstraintEndpoint) => SheetPosition | null) | undefined,
  constraintId: string,
): string {
  const resolvedA = resolveEndpoint ? resolveEndpoint(constraint.pointA) : null;
  const resolvedB = resolveEndpoint ? resolveEndpoint(constraint.pointB) : null;

  const pointAPx = resolvedA ? positionToPixels(resolvedA) : { x: 0, y: 0 };
  const pointBPx = resolvedB ? positionToPixels(resolvedB) : { x: 0, y: 0 };

  const pathD = [
    `M${pointAPx.x.toFixed(2)},${pointAPx.y.toFixed(2)} L${pointBPx.x.toFixed(2)},${pointBPx.y.toFixed(2)}`,
  ].join(' ');

  const midX = (pointAPx.x + pointBPx.x) / 2;
  const midY = (pointAPx.y + pointBPx.y) / 2;

  const attrs: Array<string> = [
    `data-type="horizontal-constraint"`,
    `id="${constraintId}"`,
    ...serializeEndpointAttrs('endpoint-a', constraint.pointA),
    ...serializeEndpointAttrs('endpoint-b', constraint.pointB),
  ];

  return `<g ${attrs.join(' ')}>
  <path d="${pathD}" stroke="${CONSTRAINT_COLOR}" stroke-width="${CONSTRAINT_LINE_WIDTH_PX}" fill="none"/>
  <text x="${midX.toFixed(2)}" y="${midY.toFixed(2)}" fill="${CONSTRAINT_COLOR}" font-size="14" text-anchor="middle" dominant-baseline="middle" font-family="monospace">H</text>
</g>`;
}

/** Serializes a vertical constraint to an SVG <g> element string. */
export function serializeVerticalConstraint(
  constraint: VerticalConstraintData,
  resolveEndpoint: ((endpoint: ConstraintEndpoint) => SheetPosition | null) | undefined,
  constraintId: string,
): string {
  const resolvedA = resolveEndpoint ? resolveEndpoint(constraint.pointA) : null;
  const resolvedB = resolveEndpoint ? resolveEndpoint(constraint.pointB) : null;

  const pointAPx = resolvedA ? positionToPixels(resolvedA) : { x: 0, y: 0 };
  const pointBPx = resolvedB ? positionToPixels(resolvedB) : { x: 0, y: 0 };

  const pathD = [
    `M${pointAPx.x.toFixed(2)},${pointAPx.y.toFixed(2)} L${pointBPx.x.toFixed(2)},${pointBPx.y.toFixed(2)}`,
  ].join(' ');

  const midX = (pointAPx.x + pointBPx.x) / 2;
  const midY = (pointAPx.y + pointBPx.y) / 2;

  const attrs: Array<string> = [
    `data-type="vertical-constraint"`,
    `id="${constraintId}"`,
    ...serializeEndpointAttrs('endpoint-a', constraint.pointA),
    ...serializeEndpointAttrs('endpoint-b', constraint.pointB),
  ];

  return `<g ${attrs.join(' ')}>
  <path d="${pathD}" stroke="${CONSTRAINT_COLOR}" stroke-width="${CONSTRAINT_LINE_WIDTH_PX}" fill="none"/>
  <text x="${midX.toFixed(2)}" y="${midY.toFixed(2)}" fill="${CONSTRAINT_COLOR}" font-size="14" text-anchor="middle" dominant-baseline="middle" font-family="monospace">V</text>
</g>`;
}

/** Serializes a colinear constraint to an SVG <g> element string. */
export function serializeColinearConstraint(
  constraint: ColinearConstraintData,
  resolveEndpoint: ((endpoint: ConstraintEndpoint) => SheetPosition | null) | undefined,
  constraintId: string,
): string {
  const resolvedTarget = resolveEndpoint ? resolveEndpoint(constraint.pointTarget) : null;
  const resolvedA = resolveEndpoint ? resolveEndpoint(constraint.pointA) : null;
  const resolvedB = resolveEndpoint ? resolveEndpoint(constraint.pointB) : null;

  const targetPx = resolvedTarget ? positionToPixels(resolvedTarget) : { x: 0, y: 0 };
  const pointAPx = resolvedA ? positionToPixels(resolvedA) : { x: 0, y: 0 };
  const pointBPx = resolvedB ? positionToPixels(resolvedB) : { x: 0, y: 0 };

  const pathD = [
    `M${pointAPx.x.toFixed(2)},${pointAPx.y.toFixed(2)} L${pointBPx.x.toFixed(2)},${pointBPx.y.toFixed(2)}`,
  ].join(' ');

  const midX = (pointAPx.x + pointBPx.x) / 2;
  const midY = (pointAPx.y + pointBPx.y) / 2;

  const attrs: Array<string> = [
    `data-type="colinear-constraint"`,
    `id="${constraintId}"`,
    ...serializeEndpointAttrs('endpoint-target', constraint.pointTarget),
    ...serializeEndpointAttrs('endpoint-a', constraint.pointA),
    ...serializeEndpointAttrs('endpoint-b', constraint.pointB),
  ];

  return `<g ${attrs.join(' ')}>
  <circle cx="${targetPx.x.toFixed(2)}" cy="${targetPx.y.toFixed(2)}" r="3" fill="${CONSTRAINT_COLOR}"/>
  <path d="${pathD}" stroke="${CONSTRAINT_COLOR}" stroke-width="${CONSTRAINT_LINE_WIDTH_PX}" stroke-dasharray="4,4" fill="none"/>
  <text x="${midX.toFixed(2)}" y="${midY.toFixed(2)}" fill="${CONSTRAINT_COLOR}" font-size="14" text-anchor="middle" dominant-baseline="middle" font-family="monospace">≡</text>
</g>`;
}

/** Serializes a linear constraint to an SVG <g> element string.
 *  The inner SVG renders a visual approximation of the dimension line.
 *  resolveEndpoint is optional and only used for rendering the visual dimension line. */
export function serializeLinearConstraint(
  constraint: LinearConstraintData,
  resolveEndpoint: ((endpoint: ConstraintEndpoint) => SheetPosition | null) | undefined,
  constraintId: string,
): string {
  const resolvedA = resolveEndpoint ? resolveEndpoint(constraint.pointA) : null;
  const resolvedB = resolveEndpoint ? resolveEndpoint(constraint.pointB) : null;

  const pointAPx = resolvedA ? positionToPixels(resolvedA) : { x: 0, y: 0 };
  const pointBPx = resolvedB ? positionToPixels(resolvedB) : { x: 0, y: 0 };

  const pts = computeDimensionLinePoints(
    { x: pointAPx.x, y: pointAPx.y },
    { x: pointBPx.x, y: pointBPx.y },
    constraint.connectorLineOffsetPx,
    constraint.axis,
  );

  const displayText = constraint.constrainedLength.toDisplayString();

  const lengthTypeStr =
    constraint.constrainedLength.type === InchesType
      ? 'in'
      : constraint.constrainedLength.type === FeetType
        ? 'ft'
        : constraint.constrainedLength.type === MillimetersType
          ? 'mm'
          : constraint.constrainedLength.type === CentimetersType
            ? 'cm'
            : 'm';

  const attrs: Array<string> = [
    `data-type="linear-constraint"`,
    `id="${constraintId}"`,
    ...serializeEndpointAttrs('endpoint-a', constraint.pointA),
    ...serializeEndpointAttrs('endpoint-b', constraint.pointB),
    `data-offset="${constraint.connectorLineOffsetPx}"`,
    `data-length-mag="${constraint.constrainedLength.magnitude}"`,
    `data-length-type="${lengthTypeStr}"`,
  ];
  if (constraint.axis) {
    attrs.push(`data-axis="${constraint.axis}"`);
  }

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
  activeTool: string,
): string {
  const geometryStore = sheet.geometryStore;

  const svgParts: Array<string> = [];

  // SVG header with viewBox sized to sheet in pixels
  const widthPx = sheet.width.toSheetUnits(sheet.defaultUnit).magnitude * SHEET_UNITS_TO_PIXELS;
  const heightPx = sheet.height.toSheetUnits(sheet.defaultUnit).magnitude * SHEET_UNITS_TO_PIXELS;
  svgParts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${widthPx} ${heightPx}" data-cad2d-version="${CURRENT_VERSION}">`,
  );

  // Collect all shapes and sort by render order (ascending, lower = further back)
  const allShapes: Array<{ renderOrder: number; serialize: () => string }> = [];
  for (const rect of geometryStore.listWithComponents(
    RectangleComponent,
    FillColorComponent,
    LinkDimensionsComponent,
    RenderOrderComponent,
  )) {
    allShapes.push({
      renderOrder: RenderOrderComponent.get(rect),
      serialize: () => serializeRectangle(rect),
    });
  }
  for (const ellipse of geometryStore.listWithComponents(
    EllipseComponent,
    FillColorComponent,
    LinkDimensionsComponent,
    RenderOrderComponent,
  )) {
    allShapes.push({
      renderOrder: RenderOrderComponent.get(ellipse),
      serialize: () => serializeEllipse(ellipse),
    });
  }
  for (const polygon of geometryStore.listWithComponents(PolygonComponent, RenderOrderComponent)) {
    allShapes.push({
      renderOrder: RenderOrderComponent.get(polygon),
      serialize: () => serializePolygon(polygon),
    });
  }
  allShapes.sort((a, b) => a.renderOrder - b.renderOrder);
  for (const shape of allShapes) {
    svgParts.push(shape.serialize());
  }

  // Serialize datums after geometry but before constraints
  for (const datum of geometryStore.listWithComponent(DatumComponent)) {
    svgParts.push(serializeDatum(datum));
  }

  // Serialize constraints
  for (const constraintGeom of geometryStore.listWithComponent(ConstraintComponent)) {
    const constraint = ConstraintComponent.get(constraintGeom);
    switch (constraint.type) {
      case 'linear':
        svgParts.push(
          serializeLinearConstraint(
            constraint,
            (ep) => geometryStore.resolveConstraintEndpoint(ep),
            constraintGeom.id,
          ),
        );
        break;
      case 'perpendicular':
        svgParts.push(
          serializePerpendicularConstraint(
            constraint,
            (ep) => geometryStore.resolveConstraintEndpoint(ep),
            constraintGeom.id,
          ),
        );
        break;
      case 'parallel':
        svgParts.push(
          serializeParallelConstraint(
            constraint,
            (ep) => geometryStore.resolveConstraintEndpoint(ep),
            constraintGeom.id,
          ),
        );
        break;
      case 'horizontal':
        svgParts.push(
          serializeHorizontalConstraint(
            constraint,
            (ep) => geometryStore.resolveConstraintEndpoint(ep),
            constraintGeom.id,
          ),
        );
        break;
      case 'vertical':
        svgParts.push(
          serializeVerticalConstraint(
            constraint,
            (ep) => geometryStore.resolveConstraintEndpoint(ep),
            constraintGeom.id,
          ),
        );
        break;
      case 'colinear':
        svgParts.push(
          serializeColinearConstraint(
            constraint,
            (ep) => geometryStore.resolveConstraintEndpoint(ep),
            constraintGeom.id,
          ),
        );
        break;
      default:
        throw new Error(
          `serializeToSvg: unexpected constraint type ${(constraint as ConstraintData).type}`,
        );
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
