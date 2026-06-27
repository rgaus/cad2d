import {
  type CubicBezierSegment,
  Ellipse,
  EllipseComponent,
  FillColorComponent,
  LinkDimensionsComponent,
  type PointSegment,
  Polygon,
  PolygonComponent,
  type QuadraticBezierSegment,
  Rectangle,
  RectangleComponent,
  RenderOrderComponent,
} from '@/lib/geometry';
import {
  ConstraintEndpoint,
  Datum,
  DatumComponent,
  LinearConstraint,
  ParallelConstraint,
  PerpendicularConstraint,
} from '@/lib/geometry';
import { ID_PREFIXES } from '@/lib/geometry/GeometryStore';
import { GeometryStore } from '@/lib/geometry/GeometryStore';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { parseSvg } from '@/lib/serialization/deserialize';
import { serializeToSvg } from '@/lib/serialization/serialize';
import { CAD2D_STATE_COMMENT_PREFIX, CURRENT_VERSION } from '@/lib/serialization/versions';
import { SHEET_UNITS_TO_PIXELS, Sheet } from '@/lib/sheet/Sheet';
import { Length } from '@/lib/units/length';
import { SheetPosition } from '@/lib/viewport/types';

function makePoint(x: number, y: number): PointSegment {
  return { type: 'point', point: new SheetPosition(x, y) };
}

function makeQuadratic(x: number, y: number, cx: number, cy: number): QuadraticBezierSegment {
  return {
    type: 'arc-quadratic',
    point: new SheetPosition(x, y),
    controlPoint: new SheetPosition(cx, cy),
  };
}

function makeCubic(
  x: number,
  y: number,
  cpa1: number,
  cpa2: number,
  cpb1: number,
  cpb2: number,
): CubicBezierSegment {
  return {
    type: 'arc-cubic',
    point: new SheetPosition(x, y),
    controlPointA: new SheetPosition(cpa1, cpa2),
    controlPointB: new SheetPosition(cpb1, cpb2),
  };
}

function comparePositions(a: SheetPosition, b: SheetPosition): boolean {
  return Math.abs(a.x - b.x) < 0.001 && Math.abs(a.y - b.y) < 0.001;
}

function comparePolygons(a: Polygon, b: Polygon): boolean {
  const aData = PolygonComponent.get(a);
  const bData = PolygonComponent.get(b);
  if (a.id !== b.id) return false;
  if (aData.closed !== bData.closed) return false;
  if (FillColorComponent.getOptional(a) !== FillColorComponent.getOptional(b)) return false;
  if (aData.openAtIndex !== bData.openAtIndex) return false;
  if (aData.points.length !== bData.points.length) return false;
  for (let i = 0; i < aData.points.length; i++) {
    const aSeg = aData.points[i];
    const bSeg = bData.points[i];
    if (aSeg.type !== bSeg.type) return false;
    if (!comparePositions(aSeg.point, bSeg.point)) return false;
    if (aSeg.type === 'arc-quadratic') {
      if (!comparePositions(aSeg.controlPoint, (bSeg as QuadraticBezierSegment).controlPoint))
        return false;
    }
    if (aSeg.type === 'arc-cubic') {
      const bSegC = bSeg as CubicBezierSegment;
      const aSegC = aSeg as CubicBezierSegment;
      if (!comparePositions(aSegC.controlPointA, bSegC.controlPointA)) return false;
      if (!comparePositions(aSegC.controlPointB, bSegC.controlPointB)) return false;
    }
  }
  return true;
}

function compareRectangles(a: Rectangle, b: Rectangle): boolean {
  const aRectangle = RectangleComponent.get(a),
    bRectangle = RectangleComponent.get(b);
  if (!comparePositions(aRectangle.upperLeft, bRectangle.upperLeft)) return false;
  if (!comparePositions(aRectangle.lowerRight, bRectangle.lowerRight)) return false;
  if (FillColorComponent.get(a) !== FillColorComponent.get(b)) return false;
  if (LinkDimensionsComponent.get(a) !== LinkDimensionsComponent.get(b)) return false;
  return true;
}

function compareEllipses(a: Ellipse, b: Ellipse): boolean {
  const aEllipse = EllipseComponent.get(a),
    bEllipse = EllipseComponent.get(b);
  if (!comparePositions(aEllipse.center, bEllipse.center)) return false;
  if (Math.abs(aEllipse.radiusX - bEllipse.radiusX) > 0.001) return false;
  if (Math.abs(aEllipse.radiusY - bEllipse.radiusY) > 0.001) return false;
  if (FillColorComponent.get(a) !== FillColorComponent.get(b)) return false;
  if (LinkDimensionsComponent.get(a) !== LinkDimensionsComponent.get(b)) return false;
  return true;
}

function constraintEndpointsEqual(a: ConstraintEndpoint, b: ConstraintEndpoint): boolean {
  if (a.type !== b.type) return false;
  switch (a.type) {
    case 'point':
      return b.type === 'point' && a.point.x === b.point.x && a.point.y === b.point.y;
    case 'locked-rectangle':
      return b.type === 'locked-rectangle' && a.id === b.id && a.point === b.point;
    case 'locked-ellipse':
      return b.type === 'locked-ellipse' && a.id === b.id && a.point === b.point;
    case 'locked-polygon':
      return b.type === 'locked-polygon' && a.id === b.id && a.pointIndex === b.pointIndex;
    case 'locked-datum':
      return b.type === 'locked-datum' && a.id === b.id;
    default:
      a satisfies never;
      throw new Error(`constraintEndpointsEqual: unexpected endpoint type ${(a as any).type}`);
  }
}

function compareConstraints(a: LinearConstraint, b: LinearConstraint): boolean {
  if (a.id !== b.id) return false;
  if (a.type !== b.type) return false;
  if (!constraintEndpointsEqual(a.pointA, b.pointA)) return false;
  if (!constraintEndpointsEqual(a.pointB, b.pointB)) return false;
  if (Math.abs(a.constrainedLength.magnitude - b.constrainedLength.magnitude) > 0.001) return false;
  if (a.constrainedLength.type !== b.constrainedLength.type) return false;
  if (a.connectorLineOffsetPx !== b.connectorLineOffsetPx) return false;
  if (a.axis !== b.axis) return false;
  return true;
}

function makeSheet(): {
  sheet: Sheet;
  geometryStore: GeometryStore;
  historyManager: HistoryManager;
} {
  const sheet = Sheet.a4();
  return { sheet, geometryStore: sheet.geometryStore, historyManager: sheet.historyManager };
}

function makePolygon(overrides: {
  id: string;
  points: Array<PointSegment>;
  closed?: boolean;
  fillColor?: number | null;
  openAtIndex?: number;
  renderOrder?: number;
}): Polygon {
  const template = Polygon.create(overrides.points, {
    closed: overrides.closed,
    fillColor: overrides.fillColor,
    openAtIndex: overrides.openAtIndex,
  });
  const renderOrder = overrides.renderOrder ?? 0;
  return {
    id: overrides.id,
    ...template,
    components: {
      ...template.components,
      ...RenderOrderComponent.create(renderOrder),
    },
  };
}

function makeRectangle(overrides: {
  id: string;
  upperLeft: SheetPosition;
  lowerRight: SheetPosition;
  fillColor?: number | null;
  linkDimensions?: boolean;
  renderOrder?: number;
}): Rectangle {
  const template = Rectangle.create(overrides.upperLeft, overrides.lowerRight, {
    fillColor: overrides.fillColor,
    linkDimensions: overrides.linkDimensions,
  });
  const renderOrder = overrides.renderOrder ?? 0;
  return {
    id: overrides.id,
    ...template,
    components: {
      ...template.components,
      ...RenderOrderComponent.create(renderOrder),
    },
  };
}

function makeEllipse(overrides: {
  id: string;
  center: SheetPosition;
  radiusX: number;
  radiusY: number;
  fillColor?: number | null;
  linkDimensions?: boolean;
  renderOrder?: number;
}): Ellipse {
  const template = Ellipse.create(overrides.center, {
    radiusX: overrides.radiusX,
    radiusY: overrides.radiusY,
    fillColor: overrides.fillColor,
    linkDimensions: overrides.linkDimensions,
  });
  const renderOrder = overrides.renderOrder ?? 0;
  return {
    id: overrides.id,
    ...template,
    components: {
      ...template.components,
      ...RenderOrderComponent.create(renderOrder),
    },
  };
}

const historyManager = new HistoryManager();
const generateStableId = historyManager.generateStableId.bind(historyManager);

