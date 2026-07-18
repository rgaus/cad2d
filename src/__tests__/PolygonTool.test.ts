import { ActionsManager } from '@/lib/actions/ActionsManager';
import {
  ConstraintComponent,
  ConstraintEndpoint,
  FillColorComponent,
  GeometryComponent,
  LinearConstraint,
  type PointSegment,
  Polygon,
  PolygonComponent,
  type PolygonSegment,
} from '@/lib/entity';
import { ID_PREFIXES } from '@/lib/entity/GeometryStore';
import { GeometryStore } from '@/lib/entity/GeometryStore';
import { DEFAULT_COLOR } from '@/lib/entity/colors';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { SerializationManager } from '@/lib/serialization/SerializationManager';
import { Sheet } from '@/lib/sheet/Sheet';
import { SHEET_UNITS_TO_PIXELS } from '@/lib/sheet/Sheet';
import { subscribeToEvents } from '@/lib/subscribe-to-events';
import { PolygonTool } from '@/lib/tools/PolygonTool';
import { SelectionManager } from '@/lib/tools/SelectionManager';
import { ToolManager } from '@/lib/tools/ToolManager';
import { WorkingLinearConstraint } from '@/lib/tools/types';
import { Length, MillimetersType } from '@/lib/units/length';
import {
  ScreenPosition,
  SheetPosition,
  ViewportPosition,
  type ViewportState,
} from '@/lib/viewport/types';

function makePoint(x: number, y: number): PointSegment {
  return { type: 'point', point: new SheetPosition(x, y) };
}

function createViewportState(scale: number = 1): ViewportState {
  return {
    position: new ViewportPosition(0, 0),
    scale,
  };
}

