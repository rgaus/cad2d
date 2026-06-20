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
import { ConstraintEndpoint, LinearConstraint, PerpendicularConstraint } from '@/lib/geometry';
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
    });
    geometryStore.addConstraintDirect({
      id: 'cns_2',
      type: 'linear',
      pointA: { type: 'point', point: new SheetPosition(0, 0) },
      pointB: { type: 'point', point: new SheetPosition(0, 10) },
      constrainedLength: Length.millimeters(100),
      connectorLineOffsetPx: 12,
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
});