describe('parseSvg', () => {
  describe('polygon path - linear', () => {
    it('parses simple closed linear polygon (with data-closed=true)', () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <path id="p1" fill="none" data-type="polygon" data-closed="true" d="M0,0 L${SHEET_UNITS_TO_PIXELS},0 L${SHEET_UNITS_TO_PIXELS},${SHEET_UNITS_TO_PIXELS} L0,${SHEET_UNITS_TO_PIXELS}" />
      </svg>`;
      const result = parseSvg(svg, generateStableId);
      expect(result.polygons).toHaveLength(1);
      const poly = result.polygons[0];
      expect(poly.id).toBe('p1');
      expect(PolygonComponent.get(poly).closed).toBe(true);
      expect(FillColorComponent.getOptional(poly)).toBeNull();
      expect(PolygonComponent.get(poly).openAtIndex).toBe(0);
      expect(PolygonComponent.get(poly).points).toHaveLength(4);
      expect(PolygonComponent.get(poly).points[0].type).toBe('point');
      expect(
        comparePositions(PolygonComponent.get(poly).points[0].point, new SheetPosition(0, 0)),
      ).toBe(true);
      expect(
        comparePositions(PolygonComponent.get(poly).points[1].point, new SheetPosition(1, 0)),
      ).toBe(true);
      expect(
        comparePositions(PolygonComponent.get(poly).points[2].point, new SheetPosition(1, 1)),
      ).toBe(true);
      expect(
        comparePositions(PolygonComponent.get(poly).points[3].point, new SheetPosition(0, 1)),
      ).toBe(true);
    });

    it('parses simple closed linear polygon (with path[d] ending in Z)', () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <path id="p1" fill="none" data-type="polygon" d="M0,0 L${SHEET_UNITS_TO_PIXELS},0 L${SHEET_UNITS_TO_PIXELS},${SHEET_UNITS_TO_PIXELS} L0,${SHEET_UNITS_TO_PIXELS} Z"/>
      </svg>`;
      const result = parseSvg(svg, generateStableId);
      expect(result.polygons).toHaveLength(1);
      const poly = result.polygons[0];
      expect(poly.id).toBe('p1');
      expect(PolygonComponent.get(poly).closed).toBe(true);
      expect(FillColorComponent.getOptional(poly)).toBeNull();
      expect(PolygonComponent.get(poly).openAtIndex).toBe(0);
      expect(PolygonComponent.get(poly).points).toHaveLength(5);
      expect(PolygonComponent.get(poly).points[0].type).toBe('point');
      expect(
        comparePositions(PolygonComponent.get(poly).points[0].point, new SheetPosition(0, 0)),
      ).toBe(true);
      expect(
        comparePositions(PolygonComponent.get(poly).points[1].point, new SheetPosition(1, 0)),
      ).toBe(true);
      expect(
        comparePositions(PolygonComponent.get(poly).points[2].point, new SheetPosition(1, 1)),
      ).toBe(true);
      expect(
        comparePositions(PolygonComponent.get(poly).points[3].point, new SheetPosition(0, 1)),
      ).toBe(true);
      expect(
        comparePositions(PolygonComponent.get(poly).points[4].point, new SheetPosition(0, 0)),
      ).toBe(true);
    });

    it('parses open linear polygon', () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <path id="p1" fill="none" data-type="polygon" d="M0,0 L64,64 L0,128" />
      </svg>`;
      const result = parseSvg(svg, generateStableId);
      expect(result.polygons).toHaveLength(1);
      const poly = PolygonComponent.get(result.polygons[0]);
      expect(poly.closed).toBe(false);
      expect(poly.points).toHaveLength(3);
    });

    it('parses 2-point path (valid)', () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <path id="p1" fill="none" data-type="polygon" d="M0,0 L64,64" />
      </svg>`;
      const result = parseSvg(svg, generateStableId);
      expect(result.polygons).toHaveLength(1);
      expect(PolygonComponent.get(result.polygons[0]).points).toHaveLength(2);
    });

    it('parses 2-point path with Z at end as non closed', () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <path id="p1" fill="none" data-type="polygon" d="M0,0 L64,64 Z" />
      </svg>`;
      const result = parseSvg(svg, generateStableId);
      expect(result.polygons).toHaveLength(1);
      expect(PolygonComponent.get(result.polygons[0]).points).toHaveLength(2);
      expect(PolygonComponent.get(result.polygons[0]).closed).toBe(false);
    });

    it('rejects 1-point path', () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <path id="p1" fill="none" data-type="polygon" d="M0,0"/>
      </svg>`;
      const result = parseSvg(svg, generateStableId);
      expect(result.polygons).toHaveLength(0);
    });

    it('rejects path with only move commands', () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <path id="p1" fill="none" data-type="polygon" d="M0,0 M64,64 M128,128"/>
      </svg>`;
      const result = parseSvg(svg, generateStableId);
      expect(result.polygons).toHaveLength(0);
    });

    it('parses polygon with fill color', () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <path id="p1" fill="#ff0000" data-type="polygon" d="M0,0 L64,0 L64,64 L0,64 Z"/>
      </svg>`;
      const result = parseSvg(svg, generateStableId);
      expect(result.polygons).toHaveLength(1);
      expect(FillColorComponent.getOptional(result.polygons[0])).toBe(0xff0000);
    });

    it('parses polygon with H (horizontal) command', () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <path id="p1" fill="none" data-type="polygon" d="M 0 0 H 64 L 64 64 L 0 64 Z"/>
      </svg>`;
      const result = parseSvg(svg, generateStableId);
      expect(result.polygons).toHaveLength(1);
      const poly = PolygonComponent.get(result.polygons[0]);
      expect(poly.points).toHaveLength(5);
      expect(comparePositions(poly.points[0].point, new SheetPosition(0, 0))).toBe(true);
      expect(comparePositions(poly.points[1].point, new SheetPosition(1, 0))).toBe(true);
      expect(comparePositions(poly.points[2].point, new SheetPosition(1, 1))).toBe(true);
      expect(comparePositions(poly.points[3].point, new SheetPosition(0, 1))).toBe(true);
    });

    it('parses polygon with V (vertical) command', () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <path id="p1" fill="none" data-type="polygon" d="M 0 0 L 64 0 V 64 L 0 64 Z"/>
      </svg>`;
      const result = parseSvg(svg, generateStableId);
      expect(result.polygons).toHaveLength(1);
      const poly = PolygonComponent.get(result.polygons[0]);
      expect(poly.points).toHaveLength(5);
      expect(comparePositions(poly.points[0].point, new SheetPosition(0, 0))).toBe(true);
      expect(comparePositions(poly.points[1].point, new SheetPosition(1, 0))).toBe(true);
      expect(comparePositions(poly.points[2].point, new SheetPosition(1, 1))).toBe(true);
      expect(comparePositions(poly.points[3].point, new SheetPosition(0, 1))).toBe(true);
    });

    it('parses polygon with H and V commands mixed', () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <path id="p1" fill="none" data-type="polygon" d="M 0 0 H 64 V 64 H 0 Z"/>
      </svg>`;
      const result = parseSvg(svg, generateStableId);
      expect(result.polygons).toHaveLength(1);
      const poly = PolygonComponent.get(result.polygons[0]);
      expect(poly.points).toHaveLength(5);
      expect(comparePositions(poly.points[0].point, new SheetPosition(0, 0))).toBe(true);
      expect(comparePositions(poly.points[1].point, new SheetPosition(1, 0))).toBe(true);
      expect(comparePositions(poly.points[2].point, new SheetPosition(1, 1))).toBe(true);
      expect(comparePositions(poly.points[3].point, new SheetPosition(0, 1))).toBe(true);
    });
  });

  describe('polygon path - with arcs', () => {
    it('parses quadratic arc polygon', () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <path id="p1" fill="none" data-type="polygon" d="M0,0 Q32,64 64,0 L64,64 L0,64 Z"/>
      </svg>`;
      const result = parseSvg(svg, generateStableId);
      expect(result.polygons).toHaveLength(1);
      const poly = PolygonComponent.get(result.polygons[0]);
      expect(poly.points).toHaveLength(5);
      expect(poly.points[0].type).toBe('point');
      expect(poly.points[1].type).toBe('arc-quadratic');
      const arcSeg = poly.points[1] as QuadraticBezierSegment;
      expect(comparePositions(arcSeg.point, new SheetPosition(1, 0))).toBe(true);
      expect(comparePositions(arcSeg.controlPoint, new SheetPosition(0.5, 1))).toBe(true);
    });

    it('parses cubic arc polygon', () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <path id="p1" fill="none" data-type="polygon" d="M0,0 C16,64 48,64 64,0 L64,64 L0,64 Z"/>
      </svg>`;
      const result = parseSvg(svg, generateStableId);
      expect(result.polygons).toHaveLength(1);
      const poly = PolygonComponent.get(result.polygons[0]);
      expect(poly.points[1].type).toBe('arc-cubic');
      const arcSeg = poly.points[1] as CubicBezierSegment;
      expect(comparePositions(arcSeg.point, new SheetPosition(1, 0))).toBe(true);
      expect(comparePositions(arcSeg.controlPointA, new SheetPosition(0.25, 1))).toBe(true);
      expect(comparePositions(arcSeg.controlPointB, new SheetPosition(0.75, 1))).toBe(true);
    });
  });

  describe('polygon element (<polygon>)', () => {
    it('parses closed linear polygon', () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <polygon id="p1" fill="#00ff00" data-type="polygon" data-open-at-index="2" points="0,0 ${SHEET_UNITS_TO_PIXELS},0 ${SHEET_UNITS_TO_PIXELS},${SHEET_UNITS_TO_PIXELS} 0,${SHEET_UNITS_TO_PIXELS}"/>
      </svg>`;
      const result = parseSvg(svg, generateStableId);
      expect(result.polygons).toHaveLength(1);
      const poly = result.polygons[0];
      expect(PolygonComponent.get(poly).closed).toBe(true);
      expect(PolygonComponent.get(poly).openAtIndex).toBe(2);
      expect(FillColorComponent.getOptional(poly)).toBe(0x00ff00);
      // Should have duplicated first point at end
      expect(PolygonComponent.get(poly).points).toHaveLength(5);
      expect(
        comparePositions(PolygonComponent.get(poly).points[4].point, new SheetPosition(0, 0)),
      ).toBe(true);
    });

    it('rejects polygon with insufficient points', () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <polygon id="p1" fill="none" data-type="polygon" points="0,0 64,64"/>
      </svg>`;
      const result = parseSvg(svg, generateStableId);
      expect(result.polygons).toHaveLength(0);
    });

    it('handles scientific notation in points', () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 5000 5000">
        <polygon id="p1" fill="none" data-type="polygon" points="1.5e2,2.5e2 2e3,3e3 4e2,5e2"/>
      </svg>`;
      const result = parseSvg(svg, generateStableId);
      expect(result.polygons).toHaveLength(1);
      const poly = PolygonComponent.get(result.polygons[0]);
      expect(poly.points).toHaveLength(4); // 3 + duplicate
      expect(
        comparePositions(
          poly.points[0].point,
          new SheetPosition(150 / SHEET_UNITS_TO_PIXELS, 250 / SHEET_UNITS_TO_PIXELS),
        ),
      ).toBe(true);
    });
  });

  describe('rectangle', () => {
    it('parses basic rectangle', () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <rect id="r1" data-type="rectangle" fill="#ff0000" data-link-dimensions="true" x="0" y="0" width="${SHEET_UNITS_TO_PIXELS}" height="${SHEET_UNITS_TO_PIXELS / 2}"/>
      </svg>`;
      const result = parseSvg(svg, generateStableId);
      expect(result.rectangles).toHaveLength(1);
      const rect = result.rectangles[0];
      expect(rect.id).toBe('r1');
      expect(
        comparePositions(RectangleComponent.get(rect).upperLeft, new SheetPosition(0, 0)),
      ).toBe(true);
      expect(
        comparePositions(RectangleComponent.get(rect).lowerRight, new SheetPosition(1, 0.5)),
      ).toBe(true);
      expect(FillColorComponent.get(rect)).toBe(0xff0000);
      expect(LinkDimensionsComponent.get(rect)).toBe(true);
    });

    it('parses rectangle with none fill', () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <rect id="r1" data-type="rectangle" fill="none" data-link-dimensions="false" x="0" y="0" width="64" height="32"/>
      </svg>`;
      const result = parseSvg(svg, generateStableId);
      expect(FillColorComponent.get(result.rectangles[0])).toBeNull();
      expect(LinkDimensionsComponent.get(result.rectangles[0])).toBe(false);
    });

    it('rejects rectangle with zero width', () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <rect id="r1" data-type="rectangle" fill="none" x="0" y="0" width="0" height="64"/>
      </svg>`;
      const result = parseSvg(svg, generateStableId);
      expect(result.rectangles).toHaveLength(0);
    });

    it('rejects rectangle with negative height', () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <rect id="r1" data-type="rectangle" fill="none" x="0" y="0" width="64" height="-5"/>
      </svg>`;
      const result = parseSvg(svg, generateStableId);
      expect(result.rectangles).toHaveLength(0);
    });
  });

  describe('ellipse', () => {
    it('parses basic ellipse', () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <ellipse id="e1" data-type="ellipse" fill="#0000ff" data-link-dimensions="false" cx="32" cy="32" rx="${SHEET_UNITS_TO_PIXELS}" ry="${SHEET_UNITS_TO_PIXELS / 2}"/>
      </svg>`;
      const result = parseSvg(svg, generateStableId);
      expect(result.ellipses).toHaveLength(1);
      const ellipse = result.ellipses[0];
      expect(ellipse.id).toBe('e1');
      expect(
        comparePositions(EllipseComponent.get(ellipse).center, new SheetPosition(0.5, 0.5)),
      ).toBe(true);
      expect(EllipseComponent.get(ellipse).radiusX).toBeCloseTo(1, 3);
      expect(EllipseComponent.get(ellipse).radiusY).toBeCloseTo(0.5, 3);
      expect(FillColorComponent.get(ellipse)).toBe(0x0000ff);
      expect(LinkDimensionsComponent.get(ellipse)).toBe(false);
    });

    it('parses ellipse with transparent fill', () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <ellipse id="e1" data-type="ellipse" fill="transparent" data-link-dimensions="true" cx="32" cy="32" rx="32" ry="16"/>
      </svg>`;
      const result = parseSvg(svg, generateStableId);
      expect(FillColorComponent.get(result.ellipses[0])).toBeNull();
    });

    it('rejects ellipse with zero rx', () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <ellipse id="e1" data-type="ellipse" fill="none" cx="32" cy="32" rx="0" ry="16"/>
      </svg>`;
      const result = parseSvg(svg, generateStableId);
      expect(result.ellipses).toHaveLength(0);
    });

    it('rejects ellipse with negative ry', () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <ellipse id="e1" data-type="ellipse" fill="none" cx="32" cy="32" rx="16" ry="-5"/>
      </svg>`;
      const result = parseSvg(svg, generateStableId);
      expect(result.ellipses).toHaveLength(0);
    });
  });

  describe('constraint', () => {
    it('parses linear constraint from <g> element with all data attributes', () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" data-cad2d-version="1">
        <g data-type="linear-constraint" id="cns_parse_test"
           data-point-a-x="5"
           data-point-a-y="10"
           data-point-b-x="15"
           data-point-b-y="20"
           data-offset="-12"
           data-length-mag="3.75"
           data-length-type="cm">
          <line x1="320" y1="640" x2="960" y2="640" stroke="#666666" stroke-width="1"/>
        </g>
      </svg>`;
      const result = parseSvg(svg, generateStableId);
      expect(result.constraints).toHaveLength(1);
      expect(result.constraints[0].id).toBe('cns_parse_test');
      expect((result.constraints[0].pointA as any).point.x).toBe(5);
      expect((result.constraints[0].pointA as any).point.y).toBe(10);
      expect((result.constraints[0].pointB as any).point.x).toBe(15);
      expect((result.constraints[0].pointB as any).point.y).toBe(20);
      expect(result.constraints[0].type).toStrictEqual('linear');
      expect((result.constraints[0] as LinearConstraint).connectorLineOffsetPx).toBe(-12);
      expect((result.constraints[0] as LinearConstraint).constrainedLength.magnitude).toBe(3.75);
    });

    it('parses perpendicular constraint from <g> element', () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" data-cad2d-version="1">
        <g data-type="perpendicular-constraint" id="cns_perp_test"
           data-endpoint-a-type="point"
           data-endpoint-a-x="0"
           data-endpoint-a-y="0"
           data-endpoint-center-type="point"
           data-endpoint-center-x="5"
           data-endpoint-center-y="0"
           data-endpoint-c-type="point"
           data-endpoint-c-x="5"
           data-endpoint-c-y="5">
        </g>
      </svg>`;
      const result = parseSvg(svg, generateStableId);
      expect(result.constraints).toHaveLength(1);
      const c = result.constraints[0] as PerpendicularConstraint;
      expect(c.id).toBe('cns_perp_test');
      expect(c.type).toStrictEqual('perpendicular');
      expect(c.pointA.type).toStrictEqual('point');
      expect((c.pointA as any).point.x).toBe(0);
      expect((c.pointA as any).point.y).toBe(0);
      expect(c.pointCenter.type).toStrictEqual('point');
      expect((c.pointCenter as any).point.x).toBe(5);
      expect((c.pointCenter as any).point.y).toBe(0);
      expect(c.pointB.type).toStrictEqual('point');
      expect((c.pointB as any).point.x).toBe(5);
      expect((c.pointB as any).point.y).toBe(5);
    });

    it('ignores inner children of constraint <g> element', () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">
        <g data-type="linear-constraint" id="cns_ignore_inner"
           data-point-a-x="0"
           data-point-a-y="0"
           data-point-b-x="10"
           data-point-b-y="0"
           data-offset="0"
           data-length-mag="25.4"
           data-length-type="mm">
          <line x1="0" y1="0" x2="640" y2="0" stroke="#666666" stroke-width="1"/>
          <line x1="0" y1="-16" x2="0" y2="16" stroke="#666666" stroke-width="1"/>
          <text x="320" y="-8" fill="#666666">25.4 mm</text>
        </g>
      </svg>`;
      const result = parseSvg(svg, generateStableId);
      expect(result.constraints).toHaveLength(1);
      expect(result.constraints[0].id).toBe('cns_ignore_inner');
      expect(result.constraints[0].type).toStrictEqual('linear');
      expect((result.constraints[0] as LinearConstraint).constrainedLength.magnitude).toBe(25.4);
    });

    it('skips <g> elements without data-type="linear-constraint"', () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">
        <g id="not-a-constraint">
          <line x1="0" y1="0" x2="100" y2="100" stroke="black"/>
        </g>
        <g data-type="linear-constraint" id="cns_real"
           data-point-a-x="0"
           data-point-a-y="0"
           data-point-b-x="5"
           data-point-b-y="0"
           data-offset="0"
           data-length-mag="5"
           data-length-type="cm">
        </g>
      </svg>`;
      const result = parseSvg(svg, generateStableId);
      expect(result.constraints).toHaveLength(1);
      expect(result.constraints[0].id).toBe('cns_real');
    });

    it('parses constraint with all supported length types', () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">
        <g data-type="linear-constraint" id="cns_in" data-point-a-x="0" data-point-a-y="0" data-point-b-x="1" data-point-b-y="0" data-offset="0" data-length-mag="1" data-length-type="in"></g>
        <g data-type="linear-constraint" id="cns_ft" data-point-a-x="0" data-point-a-y="0" data-point-b-x="1" data-point-b-y="0" data-offset="0" data-length-mag="1" data-length-type="ft"></g>
        <g data-type="linear-constraint" id="cns_mm" data-point-a-x="0" data-point-a-y="0" data-point-b-x="1" data-point-b-y="0" data-offset="0" data-length-mag="1" data-length-type="mm"></g>
        <g data-type="linear-constraint" id="cns_cm" data-point-a-x="0" data-point-a-y="0" data-point-b-x="1" data-point-b-y="0" data-offset="0" data-length-mag="1" data-length-type="cm"></g>
        <g data-type="linear-constraint" id="cns_m" data-point-a-x="0" data-point-a-y="0" data-point-b-x="1" data-point-b-y="0" data-offset="0" data-length-mag="1" data-length-type="m"></g>
      </svg>`;
      const result = parseSvg(svg, generateStableId);
      expect(result.constraints).toHaveLength(5);
      // Verify each constraint was parsed with correct magnitude
      for (const c of result.constraints) {
        switch (c.type) {
          case 'linear':
            expect(c.constrainedLength.magnitude).toBe(1);
            break;
        }
      }
      // Verify the toDisplayString returns expected formats (which differ by type)
      expect(
        (
          result.constraints.find((c) => c.id === 'cns_in')! as LinearConstraint
        ).constrainedLength.toDisplayString(),
      ).toContain('inch');
      expect(
        (
          result.constraints.find((c) => c.id === 'cns_ft')! as LinearConstraint
        ).constrainedLength.toDisplayString(),
      ).toContain('foot');
      expect(
        (
          result.constraints.find((c) => c.id === 'cns_mm')! as LinearConstraint
        ).constrainedLength.toDisplayString(),
      ).toContain('mm');
      expect(
        (
          result.constraints.find((c) => c.id === 'cns_cm')! as LinearConstraint
        ).constrainedLength.toDisplayString(),
      ).toContain('cm');
      expect(
        (
          result.constraints.find((c) => c.id === 'cns_m')! as LinearConstraint
        ).constrainedLength.toDisplayString(),
      ).toContain('meter');
    });
  });

  describe('color parsing', () => {
    it('parses hex colors', () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <rect id="r1" data-type="rectangle" fill="#ff8800" x="0" y="0" width="10" height="10"/>
      </svg>`;
      const result = parseSvg(svg, generateStableId);
      expect(FillColorComponent.get(result.rectangles[0])).toBe(0xff8800);
    });

    it('parses rgb colors', () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <rect id="r1" data-type="rectangle" fill="rgb(0,128,255)" x="0" y="0" width="10" height="10"/>
      </svg>`;
      const result = parseSvg(svg, generateStableId);
      expect(FillColorComponent.get(result.rectangles[0])).toBe(0x0080ff);
    });

    it('parses hsl colors', () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <rect id="r1" data-type="rectangle" fill="hsl(120,100%,50%)" x="0" y="0" width="10" height="10"/>
      </svg>`;
      const result = parseSvg(svg, generateStableId);
      expect(FillColorComponent.get(result.rectangles[0])).toBe(0x00ff00);
    });

    it('returns null for "none" fill', () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <rect id="r1" data-type="rectangle" fill="none" x="0" y="0" width="10" height="10"/>
      </svg>`;
      const result = parseSvg(svg, generateStableId);
      expect(FillColorComponent.get(result.rectangles[0])).toBeNull();
    });
  });

  describe('state comment', () => {
    it('parses full native SVG with state comment', () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1344 1900.8" data-cad2d-version="1">
        <rect id="r1" data-type="rectangle" fill="none" data-link-dimensions="false" x="0" y="0" width="100" height="100"/>
        <!-- ${CAD2D_STATE_COMMENT_PREFIX}{"version":1,"sheet":{"width":{"type":"cm","magnitude":21},"height":{"type":"cm","magnitude":29.7},"defaultUnit":"cm"},"viewport":{"position":{"x":0,"y":0},"scale":1},"selection":[],"history":{"undoStack":[],"redoStack":[],"stableIdCounter":1},"activeTool":"select"} -->
      </svg>`;
      const result = parseSvg(svg, generateStableId);
      expect(result.isValid).toBe(true);
      expect(result.isFallback).toBe(true);
      expect(result.state).not.toBeNull();
      expect(result.state!.version).toBe(CURRENT_VERSION);
      expect(result.state!.sheet.defaultUnit).toBe('cm');
      expect(result.state!.activeTool).toBe('select');
      expect(result.state!.history.undoStack).toEqual([]);
      expect(result.state!.history.redoStack).toEqual([]);
      expect(result.state!.history.stableIdCounter).toBe(1);
    });

    it('parses fallback SVG (no state comment) with geometry', () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <rect id="r1" data-type="rectangle" fill="none" x="0" y="0" width="10" height="10"/>
      </svg>`;
      const result = parseSvg(svg, generateStableId);
      expect(result.isValid).toBe(true);
      expect(result.isFallback).toBe(false);
      expect(result.state).toBeNull();
    });

    it('extracts version from data-cad2d-version attribute', () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" data-cad2d-version="5">
        <rect id="r1" data-type="rectangle" fill="none" x="0" y="0" width="10" height="10"/>
      </svg>`;
      const result = parseSvg(svg, generateStableId);
      expect(result.version).toBe(5);
    });
  });

  describe('mixed geometry', () => {
    it('parses multiple polygons, rectangles, and ellipses', () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <path id="p1" fill="none" data-type="polygon" d="M0,0 L64,0 L64,64 L0,64 Z"/>
        <rect id="r1" data-type="rectangle" fill="none" x="128" y="0" width="64" height="32"/>
        <ellipse id="e1" data-type="ellipse" fill="none" cx="192" cy="16" rx="32" ry="16"/>
      </svg>`;
      const result = parseSvg(svg, generateStableId);
      expect(result.polygons).toHaveLength(1);
      expect(result.rectangles).toHaveLength(1);
      expect(result.ellipses).toHaveLength(1);
    });
  });
});

describe('serializeToSvg', () => {
  it('serializes closed linear polygon as <polygon> element', () => {
    const { sheet, geometryStore } = makeSheet();
    geometryStore.add(
      ID_PREFIXES.polygon,
      Polygon.create(
        [
          makePoint(0, 0),
          makePoint(1, 0),
          makePoint(1, 1),
          makePoint(0, 1),
          makePoint(0, 0), // duplicate for closed
        ],
        { closed: true, fillColor: null, openAtIndex: 0 },
      ),
    );

    const svg = serializeToSvg(sheet, { x: 0, y: 0 }, 1, [], 'select');
    expect(svg).toContain('<polygon');
    expect(svg).toContain('data-type="polygon"');
    expect(svg).toContain('data-open-at-index="0"');
    expect(svg).not.toContain('data-closed');
  });

  it('serializes open polygon as <path> element', () => {
    const { sheet, geometryStore } = makeSheet();
    geometryStore.add(
      ID_PREFIXES.polygon,
      Polygon.create([makePoint(0, 0), makePoint(1, 0), makePoint(1, 1)], {
        closed: false,
        fillColor: null,
        openAtIndex: 0,
      }),
    );

    const svg = serializeToSvg(sheet, { x: 0, y: 0 }, 1, [], 'select');
    expect(svg).toContain('<path');
    expect(svg).toMatch(/d=".*L.*?[^Z]"/);
  });

  it('serializes polygon with quadratic arc as <path> with Q command', () => {
    const { sheet, geometryStore } = makeSheet();
    geometryStore.add(
      ID_PREFIXES.polygon,
      Polygon.create(
        [makePoint(0, 0), makeQuadratic(1, 0, 0.5, 1), makePoint(1, 1), makePoint(0, 1)],
        { closed: true, fillColor: null, openAtIndex: 0 },
      ),
    );

    const svg = serializeToSvg(sheet, { x: 0, y: 0 }, 1, [], 'select');
    expect(svg).toMatch(/d=".*Q.*Z/);
  });

  it('serializes polygon with cubic arc as <path> with C command', () => {
    const { sheet, geometryStore } = makeSheet();
    geometryStore.add(
      ID_PREFIXES.polygon,
      Polygon.create(
        [makePoint(0, 0), makeCubic(1, 0, 0.25, 1, 0.75, 1), makePoint(1, 1), makePoint(0, 1)],
        { closed: true, fillColor: null, openAtIndex: 0 },
      ),
    );

    const svg = serializeToSvg(sheet, { x: 0, y: 0 }, 1, [], 'select');
    expect(svg).toMatch(/d=".*C/);
  });

  it('serializes rectangle with correct attributes', () => {
    const { sheet, geometryStore } = makeSheet();
    geometryStore.add(
      ID_PREFIXES.rectangle,
      Rectangle.create(new SheetPosition(0, 0), new SheetPosition(1, 1), {
        fillColor: 0xff0000,
        linkDimensions: true,
      }),
    );

    const svg = serializeToSvg(sheet, { x: 0, y: 0 }, 1, [], 'select');
    expect(svg).toContain('data-type="rectangle"');
    expect(svg).toContain('data-link-dimensions="true"');
    expect(svg).toContain('fill="#ff0000"');
    expect(svg).toContain('x="0.00"');
    expect(svg).toContain('y="0.00"');
    expect(svg).toContain('width="64.00"');
    expect(svg).toContain('height="64.00"');
  });

  it('serializes ellipse with radii in pixels', () => {
    const { sheet, geometryStore } = makeSheet();
    geometryStore.add(
      ID_PREFIXES.ellipse,
      Ellipse.create(new SheetPosition(0.5, 0.5), {
        radiusX: 0.5,
        radiusY: 0.25,
        fillColor: 0x0000ff,
        linkDimensions: false,
      }),
    );

    const svg = serializeToSvg(sheet, { x: 0, y: 0 }, 1, [], 'select');
    expect(svg).toContain('data-type="ellipse"');
    expect(svg).toContain('data-link-dimensions="false"');
    expect(svg).toContain('fill="#0000ff"');
    expect(svg).toContain('rx="32"');
    expect(svg).toContain('ry="16"');
  });

  it('serializes empty geometry with state comment only', () => {
    const { sheet } = makeSheet();
    const svg = serializeToSvg(sheet, { x: 0, y: 0 }, 1, [], 'select');

    expect(svg).toContain('<svg');
    expect(svg).toContain(`data-cad2d-version="${CURRENT_VERSION}"`);
    expect(svg).toContain(`<!-- ${CAD2D_STATE_COMMENT_PREFIX}`);
    expect(svg).not.toContain('<path');
    expect(svg).not.toContain('<rect');
    expect(svg).not.toContain('<ellipse');
    expect(svg).toContain('</svg>');
  });

  it('serializes state comment with correct JSON structure', () => {
    const { sheet } = makeSheet();
    const svg = serializeToSvg(sheet, { x: 10, y: 20 }, 1.5, ['p1', 'r1'], 'polygon');

    const stateMatch = svg.match(new RegExp(`<!-- ${CAD2D_STATE_COMMENT_PREFIX}(.+) -->`));
    expect(stateMatch).not.toBeNull();

    const state = JSON.parse(stateMatch![1]);
    expect(state.version).toBe(CURRENT_VERSION);
    expect(state.sheet.width.type).toBe('cm');
    expect(state.sheet.height.type).toBe('cm');
    expect(state.sheet.defaultUnit).toBe('cm');
    expect(state.viewport.position.x).toBe(10);
    expect(state.viewport.position.y).toBe(20);
    expect(state.viewport.scale).toBe(1.5);
    expect(state.selection).toEqual(['p1', 'r1']);
    expect(state.activeTool).toBe('polygon');
    expect(state.history).toBeDefined();
    expect(state.history.undoStack).toEqual([]);
    expect(state.history.redoStack).toEqual([]);
    expect(typeof state.history.stableIdCounter).toBe('number');
  });

  it('scales coordinates from sheet units to pixels', () => {
    const { sheet, geometryStore } = makeSheet();
    geometryStore.add(
      ID_PREFIXES.polygon,
      Polygon.create([makePoint(2, 3), makePoint(2.5, 3), makePoint(2.5, 3.5), makePoint(2, 3.5)], {
        closed: true,
        fillColor: null,
        openAtIndex: 0,
      }),
    );

    const svg = serializeToSvg(sheet, { x: 0, y: 0 }, 1, [], 'select');
    expect(svg).toContain(`${2 * SHEET_UNITS_TO_PIXELS}`);
    expect(svg).toContain(`${2.5 * SHEET_UNITS_TO_PIXELS}`);
  });

  it('serializes fill color "none" for null fill', () => {
    const { sheet, geometryStore } = makeSheet();
    geometryStore.add(
      ID_PREFIXES.rectangle,
      Rectangle.create(new SheetPosition(0, 0), new SheetPosition(1, 1), {
        fillColor: null,
        linkDimensions: false,
      }),
    );

    const svg = serializeToSvg(sheet, { x: 0, y: 0 }, 1, [], 'select');
    expect(svg).toContain('fill="none"');
  });

  it('serializes linear constraint as <g> element with correct data attributes', () => {
    const { sheet, geometryStore } = makeSheet();
    geometryStore.addConstraintDirect({
      id: 'cns_serialize_test',
      type: 'linear',
      pointA: { type: 'point', point: new SheetPosition(1, 2) },
      pointB: { type: 'point', point: new SheetPosition(3, 4) },
      constrainedLength: Length.inches(2.5),
      connectorLineOffsetPx: -8,
      axis: null,
    });

    const svg = serializeToSvg(sheet, { x: 0, y: 0 }, 1, [], 'select');
    expect(svg).toContain('<g');
    expect(svg).toContain('data-type="linear-constraint"');
    expect(svg).toContain('id="cns_serialize_test"');
    expect(svg).toContain('data-endpoint-a-type="point"');
    expect(svg).toContain('data-endpoint-a-x="1"');
    expect(svg).toContain('data-endpoint-a-y="2"');
    expect(svg).toContain('data-endpoint-b-type="point"');
    expect(svg).toContain('data-endpoint-b-x="3"');
    expect(svg).toContain('data-endpoint-b-y="4"');
    expect(svg).toContain('data-offset="-8"');
    expect(svg).toContain('data-length-mag="2.5"');
    expect(svg).toContain('data-length-type="in"');
    expect(svg).toContain('</g>');
  });

  it('serializes data-axis attribute when axis is set', () => {
    const { sheet, geometryStore } = makeSheet();
    geometryStore.addConstraintDirect({
      id: 'cns_axis_x',
      type: 'linear',
      pointA: { type: 'point', point: new SheetPosition(1, 2) },
      pointB: { type: 'point', point: new SheetPosition(3, 2) },
      constrainedLength: Length.inches(2),
      connectorLineOffsetPx: -12,
      axis: 'x',
    });

    const svg = serializeToSvg(sheet, { x: 0, y: 0 }, 1, [], 'select');
    expect(svg).toContain('data-axis="x"');
  });

  it('omits data-axis attribute when axis is null', () => {
    const { sheet, geometryStore } = makeSheet();
    geometryStore.addConstraintDirect({
      id: 'cns_axis_null',
      type: 'linear',
      pointA: { type: 'point', point: new SheetPosition(1, 2) },
      pointB: { type: 'point', point: new SheetPosition(3, 2) },
      constrainedLength: Length.inches(2),
      connectorLineOffsetPx: -12,
      axis: null,
    });

    const svg = serializeToSvg(sheet, { x: 0, y: 0 }, 1, [], 'select');
    expect(svg).not.toContain('data-axis');
  });
});

describe('round-trip', () => {
  function addPolygon(
    geometryStore: GeometryStore,
    points: Array<{
      type: 'point' | 'arc-quadratic' | 'arc-cubic';
      point?: SheetPosition;
      controlPoint?: SheetPosition;
      controlPointA?: SheetPosition;
      controlPointB?: SheetPosition;
    }>,
    closed: boolean,
    fillColor: number | null,
    openAtIndex: number,
  ): Polygon {
    const segs = points.map((p) => {
      if (p.type === 'point') {
        return makePoint(p.point!.x, p.point!.y);
      } else if (p.type === 'arc-quadratic') {
        return makeQuadratic(p.point!.x, p.point!.y, p.controlPoint!.x, p.controlPoint!.y);
      } else {
        return makeCubic(
          p.point!.x,
          p.point!.y,
          p.controlPointA!.x,
          p.controlPointA!.y,
          p.controlPointB!.x,
          p.controlPointB!.y,
        );
      }
    });
    const template = Polygon.create(segs, { closed, fillColor, openAtIndex });
    return geometryStore.add(ID_PREFIXES.polygon, template);
  }

  it('simple closed linear polygon round-trips correctly', () => {
    const { sheet, geometryStore } = makeSheet();
    addPolygon(
      geometryStore,
      [
        { type: 'point', point: new SheetPosition(0, 0) },
        { type: 'point', point: new SheetPosition(1, 0) },
        { type: 'point', point: new SheetPosition(1, 1) },
        { type: 'point', point: new SheetPosition(0, 1) },
        { type: 'point', point: new SheetPosition(0, 0) },
      ],
      true,
      0xff0000,
      0,
    );

    const original = geometryStore.listWithComponent(PolygonComponent)[0] as Polygon;
    const svg = serializeToSvg(sheet, { x: 0, y: 0 }, 1, [], 'select');
    const result = parseSvg(svg, generateStableId);

    expect(result.polygons).toHaveLength(1);
    const parsed = result.polygons[0];
    expect(comparePolygons(original, parsed)).toBe(true);
  });

  it('open polygon round-trips correctly', () => {
    const { sheet, geometryStore } = makeSheet();
    addPolygon(
      geometryStore,
      [
        { type: 'point', point: new SheetPosition(0, 0) },
        { type: 'point', point: new SheetPosition(1, 0) },
        { type: 'point', point: new SheetPosition(1, 1) },
      ],
      false,
      null,
      0,
    );

    const svg = serializeToSvg(sheet, { x: 0, y: 0 }, 1, [], 'select');
    const result = parseSvg(svg, generateStableId);

    expect(result.polygons).toHaveLength(1);
    expect(PolygonComponent.get(result.polygons[0]).closed).toBe(false);
    expect(PolygonComponent.get(result.polygons[0]).points).toHaveLength(3);
  });

  it('polygon with quadratic arc preserves arc type', () => {
    const { sheet, geometryStore } = makeSheet();
    addPolygon(
      geometryStore,
      [
        { type: 'point', point: new SheetPosition(0, 0) },
        {
          type: 'arc-quadratic',
          point: new SheetPosition(1, 0),
          controlPoint: new SheetPosition(0.5, 1),
        },
        { type: 'point', point: new SheetPosition(1, 1) },
        { type: 'point', point: new SheetPosition(0, 1) },
      ],
      true,
      null,
      0,
    );

    const svg = serializeToSvg(sheet, { x: 0, y: 0 }, 1, [], 'select');
    const result = parseSvg(svg, generateStableId);

    expect(PolygonComponent.get(result.polygons[0]).points[1].type).toBe('arc-quadratic');
    const arcSeg = PolygonComponent.get(result.polygons[0]).points[1] as QuadraticBezierSegment;
    expect(comparePositions(arcSeg.point, new SheetPosition(1, 0))).toBe(true);
    expect(comparePositions(arcSeg.controlPoint, new SheetPosition(0.5, 1))).toBe(true);
  });

  it('polygon with cubic arc preserves arc type', () => {
    const { sheet, geometryStore } = makeSheet();
    addPolygon(
      geometryStore,
      [
        { type: 'point', point: new SheetPosition(0, 0) },
        {
          type: 'arc-cubic',
          point: new SheetPosition(1, 0),
          controlPointA: new SheetPosition(0.25, 1),
          controlPointB: new SheetPosition(0.75, 1),
        },
        { type: 'point', point: new SheetPosition(1, 1) },
        { type: 'point', point: new SheetPosition(0, 1) },
      ],
      true,
      null,
      0,
    );

    const svg = serializeToSvg(sheet, { x: 0, y: 0 }, 1, [], 'select');
    const result = parseSvg(svg, generateStableId);

    expect(PolygonComponent.get(result.polygons[0]).points[1].type).toBe('arc-cubic');
    const arcSeg = PolygonComponent.get(result.polygons[0]).points[1] as CubicBezierSegment;
    expect(comparePositions(arcSeg.controlPointA, new SheetPosition(0.25, 1))).toBe(true);
    expect(comparePositions(arcSeg.controlPointB, new SheetPosition(0.75, 1))).toBe(true);
  });

  it('rectangle round-trips correctly', () => {
    const { sheet, geometryStore } = makeSheet();
    geometryStore.add(
      ID_PREFIXES.rectangle,
      Rectangle.create(new SheetPosition(0, 0), new SheetPosition(1, 1), {
        fillColor: 0xff0000,
        linkDimensions: true,
      }),
    );

    const original = Array.from(
      geometryStore.listWithComponent(RectangleComponent),
    )[0] as Rectangle;
    const svg = serializeToSvg(sheet, { x: 0, y: 0 }, 1, [], 'select');
    const result = parseSvg(svg, generateStableId);

    expect(result.rectangles).toHaveLength(1);
    expect(compareRectangles(original, result.rectangles[0])).toBe(true);
  });

  it('ellipse round-trips correctly', () => {
    const { sheet, geometryStore } = makeSheet();
    geometryStore.add(
      ID_PREFIXES.ellipse,
      Ellipse.create(new SheetPosition(0.5, 0.5), {
        radiusX: 0.5,
        radiusY: 0.25,
        fillColor: 0x0000ff,
        linkDimensions: false,
      }),
    );

    const original = Array.from(
      geometryStore.listWithComponent(EllipseComponent),
    )[0] as unknown as Ellipse;
    const svg = serializeToSvg(sheet, { x: 0, y: 0 }, 1, [], 'select');
    const result = parseSvg(svg, generateStableId);

    expect(result.ellipses).toHaveLength(1);
    expect(compareEllipses(original, result.ellipses[0])).toBe(true);
  });

  it('constraint round-trips correctly', () => {
    const { sheet, geometryStore } = makeSheet();
    geometryStore.addConstraintDirect({
      id: 'cns_test_1',
      type: 'linear',
      pointA: { type: 'point', point: new SheetPosition(0, 0) },
      pointB: { type: 'point', point: new SheetPosition(10, 5) },
      constrainedLength: Length.inches(5),
      connectorLineOffsetPx: -12,
      axis: null as 'x' | 'y' | null,
    });

    const original = geometryStore.constraints[0] as LinearConstraint;
    const svg = serializeToSvg(sheet, { x: 0, y: 0 }, 1, [], 'select');
    const result = parseSvg(svg, generateStableId);

    expect(result.constraints).toHaveLength(1);
    expect(compareConstraints(original, result.constraints[0] as LinearConstraint)).toBe(true);
  });

  it('multiple constraints round-trip correctly', () => {
    const { sheet, geometryStore } = makeSheet();
    geometryStore.addConstraintDirect({
      id: 'cns_1',
      type: 'linear',
      pointA: { type: 'point', point: new SheetPosition(0, 0) },
      pointB: { type: 'point', point: new SheetPosition(10, 0) },
      constrainedLength: Length.centimeters(25),
      connectorLineOffsetPx: -12,
      axis: null as 'x' | 'y' | null,
    });
    geometryStore.addConstraintDirect({
      id: 'cns_2',
      type: 'linear',
      pointA: { type: 'point', point: new SheetPosition(0, 0) },
      pointB: { type: 'point', point: new SheetPosition(0, 10) },
      constrainedLength: Length.millimeters(100),
      connectorLineOffsetPx: 12,
      axis: null as 'x' | 'y' | null,
    });

    const svg = serializeToSvg(sheet, { x: 0, y: 0 }, 1, [], 'select');
    const result = parseSvg(svg, generateStableId);

    expect(result.constraints).toHaveLength(2);
    expect(
      compareConstraints(
        geometryStore.constraints[0] as LinearConstraint,
        result.constraints[0] as LinearConstraint,
      ),
    ).toBe(true);
    expect(
      compareConstraints(
        geometryStore.constraints[1] as LinearConstraint,
        result.constraints[1] as LinearConstraint,
      ),
    ).toBe(true);
  });

  it('perpendicular constraint round-trips correctly', () => {
    const { sheet, geometryStore } = makeSheet();
    geometryStore.addConstraintDirect({
      id: 'cns_perp_rt',
      type: 'perpendicular',
      pointA: { type: 'point', point: new SheetPosition(0, 0) },
      pointCenter: { type: 'point', point: new SheetPosition(5, 0) },
      pointB: { type: 'point', point: new SheetPosition(5, 5) },
    });

    const original = geometryStore.constraints[0] as PerpendicularConstraint;
    const svg = serializeToSvg(sheet, { x: 0, y: 0 }, 1, [], 'select');
    const result = parseSvg(svg, generateStableId);

    expect(result.constraints).toHaveLength(1);
    const parsed = result.constraints[0] as PerpendicularConstraint;
    expect(parsed.id).toBe(original.id);
    expect(parsed.type).toStrictEqual('perpendicular');
    expect(constraintEndpointsEqual(parsed.pointA, original.pointA)).toBe(true);
    expect(constraintEndpointsEqual(parsed.pointCenter, original.pointCenter)).toBe(true);
    expect(constraintEndpointsEqual(parsed.pointB, original.pointB)).toBe(true);
  });

  it('polygon with linear and perpendicular constraints round-trips correctly', () => {
    const { sheet, geometryStore } = makeSheet();
    // Create a 4-point polygon
    const polygon = geometryStore.add(
      ID_PREFIXES.polygon,
      Polygon.create(
        [
          { type: 'point', point: new SheetPosition(0, 0) },
          { type: 'point', point: new SheetPosition(10, 0) },
          { type: 'point', point: new SheetPosition(10, 10) },
          { type: 'point', point: new SheetPosition(0, 10) },
          { type: 'point', point: new SheetPosition(0, 0) },
        ],
        { closed: true, fillColor: null },
      ),
    );

    // Add a linear constraint locked to polygon points 0->1 (bottom edge)
    const { id: linearConstraintId } = geometryStore.addConstraint(
      LinearConstraint.create(
        ConstraintEndpoint.lockedToPolygon(polygon.id, 0),
        ConstraintEndpoint.lockedToPolygon(polygon.id, 1),
        Length.centimeters(10),
        {
          connectorLineOffsetPx: -12,
        },
      ),
    );

    // Add a perpendicular constraint locked to polygon points 1->2->3 (corner)
    const { id: perpendicularConstraintId } = geometryStore.addConstraint(
      PerpendicularConstraint.create(
        ConstraintEndpoint.lockedToPolygon(polygon.id, 1),
        ConstraintEndpoint.lockedToPolygon(polygon.id, 2),
        ConstraintEndpoint.lockedToPolygon(polygon.id, 3),
      ),
    );

    const svg = serializeToSvg(sheet, { x: 0, y: 0 }, 1, [], 'select');
    const result = parseSvg(svg, generateStableId);

    // Verify polygon round-tripped
    // Closed polygons duplicate the first point at the end of the array
    expect(result.polygons).toHaveLength(1);
    expect(result.polygons[0].id).toStrictEqual(polygon.id);
    const polygonData = PolygonComponent.get(result.polygons[0]);
    expect(polygonData.closed).toBe(true);
    expect(polygonData.points).toHaveLength(5);
    expect(polygonData.points[0].point.x).toBeCloseTo(0, 5);
    expect(polygonData.points[0].point.y).toBeCloseTo(0, 5);
    expect(polygonData.points[1].point.x).toBeCloseTo(10, 5);
    expect(polygonData.points[2].point.x).toBeCloseTo(10, 5);
    expect(polygonData.points[2].point.y).toBeCloseTo(10, 5);
    expect(polygonData.points[3].point.x).toBeCloseTo(0, 5);
    expect(polygonData.points[3].point.y).toBeCloseTo(10, 5);
    expect(polygonData.points[4].point.x).toBeCloseTo(0, 5);
    expect(polygonData.points[4].point.y).toBeCloseTo(0, 5);

    // Verify both constraints round-tripped
    expect(result.constraints).toHaveLength(2);

    const linearConstraint = result.constraints.find(
      (c) => c.id === linearConstraintId,
    ) as LinearConstraint;
    expect(linearConstraint).toBeDefined();
    expect(linearConstraint.type).toStrictEqual('linear');
    expect(linearConstraint.pointA.type).toStrictEqual('locked-polygon');
    expect((linearConstraint.pointA as any).id).toBe(polygon.id);
    expect((linearConstraint.pointA as any).pointIndex).toBe(0);
    expect(linearConstraint.pointB.type).toStrictEqual('locked-polygon');
    expect((linearConstraint.pointB as any).id).toBe(polygon.id);
    expect((linearConstraint.pointB as any).pointIndex).toBe(1);
    expect(linearConstraint.constrainedLength.magnitude).toBeCloseTo(10, 5);

    const perpConstraint = result.constraints.find(
      (c) => c.id === perpendicularConstraintId,
    ) as PerpendicularConstraint;
    expect(perpConstraint).toBeDefined();
    expect(perpConstraint.type).toStrictEqual('perpendicular');
    expect(perpConstraint.pointA.type).toStrictEqual('locked-polygon');
    expect((perpConstraint.pointA as any).id).toBe(polygon.id);
    expect((perpConstraint.pointA as any).pointIndex).toBe(1);
    expect(perpConstraint.pointCenter.type).toStrictEqual('locked-polygon');
    expect((perpConstraint.pointCenter as any).id).toBe(polygon.id);
    expect((perpConstraint.pointCenter as any).pointIndex).toBe(2);
    expect(perpConstraint.pointB.type).toStrictEqual('locked-polygon');
    expect((perpConstraint.pointB as any).id).toBe(polygon.id);
    expect((perpConstraint.pointB as any).pointIndex).toBe(3);
  });

  it('parses parallel constraint from <g> element', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" data-cad2d-version="1">
      <g data-type="parallel-constraint" id="cns_para_test"
         data-endpoint-a-type="point"
         data-endpoint-a-x="0"
         data-endpoint-a-y="0"
         data-endpoint-b-type="point"
         data-endpoint-b-x="10"
         data-endpoint-b-y="0"
         data-endpoint-c-type="point"
         data-endpoint-c-x="20"
         data-endpoint-c-y="5"
         data-endpoint-d-type="point"
         data-endpoint-d-x="30"
         data-endpoint-d-y="5">
      </g>
    </svg>`;
    const result = parseSvg(svg, generateStableId);
    expect(result.constraints).toHaveLength(1);
    const c = result.constraints[0] as ParallelConstraint;
    expect(c.id).toBe('cns_para_test');
    expect(c.type).toStrictEqual('parallel');
    expect(c.pointA.type).toStrictEqual('point');
    expect((c.pointA as any).point.x).toBe(0);
    expect((c.pointA as any).point.y).toBe(0);
    expect(c.pointB.type).toStrictEqual('point');
    expect((c.pointB as any).point.x).toBe(10);
    expect((c.pointB as any).point.y).toBe(0);
    expect(c.pointC.type).toStrictEqual('point');
    expect((c.pointC as any).point.x).toBe(20);
    expect((c.pointC as any).point.y).toBe(5);
    expect(c.pointD.type).toStrictEqual('point');
    expect((c.pointD as any).point.x).toBe(30);
    expect((c.pointD as any).point.y).toBe(5);
  });

  it('parallel constraint round-trips correctly', () => {
    const { sheet, geometryStore } = makeSheet();
    geometryStore.addConstraintDirect({
      id: 'cns_para_rt',
      type: 'parallel',
      pointA: { type: 'point', point: new SheetPosition(0, 0) },
      pointB: { type: 'point', point: new SheetPosition(10, 0) },
      pointC: { type: 'point', point: new SheetPosition(20, 5) },
      pointD: { type: 'point', point: new SheetPosition(30, 5) },
    });

    const original = geometryStore.constraints[0] as ParallelConstraint;
    const svg = serializeToSvg(sheet, { x: 0, y: 0 }, 1, [], 'select');
    const result = parseSvg(svg, generateStableId);

    expect(result.constraints).toHaveLength(1);
    const parsed = result.constraints[0] as ParallelConstraint;
    expect(parsed.id).toBe(original.id);
    expect(parsed.type).toStrictEqual('parallel');
    expect(constraintEndpointsEqual(parsed.pointA, original.pointA)).toBe(true);
    expect(constraintEndpointsEqual(parsed.pointB, original.pointB)).toBe(true);
    expect(constraintEndpointsEqual(parsed.pointC, original.pointC)).toBe(true);
    expect(constraintEndpointsEqual(parsed.pointD, original.pointD)).toBe(true);
  });

  it('linear constraint with axis round-trips correctly', () => {
    const { sheet, geometryStore } = makeSheet();
    geometryStore.addConstraintDirect({
      id: 'cns_axis_rt',
      type: 'linear',
      pointA: { type: 'point', point: new SheetPosition(0, 0) },
      pointB: { type: 'point', point: new SheetPosition(10, 0) },
      constrainedLength: Length.inches(10),
      connectorLineOffsetPx: -12,
      axis: 'x',
    });

    const original = geometryStore.constraints[0] as LinearConstraint;
    const svg = serializeToSvg(sheet, { x: 0, y: 0 }, 1, [], 'select');
    const result = parseSvg(svg, generateStableId);

    expect(result.constraints).toHaveLength(1);
    const parsed = result.constraints[0] as LinearConstraint;
    expect(parsed.id).toBe(original.id);
    expect(parsed.type).toStrictEqual('linear');
    expect(parsed.axis).toBe('x');
    expect(compareConstraints(original, parsed)).toBe(true);
  });

  it('full state round-trips with history', () => {
    const { sheet, geometryStore } = makeSheet();

    // Add some geometry
    addPolygon(
      geometryStore,
      [
        { type: 'point', point: new SheetPosition(0, 0) },
        { type: 'point', point: new SheetPosition(1, 0) },
        { type: 'point', point: new SheetPosition(1, 1) },
      ],
      false,
      null,
      0,
    );

    // Perform an undo operation to populate history
    sheet.historyManager.undo();

    const svg = serializeToSvg(sheet, { x: 5, y: 10 }, 2, ['p1'], 'polygon');
    const result = parseSvg(svg, generateStableId);

    expect(result.state).not.toBeNull();
    expect(result.state!.viewport.position.x).toBe(5);
    expect(result.state!.viewport.position.y).toBe(10);
    expect(result.state!.viewport.scale).toBe(2);
    expect(result.state!.selection).toEqual(['p1']);
    expect(result.state!.activeTool).toBe('polygon');
    expect(JSON.stringify(result.state!.history)).toBe(
      JSON.stringify(
        sheet.historyManager.getUndoStack().length >= 0
          ? {
              undoStack: sheet.historyManager.getUndoStack(),
              redoStack: sheet.historyManager.getRedoStack(),
              stableIdCounter: sheet.historyManager.getStableIdCounter(),
            }
          : null,
      ),
    );
  });

  it('sorts shapes by renderOrder in SVG output, not by type group', () => {
    const { sheet, geometryStore } = makeSheet();
    const pid = 'poly_test';
    const rid = 'rect_test';
    const eid = 'ellip_test';

    geometryStore.addDirect(
      makePolygon({
        id: pid,
        points: [
          makePoint(0, 0),
          makePoint(1, 0),
          makePoint(1, 1),
          makePoint(0, 1),
          makePoint(0, 0),
        ],
        closed: true,
        fillColor: null,
        openAtIndex: 0,
        renderOrder: 2,
      }),
    );

    geometryStore.addDirect(
      makeRectangle({
        id: rid,
        upperLeft: new SheetPosition(0, 0),
        lowerRight: new SheetPosition(1, 1),
        fillColor: null,
        linkDimensions: false,
        renderOrder: 5,
      }),
    );

    geometryStore.addDirect(
      makeEllipse({
        id: eid,
        center: new SheetPosition(0.5, 0.5),
        radiusX: 0.5,
        radiusY: 0.3,
        fillColor: null,
        linkDimensions: false,
        renderOrder: 8,
      }),
    );

    const svg = serializeToSvg(sheet, { x: 0, y: 0 }, 1, [], 'select');

    const polyIdx = svg.indexOf(`id="${pid}"`);
    const rectIdx = svg.indexOf(`id="${rid}"`);
    const ellipIdx = svg.indexOf(`id="${eid}"`);

    expect(polyIdx).toBeLessThan(rectIdx);
    expect(rectIdx).toBeLessThan(ellipIdx);
  });

  it('copy-paste with constraints rewrites all IDs and constraint references', () => {
    // Simulates the real copy/paste flow: copy = formatSelectedAsFragment (serializeToSvg
    // for the whole sheet), paste = loadFragment which calls parseSvg with the same
    // HistoryManager.generateStableId and GeometryStore.hasId so IDs get rewritten.
    const { sheet, geometryStore, historyManager } = makeSheet();

    // Add a polygon
    const polygon = geometryStore.add(
      ID_PREFIXES.polygon,
      Polygon.create(
        [makePoint(0, 0), makePoint(2, 0), makePoint(2, 2), makePoint(0, 2), makePoint(0, 0)],
        { closed: true, fillColor: 0xff0000 },
      ),
    );

    // Add a rectangle
    const rectangle = geometryStore.add(
      ID_PREFIXES.rectangle,
      Rectangle.create(new SheetPosition(0, 0), new SheetPosition(1, 1), {
        fillColor: 0x00ff00,
        linkDimensions: true,
      }),
    );

    // Add an ellipse
    const ellipse = geometryStore.add(
      ID_PREFIXES.ellipse,
      Ellipse.create(new SheetPosition(3, 3), {
        radiusX: 0.5,
        radiusY: 0.3,
        fillColor: 0x0000ff,
        linkDimensions: false,
      }),
    );

    // Add a linear constraint locked to polygon point 0 and rectangle top-left
    geometryStore.addConstraint(
      LinearConstraint.create(
        ConstraintEndpoint.lockedToPolygon(polygon.id, 0),
        ConstraintEndpoint.lockedToRectangle(rectangle.id, 'upperLeft'),
        Length.centimeters(10),
        { connectorLineOffsetPx: -12 },
      ),
    );

    // Add a perpendicular constraint locked to rectangle corners
    geometryStore.addConstraint(
      PerpendicularConstraint.create(
        ConstraintEndpoint.lockedToRectangle(rectangle.id, 'upperLeft'),
        ConstraintEndpoint.lockedToRectangle(rectangle.id, 'upperRight'),
        ConstraintEndpoint.lockedToRectangle(rectangle.id, 'lowerRight'),
      ),
    );

    // Add a parallel constraint with a locked ellipse endpoint
    geometryStore.addConstraint(
      ParallelConstraint.create(
        ConstraintEndpoint.lockedToEllipse(ellipse.id, 'center'),
        ConstraintEndpoint.point(new SheetPosition(5, 5)),
        ConstraintEndpoint.lockedToPolygon(polygon.id, 1),
        ConstraintEndpoint.point(new SheetPosition(5, 0)),
      ),
    );

    // Also add a free-floating linear constraint (no locked endpoints)
    geometryStore.addConstraint(
      LinearConstraint.create(
        ConstraintEndpoint.point(new SheetPosition(10, 10)),
        ConstraintEndpoint.point(new SheetPosition(12, 12)),
        Length.inches(3),
      ),
    );

    // Collect all original IDs
    const originalGeometryIds = new Set<string>();
    for (const g of geometryStore.listWithComponents(PolygonComponent, RenderOrderComponent)) {
      originalGeometryIds.add(g.id);
    }
    for (const g of geometryStore.listWithComponents(
      RectangleComponent,
      FillColorComponent,
      LinkDimensionsComponent,
      RenderOrderComponent,
    )) {
      originalGeometryIds.add(g.id);
    }
    for (const g of geometryStore.listWithComponents(
      EllipseComponent,
      FillColorComponent,
      LinkDimensionsComponent,
      RenderOrderComponent,
    )) {
      originalGeometryIds.add(g.id);
    }
    const originalConstraintIds = new Set(geometryStore.constraints.map((c) => c.id));

    // "Copy" - serialize everything
    const svg = serializeToSvg(sheet, { x: 0, y: 0 }, 1, [], 'select');

    // "Paste" - parse with the same history manager and doesIdExist, matching
    // the loadFragment path in SerializationManager.loadInternal(svg, false).
    const result = parseSvg(
      svg,
      historyManager.generateStableId.bind(historyManager),
      geometryStore.hasId.bind(geometryStore),
    );

    expect(result.polygons).toHaveLength(1);
    expect(result.rectangles).toHaveLength(1);
    expect(result.ellipses).toHaveLength(1);
    expect(result.constraints).toHaveLength(4);

    // All geometry IDs should be new (not in the original set)
    for (const poly of result.polygons) {
      expect(originalGeometryIds.has(poly.id)).toBe(false);
    }
    for (const rect of result.rectangles) {
      expect(originalGeometryIds.has(rect.id)).toBe(false);
    }
    for (const ell of result.ellipses) {
      expect(originalGeometryIds.has(ell.id)).toBe(false);
    }

    // All constraint IDs should be new
    for (const c of result.constraints) {
      expect(originalConstraintIds.has(c.id)).toBe(false);
    }

    // Collect the new ID mappings to verify constraint references were rewritten
    // Linear constraint (first one) locked to polygon and rectangle
    const linearConstraint = result.constraints.find(
      (c) => c.type === 'linear' && c.pointA.type === 'locked-polygon',
    ) as LinearConstraint;
    expect(linearConstraint).toBeDefined();
    expect(linearConstraint.pointA.type).toStrictEqual('locked-polygon');
    const newPolyId = (
      linearConstraint.pointA as { type: 'locked-polygon'; id: string; pointIndex: number }
    ).id;
    // The polygon point index should be preserved
    expect(
      (linearConstraint.pointA as { type: 'locked-polygon'; id: string; pointIndex: number })
        .pointIndex,
    ).toBe(0);
    // The referenced polygon ID should be the new (rewritten) one, not the original
    expect(newPolyId).not.toBe(polygon.id);
    expect(newPolyId).toBe(result.polygons[0].id);
    // The locked rectangle endpoint should reference the new rectangle ID
    expect(linearConstraint.pointB.type).toStrictEqual('locked-rectangle');
    const newRectId = (
      linearConstraint.pointB as { type: 'locked-rectangle'; id: string; point: string }
    ).id;
    expect(newRectId).not.toBe(rectangle.id);
    expect(newRectId).toBe(result.rectangles[0].id);

    // Perpendicular constraint locked to rectangle corners
    const perpConstraint = result.constraints.find(
      (c) => c.type === 'perpendicular',
    ) as PerpendicularConstraint;
    expect(perpConstraint).toBeDefined();
    expect(perpConstraint.pointA.type).toStrictEqual('locked-rectangle');
    const perpRectId = (
      perpConstraint.pointA as { type: 'locked-rectangle'; id: string; point: string }
    ).id;
    expect(perpRectId).toBe(newRectId);
    expect(perpConstraint.pointCenter.type).toStrictEqual('locked-rectangle');
    expect(perpConstraint.pointB.type).toStrictEqual('locked-rectangle');

    // Parallel constraint with locked ellipse, point, locked-polygon, point
    const paraConstraint = result.constraints.find(
      (c) => c.type === 'parallel',
    ) as ParallelConstraint;
    expect(paraConstraint).toBeDefined();
    expect(paraConstraint.pointA.type).toStrictEqual('locked-ellipse');
    const newEllipseId = (
      paraConstraint.pointA as { type: 'locked-ellipse'; id: string; point: string }
    ).id;
    expect(newEllipseId).not.toBe(ellipse.id);
    expect(newEllipseId).toBe(result.ellipses[0].id);
    // Free-floating point endpoints should be preserved as-is
    expect(paraConstraint.pointB.type).toStrictEqual('point');
    expect((paraConstraint.pointB as { type: 'point'; point: SheetPosition }).point.x).toBeCloseTo(
      5,
      5,
    );
    expect((paraConstraint.pointB as { type: 'point'; point: SheetPosition }).point.y).toBeCloseTo(
      5,
      5,
    );
    expect(paraConstraint.pointC.type).toStrictEqual('locked-polygon');
    expect(paraConstraint.pointD.type).toStrictEqual('point');
    expect((paraConstraint.pointD as { type: 'point'; point: SheetPosition }).point.x).toBeCloseTo(
      5,
      5,
    );
    expect((paraConstraint.pointD as { type: 'point'; point: SheetPosition }).point.y).toBeCloseTo(
      0,
      5,
    );

    // Free-floating linear constraint should have preserved point endpoints
    const freeConstraint = result.constraints.find(
      (c) => c.type === 'linear' && c.pointA.type === 'point' && c.pointB.type === 'point',
    ) as LinearConstraint;
    expect(freeConstraint).toBeDefined();
    expect((freeConstraint.pointA as { type: 'point'; point: SheetPosition }).point.x).toBeCloseTo(
      10,
      5,
    );
    expect((freeConstraint.pointA as { type: 'point'; point: SheetPosition }).point.y).toBeCloseTo(
      10,
      5,
    );
    expect((freeConstraint.pointB as { type: 'point'; point: SheetPosition }).point.x).toBeCloseTo(
      12,
      5,
    );
    expect((freeConstraint.pointB as { type: 'point'; point: SheetPosition }).point.y).toBeCloseTo(
      12,
      5,
    );
    expect(freeConstraint.constrainedLength.magnitude).toBeCloseTo(3, 5);

    // Geometry data should be preserved (positions, shapes, fill colors)
    const parsedPolyData = PolygonComponent.get(result.polygons[0]);
    expect(parsedPolyData.closed).toBe(true);
    expect(parsedPolyData.points).toHaveLength(5);
    expect(parsedPolyData.points[0].point.x).toBeCloseTo(0, 5);
    expect(parsedPolyData.points[0].point.y).toBeCloseTo(0, 5);
    expect(FillColorComponent.getOptional(result.polygons[0])).toBe(0xff0000);

    const parsedRectData = RectangleComponent.get(result.rectangles[0]);
    expect(parsedRectData.upperLeft.x).toBeCloseTo(0, 5);
    expect(parsedRectData.upperLeft.y).toBeCloseTo(0, 5);
    expect(parsedRectData.lowerRight.x).toBeCloseTo(1, 5);
    expect(parsedRectData.lowerRight.y).toBeCloseTo(1, 5);
    expect(FillColorComponent.get(result.rectangles[0])).toBe(0x00ff00);
    expect(LinkDimensionsComponent.get(result.rectangles[0])).toBe(true);

    const parsedEllipseData = EllipseComponent.get(result.ellipses[0]);
    expect(parsedEllipseData.center.x).toBeCloseTo(3, 5);
    expect(parsedEllipseData.center.y).toBeCloseTo(3, 5);
    expect(parsedEllipseData.radiusX).toBeCloseTo(0.5, 5);
    expect(parsedEllipseData.radiusY).toBeCloseTo(0.3, 5);
    expect(FillColorComponent.get(result.ellipses[0])).toBe(0x0000ff);
  });

  it('round-trips sheet dimensions and default unit through the state comment', () => {
    // Create a non-default sheet size (Letter)
    const sheet = Sheet.letter();
    const { geometryStore } = sheet;

    // Add a small shape so the SVG is valid
    geometryStore.add(
      ID_PREFIXES.rectangle,
      Rectangle.create(new SheetPosition(1, 1), new SheetPosition(2, 2), {
        fillColor: null,
        linkDimensions: false,
      }),
    );

    const svg = serializeToSvg(sheet, { x: 0, y: 0 }, 1, [], 'select');
    const result = parseSvg(svg, generateStableId);

    // Verify sheet state was parsed from the state comment
    expect(result.state).not.toBeNull();
    expect(result.state!.sheet.width.type).toBe('in');
    expect(result.state!.sheet.width.magnitude).toBeCloseTo(8.5, 5);
    expect(result.state!.sheet.height.type).toBe('in');
    expect(result.state!.sheet.height.magnitude).toBeCloseTo(11, 5);
    expect(result.state!.sheet.defaultUnit).toBe('in');

    // Also test a metric size
    const a3Sheet = Sheet.a3();
    const { geometryStore: a3Store } = a3Sheet;
    a3Store.add(
      ID_PREFIXES.ellipse,
      Ellipse.create(new SheetPosition(5, 5), {
        radiusX: 2,
        radiusY: 1,
        fillColor: null,
        linkDimensions: false,
      }),
    );
    const a3Svg = serializeToSvg(a3Sheet, { x: 0, y: 0 }, 1, [], 'select');
    const a3Result = parseSvg(a3Svg, generateStableId);

    expect(a3Result.state).not.toBeNull();
    expect(a3Result.state!.sheet.width.type).toBe('cm');
    expect(a3Result.state!.sheet.width.magnitude).toBeCloseTo(29.7, 5);
    expect(a3Result.state!.sheet.height.type).toBe('cm');
    expect(a3Result.state!.sheet.height.magnitude).toBeCloseTo(42.0, 5);
    expect(a3Result.state!.sheet.defaultUnit).toBe('cm');
  });

  it('roundtrips a datum with a locked-datum constraint endpoint', () => {
    const { sheet, geometryStore } = makeSheet();

    const datum = geometryStore.add(ID_PREFIXES.datum, Datum.create(new SheetPosition(3, 4)));
    geometryStore.addConstraint(
      LinearConstraint.create(
        ConstraintEndpoint.lockedToDatum(datum.id),
        ConstraintEndpoint.point(new SheetPosition(8, 4)),
        Length.centimeters(5),
      ),
    );

    const svg = serializeToSvg(sheet, { x: 0, y: 0 }, 1, [], 'select');
    expect(svg).toContain('data-type="datum"');
    expect(svg).toContain('data-x="3"');
    expect(svg).toContain('data-y="4"');

    const result = parseSvg(svg, generateStableId);
    expect(result.datums).toHaveLength(1);
    expect(DatumComponent.get(result.datums[0] as Datum)).toEqual(new SheetPosition(3, 4));

    expect(result.constraints).toHaveLength(1);
    const parsedC = result.constraints[0] as LinearConstraint;
    expect(parsedC.pointA.type).toStrictEqual('locked-datum');
    if (parsedC.pointA.type === 'locked-datum') {
      expect(parsedC.pointA.id).toStrictEqual(datum.id);
    }
  });

  it('serializes a standalone datum as a <g> with crosshair and circle', () => {
    const { sheet, geometryStore } = makeSheet();
    geometryStore.add(ID_PREFIXES.datum, Datum.create(new SheetPosition(5, 7)));

    const svg = serializeToSvg(sheet, { x: 0, y: 0 }, 1, [], 'select');
    expect(svg).toContain('data-type="datum"');
    expect(svg).toContain('data-x="5"');
    expect(svg).toContain('data-y="7"');
    expect(svg).toContain('<line');
    expect(svg).toContain('<circle');
  });

  it('datum survives formatSelectedAsFragment → loadFragment roundtrip', () => {
    const { sheet, geometryStore, historyManager } = makeSheet();

    // Build original state: datum + constraint locked to it
    const datum = geometryStore.add(ID_PREFIXES.datum, Datum.create(new SheetPosition(3, 4)));
    geometryStore.addConstraint(
      LinearConstraint.create(
        ConstraintEndpoint.lockedToDatum(datum.id),
        ConstraintEndpoint.point(new SheetPosition(8, 4)),
        Length.centimeters(5),
      ),
    );

    // formatSelectedAsFragment → loadFragment is just serializeToSvg + parseSvg
    // with the same generateStableId and doesIdExist, which is exactly what
    // the existing copy-paste test exercises for polygons/rectangles/ellipses.
    const svg = serializeToSvg(sheet, { x: 0, y: 0 }, 1, [], 'select');
    const parseResult = parseSvg(
      svg,
      historyManager.generateStableId.bind(historyManager),
      geometryStore.hasId.bind(geometryStore),
    );

    // Load into a fresh store via addDirect (matching the loadInternal path)
    const fresh = Sheet.a4().geometryStore;
    for (const d of parseResult.datums) {
      fresh.addDirect(d);
    }
    for (const c of parseResult.constraints) {
      fresh.addConstraintDirect(c);
    }

    const loadedDatums = fresh.listWithComponent(DatumComponent);
    expect(loadedDatums).toHaveLength(1);
    expect(DatumComponent.get(loadedDatums[0])).toEqual(new SheetPosition(3, 4));

    expect(fresh.constraints).toHaveLength(1);
    const loadedC = fresh.constraints[0] as LinearConstraint;
    expect(loadedC.pointA.type).toStrictEqual('locked-datum');
    if (loadedC.pointA.type === 'locked-datum') {
      expect(loadedC.pointA.id).toStrictEqual(loadedDatums[0].id);
    }
  });
});
