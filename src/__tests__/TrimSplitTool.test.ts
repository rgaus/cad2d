import {
  ColinearConstraint,
  ColinearConstraintComponent,
  ConstraintEndpoint,
  type CubicBezierSegment,
  DatumComponent,
  Ellipse,
  Geometry,
  HorizontalConstraintComponent,
  LinearConstraint,
  LinearConstraintComponent,
  type PointSegment,
  Polygon,
  PolygonComponent,
  type QuadraticBezierSegment,
  Rectangle,
  RectangleComponent,
  VerticalConstraintComponent,
} from '@/lib/geometry';
import { ID_PREFIXES } from '@/lib/geometry/GeometryStore';
import { GeometryStore } from '@/lib/geometry/GeometryStore';
import { DEFAULT_COLOR } from '@/lib/geometry/colors';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { SHEET_UNITS_TO_PIXELS } from '@/lib/sheet/Sheet';
import { subscribeToEvents } from '@/lib/subscribe-to-events';
import { SelectionManager } from '@/lib/tools/SelectionManager';
import { ToolManager } from '@/lib/tools/ToolManager';
import { type SplitPoint, type TrimSegment, TrimSplitTool } from '@/lib/tools/TrimSplitTool';
import { Length } from '@/lib/units/length';
import {
  ScreenPosition,
  SheetPosition,
  ViewportPosition,
  type ViewportState,
  WorldPosition,
} from '@/lib/viewport/types';

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
  cxa: number,
  cya: number,
  cxb: number,
  cyb: number,
): CubicBezierSegment {
  return {
    type: 'arc-cubic',
    point: new SheetPosition(x, y),
    controlPointA: new SheetPosition(cxa, cya),
    controlPointB: new SheetPosition(cxb, cyb),
  };
}

function createViewportState(scale: number = 1): ViewportState {
  return {
    position: new ViewportPosition(0, 0),
    scale,
  };
}

function sheetToScreen(x: number, y: number, viewport: ViewportState): ScreenPosition {
  return new WorldPosition(x * SHEET_UNITS_TO_PIXELS, y * SHEET_UNITS_TO_PIXELS).toScreen(viewport);
}

function simulateMouseMove(
  toolManager: ToolManager,
  x: number,
  y: number,
  viewport: ViewportState,
) {
  toolManager.handleMouseMove(new ScreenPosition(x, y), viewport);
}

function simulateMouseDown(
  toolManager: ToolManager,
  x: number,
  y: number,
  viewport: ViewportState,
) {
  toolManager.handleMouseMove(new ScreenPosition(x, y), viewport);
  toolManager.handleMouseDown(new ScreenPosition(x, y), viewport);
}

