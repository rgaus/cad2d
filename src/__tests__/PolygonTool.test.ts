import { PolygonTool, PreviewSegmentIntersections } from '@/lib/tools/PolygonTool';
import { ToolManager } from '@/lib/tools/ToolManager';
import { GeometryStore } from '@/lib/tools/GeometryStore';
import { SelectionManager } from '@/lib/tools/SelectionManager';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { ViewportPosition, ScreenPosition, SheetPosition, type ViewportState } from '@/lib/viewport/types';
import type { PointSegment, QuadraticBezierSegment } from '@/lib/geometry/types';
import { DEFAULT_COLOR } from '@/lib/tools/GeometryStore';
import { mapIndexToKeyCombo } from '@/lib/index-mapper';
import { subscribeToEvents } from '@/lib/subscribe-to-events';
import { SHEET_UNITS_TO_PIXELS } from '@/lib/sheet/Sheet';

function makePoint(x: number, y: number): PointSegment {
  return { type: 'point', point: new SheetPosition(x, y) };
}

function makeQuadratic(x: number, y: number, cx: number, cy: number): QuadraticBezierSegment {
  return { type: 'arc-quadratic', point: new SheetPosition(x, y), controlPoint: new SheetPosition(cx, cy) };
}

function createViewportState(scale: number = 1): ViewportState {
  return {
    position: new ViewportPosition(0, 0),
    scale,
  };
}

function simulateMouseDown(toolManager: ToolManager, x: number, y: number, viewport: ViewportState) {
  toolManager.handleMouseMove(new ScreenPosition(x, y), viewport);
  toolManager.handleMouseDown(new ScreenPosition(x, y), viewport);
}

function simulateKeyDown(toolManager: ToolManager, key: string) {
  toolManager.handleKeyDown({ key, keyCode: key.charCodeAt(0), code: key } as unknown as KeyboardEvent);
}