describe('PolygonTool', () => {
  let sheet: Sheet;
  let historyManager: HistoryManager;
  let geometryStore: GeometryStore;
  let toolManager: ToolManager;
  let selectionManager: SelectionManager;
  let actionManager: ActionsManager;
  let serializationManager: SerializationManager;
  let polygonTool: PolygonTool;
  let viewport: ViewportState;

  beforeEach(() => {
    sheet = Sheet.a4();
    historyManager = new HistoryManager();
    geometryStore = new GeometryStore(historyManager);
    historyManager.setGeometryStore(geometryStore);
    selectionManager = new SelectionManager();
    actionManager = new ActionsManager(sheet, geometryStore, selectionManager, historyManager);
    serializationManager = new SerializationManager(actionManager, toolManager, sheet);
    toolManager = new ToolManager(geometryStore, selectionManager, historyManager);
    toolManager.setSerializationManager(serializationManager);
    actionManager.setSerializationManager(serializationManager);
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
      expect(geometryStore.workingPolygon!.points).toHaveLength(
        2 /* 1 point + 1 preview segment */,
      );

      // The first click should also create a single working constraint without constrainedLength set
      expect(geometryStore.workingConstraints).toHaveLength(1);
      expect(geometryStore.workingConstraints[0].type).toStrictEqual('linear');
      expect(
        (geometryStore.workingConstraints[0] as WorkingLinearConstraint).constrainedLength,
      ).toBeNull();

      // Thie working constraint should start and end both at the mouse position
      expect(geometryStore.workingConstraints[0].pointA?.type).toStrictEqual('point');
      expect((geometryStore.workingConstraints[0].pointA as any).point.x).toBeCloseTo(
        10 / SHEET_UNITS_TO_PIXELS,
        2,
      );
      expect((geometryStore.workingConstraints[0].pointA as any).point.y).toBeCloseTo(
        10 / SHEET_UNITS_TO_PIXELS,
        2,
      );
      expect(geometryStore.workingConstraints[0].pointB?.type).toStrictEqual('point');
      expect((geometryStore.workingConstraints[0].pointB as any).point.x).toBeCloseTo(
        10 / SHEET_UNITS_TO_PIXELS,
        2,
      );
      expect((geometryStore.workingConstraints[0].pointB as any).point.y).toBeCloseTo(
        10 / SHEET_UNITS_TO_PIXELS,
        2,
      );
    });

    it('subsequent clicks add points', () => {
      // Create first point
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      expect(geometryStore.workingPolygon!.points).toHaveLength(2);

      // Add second point
      toolManager.handleMouseDown(new ScreenPosition(20, 10), viewport);
      expect(geometryStore.workingPolygon!.points).toHaveLength(3);

      // Ensure the working constraint is now second point -> mouse position
      expect(geometryStore.workingConstraints).toHaveLength(1);
      expect(geometryStore.workingConstraints[0].type).toStrictEqual('linear');
      expect(
        (geometryStore.workingConstraints[0] as WorkingLinearConstraint).constrainedLength,
      ).toBeNull();
      expect(geometryStore.workingConstraints[0].pointA?.type).toStrictEqual('point');
      expect((geometryStore.workingConstraints[0].pointA as any).point.x).toBeCloseTo(
        20 / SHEET_UNITS_TO_PIXELS,
        2,
      );
      expect((geometryStore.workingConstraints[0].pointA as any).point.y).toBeCloseTo(
        10 / SHEET_UNITS_TO_PIXELS,
        2,
      );
      expect(geometryStore.workingConstraints[0].pointB?.type).toStrictEqual('point');
      expect((geometryStore.workingConstraints[0].pointB as any).point.x).toBeCloseTo(
        20 / SHEET_UNITS_TO_PIXELS,
        2,
      );
      expect((geometryStore.workingConstraints[0].pointB as any).point.y).toBeCloseTo(
        10 / SHEET_UNITS_TO_PIXELS,
        2,
      );
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
      expect(geometryStore.listWithComponent(PolygonComponent)).toHaveLength(1);
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).closed,
      ).toBe(true);
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points,
      ).toHaveLength(4);

      // Make sure no working constraints are active
      expect(geometryStore.workingConstraints).toHaveLength(0);
    });

    it('clicking first handle with alt held starts arc close', () => {
      // Create 3 points
      toolManager.handleMouseDown(new ScreenPosition(100, 100), viewport);
      toolManager.handleMouseDown(new ScreenPosition(200, 200), viewport);
      toolManager.handleMouseDown(new ScreenPosition(100, 200), viewport);

      // Make sure one working constraint is visible (from [100, 200] -> mouse position)
      expect(geometryStore.workingConstraints).toHaveLength(1);

      // Set hovering first handle then click with alt pressed
      polygonTool.setHoveringFirstHandle(true);
      toolManager.handleKeyDown({ key: 'Alt', altKey: true } as KeyboardEvent);
      toolManager.handleMouseDown(new ScreenPosition(100, 100), viewport);
      toolManager.handleKeyDown({ key: 'Alt', altKey: false } as KeyboardEvent);

      // Make sure working constraints was cleared, constraints should not be visible when arc
      // drawing
      expect(geometryStore.workingConstraints).toHaveLength(0);

      // Click to place the quadratic arc control point in another place
      toolManager.handleMouseDown(new ScreenPosition(50, 50), viewport);

      // Polygon should be closed
      expect(geometryStore.listWithComponent(PolygonComponent)).toHaveLength(1);
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).closed,
      ).toBe(true);
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points,
      ).toHaveLength(4);

      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[0].type,
      ).toStrictEqual('point');
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[1].type,
      ).toStrictEqual('point');
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[2].type,
      ).toStrictEqual('point');
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[3].type,
      ).toStrictEqual('arc-quadratic');

      // Make sure STILL no working cosntraints are shown
      expect(geometryStore.workingConstraints).toHaveLength(0);
    });

    it('enter key completes open polygon', () => {
      // Create 2 points
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      toolManager.handleMouseDown(new ScreenPosition(20, 20), viewport);
      expect(geometryStore.workingPolygon).not.toBeNull();

      // Make sure one working constraint is visible (from [20, 20] -> mouse position)
      expect(geometryStore.workingConstraints).toHaveLength(1);

      // Press Enter to complete
      toolManager.handleKeyDown({ key: 'Enter' } as KeyboardEvent);

      // Polygon should be added to store
      expect(geometryStore.listWithComponent(PolygonComponent)).toHaveLength(1);
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).closed,
      ).toBe(false);
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points,
      ).toHaveLength(2);
      expect(
        FillColorComponent.getOptional(geometryStore.listWithComponent(PolygonComponent)[0]),
      ).toBeUndefined(); // Non closed polygons are not filled
      expect(geometryStore.workingPolygon).toBeNull();

      // Working constraint should not be visible
      expect(geometryStore.workingConstraints).toHaveLength(0);
    });

    it('extending and closing an open polygon adds FillColorComponent', () => {
      // Create an open polygon, press Enter to complete (no fill)
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      toolManager.handleMouseDown(new ScreenPosition(60, 10), viewport);
      toolManager.handleMouseDown(new ScreenPosition(50, 50), viewport);
      toolManager.handleKeyDown({ key: 'Enter' } as KeyboardEvent);

      expect(geometryStore.listWithComponent(PolygonComponent)).toHaveLength(1);
      expect(geometryStore.workingPolygon).toBeNull();

      const polygon = geometryStore.listWithComponent(PolygonComponent)[0];
      const polygonData = PolygonComponent.get(polygon);
      expect(polygonData.closed).toBe(false);
      expect(FillColorComponent.getOptional(polygon)).toBeUndefined();

      // Extend from the end handle: hover over the last point and click
      polygonTool.setHoveringEndpointOfPolygon({
        polygonId: polygon.id,
        pointIndex: polygonData.points.length - 1,
        isStartPoint: false,
      });
      const endScreen = polygonData.points.at(-1)!.point.toWorld().toScreen(viewport);
      toolManager.handleMouseDown(endScreen, viewport);
      polygonTool.setHoveringEndpointOfPolygon(null);

      // Add one more point to the extension
      toolManager.handleMouseDown(new ScreenPosition(200, 200), viewport);

      // Close by clicking the first handle
      polygonTool.setHoveringFirstHandle(true);
      const startScreen = polygonData.points[0].point.toWorld().toScreen(viewport);
      toolManager.handleMouseDown(startScreen, viewport);
      polygonTool.setHoveringFirstHandle(false);

      expect(geometryStore.listWithComponent(PolygonComponent)).toHaveLength(1);

      const updated = geometryStore.listWithComponent(PolygonComponent)[0];
      expect(PolygonComponent.get(updated).closed).toBe(true);
      expect(FillColorComponent.getOptional(updated)).toBe(DEFAULT_COLOR);
    });

    it('esc key aborts polygon drawing', () => {
      // Create 2 points
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      toolManager.handleMouseDown(new ScreenPosition(20, 20), viewport);
      expect(geometryStore.workingPolygon).not.toBeNull();

      // Make sure one working constraint is visible (from [20, 20] -> mouse position)
      expect(geometryStore.workingConstraints).toHaveLength(1);

      // Press Esc to abort
      toolManager.handleKeyDown({ key: 'Escape' } as KeyboardEvent);

      // Polygon state should be gone
      expect(geometryStore.listWithComponent(PolygonComponent)).toHaveLength(0);
      expect(geometryStore.workingPolygon).toBeNull();

      // Working constraint should not be visible
      expect(geometryStore.workingConstraints).toHaveLength(0);
    });

    it('backspace key deletes in flight polygon segments', () => {
      // Create 4 points
      toolManager.handleMouseDown(new ScreenPosition(10, 11), viewport);
      toolManager.handleMouseDown(new ScreenPosition(20, 21), viewport);
      toolManager.handleMouseDown(new ScreenPosition(30, 31), viewport);
      toolManager.handleMouseDown(new ScreenPosition(40, 41), viewport);
      expect(geometryStore.workingPolygon).not.toBeNull();
      expect(geometryStore.workingPolygon!.points).toHaveLength(
        5 /* 1 initial point + 4 manually placed points */,
      );
      expect(geometryStore.workingPolygon!.points.at(-2)?.point.x).toBeCloseTo(
        40 / SHEET_UNITS_TO_PIXELS,
        2,
      );
      expect(geometryStore.workingPolygon!.points.at(-2)?.point.y).toBeCloseTo(
        41 / SHEET_UNITS_TO_PIXELS,
        2,
      );

      // Move cursor to a differet spot (just to make the below assertions more clear)
      toolManager.handleMouseMove(new ScreenPosition(100, 101), viewport);

      // Make sure one working constraint is visible (from [40, 41] -> mouse position)
      expect(geometryStore.workingConstraints).toHaveLength(1);
      expect(geometryStore.workingConstraints[0].type).toStrictEqual('linear');
      expect(
        (geometryStore.workingConstraints[0] as WorkingLinearConstraint).constrainedLength,
      ).toBeNull();
      expect(geometryStore.workingConstraints[0].pointA?.type).toStrictEqual('point');
      expect((geometryStore.workingConstraints[0].pointA as any).point.x).toBeCloseTo(
        40 / SHEET_UNITS_TO_PIXELS,
        2,
      );
      expect((geometryStore.workingConstraints[0].pointA as any).point.y).toBeCloseTo(
        41 / SHEET_UNITS_TO_PIXELS,
        2,
      );
      expect(geometryStore.workingConstraints[0].pointB?.type).toStrictEqual('point');
      expect((geometryStore.workingConstraints[0].pointB as any).point.x).toBeCloseTo(
        100 / SHEET_UNITS_TO_PIXELS,
        2,
      );
      expect((geometryStore.workingConstraints[0].pointB as any).point.y).toBeCloseTo(
        101 / SHEET_UNITS_TO_PIXELS,
        2,
      );

      // Press Backspace to get rid of a segment
      toolManager.handleKeyDown({ key: 'Backspace' } as KeyboardEvent);

      // The last non preview point should have gone away
      expect(geometryStore.workingPolygon!.points).toHaveLength(4);
      expect(geometryStore.workingPolygon!.points.at(-1)?.point.x).toBeCloseTo(
        100 / SHEET_UNITS_TO_PIXELS,
        2,
      );
      expect(geometryStore.workingPolygon!.points.at(-1)?.point.y).toBeCloseTo(
        101 / SHEET_UNITS_TO_PIXELS,
        2,
      );
      expect(geometryStore.workingPolygon!.points.at(-2)?.point.x).toBeCloseTo(
        30 / SHEET_UNITS_TO_PIXELS,
        2,
      );
      expect(geometryStore.workingPolygon!.points.at(-2)?.point.y).toBeCloseTo(
        31 / SHEET_UNITS_TO_PIXELS,
        2,
      );

      // Make sure the working constraint is now between the previous point and the mouse
      expect(geometryStore.workingConstraints).toHaveLength(1);
      expect((geometryStore.workingConstraints[0].pointA as any).point.x).toBeCloseTo(
        30 / SHEET_UNITS_TO_PIXELS,
        2,
      );
      expect((geometryStore.workingConstraints[0].pointA as any).point.y).toBeCloseTo(
        31 / SHEET_UNITS_TO_PIXELS,
        2,
      );
      expect((geometryStore.workingConstraints[0].pointB as any).point.x).toBeCloseTo(
        100 / SHEET_UNITS_TO_PIXELS,
        2,
      );
      expect((geometryStore.workingConstraints[0].pointB as any).point.y).toBeCloseTo(
        101 / SHEET_UNITS_TO_PIXELS,
        2,
      );
    });

    it('backspace with 1 point then complete does nothing', () => {
      // Create 1 point
      toolManager.handleMouseDown(new ScreenPosition(10, 11), viewport);

      // Press Backspace to get rid of a segment
      toolManager.handleKeyDown({ key: 'Backspace' } as KeyboardEvent);

      // Action: Try to complete
      toolManager.handleKeyDown({ key: 'Enter' } as KeyboardEvent);

      // Verify: No polygon created
      expect(geometryStore.listWithComponent(PolygonComponent)).toHaveLength(0);
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

      // Make sure preview segment working constraint is visible
      expect(geometryStore.workingConstraints).toHaveLength(1);

      // Hold down alt, and click at the next corner to create a quadratic arc
      toolManager.handleKeyDown({ key: 'Alt' } as KeyboardEvent);
      toolManager.handleMouseDown(new ScreenPosition(30, 30), viewport);
      toolManager.handleKeyUp({ key: 'Alt' } as KeyboardEvent);

      // Make sure preview segment is not visible because the arc is being drawn
      expect(geometryStore.workingConstraints).toHaveLength(0);

      // Place the quadratic arc single control point off to the side
      toolManager.handleMouseDown(new ScreenPosition(50, 20), viewport);

      // Make sure preview segment now goes from end of arc -> mouse position
      expect(geometryStore.workingConstraints).toHaveLength(1);
      expect(geometryStore.workingConstraints[0].type).toStrictEqual('linear');
      expect(
        (geometryStore.workingConstraints[0] as WorkingLinearConstraint).constrainedLength,
      ).toBeNull();
      expect(geometryStore.workingConstraints[0].pointA?.type).toStrictEqual('point');
      expect((geometryStore.workingConstraints[0].pointA as any).point.x).toBeCloseTo(
        30 / SHEET_UNITS_TO_PIXELS,
        2,
      );
      expect((geometryStore.workingConstraints[0].pointA as any).point.y).toBeCloseTo(
        30 / SHEET_UNITS_TO_PIXELS,
        2,
      );
      expect(geometryStore.workingConstraints[0].pointB?.type).toStrictEqual('point');
      expect((geometryStore.workingConstraints[0].pointB as any).point.x).toBeCloseTo(
        50 / SHEET_UNITS_TO_PIXELS,
        2,
      );
      expect((geometryStore.workingConstraints[0].pointB as any).point.y).toBeCloseTo(
        20 / SHEET_UNITS_TO_PIXELS,
        2,
      );

      // Place the final two points of the square, closing the square
      toolManager.handleMouseDown(new ScreenPosition(10, 30), viewport);
      polygonTool.setHoveringFirstHandle(true);
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      polygonTool.setHoveringFirstHandle(false);

      // Make sure now there aren't any working constraints visible
      expect(geometryStore.workingConstraints).toHaveLength(0);

      // Make sure there is a square in the polygon state:
      expect(geometryStore.listWithComponent(PolygonComponent)).toHaveLength(1);
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).closed,
      ).toBe(true);
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points,
      ).toHaveLength(5 /* 4 points + 1 duplicate close point */);

      // Point one is upper left
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[0].type,
      ).toStrictEqual('point');
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[0].point
          .x,
      ).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[0].point
          .y,
      ).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);

      // Point two is upper right
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[1].type,
      ).toStrictEqual('point');
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[1].point
          .x,
      ).toBeCloseTo(30 / SHEET_UNITS_TO_PIXELS, 2);
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[1].point
          .y,
      ).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);

      // Point three is the quadratic arc on the right side -> lower right
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[2].type,
      ).toStrictEqual('arc-quadratic');
      expect(
        (
          PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0])
            .points[2] as any
        ).controlPoint.x,
      ).toBeCloseTo(50 / SHEET_UNITS_TO_PIXELS, 2);
      expect(
        (
          PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0])
            .points[2] as any
        ).controlPoint.y,
      ).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[2].point
          .x,
      ).toBeCloseTo(30 / SHEET_UNITS_TO_PIXELS, 2);
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[2].point
          .y,
      ).toBeCloseTo(30 / SHEET_UNITS_TO_PIXELS, 2);

      // Point four is the lower left
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[3].type,
      ).toStrictEqual('point');
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[3].point
          .x,
      ).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[3].point
          .y,
      ).toBeCloseTo(30 / SHEET_UNITS_TO_PIXELS, 2);

      // Point five is the upper left again
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[4].type,
      ).toStrictEqual('point');
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[4].point
          .x,
      ).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[4].point
          .y,
      ).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2); // 30?
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

      // Make sure preview segment is not visible because the arc is being drawn
      expect(geometryStore.workingConstraints).toHaveLength(0);

      // Press B to move from quadratic -> cubic
      toolManager.handleKeyDown({ key: 'B' } as KeyboardEvent);

      // Make sure preview segment is not visible because the arc is being drawn
      expect(geometryStore.workingConstraints).toHaveLength(0);

      // Place the first cubic control point off to the side
      toolManager.handleMouseDown(new ScreenPosition(50, 15), viewport);

      // Place the second cubic control point off to the side but lower
      toolManager.handleMouseDown(new ScreenPosition(50, 25), viewport);

      // Now that drawing the arc is done, a new "preview segment" working constraint should be visible
      expect(geometryStore.workingConstraints).toHaveLength(1);
      expect(geometryStore.workingConstraints[0].type).toStrictEqual('linear');
      expect(
        (geometryStore.workingConstraints[0] as WorkingLinearConstraint).constrainedLength,
      ).toBeNull();
      expect(geometryStore.workingConstraints[0].pointA?.type).toStrictEqual('point');
      expect((geometryStore.workingConstraints[0].pointA as any).point.x).toBeCloseTo(
        30 / SHEET_UNITS_TO_PIXELS,
        2,
      );
      expect((geometryStore.workingConstraints[0].pointA as any).point.y).toBeCloseTo(
        30 / SHEET_UNITS_TO_PIXELS,
        2,
      );
      expect(geometryStore.workingConstraints[0].pointB?.type).toStrictEqual('point');
      expect((geometryStore.workingConstraints[0].pointB as any).point.x).toBeCloseTo(
        50 / SHEET_UNITS_TO_PIXELS,
        2,
      );
      expect((geometryStore.workingConstraints[0].pointB as any).point.y).toBeCloseTo(
        25 / SHEET_UNITS_TO_PIXELS,
        2,
      );

      // Place the final two points of the square, closing the square
      toolManager.handleMouseDown(new ScreenPosition(10, 30), viewport);
      polygonTool.setHoveringFirstHandle(true);
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      polygonTool.setHoveringFirstHandle(false);

      // Make sure there is a square in the polygon state:
      expect(geometryStore.listWithComponent(PolygonComponent)).toHaveLength(1);
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).closed,
      ).toBe(true);
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points,
      ).toHaveLength(5 /* 4 points + 1 duplicate close point */);

      // Point one is upper left
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[0].type,
      ).toStrictEqual('point');
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[0].point
          .x,
      ).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[0].point
          .y,
      ).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);

      // Point two is upper right
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[1].type,
      ).toStrictEqual('point');
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[1].point
          .x,
      ).toBeCloseTo(30 / SHEET_UNITS_TO_PIXELS, 2);
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[1].point
          .y,
      ).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);

      // Point three is the cubic arc on the right side -> lower right
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[2].type,
      ).toStrictEqual('arc-cubic');
      expect(
        (
          PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0])
            .points[2] as any
        ).controlPointA.x,
      ).toBeCloseTo(50 / SHEET_UNITS_TO_PIXELS, 2);
      expect(
        (
          PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0])
            .points[2] as any
        ).controlPointA.y,
      ).toBeCloseTo(15 / SHEET_UNITS_TO_PIXELS, 2);
      expect(
        (
          PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0])
            .points[2] as any
        ).controlPointB.x,
      ).toBeCloseTo(50 / SHEET_UNITS_TO_PIXELS, 2);
      expect(
        (
          PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0])
            .points[2] as any
        ).controlPointB.y,
      ).toBeCloseTo(25 / SHEET_UNITS_TO_PIXELS, 2);
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[2].point
          .x,
      ).toBeCloseTo(30 / SHEET_UNITS_TO_PIXELS, 2);
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[2].point
          .y,
      ).toBeCloseTo(30 / SHEET_UNITS_TO_PIXELS, 2);

      // Point four is the lower left
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[3].type,
      ).toStrictEqual('point');
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[3].point
          .x,
      ).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[3].point
          .y,
      ).toBeCloseTo(30 / SHEET_UNITS_TO_PIXELS, 2);

      // Point five is the upper left again
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[4].type,
      ).toStrictEqual('point');
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[4].point
          .x,
      ).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[4].point
          .y,
      ).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
    });

    it('esc key when in curve drawing cancels current curve drawing, and a second press aborts polygon', () => {
      // Create points making up the first 2 corners of a square
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      toolManager.handleMouseDown(new ScreenPosition(30, 10), viewport);

      expect(geometryStore.workingPolygon?.points).toHaveLength(3);

      // Make sure preview segment is visible initially
      expect(geometryStore.workingConstraints).toHaveLength(1);

      // Hold down alt, and click at the next corner to start a quadratic arc
      toolManager.handleKeyDown({ key: 'Alt' } as KeyboardEvent);
      toolManager.handleMouseDown(new ScreenPosition(30, 30), viewport);
      toolManager.handleKeyUp({ key: 'Alt' } as KeyboardEvent);

      // Make sure preview segment is not visible because the arc is being drawn
      expect(geometryStore.workingConstraints).toHaveLength(0);

      expect(geometryStore.workingPolygon?.points.at(-1)?.type).toStrictEqual('arc-quadratic');

      // Press Esc to stop drawing the arc
      toolManager.handleKeyDown({ key: 'Escape' } as KeyboardEvent);

      // Working polygon state should be reset to not have the arc
      expect(geometryStore.workingPolygon?.points).toHaveLength(3);
      expect(geometryStore.workingPolygon?.points.at(-1)?.type).toStrictEqual('point');

      // Make sure preview segment should be visible again
      expect(geometryStore.workingConstraints).toHaveLength(1);

      // Press Esc again
      toolManager.handleKeyDown({ key: 'Escape' } as KeyboardEvent);

      // The working polygon should be fully wiped out
      expect(geometryStore.listWithComponent(PolygonComponent)).toHaveLength(0);
      expect(geometryStore.workingPolygon).toBeNull();

      // Make the preview segment should also be gone
      expect(geometryStore.workingConstraints).toHaveLength(0);
    });

    it('backspace key when in curve drawing cancels current curve drawing, and a second press deletes past points', () => {
      // Create points making up the first 2 corners of a square
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      toolManager.handleMouseDown(new ScreenPosition(30, 10), viewport);

      expect(geometryStore.workingPolygon?.points).toHaveLength(3);

      // Make sure preview segment is visible initially
      expect(geometryStore.workingConstraints).toHaveLength(1);

      // Hold down alt, and click at the next corner to start a quadratic arc
      toolManager.handleKeyDown({ key: 'Alt' } as KeyboardEvent);
      toolManager.handleMouseDown(new ScreenPosition(30, 30), viewport);
      toolManager.handleKeyUp({ key: 'Alt' } as KeyboardEvent);

      expect(geometryStore.workingPolygon?.points.at(-1)?.type).toStrictEqual('arc-quadratic');

      // Make the preview segment should be gone in curve drawing mode
      expect(geometryStore.workingConstraints).toHaveLength(0);

      // Press Backspaec to stop drawing the arc
      toolManager.handleKeyDown({ key: 'Backspace' } as KeyboardEvent);

      // Working polygon state should be reset to not have the arc
      expect(geometryStore.workingPolygon?.points).toHaveLength(3);
      expect(geometryStore.workingPolygon?.points.at(-1)?.type).toStrictEqual('point');

      // Preview segment should be visible, sicne we're back to line drawing mode
      expect(geometryStore.workingConstraints).toHaveLength(1);

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

      // Make sure preview segment is visible initially
      expect(geometryStore.workingConstraints).toHaveLength(1);

      // Hold down alt, and click at the upper left corner to close with a quadratic arc
      toolManager.handleKeyDown({ key: 'Alt' } as KeyboardEvent);
      polygonTool.setHoveringFirstHandle(true);
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      polygonTool.setHoveringFirstHandle(false);
      toolManager.handleKeyUp({ key: 'Alt' } as KeyboardEvent);

      // Make sure preview segment is not visible because the arc is being drawn
      expect(geometryStore.workingConstraints).toHaveLength(0);

      // Place the quadratic arc single control point off to the side
      toolManager.handleMouseDown(new ScreenPosition(0, 20), viewport);

      // Make the preview segment should still not be visible
      expect(geometryStore.workingConstraints).toHaveLength(0);

      // Make sure there is a square in the polygon state:
      expect(geometryStore.listWithComponent(PolygonComponent)).toHaveLength(1);
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).closed,
      ).toBe(true);
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points,
      ).toHaveLength(5 /* 4 points + 1 duplicate close point */);

      // Point one is upper left
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[0].type,
      ).toStrictEqual('point');
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[0].point
          .x,
      ).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[0].point
          .y,
      ).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);

      // Point two is upper right
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[1].type,
      ).toStrictEqual('point');
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[1].point
          .x,
      ).toBeCloseTo(30 / SHEET_UNITS_TO_PIXELS, 2);
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[1].point
          .y,
      ).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);

      // Point two is lower right
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[2].type,
      ).toStrictEqual('point');
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[2].point
          .x,
      ).toBeCloseTo(30 / SHEET_UNITS_TO_PIXELS, 2);
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[2].point
          .y,
      ).toBeCloseTo(30 / SHEET_UNITS_TO_PIXELS, 2);

      // Point four is lower left
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[3].type,
      ).toStrictEqual('point');
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[3].point
          .x,
      ).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[3].point
          .y,
      ).toBeCloseTo(30 / SHEET_UNITS_TO_PIXELS, 2);

      // Point five is the quadratic arc on the right side -> upper left
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[4].type,
      ).toStrictEqual('arc-quadratic');
      expect(
        (
          PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0])
            .points[4] as any
        ).controlPoint.x,
      ).toBeCloseTo(0 / SHEET_UNITS_TO_PIXELS, 2);
      expect(
        (
          PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0])
            .points[4] as any
        ).controlPoint.y,
      ).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[4].point
          .x,
      ).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[4].point
          .y,
      ).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
    });

    it('closes a polygon with a cubic curve', () => {
      // Create points making up the first 3 sides of a square
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      toolManager.handleMouseDown(new ScreenPosition(30, 10), viewport);
      toolManager.handleMouseDown(new ScreenPosition(30, 30), viewport);
      toolManager.handleMouseDown(new ScreenPosition(10, 30), viewport);

      expect(geometryStore.workingPolygon?.points).toHaveLength(5);

      // Make sure preview segment is visible initially
      expect(geometryStore.workingConstraints).toHaveLength(1);

      // Hold down alt, and click at the upper left corner to close with a quadratic arc
      toolManager.handleKeyDown({ key: 'Alt' } as KeyboardEvent);
      polygonTool.setHoveringFirstHandle(true);
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      polygonTool.setHoveringFirstHandle(false);
      toolManager.handleKeyUp({ key: 'Alt' } as KeyboardEvent);

      // Make sure preview segment is not visible because the arc is being drawn
      expect(geometryStore.workingConstraints).toHaveLength(0);

      // Press B to move from quadratic -> cubic
      toolManager.handleKeyDown({ key: 'B' } as KeyboardEvent);

      // Make sure preview segment is STILL not visible
      expect(geometryStore.workingConstraints).toHaveLength(0);

      // Place the first subic arc single control point off to the bottom side
      toolManager.handleMouseDown(new ScreenPosition(0, 30), viewport);

      // Place the second subic arc single control point off to the top side
      toolManager.handleMouseDown(new ScreenPosition(0, 0), viewport);

      // Make sure preview segment is not visible, drawing is done
      expect(geometryStore.workingConstraints).toHaveLength(0);

      // Make sure there is a square in the polygon state:
      expect(geometryStore.listWithComponent(PolygonComponent)).toHaveLength(1);
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).closed,
      ).toBe(true);
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points,
      ).toHaveLength(5 /* 4 points + 1 duplicate close point */);

      // Point one is upper left
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[0].type,
      ).toStrictEqual('point');
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[0].point
          .x,
      ).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[0].point
          .y,
      ).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);

      // Point two is upper right
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[1].type,
      ).toStrictEqual('point');
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[1].point
          .x,
      ).toBeCloseTo(30 / SHEET_UNITS_TO_PIXELS, 2);
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[1].point
          .y,
      ).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);

      // Point two is lower right
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[2].type,
      ).toStrictEqual('point');
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[2].point
          .x,
      ).toBeCloseTo(30 / SHEET_UNITS_TO_PIXELS, 2);
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[2].point
          .y,
      ).toBeCloseTo(30 / SHEET_UNITS_TO_PIXELS, 2);

      // Point four is lower left
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[3].type,
      ).toStrictEqual('point');
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[3].point
          .x,
      ).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[3].point
          .y,
      ).toBeCloseTo(30 / SHEET_UNITS_TO_PIXELS, 2);

      // Point five is the quadratic arc on the right side -> upper left
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[4].type,
      ).toStrictEqual('arc-cubic');
      expect(
        (
          PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0])
            .points[4] as any
        ).controlPointA.x,
      ).toBeCloseTo(0 / SHEET_UNITS_TO_PIXELS, 2);
      expect(
        (
          PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0])
            .points[4] as any
        ).controlPointA.y,
      ).toBeCloseTo(30 / SHEET_UNITS_TO_PIXELS, 2);
      expect(
        (
          PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0])
            .points[4] as any
        ).controlPointB.x,
      ).toBeCloseTo(0 / SHEET_UNITS_TO_PIXELS, 2);
      expect(
        (
          PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0])
            .points[4] as any
        ).controlPointB.y,
      ).toBeCloseTo(0 / SHEET_UNITS_TO_PIXELS, 2);
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[4].point
          .x,
      ).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[4].point
          .y,
      ).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
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
      expect((geometryStore.workingPolygon?.points.at(-1) as any).controlPointA.x).toBeCloseTo(
        60 / SHEET_UNITS_TO_PIXELS,
        2,
      );
      expect((geometryStore.workingPolygon?.points.at(-1) as any).controlPointA.y).toBeCloseTo(
        61 / SHEET_UNITS_TO_PIXELS,
        2,
      );

      // Press M to move from cubic -> quadratic
      toolManager.handleKeyDown({ key: 'M' } as KeyboardEvent);

      // Make sure the quadratic control point is also still (60, 61)
      expect((geometryStore.workingPolygon?.points.at(-1) as any).controlPoint.x).toBeCloseTo(
        60 / SHEET_UNITS_TO_PIXELS,
        2,
      );
      expect((geometryStore.workingPolygon?.points.at(-1) as any).controlPoint.y).toBeCloseTo(
        61 / SHEET_UNITS_TO_PIXELS,
        2,
      );
    });
  });

  describe('extending from start / end', () => {
    beforeEach(() => {
      // Disable snapping for basic tests
      polygonTool.setSnappingOptions({ primaryGridSize: 0.001, secondaryGridSize: 0.001 });
    });

    it('should extend a non closed polygon from the start point and close it', () => {
      // Create a small, two point polygon
      const polygon = geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create(
          [
            {
              type: 'point',
              point: new SheetPosition(10 / SHEET_UNITS_TO_PIXELS, 10 / SHEET_UNITS_TO_PIXELS),
            },
            {
              type: 'point',
              point: new SheetPosition(20 / SHEET_UNITS_TO_PIXELS, 10 / SHEET_UNITS_TO_PIXELS),
            },
          ],
          { closed: false, fillColor: null, openAtIndex: 0 },
        ),
      );

      // Hover over the first polygon point
      polygonTool.setHoveringEndpointOfPolygon({
        polygonId: polygon.id,
        pointIndex: 0,
        isStartPoint: true,
      });
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      polygonTool.setHoveringEndpointOfPolygon(null);

      expect(geometryStore.workingPolygon?.points).toHaveLength(3);

      // The first click should also create a single working constraint without constrainedLength set
      expect(geometryStore.workingConstraints).toHaveLength(1);
      expect(geometryStore.workingConstraints[0].type).toStrictEqual('linear');
      expect(
        (geometryStore.workingConstraints[0] as WorkingLinearConstraint).constrainedLength,
      ).toBeNull();

      // Thie working constraint should start at the endpoint position -> end at mouse position (same position, though)
      expect(geometryStore.workingConstraints[0].pointA?.type).toStrictEqual('point');
      expect((geometryStore.workingConstraints[0].pointA as any).point.x).toBeCloseTo(
        10 / SHEET_UNITS_TO_PIXELS,
        2,
      );
      expect((geometryStore.workingConstraints[0].pointA as any).point.y).toBeCloseTo(
        10 / SHEET_UNITS_TO_PIXELS,
        2,
      );
      expect(geometryStore.workingConstraints[0].pointB?.type).toStrictEqual('point');
      expect((geometryStore.workingConstraints[0].pointB as any).point.x).toBeCloseTo(
        10 / SHEET_UNITS_TO_PIXELS,
        2,
      );
      expect((geometryStore.workingConstraints[0].pointB as any).point.y).toBeCloseTo(
        10 / SHEET_UNITS_TO_PIXELS,
        2,
      );

      // Place a few more points
      toolManager.handleMouseDown(new ScreenPosition(50, 50), viewport);
      toolManager.handleMouseDown(new ScreenPosition(80, 60), viewport);

      // Make sure only one working constraint is still visible, now starting at the last placed point
      expect(geometryStore.workingConstraints).toHaveLength(1);
      expect(geometryStore.workingConstraints[0].pointA?.type).toStrictEqual('point');
      expect((geometryStore.workingConstraints[0].pointA as any).point.x).toBeCloseTo(
        80 / SHEET_UNITS_TO_PIXELS,
        2,
      );
      expect((geometryStore.workingConstraints[0].pointA as any).point.y).toBeCloseTo(
        60 / SHEET_UNITS_TO_PIXELS,
        2,
      );

      // Hover over the final point of the polygon and click
      polygonTool.setHoveringFirstHandle(true); // NOTE: this name is wrong, this really means "last handle" in this context
      toolManager.handleMouseDown(new ScreenPosition(20, 10), viewport);
      polygonTool.setHoveringFirstHandle(false); // NOTE: this name is wrong, this really means "last handle" in this context

      // Make sure there is one polygon still, and it has all the points
      expect(geometryStore.workingPolygon).toBeNull();
      expect(geometryStore.listWithComponent(PolygonComponent)).toHaveLength(1);
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).closed,
      ).toBeTruthy();
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points,
      ).toHaveLength(5);

      // The first point should be the final point of the existing segment
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[0].point
          .x,
      ).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[0].point
          .y,
      ).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);

      // The original segment should be at the end
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points.at(-2)!
          .point.x,
      ).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points.at(-2)!
          .point.y,
      ).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points.at(-1)!
          .point.x,
      ).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points.at(-1)!
          .point.y,
      ).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);

      // Make sure preview segment is not visible, drawing is done
      expect(geometryStore.workingConstraints).toHaveLength(0);
    });

    it('should extend a non closed polygon from the end point and close it', () => {
      // Create a small, two point polygon
      const polygon = geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create(
          [
            {
              type: 'point',
              point: new SheetPosition(10 / SHEET_UNITS_TO_PIXELS, 10 / SHEET_UNITS_TO_PIXELS),
            },
            {
              type: 'point',
              point: new SheetPosition(20 / SHEET_UNITS_TO_PIXELS, 10 / SHEET_UNITS_TO_PIXELS),
            },
          ],
          { closed: false, fillColor: null, openAtIndex: 0 },
        ),
      );

      // Hover over the last polygon point
      polygonTool.setHoveringEndpointOfPolygon({
        polygonId: polygon.id,
        pointIndex: 1,
        isStartPoint: false,
      });
      toolManager.handleMouseDown(new ScreenPosition(20, 10), viewport);
      polygonTool.setHoveringEndpointOfPolygon(null);

      expect(geometryStore.workingPolygon?.points).toHaveLength(3);

      // The first click should also create a single working constraint without constrainedLength set
      expect(geometryStore.workingConstraints).toHaveLength(1);
      expect(geometryStore.workingConstraints[0].type).toStrictEqual('linear');
      expect(
        (geometryStore.workingConstraints[0] as WorkingLinearConstraint).constrainedLength,
      ).toBeNull();

      // Thie working constraint should start at the endpoint position -> end at mouse position (same position, though)
      expect(geometryStore.workingConstraints[0].pointA?.type).toStrictEqual('point');
      expect((geometryStore.workingConstraints[0].pointA as any).point.x).toBeCloseTo(
        20 / SHEET_UNITS_TO_PIXELS,
        2,
      );
      expect((geometryStore.workingConstraints[0].pointA as any).point.y).toBeCloseTo(
        10 / SHEET_UNITS_TO_PIXELS,
        2,
      );
      expect(geometryStore.workingConstraints[0].pointB?.type).toStrictEqual('point');
      expect((geometryStore.workingConstraints[0].pointB as any).point.x).toBeCloseTo(
        20 / SHEET_UNITS_TO_PIXELS,
        2,
      );
      expect((geometryStore.workingConstraints[0].pointB as any).point.y).toBeCloseTo(
        10 / SHEET_UNITS_TO_PIXELS,
        2,
      );

      // Place a few more points
      toolManager.handleMouseDown(new ScreenPosition(50, 50), viewport);
      toolManager.handleMouseDown(new ScreenPosition(80, 60), viewport);

      // Make sure only one working constraint is still visible, now ending at the last placed point
      expect(geometryStore.workingConstraints).toHaveLength(1);
      expect(geometryStore.workingConstraints[0].pointB?.type).toStrictEqual('point');
      expect((geometryStore.workingConstraints[0].pointB as any).point.x).toBeCloseTo(
        80 / SHEET_UNITS_TO_PIXELS,
        2,
      );
      expect((geometryStore.workingConstraints[0].pointB as any).point.y).toBeCloseTo(
        60 / SHEET_UNITS_TO_PIXELS,
        2,
      );

      // Hover over the final point of the polygon and click
      polygonTool.setHoveringFirstHandle(true);
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      polygonTool.setHoveringFirstHandle(false);

      // Make sure there is one polygon still, and it has all the points
      expect(geometryStore.workingPolygon).toBeNull();
      expect(geometryStore.listWithComponent(PolygonComponent)).toHaveLength(1);
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).closed,
      ).toBeTruthy();
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points,
      ).toHaveLength(5);

      // The original segment should be at the end
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[0].point
          .x,
      ).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[0].point
          .y,
      ).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[1].point
          .x,
      ).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[1].point
          .y,
      ).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);

      // The last point should be the final point of the initial segment
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points.at(-1)!
          .point.x,
      ).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points.at(-1)!
          .point.y,
      ).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);

      // Make sure preview segment is not visible, drawing is done
      expect(geometryStore.workingConstraints).toHaveLength(0);
    });

    it('should be able to drop points with backspace from polygon extended from start', () => {
      // Create a small, two point polygon
      const polygon = geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create(
          [
            {
              type: 'point',
              point: new SheetPosition(10 / SHEET_UNITS_TO_PIXELS, 10 / SHEET_UNITS_TO_PIXELS),
            },
            {
              type: 'point',
              point: new SheetPosition(20 / SHEET_UNITS_TO_PIXELS, 10 / SHEET_UNITS_TO_PIXELS),
            },
          ],
          { closed: false, fillColor: null, openAtIndex: 0 },
        ),
      );

      // Hover over the first polygon point
      polygonTool.setHoveringEndpointOfPolygon({
        polygonId: polygon.id,
        pointIndex: 0,
        isStartPoint: true,
      });
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
      const polygon = geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create(
          [
            {
              type: 'point',
              point: new SheetPosition(10 / SHEET_UNITS_TO_PIXELS, 10 / SHEET_UNITS_TO_PIXELS),
            },
            {
              type: 'point',
              point: new SheetPosition(20 / SHEET_UNITS_TO_PIXELS, 10 / SHEET_UNITS_TO_PIXELS),
            },
          ],
          { closed: false, fillColor: null, openAtIndex: 0 },
        ),
      );

      // Hover over the first polygon point
      polygonTool.setHoveringEndpointOfPolygon({
        polygonId: polygon.id,
        pointIndex: 0,
        isStartPoint: false,
      });
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

    // --------------------------------------------------------------------------------
    // Extending from start - working constraint lifecycle
    // --------------------------------------------------------------------------------

    it('extending from start accumulates disabled working constraints when lengths are set', () => {
      // Create a small, two point polygon with no constraints
      const polygon = geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create(
          [
            {
              type: 'point',
              point: new SheetPosition(10 / SHEET_UNITS_TO_PIXELS, 10 / SHEET_UNITS_TO_PIXELS),
            },
            {
              type: 'point',
              point: new SheetPosition(20 / SHEET_UNITS_TO_PIXELS, 10 / SHEET_UNITS_TO_PIXELS),
            },
          ],
          { closed: false, fillColor: null, openAtIndex: 0 },
        ),
      );

      // Extend from start
      polygonTool.setHoveringEndpointOfPolygon({
        polygonId: polygon.id,
        pointIndex: 0,
        isStartPoint: true,
      });
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      polygonTool.setHoveringEndpointOfPolygon(null);

      expect(geometryStore.workingConstraints).toHaveLength(1);
      expect(geometryStore.workingConstraints[0].disabled).toBe(false);

      // Set a length on the preview segment (simulates user typing a value)
      geometryStore.setWorkingConstraints([
        {
          ...(geometryStore.workingConstraints[0] as WorkingLinearConstraint),
          constrainedLength: Length.millimeters(100),
        },
      ]);

      // Place the next point, committing the segment with the constraint
      toolManager.handleMouseDown(new ScreenPosition(10, 0), viewport);

      // Should have: 1 active (new preview) + 1 disabled (committed segment with constraint)
      expect(geometryStore.workingConstraints).toHaveLength(2);
      expect(geometryStore.workingConstraints[0].disabled).toBe(false);
      expect(
        (geometryStore.workingConstraints[0] as WorkingLinearConstraint).constrainedLength,
      ).toBeNull();
      expect(geometryStore.workingConstraints[1].disabled).toBe(true);
      expect(
        (geometryStore.workingConstraints[1] as WorkingLinearConstraint).constrainedLength?.type,
      ).toStrictEqual(MillimetersType);
      expect(
        (geometryStore.workingConstraints[1] as WorkingLinearConstraint).constrainedLength
          ?.magnitude,
      ).toStrictEqual(100);
    });

    it('extending from start completes with both original and new constraints', () => {
      // Create a polygon with a constraint on its only segment
      const polygon = geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create(
          [
            {
              type: 'point',
              point: new SheetPosition(10 / SHEET_UNITS_TO_PIXELS, 10 / SHEET_UNITS_TO_PIXELS),
            },
            {
              type: 'point',
              point: new SheetPosition(20 / SHEET_UNITS_TO_PIXELS, 10 / SHEET_UNITS_TO_PIXELS),
            },
          ],
          { closed: false, fillColor: null, openAtIndex: 0 },
        ),
      );
      const originalConstraint = geometryStore.add(
        ID_PREFIXES.constraint,
        LinearConstraint.create(
          ConstraintEndpoint.lockedToPolygon(polygon.id, 0),
          ConstraintEndpoint.lockedToPolygon(polygon.id, 1),
          Length.millimeters(50),
        ),
      );

      // Extend from start
      polygonTool.setHoveringEndpointOfPolygon({
        polygonId: polygon.id,
        pointIndex: 0,
        isStartPoint: true,
      });
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      polygonTool.setHoveringEndpointOfPolygon(null);

      // Should have: 1 active (new preview) + 1 disabled (original constraint shadow)
      expect(geometryStore.workingConstraints).toHaveLength(2);
      expect(geometryStore.workingConstraints[0].disabled).toBe(false);
      expect(geometryStore.workingConstraints[1].disabled).toBe(true);
      expect(
        (geometryStore.workingConstraints[1] as WorkingLinearConstraint).constrainedLength
          ?.magnitude,
      ).toStrictEqual(50);

      // Set a length on the new preview segment
      geometryStore.setWorkingConstraints([
        {
          ...(geometryStore.workingConstraints[0] as WorkingLinearConstraint),
          constrainedLength: Length.millimeters(100),
        },
        geometryStore.workingConstraints[1],
      ]);

      // Place the next point, committing the segment with the constraint
      toolManager.handleMouseDown(new ScreenPosition(10, 0), viewport);

      // Now: active + disabled(new committed 100mm) + disabled(original 50mm shadow) = 3
      expect(geometryStore.workingConstraints).toHaveLength(3);

      // Complete the polygon with Enter
      toolManager.handleKeyDown({ key: 'Enter' } as KeyboardEvent);

      // Should have 2 linear constraints (original was re-created with updated indices, plus new)
      const linearConstraintGeoms = geometryStore
        .listWithComponent(ConstraintComponent)
        .filter((g) => ConstraintComponent.get(g).type === 'linear');
      expect(linearConstraintGeoms).toHaveLength(2);

      // Both constraints should be locked to polygon points
      for (const g of linearConstraintGeoms) {
        const c = ConstraintComponent.get(g);
        if (c.type === 'linear') {
          expect(c.pointA.type).toBe('locked-polygon');
          expect(c.pointB.type).toBe('locked-polygon');
        }
      }
    });

    it('backspace while extending from start re-enables original constraint as active', () => {
      // Create a polygon with a constraint on its segment
      const polygon = geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create(
          [
            {
              type: 'point',
              point: new SheetPosition(10 / SHEET_UNITS_TO_PIXELS, 10 / SHEET_UNITS_TO_PIXELS),
            },
            {
              type: 'point',
              point: new SheetPosition(20 / SHEET_UNITS_TO_PIXELS, 10 / SHEET_UNITS_TO_PIXELS),
            },
          ],
          { closed: false, fillColor: null, openAtIndex: 0 },
        ),
      );
      const originalConstraint = geometryStore.add(
        ID_PREFIXES.constraint,
        LinearConstraint.create(
          ConstraintEndpoint.lockedToPolygon(polygon.id, 0),
          ConstraintEndpoint.lockedToPolygon(polygon.id, 1),
          Length.millimeters(50),
        ),
      );

      // Extend from start
      polygonTool.setHoveringEndpointOfPolygon({
        polygonId: polygon.id,
        pointIndex: 0,
        isStartPoint: true,
      });
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      polygonTool.setHoveringEndpointOfPolygon(null);

      expect(geometryStore.workingConstraints).toHaveLength(2);
      expect(geometryStore.workingConstraints[1].shadowsConstraintId).toStrictEqual(
        originalConstraint.id,
      );

      // Set a length on the active WC so we get the re-enable branch on backspace
      geometryStore.setWorkingConstraints([
        {
          ...(geometryStore.workingConstraints[0] as WorkingLinearConstraint),
          constrainedLength: Length.millimeters(100),
        },
        geometryStore.workingConstraints[1],
      ]);

      // Place a point to commit the constrained segment
      toolManager.handleMouseDown(new ScreenPosition(10, 0), viewport);

      expect(geometryStore.workingConstraints).toHaveLength(3);

      // Backspace once -> removes the newest segment -> back to the 2-WC state
      toolManager.handleKeyDown({ key: 'Backspace' } as KeyboardEvent);

      // The committed segment's constraint should now be re-enabled as active
      // (constrainedLengths[0] was 100mm after shift, so else branch fires)
      expect(geometryStore.workingConstraints).toHaveLength(2);
      expect(geometryStore.workingConstraints[0].disabled).toBe(false);
      expect(
        (geometryStore.workingConstraints[0] as WorkingLinearConstraint).constrainedLength
          ?.magnitude,
      ).toStrictEqual(100);

      // Backspace again -> removes the re-enabled segment -> reaches original polygon constraint
      toolManager.handleKeyDown({ key: 'Backspace' } as KeyboardEvent);

      // Now the original constraint should be re-enabled as the active WC
      expect(geometryStore.workingConstraints).toHaveLength(1);
      expect(geometryStore.workingConstraints[0].disabled).toBe(false);
      expect(
        (geometryStore.workingConstraints[0] as WorkingLinearConstraint).constrainedLength
          ?.magnitude,
      ).toStrictEqual(50);
      expect(geometryStore.workingConstraints[0].shadowsConstraintId).toStrictEqual(
        originalConstraint.id,
      );
    });

    it('backspace while extending from start removes segments with multiple lengths then re-enables original', () => {
      // Create a polygon with a constraint
      const polygon = geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create(
          [
            {
              type: 'point',
              point: new SheetPosition(10 / SHEET_UNITS_TO_PIXELS, 10 / SHEET_UNITS_TO_PIXELS),
            },
            {
              type: 'point',
              point: new SheetPosition(20 / SHEET_UNITS_TO_PIXELS, 10 / SHEET_UNITS_TO_PIXELS),
            },
          ],
          { closed: false, fillColor: null, openAtIndex: 0 },
        ),
      );
      const originalConstraint = geometryStore.add(
        ID_PREFIXES.constraint,
        LinearConstraint.create(
          ConstraintEndpoint.lockedToPolygon(polygon.id, 0),
          ConstraintEndpoint.lockedToPolygon(polygon.id, 1),
          Length.millimeters(50),
        ),
      );

      // Extend from start
      polygonTool.setHoveringEndpointOfPolygon({
        polygonId: polygon.id,
        pointIndex: 0,
        isStartPoint: true,
      });
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      polygonTool.setHoveringEndpointOfPolygon(null);

      // Segment 1: set length and commit
      geometryStore.setWorkingConstraints([
        {
          ...(geometryStore.workingConstraints[0] as WorkingLinearConstraint),
          constrainedLength: Length.millimeters(100),
        },
        geometryStore.workingConstraints[1],
      ]);
      toolManager.handleMouseDown(new ScreenPosition(10, 0), viewport);

      // Segment 2: set length and commit
      geometryStore.setWorkingConstraints([
        {
          ...(geometryStore.workingConstraints[0] as WorkingLinearConstraint),
          constrainedLength: Length.millimeters(150),
        },
        geometryStore.workingConstraints[1],
        geometryStore.workingConstraints[2],
      ]);
      toolManager.handleMouseDown(new ScreenPosition(10, -10), viewport);

      // Now: 3 segments committed + 1 preview = 4 points, WC.length = 4
      // [active, disabled(150mm), disabled(100mm), disabled_original]
      expect(geometryStore.workingConstraints).toHaveLength(4);
      expect(geometryStore.workingConstraints[1].disabled).toBe(true);
      expect(
        (geometryStore.workingConstraints[1] as WorkingLinearConstraint).constrainedLength
          ?.magnitude,
      ).toStrictEqual(150);
      expect(geometryStore.workingConstraints[2].disabled).toBe(true);
      expect(
        (geometryStore.workingConstraints[2] as WorkingLinearConstraint).constrainedLength
          ?.magnitude,
      ).toStrictEqual(100);

      // Backspace 3x: remove the 3 added segments one by one
      // 1st backspace: removes 150mm segment, re-enables 100mm
      toolManager.handleKeyDown({ key: 'Backspace' } as KeyboardEvent);
      expect(geometryStore.workingConstraints).toHaveLength(3);

      // 2nd backspace: removes 100mm segment, re-enables original
      toolManager.handleKeyDown({ key: 'Backspace' } as KeyboardEvent);
      expect(geometryStore.workingConstraints).toHaveLength(2);

      // 3rd backspace: removes to original polygon, re-enables original constraint
      toolManager.handleKeyDown({ key: 'Backspace' } as KeyboardEvent);
      expect(geometryStore.workingConstraints).toHaveLength(1);
      expect(geometryStore.workingConstraints[0].disabled).toBe(false);
      expect(
        (geometryStore.workingConstraints[0] as WorkingLinearConstraint).constrainedLength
          ?.magnitude,
      ).toStrictEqual(50);
      expect(geometryStore.workingConstraints[0].shadowsConstraintId).toStrictEqual(
        originalConstraint.id,
      );
    });

    it('escape while extending from start reverts state to before extend', () => {
      // Create a polygon with a constraint
      const polygon = geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create(
          [
            {
              type: 'point',
              point: new SheetPosition(10 / SHEET_UNITS_TO_PIXELS, 10 / SHEET_UNITS_TO_PIXELS),
            },
            {
              type: 'point',
              point: new SheetPosition(20 / SHEET_UNITS_TO_PIXELS, 10 / SHEET_UNITS_TO_PIXELS),
            },
          ],
          { closed: false, fillColor: null, openAtIndex: 0 },
        ),
      );
      const originalConstraint = geometryStore.add(
        ID_PREFIXES.constraint,
        LinearConstraint.create(
          ConstraintEndpoint.lockedToPolygon(polygon.id, 0),
          ConstraintEndpoint.lockedToPolygon(polygon.id, 1),
          Length.millimeters(50),
        ),
      );

      // Extend from start
      polygonTool.setHoveringEndpointOfPolygon({
        polygonId: polygon.id,
        pointIndex: 0,
        isStartPoint: true,
      });
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      polygonTool.setHoveringEndpointOfPolygon(null);

      // Add 2 segments with constraint lengths
      geometryStore.setWorkingConstraints([
        {
          ...(geometryStore.workingConstraints[0] as WorkingLinearConstraint),
          constrainedLength: Length.millimeters(100),
        },
        geometryStore.workingConstraints[1],
      ]);
      toolManager.handleMouseDown(new ScreenPosition(10, 0), viewport);

      geometryStore.setWorkingConstraints([
        {
          ...(geometryStore.workingConstraints[0] as WorkingLinearConstraint),
          constrainedLength: Length.millimeters(150),
        },
        geometryStore.workingConstraints[1],
        geometryStore.workingConstraints[2],
      ]);
      toolManager.handleMouseDown(new ScreenPosition(10, -10), viewport);

      // Press Escape
      toolManager.handleKeyDown({ key: 'Escape' } as KeyboardEvent);

      // Verify: working state cleared
      expect(geometryStore.workingPolygon).toBeNull();
      expect(geometryStore.workingConstraints).toHaveLength(0);

      // Verify: original polygon and constraint unaffected
      expect(geometryStore.listWithComponent(PolygonComponent)).toHaveLength(1);
      expect(geometryStore.listWithComponent(PolygonComponent)[0].id).toStrictEqual(polygon.id);
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points,
      ).toHaveLength(2);
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[0].point
          .x,
      ).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[1].point
          .x,
      ).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);

      const remainingConstraintGeoms = geometryStore
        .listWithComponent(ConstraintComponent)
        .filter((g) => ConstraintComponent.get(g).type === 'linear');
      expect(remainingConstraintGeoms).toHaveLength(1);
      expect(remainingConstraintGeoms[0].id).toStrictEqual(originalConstraint.id);
    });

    // --------------------------------------------------------------------------------
    // Extending from end - working constraint lifecycle
    // --------------------------------------------------------------------------------

    it('extending from end accumulates disabled working constraints when lengths are set', () => {
      // Create a small, two point polygon with no constraints
      const polygon = geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create(
          [
            {
              type: 'point',
              point: new SheetPosition(10 / SHEET_UNITS_TO_PIXELS, 10 / SHEET_UNITS_TO_PIXELS),
            },
            {
              type: 'point',
              point: new SheetPosition(20 / SHEET_UNITS_TO_PIXELS, 10 / SHEET_UNITS_TO_PIXELS),
            },
          ],
          { closed: false, fillColor: null, openAtIndex: 0 },
        ),
      );

      // Extend from end (pointIndex 1, isStartPoint: false)
      polygonTool.setHoveringEndpointOfPolygon({
        polygonId: polygon.id,
        pointIndex: 1,
        isStartPoint: false,
      });
      toolManager.handleMouseDown(new ScreenPosition(20, 10), viewport);
      polygonTool.setHoveringEndpointOfPolygon(null);

      expect(geometryStore.workingConstraints).toHaveLength(1);
      expect(geometryStore.workingConstraints[0].disabled).toBe(false);

      // Set a length on the preview segment
      geometryStore.setWorkingConstraints([
        {
          ...(geometryStore.workingConstraints[0] as WorkingLinearConstraint),
          constrainedLength: Length.millimeters(100),
        },
      ]);

      // Place the next point, committing the segment with the constraint
      toolManager.handleMouseDown(new ScreenPosition(30, 10), viewport);

      // Should have: 1 disabled (committed segment with constraint) + 1 active (new preview)
      expect(geometryStore.workingConstraints).toHaveLength(2);
      expect(geometryStore.workingConstraints[0].disabled).toBe(true);
      expect(
        (geometryStore.workingConstraints[0] as WorkingLinearConstraint).constrainedLength?.type,
      ).toStrictEqual(MillimetersType);
      expect(
        (geometryStore.workingConstraints[0] as WorkingLinearConstraint).constrainedLength
          ?.magnitude,
      ).toStrictEqual(100);
      expect(geometryStore.workingConstraints[1].disabled).toBe(false);
      expect(
        (geometryStore.workingConstraints[1] as WorkingLinearConstraint).constrainedLength,
      ).toBeNull();
    });

    it('extending from end completes with both original and new constraints', () => {
      // Create a polygon with a constraint
      const polygon = geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create(
          [
            {
              type: 'point',
              point: new SheetPosition(10 / SHEET_UNITS_TO_PIXELS, 10 / SHEET_UNITS_TO_PIXELS),
            },
            {
              type: 'point',
              point: new SheetPosition(20 / SHEET_UNITS_TO_PIXELS, 10 / SHEET_UNITS_TO_PIXELS),
            },
          ],
          { closed: false, fillColor: null, openAtIndex: 0 },
        ),
      );
      const originalConstraint = geometryStore.add(
        ID_PREFIXES.constraint,
        LinearConstraint.create(
          ConstraintEndpoint.lockedToPolygon(polygon.id, 0),
          ConstraintEndpoint.lockedToPolygon(polygon.id, 1),
          Length.millimeters(50),
        ),
      );

      // Extend from end
      polygonTool.setHoveringEndpointOfPolygon({
        polygonId: polygon.id,
        pointIndex: 1,
        isStartPoint: false,
      });
      toolManager.handleMouseDown(new ScreenPosition(20, 10), viewport);
      polygonTool.setHoveringEndpointOfPolygon(null);

      // Should have: 1 disabled (original constraint shadow) + 1 active (new preview)
      expect(geometryStore.workingConstraints).toHaveLength(2);
      expect(geometryStore.workingConstraints[0].disabled).toBe(true);
      expect(
        (geometryStore.workingConstraints[0] as WorkingLinearConstraint).constrainedLength
          ?.magnitude,
      ).toStrictEqual(50);
      expect(geometryStore.workingConstraints[1].disabled).toBe(false);

      // Set a length on the new preview segment and commit
      geometryStore.setWorkingConstraints([
        geometryStore.workingConstraints[0],
        {
          ...(geometryStore.workingConstraints[1] as WorkingLinearConstraint),
          constrainedLength: Length.millimeters(100),
        },
      ]);
      toolManager.handleMouseDown(new ScreenPosition(30, 10), viewport);

      // Now: disabled(original) + disabled(new 100mm) + active = 3
      expect(geometryStore.workingConstraints).toHaveLength(3);

      // Complete with Enter
      toolManager.handleKeyDown({ key: 'Enter' } as KeyboardEvent);

      // Verify 2 linear constraints
      const linearConstraintGeoms = geometryStore
        .listWithComponent(ConstraintComponent)
        .filter((g) => ConstraintComponent.get(g).type === 'linear');
      expect(linearConstraintGeoms).toHaveLength(2);

      // Both constraints should be locked to polygon points
      for (const g of linearConstraintGeoms) {
        const c = ConstraintComponent.get(g);
        if (c.type === 'linear') {
          expect(c.pointA.type).toBe('locked-polygon');
          expect(c.pointB.type).toBe('locked-polygon');
        }
      }
    });

    it('backspace while extending from end re-enables original constraint as active', () => {
      // Create a polygon with a constraint
      const polygon = geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create(
          [
            {
              type: 'point',
              point: new SheetPosition(10 / SHEET_UNITS_TO_PIXELS, 10 / SHEET_UNITS_TO_PIXELS),
            },
            {
              type: 'point',
              point: new SheetPosition(20 / SHEET_UNITS_TO_PIXELS, 10 / SHEET_UNITS_TO_PIXELS),
            },
          ],
          { closed: false, fillColor: null, openAtIndex: 0 },
        ),
      );
      const originalConstraint = geometryStore.add(
        ID_PREFIXES.constraint,
        LinearConstraint.create(
          ConstraintEndpoint.lockedToPolygon(polygon.id, 0),
          ConstraintEndpoint.lockedToPolygon(polygon.id, 1),
          Length.millimeters(50),
        ),
      );

      // Extend from end
      polygonTool.setHoveringEndpointOfPolygon({
        polygonId: polygon.id,
        pointIndex: 1,
        isStartPoint: false,
      });
      toolManager.handleMouseDown(new ScreenPosition(20, 10), viewport);
      polygonTool.setHoveringEndpointOfPolygon(null);

      // Set a length on the active WC and commit
      geometryStore.setWorkingConstraints([
        geometryStore.workingConstraints[0],
        {
          ...(geometryStore.workingConstraints[1] as WorkingLinearConstraint),
          constrainedLength: Length.millimeters(100),
        },
      ]);
      toolManager.handleMouseDown(new ScreenPosition(30, 10), viewport);

      expect(geometryStore.workingConstraints).toHaveLength(3);

      // Backspace once -> removes newest segment
      toolManager.handleKeyDown({ key: 'Backspace' } as KeyboardEvent);
      expect(geometryStore.workingConstraints).toHaveLength(2);
      expect(geometryStore.workingConstraints[0].disabled).toBe(true);
      expect(
        (geometryStore.workingConstraints[0] as WorkingLinearConstraint).constrainedLength
          ?.magnitude,
      ).toStrictEqual(50);
      expect(geometryStore.workingConstraints[1].disabled).toBe(false);
      expect(
        (geometryStore.workingConstraints[1] as WorkingLinearConstraint).constrainedLength
          ?.magnitude,
      ).toStrictEqual(100);

      // Backspace again -> re-enables original constraint
      toolManager.handleKeyDown({ key: 'Backspace' } as KeyboardEvent);
      expect(geometryStore.workingConstraints).toHaveLength(1);
      expect(geometryStore.workingConstraints[0].disabled).toBe(false);
      expect(
        (geometryStore.workingConstraints[0] as WorkingLinearConstraint).constrainedLength
          ?.magnitude,
      ).toStrictEqual(50);
      expect(geometryStore.workingConstraints[0].shadowsConstraintId).toStrictEqual(
        originalConstraint.id,
      );
    });

    it('backspace while extending from end removes segments with multiple lengths then re-enables original', () => {
      // Create a polygon with a constraint
      const polygon = geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create(
          [
            {
              type: 'point',
              point: new SheetPosition(10 / SHEET_UNITS_TO_PIXELS, 10 / SHEET_UNITS_TO_PIXELS),
            },
            {
              type: 'point',
              point: new SheetPosition(20 / SHEET_UNITS_TO_PIXELS, 10 / SHEET_UNITS_TO_PIXELS),
            },
          ],
          { closed: false, fillColor: null, openAtIndex: 0 },
        ),
      );
      const originalConstraint = geometryStore.add(
        ID_PREFIXES.constraint,
        LinearConstraint.create(
          ConstraintEndpoint.lockedToPolygon(polygon.id, 0),
          ConstraintEndpoint.lockedToPolygon(polygon.id, 1),
          Length.millimeters(50),
        ),
      );

      // Extend from end
      polygonTool.setHoveringEndpointOfPolygon({
        polygonId: polygon.id,
        pointIndex: 1,
        isStartPoint: false,
      });
      toolManager.handleMouseDown(new ScreenPosition(20, 10), viewport);
      polygonTool.setHoveringEndpointOfPolygon(null);

      // Segment 1: set length and commit
      geometryStore.setWorkingConstraints([
        geometryStore.workingConstraints[0],
        {
          ...(geometryStore.workingConstraints[1] as WorkingLinearConstraint),
          constrainedLength: Length.millimeters(100),
        },
      ]);
      toolManager.handleMouseDown(new ScreenPosition(30, 10), viewport);

      // Segment 2: set length and commit
      geometryStore.setWorkingConstraints([
        geometryStore.workingConstraints[0],
        geometryStore.workingConstraints[1],
        {
          ...(geometryStore.workingConstraints[2] as WorkingLinearConstraint),
          constrainedLength: Length.millimeters(150),
        },
      ]);
      toolManager.handleMouseDown(new ScreenPosition(40, 10), viewport);

      // WC: [disabled(original 50), disabled(100mm), disabled(150mm), active]
      expect(geometryStore.workingConstraints).toHaveLength(4);

      // Backspace 3x: remove all 3 added segments
      // 1st: removes 150mm committed, re-enables it as active
      toolManager.handleKeyDown({ key: 'Backspace' } as KeyboardEvent);
      expect(geometryStore.workingConstraints).toHaveLength(3);

      // 2nd: removes 100mm committed, re-enables it
      toolManager.handleKeyDown({ key: 'Backspace' } as KeyboardEvent);
      expect(geometryStore.workingConstraints).toHaveLength(2);

      // 3rd: re-enables original constraint
      toolManager.handleKeyDown({ key: 'Backspace' } as KeyboardEvent);
      expect(geometryStore.workingConstraints).toHaveLength(1);
      expect(geometryStore.workingConstraints[0].disabled).toBe(false);
      expect(
        (geometryStore.workingConstraints[0] as WorkingLinearConstraint).constrainedLength
          ?.magnitude,
      ).toStrictEqual(50);
      expect(geometryStore.workingConstraints[0].shadowsConstraintId).toStrictEqual(
        originalConstraint.id,
      );
    });

    it('escape while extending from end reverts state to before extend', () => {
      // Create a polygon with a constraint
      const polygon = geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create(
          [
            {
              type: 'point',
              point: new SheetPosition(10 / SHEET_UNITS_TO_PIXELS, 10 / SHEET_UNITS_TO_PIXELS),
            },
            {
              type: 'point',
              point: new SheetPosition(20 / SHEET_UNITS_TO_PIXELS, 10 / SHEET_UNITS_TO_PIXELS),
            },
          ],
          { closed: false, fillColor: null, openAtIndex: 0 },
        ),
      );
      const originalConstraint = geometryStore.add(
        ID_PREFIXES.constraint,
        LinearConstraint.create(
          ConstraintEndpoint.lockedToPolygon(polygon.id, 0),
          ConstraintEndpoint.lockedToPolygon(polygon.id, 1),
          Length.millimeters(50),
        ),
      );

      // Extend from end
      polygonTool.setHoveringEndpointOfPolygon({
        polygonId: polygon.id,
        pointIndex: 1,
        isStartPoint: false,
      });
      toolManager.handleMouseDown(new ScreenPosition(20, 10), viewport);
      polygonTool.setHoveringEndpointOfPolygon(null);

      // Add 2 segments with constraint lengths
      geometryStore.setWorkingConstraints([
        geometryStore.workingConstraints[0],
        {
          ...(geometryStore.workingConstraints[1] as WorkingLinearConstraint),
          constrainedLength: Length.millimeters(100),
        },
      ]);
      toolManager.handleMouseDown(new ScreenPosition(30, 10), viewport);

      geometryStore.setWorkingConstraints([
        geometryStore.workingConstraints[0],
        geometryStore.workingConstraints[1],
        {
          ...(geometryStore.workingConstraints[2] as WorkingLinearConstraint),
          constrainedLength: Length.millimeters(150),
        },
      ]);
      toolManager.handleMouseDown(new ScreenPosition(40, 10), viewport);

      // Press Escape
      toolManager.handleKeyDown({ key: 'Escape' } as KeyboardEvent);

      // Verify: working state cleared
      expect(geometryStore.workingPolygon).toBeNull();
      expect(geometryStore.workingConstraints).toHaveLength(0);

      // Verify: original polygon and constraint unaffected
      expect(geometryStore.listWithComponent(PolygonComponent)).toHaveLength(1);
      expect(geometryStore.listWithComponent(PolygonComponent)[0].id).toStrictEqual(polygon.id);
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points,
      ).toHaveLength(2);
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[0].point
          .x,
      ).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(
        PolygonComponent.get(geometryStore.listWithComponent(PolygonComponent)[0]).points[1].point
          .x,
      ).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);

      const remainingConstraintGeoms = geometryStore
        .listWithComponent(ConstraintComponent)
        .filter((g) => ConstraintComponent.get(g).type === 'linear');
      expect(remainingConstraintGeoms).toHaveLength(1);
      expect(remainingConstraintGeoms[0].id).toStrictEqual(originalConstraint.id);
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
      const events = subscribeToEvents(polygonTool, [
        'previewSegmentIntersections',
        'previewSegmentIntersectionsEnabled',
      ]);

      // Action: Blur the tool
      polygonTool.handleToolBlur();

      // Verify: Events were emitted
      expect(events.areThereBufferedEvents('previewSegmentIntersections')).toBe(true);
      expect(events.areThereBufferedEvents('previewSegmentIntersectionsEnabled')).toBe(true);
    });
  });

  describe('line intersection', () => {
    it.skip('should do an intersection with another linear polygon, forming a "+" shape', () => {
      const { id: existingPolygonId } = geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(50, 0), makePoint(50, 100)], {
          closed: false,
          fillColor: null,
          openAtIndex: 0,
        }),
      );

      // Create first point
      toolManager.handleMouseDown(
        new ScreenPosition(0 * SHEET_UNITS_TO_PIXELS, 50 * SHEET_UNITS_TO_PIXELS),
        viewport,
      );
      expect(geometryStore.workingPolygon!.points).toHaveLength(2);

      // Move the mouse to the other endpoint position
      toolManager.handleMouseMove(
        new ScreenPosition(100 * SHEET_UNITS_TO_PIXELS, 50 * SHEET_UNITS_TO_PIXELS),
        viewport,
      );

      // Activate the intersection point between the segments
      toolManager.handleKeyDown({ key: 'a' } as KeyboardEvent);

      // CLick to add the second point
      toolManager.handleMouseDown(
        new ScreenPosition(100 * SHEET_UNITS_TO_PIXELS, 50 * SHEET_UNITS_TO_PIXELS),
        viewport,
      );

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
      const existingPolygon = geometryStore.getByIdWithComponent(
        existingPolygonId,
        PolygonComponent,
      );
      expect(PolygonComponent.get(existingPolygon!).points).toHaveLength(3);
      expect(PolygonComponent.get(existingPolygon!).points[0].point.x).toBeCloseTo(50, 2);
      expect(PolygonComponent.get(existingPolygon!).points[0].point.y).toBeCloseTo(0, 2);
      expect(PolygonComponent.get(existingPolygon!).points[1].point.x).toBeCloseTo(50, 2);
      expect(PolygonComponent.get(existingPolygon!).points[1].point.y).toBeCloseTo(50, 2);
      expect(PolygonComponent.get(existingPolygon!).points[2].point.x).toBeCloseTo(50, 2);
      expect(PolygonComponent.get(existingPolygon!).points[2].point.y).toBeCloseTo(100, 2);
    });
    it.skip('should do an intersection with another linear polygon, forming a "+" shape, by extending a pre-existing other polygon from start', () => {
      const { id: existingPolygonId } = geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(50, 0), makePoint(50, 100)], {
          closed: false,
          fillColor: null,
          openAtIndex: 0,
        }),
      );
      const { id: startingPolygonId } = geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create(
          [
            makePoint(100, 50),
            makePoint(123, 123) /* this point doesn't matter for the intersection calculation */,
          ],
          { closed: false, fillColor: null, openAtIndex: 0 },
        ),
      );

      // Hover first point of starting polygon
      polygonTool.setHoveringEndpointOfPolygon({
        polygonId: startingPolygonId,
        pointIndex: 0,
        isStartPoint: true,
      });
      toolManager.handleMouseDown(
        new ScreenPosition(0 * SHEET_UNITS_TO_PIXELS, 50 * SHEET_UNITS_TO_PIXELS),
        viewport,
      );
      polygonTool.setHoveringEndpointOfPolygon(null);

      expect(geometryStore.workingPolygon?.points).toHaveLength(3);

      // Move the mouse to the further left endpoint position (0, 50)
      toolManager.handleMouseMove(
        new ScreenPosition(0 * SHEET_UNITS_TO_PIXELS, 50 * SHEET_UNITS_TO_PIXELS),
        viewport,
      );

      // Activate the intersection point between the segments
      toolManager.handleKeyDown({ key: 'a' } as KeyboardEvent);

      // Click to add the next point
      toolManager.handleMouseDown(
        new ScreenPosition(0 * SHEET_UNITS_TO_PIXELS, 50 * SHEET_UNITS_TO_PIXELS),
        viewport,
      );

      // Verify the intersection point was added to the working polygon
      expect(geometryStore.workingPolygon!.points).toHaveLength(5);

      // points[0] doesn't matter, it is the start of the preview segment
      expect(geometryStore.workingPolygon!.points[1].point.x).toBeCloseTo(0, 2);
      expect(geometryStore.workingPolygon!.points[1].point.y).toBeCloseTo(50, 2);
      expect(geometryStore.workingPolygon!.points[2].point.x).toBeCloseTo(50, 2); // <- intersection point added here
      expect(geometryStore.workingPolygon!.points[2].point.y).toBeCloseTo(50, 2);
      expect(geometryStore.workingPolygon!.points[3].point.x).toBeCloseTo(100, 2);
      expect(geometryStore.workingPolygon!.points[4].point.y).toBeCloseTo(50, 2);

      expect(geometryStore.workingPolygon!.points[5].point.x).toBeCloseTo(
        123 /* end point of starting polygon */,
        2,
      );
      expect(geometryStore.workingPolygon!.points[5].point.y).toBeCloseTo(
        123 /* end point of starting polygon */,
        2,
      );

      // Verify that the intersection point was added to the existing polygon, too
      const existingPolygon = geometryStore.getByIdWithComponent(
        existingPolygonId,
        PolygonComponent,
      );
      expect(PolygonComponent.get(existingPolygon!).points).toHaveLength(3);
      expect(PolygonComponent.get(existingPolygon!).points[0].point.x).toBeCloseTo(50, 2);
      expect(PolygonComponent.get(existingPolygon!).points[0].point.y).toBeCloseTo(0, 2);
      expect(PolygonComponent.get(existingPolygon!).points[1].point.x).toBeCloseTo(50, 2);
      expect(PolygonComponent.get(existingPolygon!).points[1].point.y).toBeCloseTo(50, 2);
      expect(PolygonComponent.get(existingPolygon!).points[2].point.x).toBeCloseTo(50, 2);
      expect(PolygonComponent.get(existingPolygon!).points[2].point.y).toBeCloseTo(100, 2);
    });
  });

  // // ================================================================================
  // // Section 7: Intersection Key Combos
  // // ================================================================================
  // describe.skip('intersection key combos', () => {
  //   beforeEach(() => {
  //     // Setup: Create working polygon for intersection testing
  //     toolManager.handleMouseDown(new ScreenPosition(0, 0), viewport);
  //     toolManager.handleMouseMove(new ScreenPosition(100, 100), viewport);
  //   });

  //   function setFakeIntersections(count: number) {
  //     // Note: Direct internal state manipulation for test setup
  //     const intersections: Array<PreviewSegmentIntersection> = [];
  //     for (let i = 0; i < count; i++) {
  //       intersections.push({
  //         point: new SheetPosition(50, 50),
  //         tOnSegment: 0.5,
  //         uOnDcelEdge: 0.5,
  //         originPos: new SheetPosition(0, 0),
  //         destPos: new SheetPosition(100, 100),
  //         originId: '',
  //         destId: '',
  //         keyCombo: mapIndexToKeyCombo(i),
  //       });
  //     }
  //     (polygonTool as any).previewSegmentIntersections = intersections;
  //     (polygonTool as any).previewSegmentInteractionsKeyCombos
  //       .clear()
  //       .setKeyCombos(intersections.map((i) => i.keyCombo));
  //   }

  //   it('pressing matching combo key enables intersection', () => {
  //     // Setup: Create fake intersection with combo 'a'
  //     setFakeIntersections(1);
  //     const enabled = (polygonTool as any).previewSegmentInteractionsEnabled;

  //     // Verify: 'a' not initially enabled
  //     expect(enabled.has('a')).toBe(false);

  //     // Action: Press 'a'
  //     simulateKeyDown(toolManager, 'a');

  //     // Verify: 'a' is now enabled
  //     expect(enabled.has('a')).toBe(true);
  //   });

  //   it('pressing enabled combo key disables it', () => {
  //     // Setup: Create fake intersection and enable it
  //     setFakeIntersections(1);

  //     // Action: Press 'a' to enable
  //     simulateKeyDown(toolManager, 'a');
  //     expect((polygonTool as any).previewSegmentInteractionsEnabled.has('a')).toBe(true);

  //     // Action: Press 'a' again to disable
  //     simulateKeyDown(toolManager, 'a');

  //     // Verify: 'a' is now disabled
  //     expect((polygonTool as any).previewSegmentInteractionsEnabled.has('a')).toBe(false);
  //   });

  //   it('toggling off intersection clears lastEnabled flag', () => {
  //     // TODO: This test requires internal state access and has no assertion.
  //     // Setup: Create fake intersection
  //     setFakeIntersections(1);
  //     // Note: Direct internal state manipulation for test setup
  //     (polygonTool as any).lastPreviewSegmentEnabledIntersections = true;

  //     // Action: Toggle off
  //     simulateKeyDown(toolManager, 'a');

  //     // Verify: Flag should be false after toggling off
  //     expect((polygonTool as any).lastPreviewSegmentEnabledIntersections).toBe(false);
  //   });

  //   it('pressing non-matching key leaves intersections disabled', () => {
  //     // Setup: Create fake intersection with combo 'a' only
  //     setFakeIntersections(1);

  //     // Action: Press 'z' which is not a valid combo
  //     simulateKeyDown(toolManager, 'z');

  //     // Verify: 'a' remains disabled
  //     expect((polygonTool as any).previewSegmentInteractionsEnabled.has('a')).toBe(false);
  //   });

  //   it('disabling removes key from enabled set', () => {
  //     // Setup: Create fake intersection
  //     setFakeIntersections(1);

  //     // Action: Enable 'a'
  //     simulateKeyDown(toolManager, 'a');
  //     expect((polygonTool as any).previewSegmentInteractionsEnabled.has('a')).toBe(true);

  //     // Action: Disable 'a'
  //     simulateKeyDown(toolManager, 'a');

  //     // Verify: 'a' removed from enabled set
  //     expect((polygonTool as any).previewSegmentInteractionsEnabled.has('a')).toBe(false);
  //   });
  // });

  // // ================================================================================
  // // Section 8: Intersection Handling - Line vs Line
  // // ================================================================================
  // describe.skip('intersection handling - line vs line', () => {
  //   function setLineIntersections(intersections: PreviewSegmentIntersections[]) {
  //     // Note: Direct internal state manipulation for test setup
  //     (polygonTool as any).previewSegmentIntersections = intersections;
  //     (polygonTool as any).previewSegmentInteractionsEnabled = new Set(
  //       intersections.map((i) => i.keyCombo),
  //     );
  //   }

  //   it.skip('single intersection found and sorted', () => {
  //     // Setup: Create first polygon segment
  //     toolManager.handleMouseDown(new ScreenPosition(0, 0), viewport);
  //     toolManager.handleMouseMove(new ScreenPosition(100, 100), viewport);

  //     // Setup: Add second polygon to intersect with
  //     geometryStore.add(ID_PREFIXES.polygon, Polygon.create([makePoint(50, 0), makePoint(50, 100)], {
  //         closed: false,
  //         fillColor: null,
  //         openAtIndex: 0,
  //       }))

  //     // Action: Move to trigger intersection computation
  //     toolManager.handleMouseMove(new ScreenPosition(60, 60), viewport);

  //     // Verify: Intersection found
  //     const intersections = (polygonTool as any).previewSegmentIntersections;
  //     expect(intersections.length).toBeGreaterThan(0);
  //   });

  //   it.skip('enabled intersection splits target polygon', () => {
  //     // Setup: Create working polygon with 2 points
  //     toolManager.handleMouseDown(new ScreenPosition(0, 0), viewport);
  //     toolManager.handleMouseMove(new ScreenPosition(100, 100), viewport);

  //     // Setup: Add target polygon
  //     const targetPoly = geometryStore.add(ID_PREFIXES.polygon, Polygon.create([makePoint(50, 0), makePoint(50, 100)], {
  //         closed: false,
  //         fillColor: null,
  //         openAtIndex: 0,
  //       }))

  //     // Setup: Set intersection manually
  //     const intersection: PreviewSegmentIntersections = {
  //       otherId: targetPoly.id,
  //       otherType: 'polygon',
  //       otherSegmentIndex: 0,
  //       keyCombo: 'a',
  //       segment: { start: new SheetPosition(50, 0), end: new SheetPosition(50, 100) },
  //       intersectionPoint: new SheetPosition(50, 50),
  //       splitRatio: 0.5,
  //     };
  //     setLineIntersections([intersection]);

  //     const initialPointCount = targetPoly.points.length;

  //     // Action: Add point (this processes intersection)
  //     toolManager.handleMouseDown(new ScreenPosition(80, 80), viewport);

  //     // Verify: Target polygon has new point inserted
  //     const updated = geometryStore.listWithComponent(PolygonComponent).find((p) => p.id === targetPoly.id);
  //     expect(updated!.points.length).toBeGreaterThan(initialPointCount);
  //   });

  //   it('disabled intersection leaves polygon unchanged', () => {
  //     // Setup: Create working polygon
  //     toolManager.handleMouseDown(new ScreenPosition(0, 0), viewport);
  //     toolManager.handleMouseMove(new ScreenPosition(100, 100), viewport);

  //     // Setup: Add target polygon
  //     const targetPoly = geometryStore.add(ID_PREFIXES.polygon, Polygon.create([makePoint(50, 0), makePoint(50, 100)], {
  //         closed: false,
  //         fillColor: null,
  //         openAtIndex: 0,
  //       }))

  //     // Setup: Set intersection but do NOT enable it
  //     const intersection: PreviewSegmentIntersections = {
  //       otherId: targetPoly.id,
  //       otherType: 'polygon',
  //       otherSegmentIndex: 0,
  //       keyCombo: 'a',
  //       segment: { start: new SheetPosition(50, 0), end: new SheetPosition(50, 100) },
  //       intersectionPoint: new SheetPosition(50, 50),
  //       splitRatio: 0.5,
  //     };
  //     setLineIntersections([intersection]);
  //     (polygonTool as any).previewSegmentInteractionsEnabled = new Set();

  //     const initialPointCount = targetPoly.points.length;

  //     // Action: Add point
  //     toolManager.handleMouseDown(new ScreenPosition(80, 80), viewport);

  //     // Verify: Target polygon unchanged
  //     const updated = geometryStore.listWithComponent(PolygonComponent).find((p) => p.id === targetPoly.id);
  //     expect(updated!.points.length).toBe(initialPointCount);
  //   });

  //   it.skip('split ratio correctly computed', () => {
  //     // TODO: Need precise geometric intersection computation between two line
  //     // segments in viewport coordinates. The test setup needs exact coordinate
  //     // calculations based on the ViewportState scale and position transformations.
  //     toolManager.handleMouseDown(new ScreenPosition(0, 0), viewport);
  //     toolManager.handleMouseMove(new ScreenPosition(100, 100), viewport);

  //     const targetPoly = geometryStore.add(ID_PREFIXES.polygon, Polygon.create([makePoint(0, 50), makePoint(100, 50)], {
  //         closed: false,
  //         fillColor: null,
  //         openAtIndex: 0,
  //       }))

  //     const intersection: PreviewSegmentIntersections = {
  //       otherId: targetPoly.id,
  //       otherType: 'polygon',
  //       otherSegmentIndex: 0,
  //       keyCombo: 'a',
  //       segment: { start: new SheetPosition(0, 50), end: new SheetPosition(100, 50) },
  //       intersectionPoint: new SheetPosition(50, 50),
  //       splitRatio: 0.5,
  //     };
  //     setLineIntersections([intersection]);

  //     toolManager.handleMouseDown(new ScreenPosition(80, 80), viewport);

  //     // Verify: splitRatio is correctly computed
  //     expect(intersection.splitRatio).toBe(0.5);
  //   });

  //   it.skip('multiple intersections on same polygon found', () => {
  //     // TODO: Need to create multiple polygons with precise spacing to intersect
  //     // with the preview segment. Requires exact coordinate calculations.
  //     toolManager.handleMouseDown(new ScreenPosition(0, 0), viewport);
  //     toolManager.handleMouseMove(new ScreenPosition(100, 100), viewport);

  //     // Setup: Create vertical line polygons
  //     geometryStore.add(ID_PREFIXES.polygon, Polygon.create([makePoint(30, 0), makePoint(30, 100)], {
  //         closed: false,
  //         fillColor: null,
  //         openAtIndex: 0,
  //       }))
  //     geometryStore.add(ID_PREFIXES.polygon, Polygon.create([makePoint(70, 0), makePoint(70, 100)], {
  //         closed: false,
  //         fillColor: null,
  //         openAtIndex: 0,
  //       }))

  //     // Action: Move to trigger intersection computation
  //     toolManager.handleMouseMove(new ScreenPosition(50, 50), viewport);

  //     // Verify: Multiple intersections found
  //     const intersections = (polygonTool as any).previewSegmentIntersections;
  //     expect(intersections.length).toBeGreaterThanOrEqual(2);
  //   });
  // });

  // // ================================================================================
  // // Section 9: Intersection Handling - Line vs Rectangle
  // // ================================================================================
  // describe.skip('intersection handling - line vs rectangle', () => {
  //   // TODO: Rectangle intersection tests not yet implemented.
  //   // These tests will be added when rectangle intersection handling is implemented.
  // });

  // // ================================================================================
  // // Section 10: Intersection Handling - Line vs Ellipse
  // // ================================================================================
  // describe.skip('intersection handling - line vs ellipse', () => {
  //   // TODO: Ellipse intersection tests not yet implemented.
  //   // These tests will be added when ellipse intersection handling is implemented.
  // });

  // // ================================================================================
  // // Section 11: Intersection Handling - Line vs Arc Quadratic
  // // ================================================================================
  // describe.skip('intersection handling - line vs arc quadratic', () => {
  //   function setQuadraticIntersections(intersections: PreviewSegmentIntersections[]) {
  //     // Note: Direct internal state manipulation for test setup
  //     (polygonTool as any).previewSegmentIntersections = intersections;
  //     (polygonTool as any).previewSegmentInteractionsEnabled = new Set(
  //       intersections.map((i) => i.keyCombo),
  //     );
  //   }

  //   it.skip('preview arc intersects quadratic curve', () => {
  //     // TODO: Requires precise geometric intersection computation for quadratic Bezier curves.
  //     // Setup: Create polygon with quadratic arc
  //     const polyWithArc = geometryStore.add(ID_PREFIXES.polygon, Polygon.create(
  //         [
  //           makePoint(0, 0),
  //           {
  //             type: 'arc-quadratic',
  //             point: new SheetPosition(100, 0),
  //             controlPoint: new SheetPosition(50, 50),
  //           },
  //         ],
  //         { closed: false, fillColor: null, openAtIndex: 0 },
  //       ))

  //     toolManager.handleMouseDown(new ScreenPosition(0, 50), viewport);
  //     toolManager.handleMouseMove(new ScreenPosition(100, 50), viewport);

  //     // Verify: Intersection found with quadratic curve
  //     const intersections = (polygonTool as any).previewSegmentIntersections;
  //     const hasQuadratic = intersections.some(
  //       (i: any) => 'controlPoint' in i.segment && !('controlPointA' in i.segment),
  //     );
  //     expect(intersections.length).toBeGreaterThanOrEqual(0);
  //   });

  //   it.skip('enabled quadratic intersection splits target polygon', () => {
  //     // TODO: Requires precise geometric intersection computation.
  //     // Setup: Create target polygon with quadratic arc
  //     const targetPoly = geometryStore.add(ID_PREFIXES.polygon, Polygon.create(
  //         [
  //           makePoint(0, 0),
  //           {
  //             type: 'arc-quadratic',
  //             point: new SheetPosition(100, 0),
  //             controlPoint: new SheetPosition(50, 50),
  //           },
  //         ],
  //         { closed: false, fillColor: null, openAtIndex: 0 },
  //       ))

  //     // Setup: Create intersection
  //     const intersection: PreviewSegmentIntersections = {
  //       otherId: targetPoly.id,
  //       otherType: 'polygon',
  //       otherSegmentIndex: 0,
  //       keyCombo: 'a',
  //       segment: {
  //         start: new SheetPosition(0, 0),
  //         end: new SheetPosition(100, 0),
  //         controlPoint: new SheetPosition(50, 50),
  //       },
  //       intersectionPoint: new SheetPosition(50, 50),
  //       splitRatio: 0.5,
  //     };
  //     setQuadraticIntersections([intersection]);

  //     const initialSegCount = targetPoly.points.length;

  //     // Action: Add point
  //     toolManager.handleMouseDown(new ScreenPosition(60, 60), viewport);

  //     // Verify: Segment split
  //     // NOTE: Splitting replaces 1 segment with 2, so new length should be >= initial
  //   });

  //   it('disabled quadratic intersection leaves polygon unchanged', () => {
  //     // Setup: Create target polygon with quadratic arc
  //     const targetPoly = geometryStore.add(ID_PREFIXES.polygon, Polygon.create(
  //         [
  //           makePoint(0, 0),
  //           {
  //             type: 'arc-quadratic',
  //             point: new SheetPosition(100, 0),
  //             controlPoint: new SheetPosition(50, 50),
  //           },
  //         ],
  //         { closed: false, fillColor: null, openAtIndex: 0 },
  //       ))

  //     // Setup: Create intersection but do NOT enable it
  //     const intersection: PreviewSegmentIntersections = {
  //       otherId: targetPoly.id,
  //       otherType: 'polygon',
  //       otherSegmentIndex: 0,
  //       keyCombo: 'a',
  //       segment: {
  //         start: new SheetPosition(0, 0),
  //         end: new SheetPosition(100, 0),
  //         controlPoint: new SheetPosition(50, 50),
  //       },
  //       intersectionPoint: new SheetPosition(50, 50),
  //       splitRatio: 0.5,
  //     };
  //     setQuadraticIntersections([intersection]);
  //     (polygonTool as any).previewSegmentInteractionsEnabled = new Set();

  //     const initialSegCount = targetPoly.points.length;

  //     // Action: Add point
  //     toolManager.handleMouseDown(new ScreenPosition(60, 60), viewport);

  //     // Verify: Target polygon unchanged
  //     // NOTE: This test passes by virtue of no action being taken on disabled intersection
  //     expect(targetPoly.points.length).toBe(initialSegCount);
  //   });
  // });

  // // ================================================================================
  // // Section 12: Intersection Handling - Line vs Arc Cubic
  // // ================================================================================
  // describe.skip('intersection handling - line vs arc cubic', () => {
  //   function setCubicIntersections(intersections: PreviewSegmentIntersections[]) {
  //     // Note: Direct internal state manipulation for test setup
  //     (polygonTool as any).previewSegmentIntersections = intersections;
  //     (polygonTool as any).previewSegmentInteractionsEnabled = new Set(
  //       intersections.map((i) => i.keyCombo),
  //     );
  //   }

  //   it.skip('preview arc intersects cubic curve', () => {
  //     // TODO: Requires precise geometric intersection computation for cubic Bezier curves.
  //     // The intersection computation involves solving polynomial equations for cubic Bezier curves.
  //     const polyWithCubic = geometryStore.add(ID_PREFIXES.polygon, Polygon.create(
  //         [
  //           makePoint(0, 0),
  //           {
  //             type: 'arc-cubic',
  //             point: new SheetPosition(100, 0),
  //             controlPointA: new SheetPosition(33, 50),
  //             controlPointB: new SheetPosition(67, 50),
  //           },
  //         ],
  //         { closed: false, fillColor: null, openAtIndex: 0 },
  //       ))

  //     toolManager.handleMouseDown(new ScreenPosition(0, 50), viewport);
  //     toolManager.handleMouseMove(new ScreenPosition(100, 50), viewport);

  //     // Verify: Intersection found
  //     const intersections = (polygonTool as any).previewSegmentIntersections;
  //     expect(intersections.length).toBeGreaterThanOrEqual(0);
  //   });

  //   it.skip('enabled cubic intersection splits target polygon', () => {
  //     // TODO: Requires precise geometric intersection computation with De Casteljau algorithm.
  //     const targetPoly = geometryStore.add(ID_PREFIXES.polygon, Polygon.create(
  //         [
  //           makePoint(0, 0),
  //           {
  //             type: 'arc-cubic',
  //             point: new SheetPosition(100, 0),
  //             controlPointA: new SheetPosition(33, 50),
  //             controlPointB: new SheetPosition(67, 50),
  //           },
  //         ],
  //         { closed: false, fillColor: null, openAtIndex: 0 },
  //       ))

  //     const intersection: PreviewSegmentIntersections = {
  //       otherId: targetPoly.id,
  //       otherType: 'polygon',
  //       otherSegmentIndex: 0,
  //       keyCombo: 'a',
  //       segment: {
  //         start: new SheetPosition(0, 0),
  //         end: new SheetPosition(100, 0),
  //         controlPointA: new SheetPosition(33, 50),
  //         controlPointB: new SheetPosition(67, 50),
  //       },
  //       intersectionPoint: new SheetPosition(50, 50),
  //       splitRatio: 0.5,
  //     };
  //     setCubicIntersections([intersection]);

  //     const initialSegCount = targetPoly.points.length;
  //     toolManager.handleMouseDown(new ScreenPosition(60, 60), viewport);

  //     // Verify: Segment split using De Casteljau
  //     // NOTE: Splitting replaces 1 segment with 2
  //   });
  // });

  // // ================================================================================
  // // Section 16: Edge Cases
  // // ================================================================================
  // describe.skip('edge cases', () => {
  //   it('intersection at segment endpoint handled gracefully', () => {
  //     // Setup: Create target polygon
  //     const targetPoly = geometryStore.add(ID_PREFIXES.polygon, Polygon.create([makePoint(0, 0), makePoint(100, 100)], {
  //         closed: false,
  //         fillColor: null,
  //         openAtIndex: 0,
  //       }))

  //     // Setup: Set intersection at endpoint (100, 100)
  //     // Note: Direct internal state manipulation for test setup
  //     const intersection: PreviewSegmentIntersections = {
  //       otherId: targetPoly.id,
  //       otherType: 'polygon',
  //       otherSegmentIndex: 0,
  //       keyCombo: 'a',
  //       segment: { start: new SheetPosition(0, 0), end: new SheetPosition(100, 100) },
  //       intersectionPoint: new SheetPosition(100, 100),
  //       splitRatio: 1.0,
  //     };
  //     (polygonTool as any).previewSegmentIntersections = [intersection];
  //     (polygonTool as any).previewSegmentInteractionsEnabled = new Set(['a']);

  //     // Action: Add point
  //     toolManager.handleMouseDown(new ScreenPosition(50, 50), viewport);

  //     // Verify: Polygon created without crash
  //     expect(geometryStore.listWithComponent(PolygonComponent)).toHaveLength(1);
  //   });
  // });

  describe('working constraints', () => {
    beforeEach(() => {
      polygonTool.setSnappingOptions({ primaryGridSize: 0.001, secondaryGridSize: 0.001 });
    });

    it('creates a working constraint on first click', () => {
      toolManager.handleMouseDown(new ScreenPosition(640, 640), viewport);
      expect(geometryStore.workingConstraints).toHaveLength(1);
      expect(geometryStore.workingConstraints[0].disabled).toBe(false);
    });

    it('updates working constraint pointB on mouse move', () => {
      // Place point one
      toolManager.handleMouseDown(new ScreenPosition(640, 640), viewport);

      // Move mouse
      toolManager.handleMouseMove(new ScreenPosition(3200, 640), viewport);

      expect(geometryStore.workingConstraints).toHaveLength(1);
      const wc = geometryStore.workingConstraints[0];
      expect(wc.pointA).toEqual({
        type: 'point',
        point: new SheetPosition(640 / SHEET_UNITS_TO_PIXELS, 640 / SHEET_UNITS_TO_PIXELS),
      });
      expect(wc.pointB).toEqual({
        type: 'point',
        point: new SheetPosition(3200 / SHEET_UNITS_TO_PIXELS, 640 / SHEET_UNITS_TO_PIXELS),
      });
    });

    it('accumulates disabled working constraint when length is set on commit', () => {
      // Place point one
      toolManager.handleMouseDown(new ScreenPosition(640, 640), viewport);

      // Set a length on the working constraint (simulates user typing a value)
      geometryStore.setWorkingConstraints([
        {
          ...(geometryStore.workingConstraints[0] as WorkingLinearConstraint),
          constrainedLength: Length.millimeters(100),
        },
      ]);

      // Place point two, committing the segment without setting a length
      toolManager.handleMouseDown(new ScreenPosition(3200, 640), viewport);

      // Should have: 1 disabled (the committed segment's constraint) + 1 active (new preview)
      expect(geometryStore.workingConstraints).toHaveLength(2);
      expect(geometryStore.workingConstraints[0].disabled).toBe(true);
      expect(
        (geometryStore.workingConstraints[0] as WorkingLinearConstraint).constrainedLength?.type,
      ).toStrictEqual(MillimetersType);
      expect(
        (geometryStore.workingConstraints[0] as WorkingLinearConstraint).constrainedLength
          ?.magnitude,
      ).toStrictEqual(100);
      expect(geometryStore.workingConstraints[1].disabled).toBe(false);
      expect(
        (geometryStore.workingConstraints[1] as WorkingLinearConstraint).constrainedLength,
      ).toBeNull();
    });

    it('does not accumulate disabled constraint when no length was set', () => {
      // Place point one
      toolManager.handleMouseDown(new ScreenPosition(640, 640), viewport);

      // Place point two, committing the segment without setting a length
      toolManager.handleMouseDown(new ScreenPosition(3200, 640), viewport);

      // Should have just 1 active WC (no disabled accumulation)
      expect(geometryStore.workingConstraints).toHaveLength(1);
      expect(geometryStore.workingConstraints[0].disabled).toBe(false);
    });

    it('converts working constraints to permanent on Enter completion', () => {
      toolManager.handleMouseDown(new ScreenPosition(64, 64), viewport);
      toolManager.handleMouseMove(new ScreenPosition(128, 64), viewport);

      // Set a length on the first segment
      expect(geometryStore.workingConstraints[0].disabled).toStrictEqual(false);
      geometryStore.setWorkingConstraints([
        {
          ...(geometryStore.workingConstraints[0] as WorkingLinearConstraint),
          constrainedLength: Length.millimeters(50),
        },
      ]);

      // Place second point -> first segment committed with constraint
      toolManager.handleMouseDown(new ScreenPosition(128, 64), viewport);
      toolManager.handleMouseMove(new ScreenPosition(128, 128), viewport);

      // Set a length on the second segment
      expect(geometryStore.workingConstraints.at(-1)!.disabled).toStrictEqual(false);
      geometryStore.setWorkingConstraints((old) => [
        ...old.slice(0, -1),
        {
          ...(old[old.length - 1] as WorkingLinearConstraint),
          constrainedLength: Length.millimeters(75),
        },
      ]);

      // Place third point -> second segment committed with constraint
      toolManager.handleMouseDown(new ScreenPosition(128, 128), viewport);

      // Complete the polygon with Enter (open polygon with 3 points)
      toolManager.handleKeyDown({ key: 'Enter' } as KeyboardEvent);

      // Should have 2 permanent constraints (one for each constrained segment)
      const linearConstraintGeoms = geometryStore
        .listWithComponent(ConstraintComponent)
        .filter((g) => ConstraintComponent.get(g).type === 'linear');
      expect(linearConstraintGeoms).toHaveLength(2);

      // Verify constraints are locked to polygon points
      const polygon = geometryStore.listWithComponent(PolygonComponent)[0];
      expect(polygon).toBeDefined();
      for (const g of linearConstraintGeoms) {
        const c = ConstraintComponent.get(g);
        if (c.type === 'linear') {
          expect(c.pointA.type).toBe('locked-polygon');
          expect(c.pointB.type).toBe('locked-polygon');
        }
      }
    });
  });
});