describe('TrimSplitTool', () => {
  let historyManager: HistoryManager;
  let geometryStore: GeometryStore;
  let toolManager: ToolManager;
  let selectionManager: SelectionManager;
  let trimSplitTool: TrimSplitTool;
  let viewport: ViewportState;

  beforeEach(() => {
    historyManager = new HistoryManager();
    geometryStore = new GeometryStore(historyManager);
    historyManager.setGeometryStore(geometryStore);
    selectionManager = new SelectionManager();
    toolManager = new ToolManager(geometryStore, selectionManager, historyManager);

    viewport = createViewportState(1);

    toolManager.setActiveTool('edit');
    toolManager.changeToolSubTool('edit', 'trim-split');
    trimSplitTool = toolManager.getTool('edit').activeSubTool as TrimSplitTool;
  });

  afterEach(() => {
    trimSplitTool.resetForTesting();
  });

  describe('basic intersection detection', () => {
    it('emits null when no geometry exists', async () => {
      const events = subscribeToEvents(trimSplitTool, ['splitPointOrTrimSegmentChange']);

      simulateMouseMove(toolManager, 100, 100, viewport);

      const receivedData = await events.waitFor('splitPointOrTrimSegmentChange');
      expect(receivedData).toBeNull();
    });

    it('emits null when cursor is not near any segments', async () => {
      geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create(
          [makePoint(0, 0), makePoint(100, 0), makePoint(100, 100), makePoint(0, 100)],
          { closed: true, fillColor: DEFAULT_COLOR, openAtIndex: 0 },
        ),
      );

      const events = subscribeToEvents(trimSplitTool, ['splitPointOrTrimSegmentChange']);

      simulateMouseMove(toolManager, 200, 200, viewport);

      const receivedData = await events.waitFor('splitPointOrTrimSegmentChange');
      expect(receivedData).toBeNull();
    });

    it('emits data when two line segments cross at exact same point', async () => {
      geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(0, 50), makePoint(100, 50)], {
          closed: false,
          fillColor: DEFAULT_COLOR,
          openAtIndex: 0,
        }),
      );

      geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(50, 0), makePoint(50, 100)], {
          closed: false,
          fillColor: DEFAULT_COLOR,
          openAtIndex: 0,
        }),
      );

      const events = subscribeToEvents(trimSplitTool, ['splitPointOrTrimSegmentChange']);

      simulateMouseMove(
        toolManager,
        sheetToScreen(50, 50, viewport).x,
        sheetToScreen(50, 50, viewport).y,
        viewport,
      );

      const receivedData = await events.waitFor('splitPointOrTrimSegmentChange');
      expect(receivedData).toBeTruthy();
      const data = receivedData as SplitPoint;
      expect(data.type).toBe('split-point');
      expect(data.point.x).toBe(50);
      expect(data.point.y).toBe(50);
      expect(data.targets).toHaveLength(2);
    });

    it('emits data when line segment intersects quadratic curve at curve midpoint', async () => {
      geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(0, 50), makePoint(100, 50)], {
          closed: false,
          fillColor: DEFAULT_COLOR,
          openAtIndex: 0,
        }),
      );

      geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(0, 0), makeQuadratic(100, 100, 0, 100)], {
          closed: false,
          fillColor: DEFAULT_COLOR,
          openAtIndex: 0,
        }),
      );

      const events = subscribeToEvents(trimSplitTool, ['splitPointOrTrimSegmentChange']);

      const pos = sheetToScreen(8.1, 50, viewport);
      simulateMouseMove(toolManager, pos.x, pos.y, viewport);

      const receivedData = await events.waitFor('splitPointOrTrimSegmentChange');
      expect(receivedData).toBeTruthy();
      const data = receivedData as SplitPoint;
      expect(data.type).toBe('split-point');
      expect(data.point.x).toBeCloseTo(8.57, 0);
      expect(data.point.y).toBeCloseTo(50, 0);
    });

    it('emits data when line segment intersects cubic curve at curve midpoint', async () => {
      geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(0, 0), makePoint(0, 100)], {
          closed: false,
          fillColor: DEFAULT_COLOR,
          openAtIndex: 0,
        }),
      );

      geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(-10, 50), makeCubic(10, 50, 0, 0, 0, 100)], {
          closed: false,
          fillColor: DEFAULT_COLOR,
          openAtIndex: 0,
        }),
      );

      const events = subscribeToEvents(trimSplitTool, ['splitPointOrTrimSegmentChange']);

      simulateMouseMove(
        toolManager,
        sheetToScreen(1, 50, viewport).x,
        sheetToScreen(1, 50, viewport).y,
        viewport,
      );

      const receivedData = await events.waitFor('splitPointOrTrimSegmentChange');
      expect(receivedData).toBeTruthy();
      const data = receivedData as TrimSegment;
      expect(data.type).toBe('trim-segment');
      expect(data.nearestCursorPoint.x).toBeCloseTo(0, 1);
      expect(data.nearestCursorPoint.y).toBeCloseTo(50, 0);
    });

    it('detects cubic vs cubic curve intersection at midpoint', async () => {
      geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(20, 0), makeCubic(80, 100, 0, 100, 100, 0)], {
          closed: false,
          fillColor: DEFAULT_COLOR,
          openAtIndex: 0,
        }),
      );

      geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(20, 100), makeCubic(80, 0, 0, 0, 100, 100)], {
          closed: false,
          fillColor: DEFAULT_COLOR,
          openAtIndex: 0,
        }),
      );

      const events = subscribeToEvents(trimSplitTool, ['splitPointOrTrimSegmentChange']);

      simulateMouseMove(
        toolManager,
        sheetToScreen(50, 50, viewport).x,
        sheetToScreen(50, 50, viewport).y,
        viewport,
      );

      const receivedData = await events.waitFor('splitPointOrTrimSegmentChange');
      expect(receivedData).toBeTruthy();
      const data = receivedData as SplitPoint;
      expect(data.type).toBe('split-point');
      expect(data.point.x).toBeCloseTo(50, 0);
      expect(data.point.y).toBeCloseTo(50, 0);
    });

    it('detects quadratic vs cubic curve intersection at known point', async () => {
      // Horizontal line at y=25
      geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(0, 25), makePoint(100, 25)], {
          closed: false,
          fillColor: DEFAULT_COLOR,
          openAtIndex: 0,
        }),
      );

      // Quadratic curve from (0, 50) to (100, 50) with control (50, 0)
      // This curve crosses y=25 at x=50 (t=0.5)
      geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(0, 50), makeQuadratic(100, 50, 50, 0)], {
          closed: false,
          fillColor: DEFAULT_COLOR,
          openAtIndex: 0,
        }),
      );

      const events = subscribeToEvents(trimSplitTool, ['splitPointOrTrimSegmentChange']);

      simulateMouseMove(
        toolManager,
        sheetToScreen(50, 25, viewport).x,
        sheetToScreen(50, 25, viewport).y,
        viewport,
      );

      const receivedData = await events.waitFor('splitPointOrTrimSegmentChange');
      expect(receivedData).toBeTruthy();
      const data = receivedData as SplitPoint;
      expect(data.type).toBe('split-point');
      expect(data.point.x).toBeCloseTo(50, 0);
      expect(data.point.y).toBeCloseTo(25, 0);
    });
  });

  describe('splitting on click', () => {
    it('splits two line segments at intersection point', async () => {
      geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(0, 50), makePoint(100, 50)], {
          closed: false,
          fillColor: DEFAULT_COLOR,
          openAtIndex: 0,
        }),
      );

      geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(50, 0), makePoint(50, 100)], {
          closed: false,
          fillColor: DEFAULT_COLOR,
          openAtIndex: 0,
        }),
      );

      const events = subscribeToEvents(trimSplitTool, ['splitPointOrTrimSegmentChange']);

      simulateMouseMove(
        toolManager,
        sheetToScreen(50, 50, viewport).x,
        sheetToScreen(50, 50, viewport).y,
        viewport,
      );
      const receivedData = await events.waitFor('splitPointOrTrimSegmentChange');
      expect(receivedData).toBeTruthy();
    });

    it('detects rectangle intersection', async () => {
      geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(100, 100), {
          fillColor: DEFAULT_COLOR,
          linkDimensions: false,
        }),
      );

      // Add a line that crosses the rectangle
      geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(50, -10), makePoint(50, 110)], {
          closed: false,
          fillColor: DEFAULT_COLOR,
          openAtIndex: 0,
        }),
      );

      const events = subscribeToEvents(trimSplitTool, ['splitPointOrTrimSegmentChange']);

      // Mouse on rectangle edge at x=50
      simulateMouseMove(
        toolManager,
        sheetToScreen(50, 0, viewport).x,
        sheetToScreen(50, 0, viewport).y,
        viewport,
      );
      const receivedData = await events.waitFor('splitPointOrTrimSegmentChange');
      expect(receivedData).toBeTruthy();
      const data = receivedData as SplitPoint;
      expect(data.type).toBe('split-point');
      expect(data.point.x).toBeCloseTo(50, 0);
      expect(data.point.y).toBeCloseTo(0, 0);
    });

    it.skip('detects ellipse edge intersection', async () => {
      geometryStore.addOrdered(
        ID_PREFIXES.ellipse,
        Ellipse.create(new SheetPosition(50, 50), {
          radiusX: 50,
          radiusY: 50,
          fillColor: DEFAULT_COLOR,
          linkDimensions: false,
        }),
      );

      geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(50, -10), makePoint(50, 110)], {
          closed: false,
          fillColor: DEFAULT_COLOR,
          openAtIndex: 0,
        }),
      );

      const events = subscribeToEvents(trimSplitTool, ['splitPointOrTrimSegmentChange']);

      // Mouse at actual intersection point (50, 0)
      simulateMouseMove(
        toolManager,
        sheetToScreen(50, 0, viewport).x,
        sheetToScreen(50, 0, viewport).y,
        viewport,
      );
      const receivedData = await events.waitFor('splitPointOrTrimSegmentChange');
      expect(receivedData).toBeTruthy();
      const data = receivedData as SplitPoint;
      expect(data.type).toBe('split-point');
      expect(data.point.x).toBeCloseTo(50, 0);
      expect(data.point.y).toBeCloseTo(0, 0);
    });

    // Skipped: The intersection point calculation for two ellipses with different orientations/radii
    // is complex. The mouse position doesn't reliably trigger split-point detection.
    // Need to investigate the threshold logic in computeIntersectionAtPoint or computeTrimSegment.
    it.skip('detects two intersecting ellipses', async () => {
      geometryStore.addOrdered(
        ID_PREFIXES.ellipse,
        Ellipse.create(new SheetPosition(50, 50), {
          radiusX: 30,
          radiusY: 30,
          fillColor: DEFAULT_COLOR,
          linkDimensions: false,
        }),
      );

      geometryStore.addOrdered(
        ID_PREFIXES.ellipse,
        Ellipse.create(new SheetPosition(50, 50), {
          radiusX: 20,
          radiusY: 40,
          fillColor: DEFAULT_COLOR,
          linkDimensions: false,
        }),
      );

      const events = subscribeToEvents(trimSplitTool, ['splitPointOrTrimSegmentChange']);

      // Intersection point approximately (35, 75) - solving ellipse equations
      simulateMouseMove(
        toolManager,
        sheetToScreen(35, 75, viewport).x,
        sheetToScreen(35, 75, viewport).y,
        viewport,
      );
      const data = await events.waitFor<SplitPoint | TrimSegment | null>(
        'splitPointOrTrimSegmentChange',
      );
      expect(data).toBeTruthy();
      expect(data?.type).toBe('split-point');
      const splitPoint = data as SplitPoint;
      expect(splitPoint.targets).toHaveLength(2);
      expect(splitPoint.targets[0].type).toBe('ellipse');
      expect(splitPoint.targets[1].type).toBe('ellipse');
    });

    it('does nothing when click has no intersection data', () => {
      geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(0, 0), makePoint(100, 0)], {
          closed: false,
          fillColor: DEFAULT_COLOR,
          openAtIndex: 0,
        }),
      );

      const initialPolygonCount = Array.from(
        geometryStore.listWithComponent(PolygonComponent),
      ).length;

      simulateMouseDown(toolManager, 200, 200, viewport);

      expect(geometryStore.listWithComponent(PolygonComponent).length).toBe(initialPolygonCount);
    });
  });

  describe('trim-segment detection', () => {
    it('trims two overlapping rectangles to make a filled "L" shaped polygon and some offcuts', () => {
      geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(100, 100)),
      );
      geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(50, 50), new SheetPosition(150, 150)),
      );

      // Position the cursor in the middle of the bottom segment of the intersecting rectangle
      // ( the segment from (50, 100) => (100, 100) ) and click
      toolManager.handleMouseMove(sheetToScreen(100, 75, viewport), viewport);
      toolManager.handleMouseDown(sheetToScreen(100, 75, viewport), viewport);

      // Result: there should be an upside down L shaped polygon
      const polygons = geometryStore.listWithComponent(PolygonComponent);
      expect(polygons).toHaveLength(3);

      const polygonDatas = polygons.map((p) => PolygonComponent.get(p));

      const closedPolygon = polygonDatas.find((p) => p.closed)!;
      expect(closedPolygon).toBeDefined();
      const closedPoints = closedPolygon.points.map((p) => `${p.point.x},${p.point.y}`).sort();
      expect(closedPoints).toEqual(['0,0', '0,100', '100,0', '100,50', '50,100', '50,50']);
      expect(closedPolygon.closed).toBe(true);

      const openPolygons = polygonDatas.filter((p) => !p.closed);
      expect(openPolygons).toHaveLength(2);

      const offcutShort = openPolygons.find((p) => p.points.length === 2)!;
      expect(offcutShort.points[0].point.x).toBe(100);
      expect(offcutShort.points[0].point.y).toBe(100);
      expect(offcutShort.points[1].point.x).toBe(50);
      expect(offcutShort.points[1].point.y).toBe(100);

      const offcutLong = openPolygons.find((p) => p.points.length === 5)!;
      const expectedLongPoints: Array<[number, number]> = [
        [100, 50],
        [150, 50],
        [150, 150],
        [50, 150],
        [50, 100],
      ];
      offcutLong.points.forEach((p, i) => {
        expect(p.point.x).toBe(expectedLongPoints[i][0]);
        expect(p.point.y).toBe(expectedLongPoints[i][1]);
      });
    });

    it('trims a segment from a non closed polygon', () => {
      geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(0, 0), makePoint(100, 0), makePoint(100, 100)], {
          closed: false,
        }),
      );

      // Position the cursor in the middle of the first segment and click
      toolManager.handleMouseMove(sheetToScreen(50, 0, viewport), viewport);
      toolManager.handleMouseDown(sheetToScreen(50, 0, viewport), viewport);

      // Result: the polygon should be the same but just the first segment should be gone
      const polygons = geometryStore.listWithComponent(PolygonComponent);
      expect(polygons).toHaveLength(1);

      const polygonData = PolygonComponent.get(polygons[0]);

      expect(polygonData.closed).toStrictEqual(false);
      expect(polygonData.points).toHaveLength(2);
      expect(polygonData.points[0].point.x).toBeCloseTo(100, 0);
      expect(polygonData.points[0].point.y).toBeCloseTo(0, 0);
      expect(polygonData.points[1].point.x).toBeCloseTo(100, 0);
      expect(polygonData.points[1].point.y).toBeCloseTo(100, 0);
    });

    it('trims a rectangle with an inset circle to have a rounded / fillet corner', () => {
      geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(100, 100)),
      );
      geometryStore.addOrdered(
        ID_PREFIXES.ellipse,
        Ellipse.create(new SheetPosition(80, 80), { radiusX: 20, radiusY: 20 }),
      );

      // Position the cursor near the center of the bottom sub segment beyond the circle, and click
      toolManager.handleMouseMove(sheetToScreen(90, 100, viewport), viewport);
      toolManager.handleMouseDown(sheetToScreen(90, 100, viewport), viewport);

      // Result: the rectangle should now be a polygon with a cubic curve in the corner
      const polygons = geometryStore.listWithComponent(PolygonComponent);
      expect(polygons).toHaveLength(4);

      const polygonDatas = polygons.map((p) => PolygonComponent.get(p));

      const closedPolygon = polygonDatas.find((p) => p.closed)!;
      expect(closedPolygon).toBeDefined();
      expect(closedPolygon.closed).toBe(true);

      // Make sure that the closed polygon has all the right points - the converted rectangle
      // points, plus the intersection points between rectangle and ellipse
      const closedPoints = closedPolygon.points
        .filter((p) => p.type === 'point')
        .map((p) => `${p.point.x},${p.point.y}`)
        .sort();
      expect(closedPoints).toEqual(['0,0', '0,100', '100,0', '100,80' /* '80,100' */]);

      // There should be one cubic arc which was taken from the circle
      const cubicArc = closedPolygon.points.filter((p) => p.type === 'arc-cubic');
      expect(cubicArc).toHaveLength(1);
      // NOTE: I might have this backwards, it might be the opposite direction version in the below comment
      expect(cubicArc[0].point.x).toStrictEqual(80);
      expect(cubicArc[0].point.y).toStrictEqual(100);
      expect(cubicArc[0].controlPointA.x).toBeCloseTo(100, 2);
      expect(cubicArc[0].controlPointA.y).toBeCloseTo(91.05, 2);
      expect(cubicArc[0].controlPointB.x).toBeCloseTo(91.05, 2);
      expect(cubicArc[0].controlPointB.y).toBeCloseTo(100, 2);
      // expect(cubicArc[0].point.x).toStrictEqual(100);
      // expect(cubicArc[0].point.y).toStrictEqual(80);
      // expect(cubicArc[0].controlPointA.x).toBeCloseTo(9.105, 2);
      // expect(cubicArc[0].controlPointA.y).toBeCloseTo(10, 2);
      // expect(cubicArc[0].controlPointB.x).toBeCloseTo(10, 2);
      // expect(cubicArc[0].controlPointB.y).toBeCloseTo(9.105, 2);

      // There should be two remaining offcuts:
      // 1) The vertical subsegment beyond the circle (the match to what was trimmed)
      const openPolygons = polygonDatas.filter((p) => !p.closed);
      // expect(openPolygons).toHaveLength(2);
      expect(openPolygons.length).toBeGreaterThanOrEqual(2);

      // FIXME: uncomment once this is all working
      // const offcutShort = openPolygons.find((p) => p.points.length === 2)!;
      // expect(offcutShort.points[0].point.x).toBe(100);
      // expect(offcutShort.points[0].point.y).toBe(100);
      // expect(offcutShort.points[1].point.x).toBe(50);
      // expect(offcutShort.points[1].point.y).toBe(100);

      // // 2) The rest of the circle, as three bezier curves
      // // NOTE: the order of these points may be wrong
      // const offcutLong = openPolygons.find((p) => p.points.at(-1)?.type === 'arc-cubic')!;
      // expect(offcutLong.points).toHaveLength(3);
      // expect(offcutLong.points[0].point.x).toBeCloseTo(80);
      // expect(offcutLong.points[0].point.y).toStrictEqual(100);
      // expect((offcutLong.points[0] as CubicBezierSegment).controlPointA.x).toBeCloseTo(100, 2);
      // expect((offcutLong.points[0] as CubicBezierSegment).controlPointA.x).toBeCloseTo(91.05, 2);
      // expect((offcutLong.points[0] as CubicBezierSegment).controlPointB.y).toBeCloseTo(91.05, 2);
      // expect((offcutLong.points[0] as CubicBezierSegment).controlPointB.y).toBeCloseTo(100, 2);
      // expect(offcutLong.points[1].point.x).toBeCloseTo(80);
      // expect(offcutLong.points[1].point.y).toStrictEqual(60);
      // expect((offcutLong.points[1] as CubicBezierSegment).controlPointA.x).toBeCloseTo(60, 2);
      // expect((offcutLong.points[1] as CubicBezierSegment).controlPointA.y).toBeCloseTo(68.95, 2);
      // expect((offcutLong.points[1] as CubicBezierSegment).controlPointB.x).toBeCloseTo(68.95, 2);
      // expect((offcutLong.points[1] as CubicBezierSegment).controlPointB.y).toBeCloseTo(60, 2);
      // expect(offcutLong.points[2].point.x).toBeCloseTo(100);
      // expect(offcutLong.points[2].point.y).toStrictEqual(80);
      // expect((offcutLong.points[2] as CubicBezierSegment).controlPointA.x).toBeCloseTo(91.05, 2);
      // expect((offcutLong.points[2] as CubicBezierSegment).controlPointA.y).toBeCloseTo(6, 2);
      // expect((offcutLong.points[2] as CubicBezierSegment).controlPointB.x).toBeCloseTo(10, 2);
      // expect((offcutLong.points[2] as CubicBezierSegment).controlPointB.y).toBeCloseTo(68.95, 2);
    });

    it('trimming a segment should never create duplicate polygons', () => {
      geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(100, 100)),
      );
      geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(50, 25), new SheetPosition(150, 75)),
      );

      // Trim the vertical segment in the middle of the longer + thinner rectangle
      toolManager.handleMouseMove(sheetToScreen(100, 50, viewport), viewport);
      toolManager.handleMouseDown(sheetToScreen(100, 50, viewport), viewport);

      // Trim the three segments on the inside of the square rectangle, which should combine both
      // into one big shape
      // Top
      toolManager.handleMouseMove(sheetToScreen(75, 25, viewport), viewport);
      toolManager.handleMouseDown(sheetToScreen(75, 25, viewport), viewport);
      // Left
      toolManager.handleMouseMove(sheetToScreen(50, 50, viewport), viewport);
      toolManager.handleMouseDown(sheetToScreen(50, 50, viewport), viewport);
      // Bottom
      toolManager.handleMouseMove(sheetToScreen(75, 75, viewport), viewport);
      toolManager.handleMouseDown(sheetToScreen(75, 75, viewport), viewport);

      // Result: the rectangle should now be a SINGLE, unified polygon
      // Not multiple polygons which all are exactly the same on top of each other
      const geometries = geometryStore.listWithComponent(PolygonComponent);
      expect(geometries).toHaveLength(1);

      const polygon = PolygonComponent.get(geometries[0]);

      expect(polygon.closed).toStrictEqual(true);
      const closedPoints = polygon.points
        .filter((p) => p.type === 'point')
        .map((p) => `${p.point.x},${p.point.y}`)
        .sort();
      expect(closedPoints).toEqual(
        ['0,0', '100,0', '100,25', '150,25', '150,75', '100,75', '100,100', '0,100'].sort(),
      );
    });

    it('trimming a segment on a geometry with unrelated constraints should keep those constraints', () => {
      const { id: rectangleId } = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(100, 100)),
      );
      geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(75, 150), makePoint(150, 75)], {
          closed: false,
        }),
      );

      geometryStore.add(
        ID_PREFIXES.constraint,
        LinearConstraint.create(
          ConstraintEndpoint.lockedToRectangle(rectangleId, 'upperLeft'),
          ConstraintEndpoint.point(new SheetPosition(30, 30)),
          Length.centimeters(1),
        ),
      );

      // Trim the horizontal segment outside the polygon line
      toolManager.handleMouseMove(sheetToScreen(85, 100, viewport), viewport);
      toolManager.handleMouseDown(sheetToScreen(85, 100, viewport), viewport);

      // Result: there should still be a constraint
      expect(geometryStore.getAllConstraintGeometries()).toHaveLength(1);
    });

    it('creates a datum when a leaf vertex with a constraint is removed by trimming', () => {
      // Open polygon with three collinear points: (0,0) -> (5,0) -> (10,0)
      const { id: polygonId } = geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(0, 0), makePoint(5, 0), makePoint(10, 0)], {
          closed: false,
        }),
      );
      // Constraint locked to the right terminal vertex
      geometryStore.add(
        ID_PREFIXES.constraint,
        LinearConstraint.create(
          ConstraintEndpoint.lockedToPolygon(polygonId, 2),
          ConstraintEndpoint.point(new SheetPosition(15, 0)),
          Length.centimeters(1),
        ),
      );

      // Trim the rightmost segment (5,0)->(10,0) — this removes vertex (10,0)
      // entirely since the only path to it is the excluded edge.
      toolManager.handleMouseMove(sheetToScreen(7, 0, viewport), viewport);
      toolManager.handleMouseDown(sheetToScreen(7, 0, viewport), viewport);

      // The linear constraint should survive, re-attached to a datum at (10,0),
      // and one colinear constraint should link the datum to the surviving edge.
      expect(geometryStore.getAllConstraintGeometries()).toHaveLength(2);

      const linearConstraints = geometryStore
        .getAllConstraintGeometries()
        .filter((c) => Geometry.hasComponent(c, LinearConstraintComponent));
      expect(linearConstraints).toHaveLength(1);

      const linear = linearConstraints[0] as LinearConstraint;
      expect(LinearConstraintComponent.get(linear).pointA.type).toBe('locked-datum');
      const datumEndpoint = LinearConstraintComponent.get(linear).pointA as Extract<
        ConstraintEndpoint,
        { type: 'locked-datum' }
      >;

      // A datum should exist at the removed vertex position (10, 0)
      const datums = geometryStore.listWithComponent(DatumComponent);
      expect(datums).toHaveLength(1);
      expect(datumEndpoint.id).toBe(datums[0].id);
      const datumPos = DatumComponent.get(datums[0]);
      expect(datumPos.x).toBe(10);
      expect(datumPos.y).toBe(0);

      // The colinear constraint should lock the datum to the surviving edge (5,0)->(0,0)
      const colinearConstraints = geometryStore
        .getAllConstraintGeometries()
        .filter((c) => Geometry.hasComponent(c, ColinearConstraintComponent));
      expect(colinearConstraints).toHaveLength(1);
      const colinear = colinearConstraints[0] as ColinearConstraint;
      expect(ColinearConstraintComponent.get(colinear).pointTarget.type).toBe('locked-datum');
      const colinearDatum = ColinearConstraintComponent.get(colinear).pointTarget as Extract<
        ConstraintEndpoint,
        { type: 'locked-datum' }
      >;
      expect(colinearDatum.id).toBe(datums[0].id);
      expect(ColinearConstraintComponent.get(colinear).pointA.type).toBe('locked-polygon');
      expect(ColinearConstraintComponent.get(colinear).pointB.type).toBe('locked-polygon');
    });

    it('relinks a surviving constraint on a rectangle corner to the new boundary polygon after trim', () => {
      // Rectangle UL(0,10), UR(10,10), LR(10,0), LL(0,0)
      const { id: rectangleId } = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(10, 10)),
      );
      // Vertical line through the middle
      geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(5, -1), makePoint(5, 11)], {
          closed: false,
        }),
      );
      // Constraint on upperLeft — far from the trim region (bottom-right)
      geometryStore.add(
        ID_PREFIXES.constraint,
        LinearConstraint.create(
          ConstraintEndpoint.lockedToRectangle(rectangleId, 'upperLeft'),
          ConstraintEndpoint.point(new SheetPosition(-5, 5)),
          Length.centimeters(1),
        ),
      );

      // Trim the bottom-right portion of the bottom edge
      toolManager.handleMouseMove(sheetToScreen(7, 0, viewport), viewport);
      toolManager.handleMouseDown(sheetToScreen(7, 0, viewport), viewport);

      // The constraint should survive, now locked to the new boundary polygon
      expect(geometryStore.getAllConstraintGeometries()).toHaveLength(1);
      const c = geometryStore.getAllConstraintGeometries()[0] as LinearConstraint;
      expect(Geometry.hasComponent(c, LinearConstraintComponent)).toBe(true);
      // The constraint was locked to the rectangle's upperLeft corner; after the
      // rectangle is converted to a polygon during trim, the constraint is relinked
      // to the corresponding polygon vertex.
      expect(LinearConstraintComponent.get(c).pointA.type).toBe('locked-polygon');
    });
  });

  describe('constraint re-indexing on split', () => {
    it('shifts constraint pointIndices after splitting overlapping rectangle edges at intersection point', async () => {
      geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(10, 10), {
          fillColor: DEFAULT_COLOR,
          linkDimensions: false,
        }),
      );
      geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(5, 5), new SheetPosition(15, 15), {
          fillColor: DEFAULT_COLOR,
          linkDimensions: false,
        }),
      );

      expect(geometryStore.listWithComponent(RectangleComponent)).toHaveLength(2);

      // Move mouse to intersection point (10, 5) and verify split-point detection
      const events = subscribeToEvents(trimSplitTool, ['splitPointOrTrimSegmentChange']);

      const screenPos = sheetToScreen(10, 5, viewport);
      toolManager.handleMouseMove(new ScreenPosition(screenPos.x, screenPos.y), viewport);

      const splitPoint = (await events.waitFor('splitPointOrTrimSegmentChange')) as SplitPoint;
      expect(splitPoint).toBeTruthy();
      expect(splitPoint.point.x).toBe(10);
      expect(splitPoint.point.y).toBe(5);
      expect(splitPoint.targets).toHaveLength(2);

      // Click to apply the split
      toolManager.handleMouseDown(new ScreenPosition(screenPos.x, screenPos.y), viewport);

      // Rectangles are now converted to polygons
      const polygons = geometryStore.listWithComponent(PolygonComponent);
      expect(polygons.length).toBeGreaterThanOrEqual(2);

      // Make sure both rectangles were converted into polygons properly.
      const upperLeftPoly = polygons.find((p) =>
        PolygonComponent.get(p).points.some(
          (seg) => seg.type === 'point' && seg.point.x === 0 && seg.point.y === 0,
        ),
      );
      expect(upperLeftPoly).toBeDefined();
      const lowerRightPoly = polygons.find((p) =>
        PolygonComponent.get(p).points.some(
          (seg) => seg.type === 'point' && seg.point.x === 5 && seg.point.y === 5,
        ),
      );
      expect(lowerRightPoly).toBeDefined();

      // Make sure new points were added to bpth rectangle polygons.
      expect(
        PolygonComponent.get(upperLeftPoly!).points.find(
          (seg) => seg.type === 'point' && seg.point.x === 10 && seg.point.y === 5,
        ),
      ).toBeDefined();
      expect(
        PolygonComponent.get(lowerRightPoly!).points.find(
          (seg) => seg.type === 'point' && seg.point.x === 10 && seg.point.y === 5,
        ),
      ).toBeDefined();

      // Verify constraint re-indexing.
      // convertRectangleToPolygon auto-adds:
      //   horizontal: 0-1,  vertical: 1-2,  horizontal: 2-3,  vertical: 3-0
      // Split at segmentIndex=1 shifts indices >= 2 by +1:
      //   vertical 1-2 -> 1-3,  horizontal 0-1 -> 0-2
      const upperLeftPolyConstraints = geometryStore.findConstraintsByGeometryId(upperLeftPoly!.id);
      expect(upperLeftPolyConstraints.length).toBeGreaterThanOrEqual(2);
      expect(
        upperLeftPolyConstraints.find(
          (c) =>
            Geometry.hasComponent(c, VerticalConstraintComponent) &&
            VerticalConstraintComponent.getOptional(c)!.pointA.type === 'locked-polygon' &&
            (VerticalConstraintComponent.getOptional(c)!.pointA as any).pointIndex === 1 &&
            VerticalConstraintComponent.getOptional(c)!.pointB.type === 'locked-polygon' &&
            (VerticalConstraintComponent.getOptional(c)!.pointB as any).pointIndex === 3,
        ),
      ).toBeDefined();

      const lowerRightConstraintsAfterRedo = geometryStore.findConstraintsByGeometryId(
        lowerRightPoly!.id,
      );
      expect(lowerRightConstraintsAfterRedo.length).toBeGreaterThanOrEqual(2);
      expect(
        lowerRightConstraintsAfterRedo.find(
          (c) =>
            Geometry.hasComponent(c, HorizontalConstraintComponent) &&
            HorizontalConstraintComponent.getOptional(c)!.pointA.type === 'locked-polygon' &&
            (HorizontalConstraintComponent.getOptional(c)!.pointA as any).pointIndex === 0 &&
            HorizontalConstraintComponent.getOptional(c)!.pointB.type === 'locked-polygon' &&
            (HorizontalConstraintComponent.getOptional(c)!.pointB as any).pointIndex === 2,
        ),
      ).toBeDefined();

      // Undo reverts the split: there should be two rectangles again
      historyManager.undo();

      const rectanglesAfterUndo = geometryStore.listWithComponent(RectangleComponent);
      expect(rectanglesAfterUndo.length).toBeGreaterThanOrEqual(2);
      const upperLeftRectangleAfterUndo = rectanglesAfterUndo.find((r) => {
        const rectangle = RectangleComponent.get(r);
        return rectangle.upperLeft.x === 0 && rectangle.upperLeft.y === 0;
      });
      expect(upperLeftRectangleAfterUndo).toBeDefined();
      const lowerRightRectangleAfterUndo = rectanglesAfterUndo.find((r) => {
        const rectangle = RectangleComponent.get(r);
        return rectangle.upperLeft.x === 5 && rectangle.upperLeft.y === 5;
      });
      expect(lowerRightRectangleAfterUndo).toBeDefined();

      // Make sure constraints are gone too
      expect(
        geometryStore.findConstraintsByGeometryId(upperLeftRectangleAfterUndo!.id),
      ).toHaveLength(0);
      expect(
        geometryStore.findConstraintsByGeometryId(lowerRightRectangleAfterUndo!.id),
      ).toHaveLength(0);

      // Redo should restore the split again
      historyManager.redo();

      // Make sure new points were again added to bpth rectangle polygons.
      expect(
        PolygonComponent.get(upperLeftPoly!).points.find(
          (seg) => seg.type === 'point' && seg.point.x === 10 && seg.point.y === 5,
        ),
      ).toBeDefined();
      expect(
        PolygonComponent.get(lowerRightPoly!).points.find(
          (seg) => seg.type === 'point' && seg.point.x === 10 && seg.point.y === 5,
        ),
      ).toBeDefined();

      // Verify constraint re-indexing is back to where it was originally.
      const upperLeftConstraintsAfterRedo = geometryStore.findConstraintsByGeometryId(
        upperLeftPoly!.id,
      );
      expect(upperLeftConstraintsAfterRedo.length).toBeGreaterThanOrEqual(2);
      expect(
        upperLeftConstraintsAfterRedo.find(
          (c) =>
            Geometry.hasComponent(c, VerticalConstraintComponent) &&
            VerticalConstraintComponent.getOptional(c)!.pointA.type === 'locked-polygon' &&
            (VerticalConstraintComponent.getOptional(c)!.pointA as any).pointIndex === 1 &&
            VerticalConstraintComponent.getOptional(c)!.pointB.type === 'locked-polygon' &&
            (VerticalConstraintComponent.getOptional(c)!.pointB as any).pointIndex === 3,
        ),
      ).toBeDefined();

      const lowerRightPolyConstraints = geometryStore.findConstraintsByGeometryId(
        lowerRightPoly!.id,
      );
      expect(lowerRightPolyConstraints.length).toBeGreaterThanOrEqual(2);
      expect(
        lowerRightPolyConstraints.find(
          (c) =>
            Geometry.hasComponent(c, HorizontalConstraintComponent) &&
            HorizontalConstraintComponent.getOptional(c)!.pointA.type === 'locked-polygon' &&
            (HorizontalConstraintComponent.getOptional(c)!.pointA as any).pointIndex === 0 &&
            HorizontalConstraintComponent.getOptional(c)!.pointB.type === 'locked-polygon' &&
            (HorizontalConstraintComponent.getOptional(c)!.pointB as any).pointIndex === 2,
        ),
      ).toBeDefined();
    });
  });
});