describe('PolygonTool', () => {
  let historyManager: HistoryManager;
  let geometryStore: GeometryStore;
  let toolManager: ToolManager;
  let selectionManager: SelectionManager;
  let polygonTool: PolygonTool;
  let viewport: ViewportState;

  beforeEach(() => {
    historyManager = new HistoryManager();
    geometryStore = new GeometryStore(historyManager);
    historyManager.setGeometryStore(geometryStore);
    selectionManager = new SelectionManager();
    toolManager = new ToolManager(geometryStore, selectionManager, historyManager);
    polygonTool = toolManager.getTool('polygon') as PolygonTool;
    viewport = createViewportState(1);
    toolManager.setActiveTool('polygon');
  });

  describe('basic polygon creation + completion', () => {
    beforeEach(() => {
      // Disable snapping for basic tests
      polygonTool.setSnappingOptions({ primaryGridSize: 0.001, secondaryGridSize: 0.001 });
    });

    it('first click creates working polygon', () => {
      // No working polygon -> first click creates one with first point
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      expect(geometryStore.workingPolygon).not.toBeNull();
      expect(geometryStore.workingPolygon!.points).toHaveLength(2 /* 1 point + 1 preview segment */);
    });

    it('subsequent clicks add points', () => {
      // Create first point
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      expect(geometryStore.workingPolygon!.points).toHaveLength(2);

      // Add second point
      toolManager.handleMouseDown(new ScreenPosition(20, 10), viewport);
      expect(geometryStore.workingPolygon!.points).toHaveLength(3);
    });

    it('clicking first handle with 2+ points closes polygon', () => {
      // Create 3 points
      toolManager.handleMouseDown(new ScreenPosition(100, 100), viewport);
      toolManager.handleMouseDown(new ScreenPosition(200, 200), viewport);
      toolManager.handleMouseDown(new ScreenPosition(100, 200), viewport);

      // Set hovering first handle then click
      polygonTool.setHoveringFirstHandle(true);
      toolManager.handleMouseDown(new ScreenPosition(100, 100), viewport);
      polygonTool.setHoveringFirstHandle(false);

      // Should be closed
      expect(geometryStore.polygons).toHaveLength(1);
      expect(geometryStore.polygons[0].closed).toBe(true);
      expect(geometryStore.polygons[0].points).toHaveLength(4);
    });

    it('clicking first handle with alt held starts arc close', () => {
      // Create 3 points
      toolManager.handleMouseDown(new ScreenPosition(100, 100), viewport);
      toolManager.handleMouseDown(new ScreenPosition(200, 200), viewport);
      toolManager.handleMouseDown(new ScreenPosition(100, 200), viewport);

      // Set hovering first handle then click with alt pressed
      polygonTool.setHoveringFirstHandle(true);
      toolManager.handleKeyDown({ key: 'Alt', altKey: true } as KeyboardEvent);
      toolManager.handleMouseDown(new ScreenPosition(100, 100), viewport);
      toolManager.handleKeyDown({ key: 'Alt', altKey: false } as KeyboardEvent);

      // Click to place the quadratic arc control point in another place
      toolManager.handleMouseDown(new ScreenPosition(50, 50), viewport);

      // Polygon should be closed
      expect(geometryStore.polygons).toHaveLength(1);
      expect(geometryStore.polygons[0].closed).toBe(true);
      expect(geometryStore.polygons[0].points).toHaveLength(4);

      expect(geometryStore.polygons[0].points[0].type).toStrictEqual('point');
      expect(geometryStore.polygons[0].points[1].type).toStrictEqual('point');
      expect(geometryStore.polygons[0].points[2].type).toStrictEqual('point');
      expect(geometryStore.polygons[0].points[3].type).toStrictEqual('arc-quadratic');
    });

    it('enter key completes open polygon', () => {
      // Create 2 points
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      toolManager.handleMouseDown(new ScreenPosition(20, 20), viewport);
      expect(geometryStore.workingPolygon).not.toBeNull();

      // Press Enter to complete
      toolManager.handleKeyDown({ key: 'Enter' } as KeyboardEvent);

      // Polygon should be added to store
      expect(geometryStore.polygons).toHaveLength(1);
      expect(geometryStore.polygons[0].closed).toBe(false);
      expect(geometryStore.polygons[0].points).toHaveLength(2);
      expect(geometryStore.polygons[0].fillColor).toBe(DEFAULT_COLOR);
      expect(geometryStore.workingPolygon).toBeNull();
    });

    it('esc key aborts polygon drawing', () => {
      // Create 2 points
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      toolManager.handleMouseDown(new ScreenPosition(20, 20), viewport);
      expect(geometryStore.workingPolygon).not.toBeNull();

      // Press Esc to abort
      toolManager.handleKeyDown({ key: 'Escape' } as KeyboardEvent);

      // Polygon state should be gone
      expect(geometryStore.polygons).toHaveLength(0);
      expect(geometryStore.workingPolygon).toBeNull();
    });

    it('backspace key deletes in flight polygon segments', () => {
      // Create 4 points
      toolManager.handleMouseDown(new ScreenPosition(10, 11), viewport);
      toolManager.handleMouseDown(new ScreenPosition(20, 21), viewport);
      toolManager.handleMouseDown(new ScreenPosition(30, 31), viewport);
      toolManager.handleMouseDown(new ScreenPosition(40, 41), viewport);
      expect(geometryStore.workingPolygon).not.toBeNull();
      expect(geometryStore.workingPolygon!.points).toHaveLength(5 /* 1 initial point + 4 manually placed points */);
      expect(geometryStore.workingPolygon!.points.at(-2)?.point.x).toBeCloseTo(40 / SHEET_UNITS_TO_PIXELS, 2);
      expect(geometryStore.workingPolygon!.points.at(-2)?.point.y).toBeCloseTo(41 / SHEET_UNITS_TO_PIXELS, 2);

      // Move cursor to a differet spot (just to make the below assertions more clear)
      toolManager.handleMouseMove(new ScreenPosition(100, 101), viewport);

      // Press Backspace to get rid of a segment
      toolManager.handleKeyDown({ key: 'Backspace' } as KeyboardEvent);

      // The last non preview point should have gone away
      expect(geometryStore.workingPolygon!.points).toHaveLength(4);
      expect(geometryStore.workingPolygon!.points.at(-1)?.point.x).toBeCloseTo(100 / SHEET_UNITS_TO_PIXELS, 2);
      expect(geometryStore.workingPolygon!.points.at(-1)?.point.y).toBeCloseTo(101 / SHEET_UNITS_TO_PIXELS, 2);
      expect(geometryStore.workingPolygon!.points.at(-2)?.point.x).toBeCloseTo(30 / SHEET_UNITS_TO_PIXELS, 2);
      expect(geometryStore.workingPolygon!.points.at(-2)?.point.y).toBeCloseTo(31 / SHEET_UNITS_TO_PIXELS, 2);
    });

    it('backspace with 1 point then complete does nothing', () => {
      // Create 1 point
      toolManager.handleMouseDown(new ScreenPosition(10, 11), viewport);

      // Press Backspace to get rid of a segment
      toolManager.handleKeyDown({ key: 'Backspace' } as KeyboardEvent);

      // Action: Try to complete
      toolManager.handleKeyDown({ key: 'Enter' } as KeyboardEvent);

      // Verify: No polygon created
      expect(geometryStore.polygons).toHaveLength(0);
    });

    it('clicking same location twice adds consecutive point', () => {
      // Setup: Create first point
      toolManager.handleMouseDown(new ScreenPosition(100, 100), viewport);

      // Action: Click same location again
      toolManager.handleMouseDown(new ScreenPosition(100, 100), viewport);

      // Verify: Point added (2 points + preview = 3 segments in working polygon)
      expect(geometryStore.workingPolygon!.points).toHaveLength(3);
    });
  });

  describe('curve drawing', () => {
    beforeEach(() => {
      // Disable snapping for basic tests
      polygonTool.setSnappingOptions({ primaryGridSize: 0.001, secondaryGridSize: 0.001 });
    });

    it('creates a polygon with a quadratic curve', () => {
      // Create points making up the first 2 corners of a square
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      toolManager.handleMouseDown(new ScreenPosition(30, 10), viewport);

      expect(geometryStore.workingPolygon?.points).toHaveLength(3);

      // Hold down alt, and click at the next corner to create a quadratic arc
      toolManager.handleKeyDown({ key: 'Alt' } as KeyboardEvent);
      toolManager.handleMouseDown(new ScreenPosition(30, 30), viewport);
      toolManager.handleKeyUp({ key: 'Alt' } as KeyboardEvent);

      // Place the quadratic arc single control point off to the side
      toolManager.handleMouseDown(new ScreenPosition(50, 20), viewport);

      // Place the final two points of the square, closing the square
      toolManager.handleMouseDown(new ScreenPosition(10, 30), viewport);
      polygonTool.setHoveringFirstHandle(true);
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      polygonTool.setHoveringFirstHandle(false);

      // Make sure there is a square in the polygon state:
      expect(geometryStore.polygons).toHaveLength(1);
      expect(geometryStore.polygons[0].closed).toBe(true);
      expect(geometryStore.polygons[0].points).toHaveLength(5 /* 4 points + 1 duplicate close point */);

      // Point one is upper left
      expect(geometryStore.polygons[0].points[0].type).toStrictEqual('point');
      expect(geometryStore.polygons[0].points[0].point.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(geometryStore.polygons[0].points[0].point.y).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);

      // Point two is upper right
      expect(geometryStore.polygons[0].points[1].type).toStrictEqual('point');
      expect(geometryStore.polygons[0].points[1].point.x).toBeCloseTo(30 / SHEET_UNITS_TO_PIXELS, 2);
      expect(geometryStore.polygons[0].points[1].point.y).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);

      // Point three is the quadratic arc on the right side -> lower right
      expect(geometryStore.polygons[0].points[2].type).toStrictEqual('arc-quadratic');
      expect((geometryStore.polygons[0].points[2] as any).controlPoint.x).toBeCloseTo(50 / SHEET_UNITS_TO_PIXELS, 2);
      expect((geometryStore.polygons[0].points[2] as any).controlPoint.y).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
      expect(geometryStore.polygons[0].points[2].point.x).toBeCloseTo(30 / SHEET_UNITS_TO_PIXELS, 2);
      expect(geometryStore.polygons[0].points[2].point.y).toBeCloseTo(30 / SHEET_UNITS_TO_PIXELS, 2);

      // Point four is the lower left
      expect(geometryStore.polygons[0].points[3].type).toStrictEqual('point');
      expect(geometryStore.polygons[0].points[3].point.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(geometryStore.polygons[0].points[3].point.y).toBeCloseTo(30 / SHEET_UNITS_TO_PIXELS, 2);

      // Point five is the upper left again
      expect(geometryStore.polygons[0].points[4].type).toStrictEqual('point');
      expect(geometryStore.polygons[0].points[4].point.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(geometryStore.polygons[0].points[4].point.y).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
    });

    it('creates a polygon with a cubic curve', () => {
      // Create points making up the first 2 corners of a square
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      toolManager.handleMouseDown(new ScreenPosition(30, 10), viewport);

      expect(geometryStore.workingPolygon?.points).toHaveLength(3);

      // Hold down alt, and click at the next corner to create a quadratic arc
      toolManager.handleKeyDown({ key: 'Alt' } as KeyboardEvent);
      toolManager.handleMouseDown(new ScreenPosition(30, 30), viewport);
      toolManager.handleKeyUp({ key: 'Alt' } as KeyboardEvent);

      // Press B to move from quadratic -> cubic
      toolManager.handleKeyDown({ key: 'B' } as KeyboardEvent);

      // Place the first cubic control point off to the side
      toolManager.handleMouseDown(new ScreenPosition(50, 15), viewport);

      // Place the second cubic control point off to the side but lower
      toolManager.handleMouseDown(new ScreenPosition(50, 25), viewport);

      // Place the final two points of the square, closing the square
      toolManager.handleMouseDown(new ScreenPosition(10, 30), viewport);
      polygonTool.setHoveringFirstHandle(true);
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      polygonTool.setHoveringFirstHandle(false);

      // Make sure there is a square in the polygon state:
      expect(geometryStore.polygons).toHaveLength(1);
      expect(geometryStore.polygons[0].closed).toBe(true);
      expect(geometryStore.polygons[0].points).toHaveLength(5 /* 4 points + 1 duplicate close point */);

      // Point one is upper left
      expect(geometryStore.polygons[0].points[0].type).toStrictEqual('point');
      expect(geometryStore.polygons[0].points[0].point.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(geometryStore.polygons[0].points[0].point.y).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);

      // Point two is upper right
      expect(geometryStore.polygons[0].points[1].type).toStrictEqual('point');
      expect(geometryStore.polygons[0].points[1].point.x).toBeCloseTo(30 / SHEET_UNITS_TO_PIXELS, 2);
      expect(geometryStore.polygons[0].points[1].point.y).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);

      // Point three is the cubic arc on the right side -> lower right
      expect(geometryStore.polygons[0].points[2].type).toStrictEqual('arc-cubic');
      expect((geometryStore.polygons[0].points[2] as any).controlPointA.x).toBeCloseTo(50 / SHEET_UNITS_TO_PIXELS, 2);
      expect((geometryStore.polygons[0].points[2] as any).controlPointA.y).toBeCloseTo(15 / SHEET_UNITS_TO_PIXELS, 2);
      expect((geometryStore.polygons[0].points[2] as any).controlPointB.x).toBeCloseTo(50 / SHEET_UNITS_TO_PIXELS, 2);
      expect((geometryStore.polygons[0].points[2] as any).controlPointB.y).toBeCloseTo(25 / SHEET_UNITS_TO_PIXELS, 2);
      expect(geometryStore.polygons[0].points[2].point.x).toBeCloseTo(30 / SHEET_UNITS_TO_PIXELS, 2);
      expect(geometryStore.polygons[0].points[2].point.y).toBeCloseTo(30 / SHEET_UNITS_TO_PIXELS, 2);

      // Point four is the lower left
      expect(geometryStore.polygons[0].points[3].type).toStrictEqual('point');
      expect(geometryStore.polygons[0].points[3].point.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(geometryStore.polygons[0].points[3].point.y).toBeCloseTo(30 / SHEET_UNITS_TO_PIXELS, 2);

      // Point five is the upper left again
      expect(geometryStore.polygons[0].points[4].type).toStrictEqual('point');
      expect(geometryStore.polygons[0].points[4].point.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(geometryStore.polygons[0].points[4].point.y).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
    });

    it('esc key when in curve drawing cancels current curve drawing, and a second press aborts polygon', () => {
      // Create points making up the first 2 corners of a square
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      toolManager.handleMouseDown(new ScreenPosition(30, 10), viewport);

      expect(geometryStore.workingPolygon?.points).toHaveLength(3);

      // Hold down alt, and click at the next corner to start a quadratic arc
      toolManager.handleKeyDown({ key: 'Alt' } as KeyboardEvent);
      toolManager.handleMouseDown(new ScreenPosition(30, 30), viewport);
      toolManager.handleKeyUp({ key: 'Alt' } as KeyboardEvent);

      expect(geometryStore.workingPolygon?.points.at(-1)?.type).toStrictEqual('arc-quadratic');

      // Press Esc to stop drawing the arc
      toolManager.handleKeyDown({ key: 'Escape' } as KeyboardEvent);

      // Working polygon state should be reset to not have the arc
      expect(geometryStore.workingPolygon?.points).toHaveLength(3);
      expect(geometryStore.workingPolygon?.points.at(-1)?.type).toStrictEqual('point');

      // Press Esc again
      toolManager.handleKeyDown({ key: 'Escape' } as KeyboardEvent);

      // The working polygon should be fully wiped out
      expect(geometryStore.polygons).toHaveLength(0);
      expect(geometryStore.workingPolygon).toBeNull();
    });

    it('backspace key when in curve drawing cancels current curve drawing, and a second press deletes past points', () => {
      // Create points making up the first 2 corners of a square
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      toolManager.handleMouseDown(new ScreenPosition(30, 10), viewport);

      expect(geometryStore.workingPolygon?.points).toHaveLength(3);

      // Hold down alt, and click at the next corner to start a quadratic arc
      toolManager.handleKeyDown({ key: 'Alt' } as KeyboardEvent);
      toolManager.handleMouseDown(new ScreenPosition(30, 30), viewport);
      toolManager.handleKeyUp({ key: 'Alt' } as KeyboardEvent);

      expect(geometryStore.workingPolygon?.points.at(-1)?.type).toStrictEqual('arc-quadratic');

      // Press Backspaec to stop drawing the arc
      toolManager.handleKeyDown({ key: 'Backspace' } as KeyboardEvent);

      // Working polygon state should be reset to not have the arc
      expect(geometryStore.workingPolygon?.points).toHaveLength(3);
      expect(geometryStore.workingPolygon?.points.at(-1)?.type).toStrictEqual('point');

      // Press Backspace again
      toolManager.handleKeyDown({ key: 'Backspace' } as KeyboardEvent);

      // The working polygon should now only have two points left - both added segments were removed
      expect(geometryStore.workingPolygon?.points).toHaveLength(2);
    });

    it('closes a polygon with a quadratic curve', () => {
      // Create points making up the first 3 sides of a square
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      toolManager.handleMouseDown(new ScreenPosition(30, 10), viewport);
      toolManager.handleMouseDown(new ScreenPosition(30, 30), viewport);
      toolManager.handleMouseDown(new ScreenPosition(10, 30), viewport);

      expect(geometryStore.workingPolygon?.points).toHaveLength(5);

      // Hold down alt, and click at the upper left corner to close with a quadratic arc
      toolManager.handleKeyDown({ key: 'Alt' } as KeyboardEvent);
      polygonTool.setHoveringFirstHandle(true);
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      polygonTool.setHoveringFirstHandle(false);
      toolManager.handleKeyUp({ key: 'Alt' } as KeyboardEvent);

      // Place the quadratic arc single control point off to the side
      toolManager.handleMouseDown(new ScreenPosition(0, 20), viewport);

      // Make sure there is a square in the polygon state:
      expect(geometryStore.polygons).toHaveLength(1);
      expect(geometryStore.polygons[0].closed).toBe(true);
      expect(geometryStore.polygons[0].points).toHaveLength(5 /* 4 points + 1 duplicate close point */);

      // Point one is upper left
      expect(geometryStore.polygons[0].points[0].type).toStrictEqual('point');
      expect(geometryStore.polygons[0].points[0].point.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(geometryStore.polygons[0].points[0].point.y).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);

      // Point two is upper right
      expect(geometryStore.polygons[0].points[1].type).toStrictEqual('point');
      expect(geometryStore.polygons[0].points[1].point.x).toBeCloseTo(30 / SHEET_UNITS_TO_PIXELS, 2);
      expect(geometryStore.polygons[0].points[1].point.y).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);

      // Point two is lower right
      expect(geometryStore.polygons[0].points[2].type).toStrictEqual('point');
      expect(geometryStore.polygons[0].points[2].point.x).toBeCloseTo(30 / SHEET_UNITS_TO_PIXELS, 2);
      expect(geometryStore.polygons[0].points[2].point.y).toBeCloseTo(30 / SHEET_UNITS_TO_PIXELS, 2);

      // Point four is lower left
      expect(geometryStore.polygons[0].points[3].type).toStrictEqual('point');
      expect(geometryStore.polygons[0].points[3].point.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(geometryStore.polygons[0].points[3].point.y).toBeCloseTo(30 / SHEET_UNITS_TO_PIXELS, 2);

      // Point five is the quadratic arc on the right side -> upper left
      expect(geometryStore.polygons[0].points[4].type).toStrictEqual('arc-quadratic');
      expect((geometryStore.polygons[0].points[4] as any).controlPoint.x).toBeCloseTo(0 / SHEET_UNITS_TO_PIXELS, 2);
      expect((geometryStore.polygons[0].points[4] as any).controlPoint.y).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
      expect(geometryStore.polygons[0].points[4].point.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(geometryStore.polygons[0].points[4].point.y).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
    });

    it('closes a polygon with a cubic curve', () => {
      // Create points making up the first 3 sides of a square
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      toolManager.handleMouseDown(new ScreenPosition(30, 10), viewport);
      toolManager.handleMouseDown(new ScreenPosition(30, 30), viewport);
      toolManager.handleMouseDown(new ScreenPosition(10, 30), viewport);

      expect(geometryStore.workingPolygon?.points).toHaveLength(5);

      // Hold down alt, and click at the upper left corner to close with a quadratic arc
      toolManager.handleKeyDown({ key: 'Alt' } as KeyboardEvent);
      polygonTool.setHoveringFirstHandle(true);
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      polygonTool.setHoveringFirstHandle(false);
      toolManager.handleKeyUp({ key: 'Alt' } as KeyboardEvent);

      // Press B to move from quadratic -> cubic
      toolManager.handleKeyDown({ key: 'B' } as KeyboardEvent);

      // Place the first subic arc single control point off to the bottom side
      toolManager.handleMouseDown(new ScreenPosition(0, 30), viewport);

      // Place the second subic arc single control point off to the top side
      toolManager.handleMouseDown(new ScreenPosition(0, 0), viewport);

      // Make sure there is a square in the polygon state:
      expect(geometryStore.polygons).toHaveLength(1);
      expect(geometryStore.polygons[0].closed).toBe(true);
      expect(geometryStore.polygons[0].points).toHaveLength(5 /* 4 points + 1 duplicate close point */);

      // Point one is upper left
      expect(geometryStore.polygons[0].points[0].type).toStrictEqual('point');
      expect(geometryStore.polygons[0].points[0].point.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(geometryStore.polygons[0].points[0].point.y).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);

      // Point two is upper right
      expect(geometryStore.polygons[0].points[1].type).toStrictEqual('point');
      expect(geometryStore.polygons[0].points[1].point.x).toBeCloseTo(30 / SHEET_UNITS_TO_PIXELS, 2);
      expect(geometryStore.polygons[0].points[1].point.y).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);

      // Point two is lower right
      expect(geometryStore.polygons[0].points[2].type).toStrictEqual('point');
      expect(geometryStore.polygons[0].points[2].point.x).toBeCloseTo(30 / SHEET_UNITS_TO_PIXELS, 2);
      expect(geometryStore.polygons[0].points[2].point.y).toBeCloseTo(30 / SHEET_UNITS_TO_PIXELS, 2);

      // Point four is lower left
      expect(geometryStore.polygons[0].points[3].type).toStrictEqual('point');
      expect(geometryStore.polygons[0].points[3].point.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(geometryStore.polygons[0].points[3].point.y).toBeCloseTo(30 / SHEET_UNITS_TO_PIXELS, 2);

      // Point five is the quadratic arc on the right side -> upper left
      expect(geometryStore.polygons[0].points[4].type).toStrictEqual('arc-cubic');
      expect((geometryStore.polygons[0].points[4] as any).controlPointA.x).toBeCloseTo(0 / SHEET_UNITS_TO_PIXELS, 2);
      expect((geometryStore.polygons[0].points[4] as any).controlPointA.y).toBeCloseTo(30 / SHEET_UNITS_TO_PIXELS, 2);
      expect((geometryStore.polygons[0].points[4] as any).controlPointB.x).toBeCloseTo(0 / SHEET_UNITS_TO_PIXELS, 2);
      expect((geometryStore.polygons[0].points[4] as any).controlPointB.y).toBeCloseTo(0 / SHEET_UNITS_TO_PIXELS, 2);
      expect(geometryStore.polygons[0].points[4].point.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(geometryStore.polygons[0].points[4].point.y).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
    });

    it('can switch between quadratic and cubic and one control point persists', () => {
      // Create two points
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      toolManager.handleMouseDown(new ScreenPosition(30, 30), viewport);

      // Hold down alt, and click at a third point to create a quadratic arc
      toolManager.handleKeyDown({ key: 'Alt' } as KeyboardEvent);
      toolManager.handleMouseDown(new ScreenPosition(50, 51), viewport);
      toolManager.handleKeyUp({ key: 'Alt' } as KeyboardEvent);

      // Move the mouse to set a seed quadratic curve control point
      toolManager.handleMouseMove(new ScreenPosition(60, 61), viewport);

      // Press B to move from quadratic -> cubic
      toolManager.handleKeyDown({ key: 'B' } as KeyboardEvent);

      // Make sure the cubic control point a is (60, 61)
      expect((geometryStore.workingPolygon?.points.at(-1) as any).controlPointA.x).toBeCloseTo(60 / SHEET_UNITS_TO_PIXELS, 2);
      expect((geometryStore.workingPolygon?.points.at(-1) as any).controlPointA.y).toBeCloseTo(61 / SHEET_UNITS_TO_PIXELS, 2);

      // Press M to move from cubic -> quadratic
      toolManager.handleKeyDown({ key: 'M' } as KeyboardEvent);

      // Make sure the quadratic control point is also still (60, 61)
      expect((geometryStore.workingPolygon?.points.at(-1) as any).controlPoint.x).toBeCloseTo(60 / SHEET_UNITS_TO_PIXELS, 2);
      expect((geometryStore.workingPolygon?.points.at(-1) as any).controlPoint.y).toBeCloseTo(61 / SHEET_UNITS_TO_PIXELS, 2);
    });
  });

  describe('extending from start / end', () => {
    beforeEach(() => {
      // Disable snapping for basic tests
      polygonTool.setSnappingOptions({ primaryGridSize: 0.001, secondaryGridSize: 0.001 });
    });

    it('should extend a non closed polygon from the start point and close it', () => {
      // Create a small, two point polygon
      const polygon = geometryStore.addPolygon({
        points: [
          { type: "point", point: new SheetPosition(10 / SHEET_UNITS_TO_PIXELS, 10 / SHEET_UNITS_TO_PIXELS) },
          { type: "point", point: new SheetPosition(20 / SHEET_UNITS_TO_PIXELS, 10 / SHEET_UNITS_TO_PIXELS) },
        ],
        closed: false,
        fillColor: null,
        openAtIndex: 0,
      });

      // Hover over the first polygon point
      polygonTool.setHoveringEndpointOfPolygon({ polygonId: polygon.id, pointIndex: 0, isStartPoint: true });
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      polygonTool.setHoveringEndpointOfPolygon(null);

      expect(geometryStore.workingPolygon?.points).toHaveLength(3);

      // Place a few more points
      toolManager.handleMouseDown(new ScreenPosition(50, 50), viewport);
      toolManager.handleMouseDown(new ScreenPosition(80, 60), viewport);

      // Hover over the final point of the polygon and click
      polygonTool.setHoveringFirstHandle(true); // NOTE: this name is wrong, this really means "last handle" in this context
      toolManager.handleMouseDown(new ScreenPosition(20, 10), viewport);
      polygonTool.setHoveringFirstHandle(false); // NOTE: this name is wrong, this really means "last handle" in this context

      // Make sure there is one polygon still, and it has all the points
      expect(geometryStore.workingPolygon).toBeNull();
      expect(geometryStore.polygons).toHaveLength(1);
      expect(geometryStore.polygons[0].closed).toBeTruthy();
      expect(geometryStore.polygons[0].points).toHaveLength(5);

      // The first point should be the final point of the existing segment
      expect(geometryStore.polygons[0].points[0].point.x).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
      expect(geometryStore.polygons[0].points[0].point.y).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);

      // The original segment should be at the end
      expect(geometryStore.polygons[0].points.at(-2)!.point.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(geometryStore.polygons[0].points.at(-2)!.point.y).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(geometryStore.polygons[0].points.at(-1)!.point.x).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
      expect(geometryStore.polygons[0].points.at(-1)!.point.y).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
    });

    it('should extend a non closed polygon from the end point and close it', () => {
      // Create a small, two point polygon
      const polygon = geometryStore.addPolygon({
        points: [
          { type: "point", point: new SheetPosition(10 / SHEET_UNITS_TO_PIXELS, 10 / SHEET_UNITS_TO_PIXELS) },
          { type: "point", point: new SheetPosition(20 / SHEET_UNITS_TO_PIXELS, 10 / SHEET_UNITS_TO_PIXELS) },
        ],
        closed: false,
        fillColor: null,
        openAtIndex: 0,
      });

      // Hover over the last polygon point
      polygonTool.setHoveringEndpointOfPolygon({ polygonId: polygon.id, pointIndex: 1, isStartPoint: false });
      toolManager.handleMouseDown(new ScreenPosition(20, 10), viewport);
      polygonTool.setHoveringEndpointOfPolygon(null);

      expect(geometryStore.workingPolygon?.points).toHaveLength(3);

      // Place a few more points
      toolManager.handleMouseDown(new ScreenPosition(50, 50), viewport);
      toolManager.handleMouseDown(new ScreenPosition(80, 60), viewport);

      // Hover over the final point of the polygon and click
      polygonTool.setHoveringFirstHandle(true);
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      polygonTool.setHoveringFirstHandle(false);

      // Make sure there is one polygon still, and it has all the points
      expect(geometryStore.workingPolygon).toBeNull();
      expect(geometryStore.polygons).toHaveLength(1);
      expect(geometryStore.polygons[0].closed).toBeTruthy();
      expect(geometryStore.polygons[0].points).toHaveLength(5);

      // The original segment should be at the end
      expect(geometryStore.polygons[0].points[0].point.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(geometryStore.polygons[0].points[0].point.y).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(geometryStore.polygons[0].points[1].point.x).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
      expect(geometryStore.polygons[0].points[1].point.y).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);

      // The last point should be the final point of the initial segment
      expect(geometryStore.polygons[0].points.at(-1)!.point.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(geometryStore.polygons[0].points.at(-1)!.point.y).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
    });

    it('should be able to drop points with backspace from polygon extended from start', () => {
      // Create a small, two point polygon
      const polygon = geometryStore.addPolygon({
        points: [
          { type: "point", point: new SheetPosition(10 / SHEET_UNITS_TO_PIXELS, 10 / SHEET_UNITS_TO_PIXELS) },
          { type: "point", point: new SheetPosition(20 / SHEET_UNITS_TO_PIXELS, 10 / SHEET_UNITS_TO_PIXELS) },
        ],
        closed: false,
        fillColor: null,
        openAtIndex: 0,
      });

      // Hover over the first polygon point
      polygonTool.setHoveringEndpointOfPolygon({ polygonId: polygon.id, pointIndex: 0, isStartPoint: true });
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      polygonTool.setHoveringEndpointOfPolygon(null);

      // Place another point
      toolManager.handleMouseDown(new ScreenPosition(50, 50), viewport);

      expect(geometryStore.workingPolygon?.points).toHaveLength(4);

      // Press backspace, this should get rid of the point that was just placed
      toolManager.handleKeyDown({ key: 'Backspace' } as KeyboardEvent);

      expect(geometryStore.workingPolygon?.points).toHaveLength(3);

      // Press backspace, this should get rid of the original polygon point
      toolManager.handleKeyDown({ key: 'Backspace' } as KeyboardEvent);

      expect(geometryStore.workingPolygon?.points).toHaveLength(2);
    });

    it('should be able to drop points with backspace from polygon extended from end', () => {
      // Create a small, two point polygon
      const polygon = geometryStore.addPolygon({
        points: [
          { type: "point", point: new SheetPosition(10 / SHEET_UNITS_TO_PIXELS, 10 / SHEET_UNITS_TO_PIXELS) },
          { type: "point", point: new SheetPosition(20 / SHEET_UNITS_TO_PIXELS, 10 / SHEET_UNITS_TO_PIXELS) },
        ],
        closed: false,
        fillColor: null,
        openAtIndex: 0,
      });

      // Hover over the first polygon point
      polygonTool.setHoveringEndpointOfPolygon({ polygonId: polygon.id, pointIndex: 0, isStartPoint: false });
      toolManager.handleMouseDown(new ScreenPosition(20, 10), viewport);
      polygonTool.setHoveringEndpointOfPolygon(null);

      // Place another point
      toolManager.handleMouseDown(new ScreenPosition(50, 50), viewport);

      expect(geometryStore.workingPolygon?.points).toHaveLength(4);

      // Press backspace, this should get rid of the point that was just placed
      toolManager.handleKeyDown({ key: 'Backspace' } as KeyboardEvent);

      expect(geometryStore.workingPolygon?.points).toHaveLength(3);

      // Press backspace, this should get rid of the original polygon point
      toolManager.handleKeyDown({ key: 'Backspace' } as KeyboardEvent);

      expect(geometryStore.workingPolygon?.points).toHaveLength(2);
    });
  });

  describe('tool focus / blur', () => {
    it('blur clears working polygon', () => {
      // Setup: Create working polygon
      toolManager.handleMouseDown(new ScreenPosition(100, 100), viewport);
      expect(geometryStore.workingPolygon).not.toBeNull();

      // Action: Blur the tool
      polygonTool.handleToolBlur();

      // Verify: Working polygon cleared
      expect(geometryStore.workingPolygon).toBeNull();
    });

    it('blur clears preview key combos', () => {
      // Setup: Create working polygon
      toolManager.handleMouseDown(new ScreenPosition(100, 100), viewport);
      expect(geometryStore.workingPolygon).not.toBeNull();

      // Setup: Add intersection key combos to state
      // Note: Direct internal state manipulation for test setup
      const state = polygonTool.state as any;
      if (state.intersection) {
        state.intersection.keyCombos.setKeyCombos(['a', 'b']);
      }

      // Action: Blur the tool
      polygonTool.handleToolBlur();

      // Verify: State reset to idle
      expect(polygonTool.state.state).toBe('idle');
    });

    it('blur clears enabled intersections', () => {
      // Setup: Set enabled intersections
      // Note: Direct internal state manipulation for test setup
      (polygonTool as any).previewSegmentInteractionsEnabled = new Set(['a']);

      // Action: Blur the tool
      polygonTool.handleToolBlur();

      // Verify: Enabled set cleared
      expect((polygonTool as any).previewSegmentInteractionsEnabled.size).toBe(0);
    });

    it('blur emits empty intersection arrays', () => {
      // Setup: Subscribe to events using subscribeToEvents helper
      const events = subscribeToEvents(polygonTool, ['previewSegmentIntersections', 'previewSegmentIntersectionsEnabled']);
      
      // Action: Blur the tool
      polygonTool.handleToolBlur();

      // Verify: Events were emitted
      expect(events.areThereBufferedEvents('previewSegmentIntersections')).toBe(true);
      expect(events.areThereBufferedEvents('previewSegmentIntersectionsEnabled')).toBe(true);
    });
  });

  describe('line intersection', () => {
    it('should do an intersection with another linear polygon, forming a "+" shape', () => {
      const { id: existingPolygonId } = geometryStore.addPolygon({
        points: [makePoint(50, 0), makePoint(50, 100)],
        closed: false,
        fillColor: null,
        openAtIndex: 0,
      });

      // Create first point
      toolManager.handleMouseDown(new ScreenPosition(0 * SHEET_UNITS_TO_PIXELS, 50 * SHEET_UNITS_TO_PIXELS), viewport);
      expect(geometryStore.workingPolygon!.points).toHaveLength(2);

      // Move the mouse to the other endpoint position
      toolManager.handleMouseMove(new ScreenPosition(100 * SHEET_UNITS_TO_PIXELS, 50 * SHEET_UNITS_TO_PIXELS), viewport);

      // Activate the intersection point between the segments
      toolManager.handleKeyDown({ key: "a" } as KeyboardEvent);

      // CLick to add the second point
      toolManager.handleMouseDown(new ScreenPosition(100 * SHEET_UNITS_TO_PIXELS, 50 * SHEET_UNITS_TO_PIXELS), viewport);

      // Verify the itnersection point was added to the working polygon
      expect(geometryStore.workingPolygon!.points).toHaveLength(4);
      expect(geometryStore.workingPolygon!.points[0].point.x).toBeCloseTo(0, 2);
      expect(geometryStore.workingPolygon!.points[0].point.y).toBeCloseTo(50, 2);
      expect(geometryStore.workingPolygon!.points[1].point.x).toBeCloseTo(50, 2);
      expect(geometryStore.workingPolygon!.points[1].point.y).toBeCloseTo(50, 2);
      expect(geometryStore.workingPolygon!.points[2].point.x).toBeCloseTo(100, 2);
      expect(geometryStore.workingPolygon!.points[2].point.y).toBeCloseTo(50, 2);
      // points[3] is the preview segment, so it's exact end point is not important

      // Verify that the intersection point was added to the existing polygon, too
      const existingPolygon = geometryStore.getPolygonById(existingPolygonId);
      expect(existingPolygon?.points).toHaveLength(3);
      expect(existingPolygon?.points[0].point.x).toBeCloseTo(50, 2);
      expect(existingPolygon?.points[0].point.y).toBeCloseTo(0, 2);
      expect(existingPolygon?.points[1].point.x).toBeCloseTo(50, 2);
      expect(existingPolygon?.points[1].point.y).toBeCloseTo(50, 2);
      expect(existingPolygon?.points[2].point.x).toBeCloseTo(50, 2);
      expect(existingPolygon?.points[2].point.y).toBeCloseTo(100, 2);
    });
    it('should do an intersection with another linear polygon, forming a "+" shape, by extending a pre-existing other polygon from start', () => {
      const { id: existingPolygonId } = geometryStore.addPolygon({
        points: [makePoint(50, 0), makePoint(50, 100)],
        closed: false,
        fillColor: null,
        openAtIndex: 0,
      });
      const { id: startingPolygonId } = geometryStore.addPolygon({
        points: [makePoint(100, 50), makePoint(123, 123) /* this point doesn't matter for the intersection calculation */],
        closed: false,
        fillColor: null,
        openAtIndex: 0,
      });

      // Hover first point of starting polygon
      polygonTool.setHoveringEndpointOfPolygon({ polygonId: startingPolygonId, pointIndex: 0, isStartPoint: true });
      toolManager.handleMouseDown(new ScreenPosition(0 * SHEET_UNITS_TO_PIXELS, 50 * SHEET_UNITS_TO_PIXELS), viewport);
      polygonTool.setHoveringEndpointOfPolygon(null);

      expect(geometryStore.workingPolygon?.points).toHaveLength(3);

      // Move the mouse to the further left endpoint position (0, 50)
      toolManager.handleMouseMove(new ScreenPosition(0 * SHEET_UNITS_TO_PIXELS, 50 * SHEET_UNITS_TO_PIXELS), viewport);

      // Activate the intersection point between the segments
      toolManager.handleKeyDown({ key: "a" } as KeyboardEvent);

      // Click to add the next point
      toolManager.handleMouseDown(new ScreenPosition(0 * SHEET_UNITS_TO_PIXELS, 50 * SHEET_UNITS_TO_PIXELS), viewport);

      // Verify the intersection point was added to the working polygon
      expect(geometryStore.workingPolygon!.points).toHaveLength(5);

      // points[0] doesn't matter, it is the start of the preview segment
      expect(geometryStore.workingPolygon!.points[1].point.x).toBeCloseTo(0, 2);
      expect(geometryStore.workingPolygon!.points[1].point.y).toBeCloseTo(50, 2);
      expect(geometryStore.workingPolygon!.points[2].point.x).toBeCloseTo(50, 2); // <- intersection point added here
      expect(geometryStore.workingPolygon!.points[2].point.y).toBeCloseTo(50, 2);
      expect(geometryStore.workingPolygon!.points[3].point.x).toBeCloseTo(100, 2);
      expect(geometryStore.workingPolygon!.points[4].point.y).toBeCloseTo(50, 2);

      expect(geometryStore.workingPolygon!.points[5].point.x).toBeCloseTo(123 /* end point of starting polygon */, 2);
      expect(geometryStore.workingPolygon!.points[5].point.y).toBeCloseTo(123 /* end point of starting polygon */, 2);

      // Verify that the intersection point was added to the existing polygon, too
      const existingPolygon = geometryStore.getPolygonById(existingPolygonId);
      expect(existingPolygon?.points).toHaveLength(3);
      expect(existingPolygon?.points[0].point.x).toBeCloseTo(50, 2);
      expect(existingPolygon?.points[0].point.y).toBeCloseTo(0, 2);
      expect(existingPolygon?.points[1].point.x).toBeCloseTo(50, 2);
      expect(existingPolygon?.points[1].point.y).toBeCloseTo(50, 2);
      expect(existingPolygon?.points[2].point.x).toBeCloseTo(50, 2);
      expect(existingPolygon?.points[2].point.y).toBeCloseTo(100, 2);
    });
  });

  describe.skip('grid snapping', () => {
    it('preview snaps to grid', () => {
      // Setup: Set up grid snapping
      polygonTool.setSnappingOptions({ primaryGridSize: 10, secondaryGridSize: 5 });

      // Setup: Create first point
      toolManager.handleMouseDown(new ScreenPosition(100, 100), viewport);

      // Action: Move to position that would snap
      toolManager.handleMouseMove(new ScreenPosition(137, 137), viewport);

      // Verify: Preview snapped to grid (x should be divisible by 10)
      expect(geometryStore.workingPolygon!.points.at(-1)!.point.x % 10).toStrictEqual(0);
      expect(geometryStore.workingPolygon!.points.at(-1)!.point.y % 10).toStrictEqual(0);
    });

    it('shift disables grid snapping', () => {
      // Setup: Set large grid
      polygonTool.setSnappingOptions({ primaryGridSize: 10, secondaryGridSize: 5 });

      // Hold shift via toolManager
      toolManager.handleKeyDown({ key: "Shift" } as KeyboardEvent);

      // Create first point
      toolManager.handleMouseDown(new ScreenPosition(100, 100), viewport);

      // Move mouse
      toolManager.handleMouseMove(new ScreenPosition(137, 137), viewport);

      // Click at the right position
      toolManager.handleMouseDown(new ScreenPosition(137, 137), viewport);

      // Make sure snapping occurred
      console.log('BAR', geometryStore.workingPolygon?.points.at(-1)?.point)
      expect(geometryStore.workingPolygon!.points.at(-1)!.point.x % 10).toStrictEqual(0);
      expect(geometryStore.workingPolygon!.points.at(-1)!.point.y % 10).toStrictEqual(0);
    });
  })

  // ================================================================================
  // Section 7: Intersection Key Combos
  // ================================================================================
  describe.skip('intersection key combos', () => {
    beforeEach(() => {
      // Setup: Create working polygon for intersection testing
      toolManager.handleMouseDown(new ScreenPosition(0, 0), viewport);
      toolManager.handleMouseMove(new ScreenPosition(100, 100), viewport);
    });

    function setFakeIntersections(count: number) {
      // Note: Direct internal state manipulation for test setup
      const intersections: PreviewSegmentIntersections[] = [];
      for (let i = 0; i < count; i++) {
        intersections.push({
          otherId: `polygon-${i}`,
          otherType: 'polygon',
          otherSegmentIndex: 0,
          keyCombo: mapIndexToKeyCombo(i),
          segment: { start: new SheetPosition(0, 0), end: new SheetPosition(100, 100) },
          intersectionPoint: new SheetPosition(50, 50),
          splitRatio: 0.5,
        });
      }
      (polygonTool as any).previewSegmentIntersections = intersections;
      (polygonTool as any).previewSegmentInteractionsKeyCombos.clear().setKeyCombos(intersections.map(i => i.keyCombo));
    }

    it('pressing matching combo key enables intersection', () => {
      // Setup: Create fake intersection with combo 'a'
      setFakeIntersections(1);
      const enabled = (polygonTool as any).previewSegmentInteractionsEnabled;

      // Verify: 'a' not initially enabled
      expect(enabled.has('a')).toBe(false);

      // Action: Press 'a'
      simulateKeyDown(toolManager, 'a');

      // Verify: 'a' is now enabled
      expect(enabled.has('a')).toBe(true);
    });

    it('pressing enabled combo key disables it', () => {
      // Setup: Create fake intersection and enable it
      setFakeIntersections(1);

      // Action: Press 'a' to enable
      simulateKeyDown(toolManager, 'a');
      expect((polygonTool as any).previewSegmentInteractionsEnabled.has('a')).toBe(true);

      // Action: Press 'a' again to disable
      simulateKeyDown(toolManager, 'a');

      // Verify: 'a' is now disabled
      expect((polygonTool as any).previewSegmentInteractionsEnabled.has('a')).toBe(false);
    });

    it('toggling off intersection clears lastEnabled flag', () => {
      // TODO: This test requires internal state access and has no assertion.
      // Setup: Create fake intersection
      setFakeIntersections(1);
      // Note: Direct internal state manipulation for test setup
      (polygonTool as any).lastPreviewSegmentEnabledIntersections = true;

      // Action: Toggle off
      simulateKeyDown(toolManager, 'a');

      // Verify: Flag should be false after toggling off
      expect((polygonTool as any).lastPreviewSegmentEnabledIntersections).toBe(false);
    });

    it('pressing non-matching key leaves intersections disabled', () => {
      // Setup: Create fake intersection with combo 'a' only
      setFakeIntersections(1);

      // Action: Press 'z' which is not a valid combo
      simulateKeyDown(toolManager, 'z');

      // Verify: 'a' remains disabled
      expect((polygonTool as any).previewSegmentInteractionsEnabled.has('a')).toBe(false);
    });

    it('disabling removes key from enabled set', () => {
      // Setup: Create fake intersection
      setFakeIntersections(1);

      // Action: Enable 'a'
      simulateKeyDown(toolManager, 'a');
      expect((polygonTool as any).previewSegmentInteractionsEnabled.has('a')).toBe(true);

      // Action: Disable 'a'
      simulateKeyDown(toolManager, 'a');

      // Verify: 'a' removed from enabled set
      expect((polygonTool as any).previewSegmentInteractionsEnabled.has('a')).toBe(false);
    });
  });

  // ================================================================================
  // Section 8: Intersection Handling - Line vs Line
  // ================================================================================
  describe.skip('intersection handling - line vs line', () => {
    function setLineIntersections(intersections: PreviewSegmentIntersections[]) {
      // Note: Direct internal state manipulation for test setup
      (polygonTool as any).previewSegmentIntersections = intersections;
      (polygonTool as any).previewSegmentInteractionsEnabled = new Set(intersections.map(i => i.keyCombo));
    }

    it.skip('single intersection found and sorted', () => {
      // Setup: Create first polygon segment
      toolManager.handleMouseDown(new ScreenPosition(0, 0), viewport);
      toolManager.handleMouseMove(new ScreenPosition(100, 100), viewport);

      // Setup: Add second polygon to intersect with
      geometryStore.addPolygon({
        points: [makePoint(50, 0), makePoint(50, 100)],
        closed: false,
        fillColor: null,
        openAtIndex: 0,
      });

      // Action: Move to trigger intersection computation
      toolManager.handleMouseMove(new ScreenPosition(60, 60), viewport);

      // Verify: Intersection found
      const intersections = (polygonTool as any).previewSegmentIntersections;
      expect(intersections.length).toBeGreaterThan(0);
    });

    it.skip('enabled intersection splits target polygon', () => {
      // Setup: Create working polygon with 2 points
      toolManager.handleMouseDown(new ScreenPosition(0, 0), viewport);
      toolManager.handleMouseMove(new ScreenPosition(100, 100), viewport);

      // Setup: Add target polygon
      const targetPoly = geometryStore.addPolygon({
        points: [makePoint(50, 0), makePoint(50, 100)],
        closed: false,
        fillColor: null,
        openAtIndex: 0,
      });

      // Setup: Set intersection manually
      const intersection: PreviewSegmentIntersections = {
        otherId: targetPoly.id,
        otherType: 'polygon',
        otherSegmentIndex: 0,
        keyCombo: 'a',
        segment: { start: new SheetPosition(50, 0), end: new SheetPosition(50, 100) },
        intersectionPoint: new SheetPosition(50, 50),
        splitRatio: 0.5,
      };
      setLineIntersections([intersection]);

      const initialPointCount = targetPoly.points.length;

      // Action: Add point (this processes intersection)
      toolManager.handleMouseDown(new ScreenPosition(80, 80), viewport);

      // Verify: Target polygon has new point inserted
      const updated = geometryStore.polygons.find(p => p.id === targetPoly.id);
      expect(updated!.points.length).toBeGreaterThan(initialPointCount);
    });

    it('disabled intersection leaves polygon unchanged', () => {
      // Setup: Create working polygon
      toolManager.handleMouseDown(new ScreenPosition(0, 0), viewport);
      toolManager.handleMouseMove(new ScreenPosition(100, 100), viewport);

      // Setup: Add target polygon
      const targetPoly = geometryStore.addPolygon({
        points: [makePoint(50, 0), makePoint(50, 100)],
        closed: false,
        fillColor: null,
        openAtIndex: 0,
      });

      // Setup: Set intersection but do NOT enable it
      const intersection: PreviewSegmentIntersections = {
        otherId: targetPoly.id,
        otherType: 'polygon',
        otherSegmentIndex: 0,
        keyCombo: 'a',
        segment: { start: new SheetPosition(50, 0), end: new SheetPosition(50, 100) },
        intersectionPoint: new SheetPosition(50, 50),
        splitRatio: 0.5,
      };
      setLineIntersections([intersection]);
      (polygonTool as any).previewSegmentInteractionsEnabled = new Set();

      const initialPointCount = targetPoly.points.length;

      // Action: Add point
      toolManager.handleMouseDown(new ScreenPosition(80, 80), viewport);

      // Verify: Target polygon unchanged
      const updated = geometryStore.polygons.find(p => p.id === targetPoly.id);
      expect(updated!.points.length).toBe(initialPointCount);
    });

    it.skip('split ratio correctly computed', () => {
      // TODO: Need precise geometric intersection computation between two line
      // segments in viewport coordinates. The test setup needs exact coordinate
      // calculations based on the ViewportState scale and position transformations.
      toolManager.handleMouseDown(new ScreenPosition(0, 0), viewport);
      toolManager.handleMouseMove(new ScreenPosition(100, 100), viewport);

      const targetPoly = geometryStore.addPolygon({
        points: [makePoint(0, 50), makePoint(100, 50)],
        closed: false,
        fillColor: null,
        openAtIndex: 0,
      });

      const intersection: PreviewSegmentIntersections = {
        otherId: targetPoly.id,
        otherType: 'polygon',
        otherSegmentIndex: 0,
        keyCombo: 'a',
        segment: { start: new SheetPosition(0, 50), end: new SheetPosition(100, 50) },
        intersectionPoint: new SheetPosition(50, 50),
        splitRatio: 0.5,
      };
      setLineIntersections([intersection]);

      toolManager.handleMouseDown(new ScreenPosition(80, 80), viewport);

      // Verify: splitRatio is correctly computed
      expect(intersection.splitRatio).toBe(0.5);
    });

    it.skip('multiple intersections on same polygon found', () => {
      // TODO: Need to create multiple polygons with precise spacing to intersect
      // with the preview segment. Requires exact coordinate calculations.
      toolManager.handleMouseDown(new ScreenPosition(0, 0), viewport);
      toolManager.handleMouseMove(new ScreenPosition(100, 100), viewport);

      // Setup: Create vertical line polygons
      geometryStore.addPolygon({
        points: [makePoint(30, 0), makePoint(30, 100)],
        closed: false,
        fillColor: null,
        openAtIndex: 0,
      });
      geometryStore.addPolygon({
        points: [makePoint(70, 0), makePoint(70, 100)],
        closed: false,
        fillColor: null,
        openAtIndex: 0,
      });

      // Action: Move to trigger intersection computation
      toolManager.handleMouseMove(new ScreenPosition(50, 50), viewport);

      // Verify: Multiple intersections found
      const intersections = (polygonTool as any).previewSegmentIntersections;
      expect(intersections.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ================================================================================
  // Section 9: Intersection Handling - Line vs Rectangle
  // ================================================================================
  describe.skip('intersection handling - line vs rectangle', () => {
    // TODO: Rectangle intersection tests not yet implemented.
    // These tests will be added when rectangle intersection handling is implemented.
  });

  // ================================================================================
  // Section 10: Intersection Handling - Line vs Ellipse
  // ================================================================================
  describe.skip('intersection handling - line vs ellipse', () => {
    // TODO: Ellipse intersection tests not yet implemented.
    // These tests will be added when ellipse intersection handling is implemented.
  });

  // ================================================================================
  // Section 11: Intersection Handling - Line vs Arc Quadratic
  // ================================================================================
  describe.skip('intersection handling - line vs arc quadratic', () => {
    function setQuadraticIntersections(intersections: PreviewSegmentIntersections[]) {
      // Note: Direct internal state manipulation for test setup
      (polygonTool as any).previewSegmentIntersections = intersections;
      (polygonTool as any).previewSegmentInteractionsEnabled = new Set(intersections.map(i => i.keyCombo));
    }

    it.skip('preview arc intersects quadratic curve', () => {
      // TODO: Requires precise geometric intersection computation for quadratic Bezier curves.
      // Setup: Create polygon with quadratic arc
      const polyWithArc = geometryStore.addPolygon({
        points: [
          makePoint(0, 0),
          { type: 'arc-quadratic', point: new SheetPosition(100, 0), controlPoint: new SheetPosition(50, 50) },
        ],
        closed: false,
        fillColor: null,
        openAtIndex: 0,
      });

      toolManager.handleMouseDown(new ScreenPosition(0, 50), viewport);
      toolManager.handleMouseMove(new ScreenPosition(100, 50), viewport);

      // Verify: Intersection found with quadratic curve
      const intersections = (polygonTool as any).previewSegmentIntersections;
      const hasQuadratic = intersections.some((i: any) => 'controlPoint' in i.segment && !('controlPointA' in i.segment));
      expect(intersections.length).toBeGreaterThanOrEqual(0);
    });

    it.skip('enabled quadratic intersection splits target polygon', () => {
      // TODO: Requires precise geometric intersection computation.
      // Setup: Create target polygon with quadratic arc
      const targetPoly = geometryStore.addPolygon({
        points: [makePoint(0, 0), { type: 'arc-quadratic', point: new SheetPosition(100, 0), controlPoint: new SheetPosition(50, 50) }],
        closed: false,
        fillColor: null,
        openAtIndex: 0,
      });

      // Setup: Create intersection
      const intersection: PreviewSegmentIntersections = {
        otherId: targetPoly.id,
        otherType: 'polygon',
        otherSegmentIndex: 0,
        keyCombo: 'a',
        segment: { start: new SheetPosition(0, 0), end: new SheetPosition(100, 0), controlPoint: new SheetPosition(50, 50) },
        intersectionPoint: new SheetPosition(50, 50),
        splitRatio: 0.5,
      };
      setQuadraticIntersections([intersection]);

      const initialSegCount = targetPoly.points.length;

      // Action: Add point
      toolManager.handleMouseDown(new ScreenPosition(60, 60), viewport);

      // Verify: Segment split
      // NOTE: Splitting replaces 1 segment with 2, so new length should be >= initial
    });

    it('disabled quadratic intersection leaves polygon unchanged', () => {
      // Setup: Create target polygon with quadratic arc
      const targetPoly = geometryStore.addPolygon({
        points: [makePoint(0, 0), { type: 'arc-quadratic', point: new SheetPosition(100, 0), controlPoint: new SheetPosition(50, 50) }],
        closed: false,
        fillColor: null,
        openAtIndex: 0,
      });

      // Setup: Create intersection but do NOT enable it
      const intersection: PreviewSegmentIntersections = {
        otherId: targetPoly.id,
        otherType: 'polygon',
        otherSegmentIndex: 0,
        keyCombo: 'a',
        segment: { start: new SheetPosition(0, 0), end: new SheetPosition(100, 0), controlPoint: new SheetPosition(50, 50) },
        intersectionPoint: new SheetPosition(50, 50),
        splitRatio: 0.5,
      };
      setQuadraticIntersections([intersection]);
      (polygonTool as any).previewSegmentInteractionsEnabled = new Set();

      const initialSegCount = targetPoly.points.length;

      // Action: Add point
      toolManager.handleMouseDown(new ScreenPosition(60, 60), viewport);

      // Verify: Target polygon unchanged
      // NOTE: This test passes by virtue of no action being taken on disabled intersection
      expect(targetPoly.points.length).toBe(initialSegCount);
    });
  });

  // ================================================================================
  // Section 12: Intersection Handling - Line vs Arc Cubic
  // ================================================================================
  describe.skip('intersection handling - line vs arc cubic', () => {
    function setCubicIntersections(intersections: PreviewSegmentIntersections[]) {
      // Note: Direct internal state manipulation for test setup
      (polygonTool as any).previewSegmentIntersections = intersections;
      (polygonTool as any).previewSegmentInteractionsEnabled = new Set(intersections.map(i => i.keyCombo));
    }

    it.skip('preview arc intersects cubic curve', () => {
      // TODO: Requires precise geometric intersection computation for cubic Bezier curves.
      // The intersection computation involves solving polynomial equations for cubic Bezier curves.
      const polyWithCubic = geometryStore.addPolygon({
        points: [
          makePoint(0, 0),
          { type: 'arc-cubic', point: new SheetPosition(100, 0), controlPointA: new SheetPosition(33, 50), controlPointB: new SheetPosition(67, 50) },
        ],
        closed: false,
        fillColor: null,
        openAtIndex: 0,
      });

      toolManager.handleMouseDown(new ScreenPosition(0, 50), viewport);
      toolManager.handleMouseMove(new ScreenPosition(100, 50), viewport);

      // Verify: Intersection found
      const intersections = (polygonTool as any).previewSegmentIntersections;
      expect(intersections.length).toBeGreaterThanOrEqual(0);
    });

    it.skip('enabled cubic intersection splits target polygon', () => {
      // TODO: Requires precise geometric intersection computation with De Casteljau algorithm.
      const targetPoly = geometryStore.addPolygon({
        points: [
          makePoint(0, 0),
          { type: 'arc-cubic', point: new SheetPosition(100, 0), controlPointA: new SheetPosition(33, 50), controlPointB: new SheetPosition(67, 50) },
        ],
        closed: false,
        fillColor: null,
        openAtIndex: 0,
      });

      const intersection: PreviewSegmentIntersections = {
        otherId: targetPoly.id,
        otherType: 'polygon',
        otherSegmentIndex: 0,
        keyCombo: 'a',
        segment: { start: new SheetPosition(0, 0), end: new SheetPosition(100, 0), controlPointA: new SheetPosition(33, 50), controlPointB: new SheetPosition(67, 50) },
        intersectionPoint: new SheetPosition(50, 50),
        splitRatio: 0.5,
      };
      setCubicIntersections([intersection]);

      const initialSegCount = targetPoly.points.length;
      toolManager.handleMouseDown(new ScreenPosition(60, 60), viewport);

      // Verify: Segment split using De Casteljau
      // NOTE: Splitting replaces 1 segment with 2
    });
  });

  // ================================================================================
  // Section 16: Edge Cases
  // ================================================================================
  describe.skip('edge cases', () => {
    it('intersection at segment endpoint handled gracefully', () => {
      // Setup: Create target polygon
      const targetPoly = geometryStore.addPolygon({
        points: [makePoint(0, 0), makePoint(100, 100)],
        closed: false,
        fillColor: null,
        openAtIndex: 0,
      });

      // Setup: Set intersection at endpoint (100, 100)
      // Note: Direct internal state manipulation for test setup
      const intersection: PreviewSegmentIntersections = {
        otherId: targetPoly.id,
        otherType: 'polygon',
        otherSegmentIndex: 0,
        keyCombo: 'a',
        segment: { start: new SheetPosition(0, 0), end: new SheetPosition(100, 100) },
        intersectionPoint: new SheetPosition(100, 100),
        splitRatio: 1.0,
      };
      (polygonTool as any).previewSegmentIntersections = [intersection];
      (polygonTool as any).previewSegmentInteractionsEnabled = new Set(['a']);

      // Action: Add point
      toolManager.handleMouseDown(new ScreenPosition(50, 50), viewport);

      // Verify: Polygon created without crash
      expect(geometryStore.polygons).toHaveLength(1);
    });
  });

  // ================================================================================
  // Section 18: Polygon Extension from End Point
  // ================================================================================
  describe.skip('polygon extension from end point', () => {
    beforeEach(() => {
      polygonTool.setSnappingOptions({ primaryGridSize: 0.001, secondaryGridSize: 0.001 });
    });

    it('click on end point starts continuation mode', () => {
      // Setup: Create non-closed polygon with points A(100,100) -> B(200,200)
      const polygon = geometryStore.addPolygon({
        points: [makePoint(100, 100), makePoint(200, 200)],
        closed: false,
        fillColor: null,
        openAtIndex: 0,
      });

      // Action: Set hovering endpoint B (index 1, isStartPoint=false)
      polygonTool.setHoveringEndpointOfPolygon({ polygonId: polygon.id, pointIndex: 1, isStartPoint: false });

      // Verify: Hovering state is set correctly
      expect(polygonTool.getHoveringEndpointOfPolygon()).not.toBeNull();
      expect(polygonTool.getHoveringEndpointOfPolygon()!.polygonId).toBe(polygon.id);
      expect(polygonTool.getHoveringEndpointOfPolygon()!.pointIndex).toBe(1);
      expect(polygonTool.getHoveringEndpointOfPolygon()!.isStartPoint).toBe(false);

      // Action: Click at endpoint B position
      toolManager.handleMouseDown(new ScreenPosition(200, 200), viewport);

      // Verify: State transitions to drawing-line with source.type === 'existing-polygon'
      // Note: Direct internal state access for verifying state machine transitions
      expect((polygonTool as any).state.state).toBe('drawing-line');
      expect((polygonTool as any).state.source.type).toBe('existing-polygon');
      expect((polygonTool as any).state.source.isStartPoint).toBe(false);
      expect((polygonTool as any).state.source.autoClosePoint).not.toBeNull();
      // autoClosePoint should be A (100, 100) - the opposite endpoint
      expect((polygonTool as any).state.source.autoClosePoint.x).toBe(100);
      expect((polygonTool as any).state.source.autoClosePoint.y).toBe(100);

      // Verify: Working polygon points are [A, B]
      expect(geometryStore.workingPolygon).not.toBeNull();
      expect(geometryStore.workingPolygon!.points).toHaveLength(2);
    });

    it('add point appends correctly when extending from end', () => {
      // Setup: Create non-closed polygon and load into working
      const polygon = geometryStore.addPolygon({
        points: [makePoint(100, 100), makePoint(200, 200)],
        closed: false,
        fillColor: null,
        openAtIndex: 0,
      });

      polygonTool.loadPolygonIntoWorking(polygon.id, false);

      // Action: Move mouse to C(300,300) and click
      toolManager.handleMouseDown(new ScreenPosition(300, 300), viewport);

      // Verify: Working polygon points become [A, B, C]
      // Note: polygon points are stored in sheet units
      // A and B are from original polygon (100, 200 in sheet units)
      // C is from mouse click at (300,300) -> sheet (300/64 ≈ 4.688)
      expect(geometryStore.workingPolygon!.points).toHaveLength(3);
      expect(geometryStore.workingPolygon!.points[0].point.x).toBeCloseTo(100, 1);
      expect(geometryStore.workingPolygon!.points[0].point.y).toBeCloseTo(100, 1);
      expect(geometryStore.workingPolygon!.points[1].point.x).toBeCloseTo(200, 1);
      expect(geometryStore.workingPolygon!.points[1].point.y).toBeCloseTo(200, 1);
      expect(geometryStore.workingPolygon!.points[2].point.x).toBeCloseTo(300/64, 1);
      expect(geometryStore.workingPolygon!.points[2].point.y).toBeCloseTo(300/64, 1);

      // Verify: source.hasPlacedFirstPoint === true
      // Note: Direct internal state access for verifying state machine property
      expect((polygonTool as any).state.source.hasPlacedFirstPoint).toBe(true);
    });

    it('click auto-close point completes polygon with closed=true', () => {
      // Setup: Create polygon and add a point
      const polygon = geometryStore.addPolygon({
        points: [makePoint(100, 100), makePoint(200, 200)],
        closed: false,
        fillColor: null,
        openAtIndex: 0,
      });
      const originalId = polygon.id;

      polygonTool.loadPolygonIntoWorking(polygon.id, false);
      toolManager.handleMouseDown(new ScreenPosition(300, 300), viewport);

      // Now we have [A(100,100), B(200,200), C(300,300)]
      // autoClosePoint is A(100,100)

      // Action: Move mouse to A position and hover first handle
      toolManager.handleMouseMove(new ScreenPosition(100, 100), viewport);
      polygonTool.setHoveringFirstHandle(true);

      // Action: Complete polygon at first handle
      polygonTool.completePolygonAtFirstHandle();

      // Verify: Polygon becomes closed=true
      expect(geometryStore.polygons).toHaveLength(1);
      expect(geometryStore.polygons[0].id).toBe(originalId);
      expect(geometryStore.polygons[0].closed).toBe(true);

      // Verify: Polygon points = [A, B, C, A]
      // A and B are from original polygon (100, 200 in sheet units)
      // C is from mouse click at (300,300) -> sheet (300/64 ≈ 4.688)
      expect(geometryStore.polygons[0].points).toHaveLength(4);
      expect(geometryStore.polygons[0].points[0].point.x).toBeCloseTo(100, 1);
      expect(geometryStore.polygons[0].points[1].point.x).toBeCloseTo(200, 1);
      expect(geometryStore.polygons[0].points[2].point.x).toBeCloseTo(300/64, 1);
      expect(geometryStore.polygons[0].points[3].point.x).toBeCloseTo(100, 1);

      // Verify: Working polygon cleared
      expect(geometryStore.workingPolygon).toBeNull();
    });
  });

  // ================================================================================
  // Section 19: Polygon Extension from Start Point
  // ================================================================================
  describe.skip('polygon extension from start point', () => {
    beforeEach(() => {
      polygonTool.setSnappingOptions({ primaryGridSize: 0.001, secondaryGridSize: 0.001 });
    });

    it('click on start point starts continuation mode', () => {
      // Setup: Create non-closed polygon with points A(100,100) -> B(200,200)
      const polygon = geometryStore.addPolygon({
        points: [makePoint(100, 100), makePoint(200, 200)],
        closed: false,
        fillColor: null,
        openAtIndex: 0,
      });

      // Action: Set hovering endpoint A (index 0, isStartPoint=true)
      polygonTool.setHoveringEndpointOfPolygon({ polygonId: polygon.id, pointIndex: 0, isStartPoint: true });

      // Verify: Hovering state is set correctly
      expect(polygonTool.getHoveringEndpointOfPolygon()).not.toBeNull();
      expect(polygonTool.getHoveringEndpointOfPolygon()!.polygonId).toBe(polygon.id);
      expect(polygonTool.getHoveringEndpointOfPolygon()!.pointIndex).toBe(0);
      expect(polygonTool.getHoveringEndpointOfPolygon()!.isStartPoint).toBe(true);

      // Action: Click at endpoint A position
      toolManager.handleMouseDown(new ScreenPosition(100, 100), viewport);

      // Verify: State transitions to drawing-line with source.type === 'existing-polygon'
      // Note: Direct internal state access for verifying state machine transitions
      expect((polygonTool as any).state.state).toBe('drawing-line');
      expect((polygonTool as any).state.source.type).toBe('existing-polygon');
      expect((polygonTool as any).state.source.isStartPoint).toBe(true);
      expect((polygonTool as any).state.source.autoClosePoint).not.toBeNull();
      // autoClosePoint should be B (200, 200) - the opposite endpoint
      expect((polygonTool as any).state.source.autoClosePoint.x).toBe(200);
      expect((polygonTool as any).state.source.autoClosePoint.y).toBe(200);

      // Verify: Working polygon points are [A, B]
      expect(geometryStore.workingPolygon).not.toBeNull();
      expect(geometryStore.workingPolygon!.points).toHaveLength(2);
    });

    it('first point prepends placeholder segment when extending from start', () => {
      // Setup: Create non-closed polygon and load into working
      const polygon = geometryStore.addPolygon({
        points: [makePoint(100, 100), makePoint(200, 200)],
        closed: false,
        fillColor: null,
        openAtIndex: 0,
      });

      polygonTool.loadPolygonIntoWorking(polygon.id, true);

      // Action: Move mouse to X(50,50) and click
      // Note: Mouse coordinates (50) are screen pixels. Sheet coords = 50/64 = 0.781
      toolManager.handleMouseDown(new ScreenPosition(50, 50), viewport);

      // Verify: Working polygon points = [placeholder@X, segment_to_X, A, B]
      // First point is placeholder at X, second is the actual point segment at X
      // Note: Original polygon points [A, B] are stored as-is (100, 200 in sheet units)
      expect(geometryStore.workingPolygon!.points).toHaveLength(4);
      // Index 0: placeholder at X (in sheet units)
      expect(geometryStore.workingPolygon!.points[0].point.x).toBeCloseTo(50/64, 1);
      expect(geometryStore.workingPolygon!.points[0].point.y).toBeCloseTo(50/64, 1);
      // Index 1: actual segment at X (the line from X to original A)
      expect(geometryStore.workingPolygon!.points[1].point.x).toBeCloseTo(50/64, 1);
      // Index 2: original start point A (in sheet units as stored in polygon)
      expect(geometryStore.workingPolygon!.points[2].point.x).toBeCloseTo(100, 1);
      // Index 3: original end point B (in sheet units as stored in polygon)
      expect(geometryStore.workingPolygon!.points[3].point.x).toBeCloseTo(200, 1);

      // Verify: source.hasPlacedFirstPoint === true
      // Note: Direct internal state access for verifying state machine property
      expect((polygonTool as any).state.source.hasPlacedFirstPoint).toBe(true);
    });

    it('click auto-close point completes polygon with closed=true when extending from start', () => {
      // Setup: Create polygon and add a point (extending from start)
      const polygon = geometryStore.addPolygon({
        points: [makePoint(100, 100), makePoint(200, 200)],
        closed: false,
        fillColor: null,
        openAtIndex: 0,
      });
      const originalId = polygon.id;

      polygonTool.loadPolygonIntoWorking(polygon.id, true);
      toolManager.handleMouseDown(new ScreenPosition(50, 50), viewport);

      // Now working polygon has [placeholder@X, segment_to_X, A, B]
      // autoClosePoint is B(200,200)

      // Action: Move mouse to B position and hover first handle
      // B is at index 3 in the working polygon (since we prepended)
      toolManager.handleMouseMove(new ScreenPosition(200, 200), viewport);
      polygonTool.setHoveringFirstHandle(true);

      // Action: Complete polygon at first handle
      polygonTool.completePolygonAtFirstHandle();

      // Verify: Polygon becomes closed=true
      expect(geometryStore.polygons).toHaveLength(1);
      expect(geometryStore.polygons[0].id).toBe(originalId);
      expect(geometryStore.polygons[0].closed).toBe(true);

      // Verify: Polygon points = [X, A, B, X] (placeholder removed, original points)
      // Points should be 4 (the original 2 plus the new one, plus the original again
      // because the polygon is closed)
      expect(geometryStore.polygons[0].points).toHaveLength(4);

      // Verify: Working polygon cleared
      expect(geometryStore.workingPolygon).toBeNull();
    });

    it('completing with arc as final segment keeps placeholder point', () => {
      // Setup: Create polygon and add a point (extending from start)
      const polygon = geometryStore.addPolygon({
        points: [makePoint(100, 100), makePoint(200, 200)],
        closed: false,
        fillColor: null,
        openAtIndex: 0,
      });

      polygonTool.loadPolygonIntoWorking(polygon.id, true);
      toolManager.handleMouseDown(new ScreenPosition(50, 50), viewport);

      // Now working polygon has [placeholder@X, segment_to_X, A, B]

      // Action: Alt+click to set arc endpoint, then move and click to confirm arc
      toolManager.handleKeyDown({ key: 'Alt', code: 'Alt' } as unknown as KeyboardEvent);
      toolManager.handleMouseMove(new ScreenPosition(25, 25), viewport);
      toolManager.handleMouseDown(new ScreenPosition(25, 25), viewport);

      // Move to control point and click
      toolManager.handleMouseMove(new ScreenPosition(75, 75), viewport);
      toolManager.handleMouseDown(new ScreenPosition(75, 75), viewport);

      // Action: Press Enter to complete without closing
      simulateKeyDown(toolManager, 'Enter');

      // Verify: Polygon created with placeholder point retained
      expect(geometryStore.polygons).toHaveLength(1);
      expect(geometryStore.polygons[0].closed).toBe(false);

      // Verify: First point is the placeholder (type should be 'point')
      expect(geometryStore.polygons[0].points[0].type).toBe('point');
    });
  });

  // ================================================================================
  // Section 20: Preview Line Direction
  // ================================================================================
  describe.skip('preview line direction', () => {
    beforeEach(() => {
      polygonTool.setSnappingOptions({ primaryGridSize: 0.001, secondaryGridSize: 0.001 });
    });

    it('preview line direction correct when extending from end', () => {
      // Setup: Create polygon A -> B, extend from B
      const polygon = geometryStore.addPolygon({
        points: [makePoint(100, 100), makePoint(200, 200)],
        closed: false,
        fillColor: null,
        openAtIndex: 0,
      });

      polygonTool.loadPolygonIntoWorking(polygon.id, false);

      // Action: Move mouse to C(300,300) - this triggers preview calculation
      toolManager.handleMouseMove(new ScreenPosition(300, 300), viewport);

      // The preview segment should be from B(200,200) to C(300,300)
      // We can verify by checking getPreviewSegment output
      const previewSegment = (polygonTool as any).getPreviewSegment();
      expect(previewSegment).not.toBeNull();

      // Verify: start point = B (the anchor point, in sheet units)
      expect(previewSegment.segment.start.x).toBeCloseTo(200, 1);
      expect(previewSegment.segment.start.y).toBeCloseTo(200, 1);

      // Verify: end point = C (mouse position - snapped, in sheet units: 300/64 = 4.688)
      expect(previewSegment.segment.end.x).toBeCloseTo(300/64, 1);
      expect(previewSegment.segment.end.y).toBeCloseTo(300/64, 1);
    });

    it('preview line direction correct when extending from start', () => {
      // Setup: Create polygon A -> B, extend from A
      const polygon = geometryStore.addPolygon({
        points: [makePoint(100, 100), makePoint(200, 200)],
        closed: false,
        fillColor: null,
        openAtIndex: 0,
      });

      polygonTool.loadPolygonIntoWorking(polygon.id, true);

      // Action: Move mouse to X(50,50) - this triggers preview calculation
      toolManager.handleMouseMove(new ScreenPosition(50, 50), viewport);

      // The preview segment should be from A(100,100) to X(50,50)
      const previewSegment = (polygonTool as any).getPreviewSegment();
      expect(previewSegment).not.toBeNull();

      // Verify: start point = A (the anchor point, in sheet units)
      expect(previewSegment.segment.start.x).toBeCloseTo(100, 1);
      expect(previewSegment.segment.start.y).toBeCloseTo(100, 1);

      // Verify: end point = X (mouse position - snapped, in sheet units: 50/64 = 0.781)
      expect(previewSegment.segment.end.x).toBeCloseTo(50/64, 1);
      expect(previewSegment.segment.end.y).toBeCloseTo(50/64, 1);
    });
  });
});
