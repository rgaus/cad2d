import {
  type CubicBezierSegment,
  Ellipse,
  type PointSegment,
  Polygon,
  PolygonComponent,
  type QuadraticBezierSegment,
  Rectangle,
} from '@/lib/geometry';
import { ID_PREFIXES } from '@/lib/geometry/GeometryStore';
import { GeometryStore } from '@/lib/geometry/GeometryStore';
import { DEFAULT_COLOR } from '@/lib/geometry/colors';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { SHEET_UNITS_TO_PIXELS } from '@/lib/sheet/Sheet';
import { SelectionManager } from '@/lib/tools/SelectionManager';
import { ToolManager } from '@/lib/tools/ToolManager';
import { type SplitPoint, type TrimSegment, TrimSplitTool } from '@/lib/tools/TrimSplitTool';
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
    trimSplitTool = toolManager.getTool('trim-split') as TrimSplitTool;
    viewport = createViewportState(1);
    toolManager.setActiveTool('trim-split');
  });

  afterEach(() => {
    trimSplitTool.resetForTesting();
  });

  describe('basic intersection detection', () => {
    it('emits null when no geometry exists', () => {
      let receivedData: SplitPoint | TrimSegment | null = null;
      trimSplitTool.on('splitPointOrTrimSegmentChange', (data) => {
        receivedData = data;
      });

      simulateMouseMove(toolManager, 100, 100, viewport);

      expect(receivedData).toBeNull();
    });

    it('emits null when cursor is not near any segments', () => {
      geometryStore.add(
        ID_PREFIXES.polygon,
        Polygon.create(
          [makePoint(0, 0), makePoint(100, 0), makePoint(100, 100), makePoint(0, 100)],
          { closed: true, fillColor: DEFAULT_COLOR, openAtIndex: 0 },
        ),
      );

      let receivedData: SplitPoint | TrimSegment | null = null;
      trimSplitTool.on('splitPointOrTrimSegmentChange', (data) => {
        receivedData = data;
      });

      simulateMouseMove(toolManager, 200, 200, viewport);

      expect(receivedData).toBeNull();
    });

    it('emits data when two line segments cross at exact same point', () => {
      geometryStore.add(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(0, 50), makePoint(100, 50)], {
          closed: false,
          fillColor: DEFAULT_COLOR,
          openAtIndex: 0,
        }),
      );

      geometryStore.add(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(50, 0), makePoint(50, 100)], {
          closed: false,
          fillColor: DEFAULT_COLOR,
          openAtIndex: 0,
        }),
      );

      let receivedData: SplitPoint | TrimSegment | null = null;
      trimSplitTool.on('splitPointOrTrimSegmentChange', (data) => {
        receivedData = data;
      });

      simulateMouseMove(
        toolManager,
        sheetToScreen(50, 50, viewport).x,
        sheetToScreen(50, 50, viewport).y,
        viewport,
      );

      expect(receivedData).toBeTruthy();
      const data = receivedData! as SplitPoint;
      expect(data.type).toBe('split-point');
      expect(data.point.x).toBe(50);
      expect(data.point.y).toBe(50);
      expect(data.targets).toHaveLength(2);
    });

    it('emits data when line segment intersects quadratic curve at curve midpoint', () => {
      geometryStore.add(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(0, 50), makePoint(100, 50)], {
          closed: false,
          fillColor: DEFAULT_COLOR,
          openAtIndex: 0,
        }),
      );

      geometryStore.add(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(0, 0), makeQuadratic(100, 100, 0, 100)], {
          closed: false,
          fillColor: DEFAULT_COLOR,
          openAtIndex: 0,
        }),
      );

      let receivedData: SplitPoint | TrimSegment | null = null;
      trimSplitTool.on('splitPointOrTrimSegmentChange', (data) => {
        receivedData = data;
      });

      const pos = sheetToScreen(8.1, 50, viewport);
      simulateMouseMove(toolManager, pos.x, pos.y, viewport);

      expect(receivedData).toBeTruthy();
      const data = receivedData! as SplitPoint;
      expect(data.type).toBe('split-point');
      expect(data.point.x).toBeCloseTo(8.57, 0);
      expect(data.point.y).toBeCloseTo(50, 0);
    });

    it('emits data when line segment intersects cubic curve at curve midpoint', () => {
      geometryStore.add(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(0, 0), makePoint(0, 100)], {
          closed: false,
          fillColor: DEFAULT_COLOR,
          openAtIndex: 0,
        }),
      );

      geometryStore.add(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(-10, 50), makeCubic(10, 50, 0, 0, 0, 100)], {
          closed: false,
          fillColor: DEFAULT_COLOR,
          openAtIndex: 0,
        }),
      );

      let receivedData: SplitPoint | TrimSegment | null = null;
      trimSplitTool.on('splitPointOrTrimSegmentChange', (data) => {
        receivedData = data;
      });

      simulateMouseMove(
        toolManager,
        sheetToScreen(1, 50, viewport).x,
        sheetToScreen(1, 50, viewport).y,
        viewport,
      );

      expect(receivedData).toBeTruthy();
      const data = receivedData! as TrimSegment;
      expect(data.type).toBe('trim-segment');
      expect(data.nearestCursorPoint.x).toBeCloseTo(0, 1);
      expect(data.nearestCursorPoint.y).toBeCloseTo(50, 0);
    });

    it('detects cubic vs cubic curve intersection at midpoint', () => {
      geometryStore.add(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(20, 0), makeCubic(80, 100, 0, 100, 100, 0)], {
          closed: false,
          fillColor: DEFAULT_COLOR,
          openAtIndex: 0,
        }),
      );

      geometryStore.add(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(20, 100), makeCubic(80, 0, 0, 0, 100, 100)], {
          closed: false,
          fillColor: DEFAULT_COLOR,
          openAtIndex: 0,
        }),
      );

      let receivedData: SplitPoint | TrimSegment | null = null;
      trimSplitTool.on('splitPointOrTrimSegmentChange', (data) => {
        receivedData = data;
      });

      simulateMouseMove(
        toolManager,
        sheetToScreen(50, 50, viewport).x,
        sheetToScreen(50, 50, viewport).y,
        viewport,
      );

      expect(receivedData).toBeTruthy();
      const data = receivedData! as SplitPoint;
      expect(data.type).toBe('split-point');
      expect(data.point.x).toBeCloseTo(50, 0);
      expect(data.point.y).toBeCloseTo(50, 0);
    });

    it('detects quadratic vs cubic curve intersection at known point', () => {
      // Horizontal line at y=25
      geometryStore.add(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(0, 25), makePoint(100, 25)], {
          closed: false,
          fillColor: DEFAULT_COLOR,
          openAtIndex: 0,
        }),
      );

      // Quadratic curve from (0, 50) to (100, 50) with control (50, 0)
      // This curve crosses y=25 at x=50 (t=0.5)
      geometryStore.add(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(0, 50), makeQuadratic(100, 50, 50, 0)], {
          closed: false,
          fillColor: DEFAULT_COLOR,
          openAtIndex: 0,
        }),
      );

      let receivedData: SplitPoint | TrimSegment | null = null;
      trimSplitTool.on('splitPointOrTrimSegmentChange', (data) => {
        receivedData = data;
      });

      simulateMouseMove(
        toolManager,
        sheetToScreen(50, 25, viewport).x,
        sheetToScreen(50, 25, viewport).y,
        viewport,
      );

      expect(receivedData).toBeTruthy();
      const data = receivedData! as SplitPoint;
      expect(data.type).toBe('split-point');
      expect(data.point.x).toBeCloseTo(50, 0);
      expect(data.point.y).toBeCloseTo(25, 0);
    });
  });

  describe('splitting on click', () => {
    it('splits two line segments at intersection point', () => {
      geometryStore.add(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(0, 50), makePoint(100, 50)], {
          closed: false,
          fillColor: DEFAULT_COLOR,
          openAtIndex: 0,
        }),
      );

      geometryStore.add(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(50, 0), makePoint(50, 100)], {
          closed: false,
          fillColor: DEFAULT_COLOR,
          openAtIndex: 0,
        }),
      );

      let receivedData: SplitPoint | TrimSegment | null = null;
      trimSplitTool.on('splitPointOrTrimSegmentChange', (data) => {
        receivedData = data;
      });

      simulateMouseMove(
        toolManager,
        sheetToScreen(50, 50, viewport).x,
        sheetToScreen(50, 50, viewport).y,
        viewport,
      );
      expect(receivedData).toBeTruthy();
    });

    it('detects rectangle intersection', () => {
      geometryStore.add(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(100, 100), {
          fillColor: DEFAULT_COLOR,
          linkDimensions: false,
        }),
      );

      // Add a line that crosses the rectangle
      geometryStore.add(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(50, -10), makePoint(50, 110)], {
          closed: false,
          fillColor: DEFAULT_COLOR,
          openAtIndex: 0,
        }),
      );

      let receivedData: SplitPoint | TrimSegment | null = null;
      trimSplitTool.on('splitPointOrTrimSegmentChange', (data) => {
        receivedData = data;
      });

      // Mouse on rectangle edge at x=50
      simulateMouseMove(
        toolManager,
        sheetToScreen(50, 0, viewport).x,
        sheetToScreen(50, 0, viewport).y,
        viewport,
      );
      expect(receivedData).toBeTruthy();
      const data = receivedData! as SplitPoint;
      expect(data.type).toBe('split-point');
      expect(data.point.x).toBeCloseTo(50, 0);
      expect(data.point.y).toBeCloseTo(0, 0);
    });

    it.skip('detects ellipse edge intersection', () => {
      geometryStore.add(
        ID_PREFIXES.ellipse,
        Ellipse.create(new SheetPosition(50, 50), {
          radiusX: 50,
          radiusY: 50,
          fillColor: DEFAULT_COLOR,
          linkDimensions: false,
        }),
      );

      geometryStore.add(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(50, -10), makePoint(50, 110)], {
          closed: false,
          fillColor: DEFAULT_COLOR,
          openAtIndex: 0,
        }),
      );

      let receivedData: SplitPoint | TrimSegment | null = null;
      trimSplitTool.on('splitPointOrTrimSegmentChange', (data) => {
        receivedData = data;
      });

      // Mouse at actual intersection point (50, 0)
      simulateMouseMove(
        toolManager,
        sheetToScreen(50, 0, viewport).x,
        sheetToScreen(50, 0, viewport).y,
        viewport,
      );
      expect(receivedData).toBeTruthy();
      const data = receivedData! as SplitPoint;
      expect(data.type).toBe('split-point');
      expect(data.point.x).toBeCloseTo(50, 0);
      expect(data.point.y).toBeCloseTo(0, 0);
    });

    // Skipped: The intersection point calculation for two ellipses with different orientations/radii
    // is complex. The mouse position doesn't reliably trigger split-point detection.
    // Need to investigate the threshold logic in computeIntersectionAtPoint or computeTrimSegment.
    it.skip('detects two intersecting ellipses', () => {
      geometryStore.add(
        ID_PREFIXES.ellipse,
        Ellipse.create(new SheetPosition(50, 50), {
          radiusX: 30,
          radiusY: 30,
          fillColor: DEFAULT_COLOR,
          linkDimensions: false,
        }),
      );

      geometryStore.add(
        ID_PREFIXES.ellipse,
        Ellipse.create(new SheetPosition(50, 50), {
          radiusX: 20,
          radiusY: 40,
          fillColor: DEFAULT_COLOR,
          linkDimensions: false,
        }),
      );

      let receivedData: SplitPoint | TrimSegment | null = null;
      trimSplitTool.on('splitPointOrTrimSegmentChange', (data) => {
        receivedData = data;
      });

      // Intersection point approximately (35, 75) - solving ellipse equations
      simulateMouseMove(
        toolManager,
        sheetToScreen(35, 75, viewport).x,
        sheetToScreen(35, 75, viewport).y,
        viewport,
      );
      expect(receivedData).toBeTruthy();
      const data = receivedData!;
      expect(data.type).toBe('split-point');
      const splitPoint = data as SplitPoint;
      expect(splitPoint.targets).toHaveLength(2);
      expect(splitPoint.targets[0].type).toBe('ellipse');
      expect(splitPoint.targets[1].type).toBe('ellipse');
    });

    it('does nothing when click has no intersection data', () => {
      geometryStore.add(
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
      geometryStore.add(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(100, 100)),
      );
      geometryStore.add(
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
      geometryStore.add(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(0, 0), makePoint(100, 0), makePoint(100, 100)], { closed: false }),
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
      geometryStore.add(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(100, 100)),
      );
      geometryStore.add(
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
      const closedPoints = closedPolygon.points.filter((p) => p.type === 'point').map((p) => `${p.point.x},${p.point.y}`).sort();
      expect(closedPoints).toEqual(['0,0', '0,100', '100,0', '100,80', '80,100']);

      // There should be one cubic arc which was taken from the circle
      const cubicArc = closedPolygon.points.filter((p) => p.type === 'arc-cubic');
      expect(cubicArc).toHaveLength(1);
      // NOTE: I might have this backwards, it might be the opposite direction version in the below comment
      expect(cubicArc[0].point.x).toStrictEqual(80);
      expect(cubicArc[0].point.y).toStrictEqual(100);
      expect(cubicArc[0].controlPointA.x).toBeCloseTo(10, 2);
      expect(cubicArc[0].controlPointA.y).toBeCloseTo(9.105, 2);
      expect(cubicArc[0].controlPointB.x).toBeCloseTo(9.105, 2);
      expect(cubicArc[0].controlPointB.y).toBeCloseTo(10, 2);
      // expect(cubicArc[0].point.x).toStrictEqual(100);
      // expect(cubicArc[0].point.y).toStrictEqual(80);
      // expect(cubicArc[0].controlPointA.x).toBeCloseTo(9.105, 2);
      // expect(cubicArc[0].controlPointA.y).toBeCloseTo(10, 2);
      // expect(cubicArc[0].controlPointB.x).toBeCloseTo(10, 2);
      // expect(cubicArc[0].controlPointB.y).toBeCloseTo(9.105, 2);

      // There should be two remaining offcuts:
      // 1) The vertical subsegment beyond the circle (the match to what was trimmed)
      const openPolygons = polygonDatas.filter((p) => !p.closed);
      expect(openPolygons).toHaveLength(2);

      const offcutShort = openPolygons.find((p) => p.points.length === 2)!;
      expect(offcutShort.points[0].point.x).toBe(100);
      expect(offcutShort.points[0].point.y).toBe(100);
      expect(offcutShort.points[1].point.x).toBe(50);
      expect(offcutShort.points[1].point.y).toBe(100);

      // 2) The rest of the circle, as three bezier curves
      // NOTE: the order of these points may be wrong
      const offcutLong = openPolygons.find((p) => p.points.at(-1)?.type === 'arc-cubic')!;
      expect(offcutLong.points).toHaveLength(3);
      expect(offcutLong.points[0].point.x).toBeCloseTo(80);
      expect(offcutLong.points[0].point.y).toStrictEqual(100);
      expect((offcutLong.points[0] as CubicBezierSegment).controlPointA.x).toBeCloseTo(100, 2);
      expect((offcutLong.points[0] as CubicBezierSegment).controlPointA.x).toBeCloseTo(91.05, 2);
      expect((offcutLong.points[0] as CubicBezierSegment).controlPointB.y).toBeCloseTo(91.05, 2);
      expect((offcutLong.points[0] as CubicBezierSegment).controlPointB.y).toBeCloseTo(100, 2);
      expect(offcutLong.points[1].point.x).toBeCloseTo(80);
      expect(offcutLong.points[1].point.y).toStrictEqual(60);
      expect((offcutLong.points[1] as CubicBezierSegment).controlPointA.x).toBeCloseTo(60, 2);
      expect((offcutLong.points[1] as CubicBezierSegment).controlPointA.y).toBeCloseTo(68.95, 2);
      expect((offcutLong.points[1] as CubicBezierSegment).controlPointB.x).toBeCloseTo(68.95, 2);
      expect((offcutLong.points[1] as CubicBezierSegment).controlPointB.y).toBeCloseTo(60, 2);
      expect(offcutLong.points[2].point.x).toBeCloseTo(100);
      expect(offcutLong.points[2].point.y).toStrictEqual(80);
      expect((offcutLong.points[2] as CubicBezierSegment).controlPointA.x).toBeCloseTo(91.05, 2);
      expect((offcutLong.points[2] as CubicBezierSegment).controlPointA.y).toBeCloseTo(6, 2);
      expect((offcutLong.points[2] as CubicBezierSegment).controlPointB.x).toBeCloseTo(10, 2);
      expect((offcutLong.points[2] as CubicBezierSegment).controlPointB.y).toBeCloseTo(68.95, 2);
    });
  });
});
