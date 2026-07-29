import { ActionsManager } from '@/lib/actions/ActionsManager';
import {
  CubicBezierSegment,
  Ellipse,
  GeometryComponent,
  PointSegment,
  Polygon,
  Rectangle,
  RenderShapeEllipse,
  RenderShapePolygon,
  RenderShapeRectangle,
} from '@/lib/entity';
import { GeometryStore, ID_PREFIXES } from '@/lib/entity/GeometryStore';
import { FilletFilter } from '@/lib/entity/filters/fillet';
import { MirrorFilter } from '@/lib/entity/filters/mirror';
import { PolygonSegment } from '@/lib/entity/geometry/polygon';
import type { QuadraticBezierSegment } from '@/lib/entity/geometry/polygon';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { SerializationManager } from '@/lib/serialization/SerializationManager';
import { Sheet } from '@/lib/sheet/Sheet';
import { FilletFilterTool } from '@/lib/tools/FilletFilterTool';
import { SelectionManager } from '@/lib/tools/SelectionManager';
import { ToolManager } from '@/lib/tools/ToolManager';
import { Length } from '@/lib/units/length';
import { ViewportControls } from '@/lib/viewport/ViewportControls';
import { SheetPosition, type ViewportState } from '@/lib/viewport/types';

function makePoint(x: number, y: number): PointSegment {
  return { type: 'point', point: new SheetPosition(x, y) };
}

describe('GeometryComponent', () => {
  let sheet: Sheet;
  let historyManager: HistoryManager;
  let geometryStore: GeometryStore;
  let selectionManager: SelectionManager;
  let actionsManager: ActionsManager;
  let toolManager: ToolManager;
  let viewport: ViewportState;
  let filletTool: FilletFilterTool;
  let viewportControls: ViewportControls;

  beforeEach(() => {
    sheet = Sheet.a4();
    historyManager = new HistoryManager();
    geometryStore = new GeometryStore(historyManager);
    historyManager.setGeometryStore(geometryStore);
    selectionManager = new SelectionManager();
    toolManager = new ToolManager(geometryStore, selectionManager, historyManager);
    actionsManager = new ActionsManager(sheet, geometryStore, selectionManager, historyManager);
    historyManager.setGeometryStore(geometryStore);
    toolManager = new ToolManager(geometryStore, selectionManager, historyManager);
    toolManager.setSerializationManager(
      new SerializationManager(actionsManager, toolManager, sheet),
    );

    viewportControls = new ViewportControls({
      canvasWidth: 800,
      canvasHeight: 600,
      sheet,
    });
    toolManager.setViewportControls(viewportControls);
    viewport = viewportControls.getState().viewport;

    toolManager.setActiveTool('edit');
    toolManager.changeToolSubTool('edit', 'fillet');
    filletTool = toolManager.getTool('edit').activeSubTool as FilletFilterTool;
  });

  describe('getRenderShapes', () => {
    describe('no filters does nothing', () => {
      it('should return rectangles unprocessed', async () => {
        // Create a new rectangle
        const rectangle = geometryStore.addOrdered(
          ID_PREFIXES.rectangle,
          Rectangle.create(new SheetPosition(0, 0), new SheetPosition(100, 100)),
        );

        // Generate the shape, make sure that the fillet corner is rendered
        const shapes = GeometryComponent.getRenderShapes(rectangle, sheet.defaultUnit);

        expect(shapes).toHaveLength(1);
        expect(shapes[0].shape).toStrictEqual('rectangle');
        const polygonShape = shapes[0] as RenderShapeRectangle;
        expect(polygonShape.upperLeft.x).toStrictEqual(0);
        expect(polygonShape.upperLeft.y).toStrictEqual(0);
        expect(polygonShape.lowerRight.x).toStrictEqual(100);
        expect(polygonShape.lowerRight.y).toStrictEqual(100);
      });

      it('should return ellipses unprocessed', async () => {
        // Create a new rectangle
        const ellipse = geometryStore.addOrdered(
          ID_PREFIXES.ellipse,
          Ellipse.create(new SheetPosition(0, 0), { radiusX: 10, radiusY: 20 }),
        );

        // Generate the shape, make sure that the ellipse is rendered
        const shapes = GeometryComponent.getRenderShapes(ellipse, sheet.defaultUnit);

        expect(shapes).toHaveLength(1);
        expect(shapes[0].shape).toStrictEqual('ellipse');
        const ellipseShape = shapes[0] as RenderShapeEllipse;
        expect(ellipseShape.center.x).toStrictEqual(0);
        expect(ellipseShape.center.y).toStrictEqual(0);
        expect(ellipseShape.radiusX).toStrictEqual(10);
        expect(ellipseShape.radiusY).toStrictEqual(20);
      });

      it('should return polygons unprocessed', async () => {
        // Create a new polygon (triangle)
        const polygon = geometryStore.addOrdered(
          ID_PREFIXES.polygon,
          Polygon.create(
            [makePoint(0, 0), makePoint(100, 0), makePoint(100, 100), makePoint(0, 0)],
            {
              closed: true,
            },
          ),
        );

        // Generate the shape with no filters — should pass through unchanged
        const shapes = GeometryComponent.getRenderShapes(polygon, sheet.defaultUnit);

        expect(shapes).toHaveLength(1);
        expect(shapes[0].shape).toStrictEqual('polygon');
        const polygonShape = shapes[0] as RenderShapePolygon;
        expect(polygonShape.primary).toStrictEqual(true);
        expect(polygonShape.closed).toStrictEqual(true);
        expect(polygonShape.points).toHaveLength(4);

        expect(polygonShape.points[0].point.x).toStrictEqual(0);
        expect(polygonShape.points[0].point.y).toStrictEqual(0);
        expect(polygonShape.points[1].point.x).toStrictEqual(100);
        expect(polygonShape.points[1].point.y).toStrictEqual(0);
        expect(polygonShape.points[2].point.x).toStrictEqual(100);
        expect(polygonShape.points[2].point.y).toStrictEqual(100);
        expect(polygonShape.points[3].point.x).toStrictEqual(0);
        expect(polygonShape.points[3].point.y).toStrictEqual(0);
      });
    });

    describe('filler / chamfer', () => {
      it('should render rectangles with fillets properly', async () => {
        // Create a new rectangle
        const rectangle = geometryStore.addOrdered(
          ID_PREFIXES.rectangle,
          Rectangle.create(new SheetPosition(0, 0), new SheetPosition(100, 100)),
        );

        // Add a fillet centered on the upperRight point of the rectangle
        const filter = geometryStore.add(
          ID_PREFIXES.filter,
          FilletFilter.createOnRectangle(
            rectangle.id,
            'upperLeft',
            'upperRight',
            'lowerRight',
            Length.centimeters(20),
          ),
        );

        // Generate the shape, make sure that the fillet corner is rendered
        const shapes = GeometryComponent.getRenderShapes(rectangle, sheet.defaultUnit, [filter]);

        expect(shapes).toHaveLength(1);
        expect(shapes[0].shape).toStrictEqual('polygon');
        const polygonShape = shapes[0] as RenderShapePolygon;
        expect(polygonShape.points).toHaveLength(6);

        // Make sure all points are positioned where they should be
        expect(polygonShape.points[0].type).toStrictEqual('point');
        expect(polygonShape.points[0].point.x).toStrictEqual(0);
        expect(polygonShape.points[0].point.y).toStrictEqual(0);

        expect(polygonShape.points[1].type).toStrictEqual('point');
        expect(polygonShape.points[1].point.x).toStrictEqual(80);
        expect(polygonShape.points[1].point.y).toStrictEqual(0);

        expect(polygonShape.points[2].type).toStrictEqual('arc-cubic');
        expect(polygonShape.points[2].point.x).toStrictEqual(100);
        expect(polygonShape.points[2].point.y).toStrictEqual(20);
        expect((polygonShape.points[2] as CubicBezierSegment).controlPointA.x).toBeCloseTo(91.045);
        expect((polygonShape.points[2] as CubicBezierSegment).controlPointA.y).toStrictEqual(0);
        expect((polygonShape.points[2] as CubicBezierSegment).controlPointB.x).toStrictEqual(100);
        expect((polygonShape.points[2] as CubicBezierSegment).controlPointB.y).toBeCloseTo(8.954);

        expect(polygonShape.points[3].type).toStrictEqual('point');
        expect(polygonShape.points[3].point.x).toStrictEqual(100);
        expect(polygonShape.points[3].point.y).toStrictEqual(100);

        expect(polygonShape.points[4].type).toStrictEqual('point');
        expect(polygonShape.points[4].point.x).toStrictEqual(0);
        expect(polygonShape.points[4].point.y).toStrictEqual(100);

        expect(polygonShape.points[5].type).toStrictEqual('point');
        expect(polygonShape.points[5].point.x).toStrictEqual(0);
        expect(polygonShape.points[5].point.y).toStrictEqual(0);
      });

      it('should render rectangles with multiple fillets properly (upper right then lower right)', async () => {
        // Create a new rectangle
        const rectangle = geometryStore.addOrdered(
          ID_PREFIXES.rectangle,
          Rectangle.create(new SheetPosition(0, 0), new SheetPosition(100, 100)),
        );

        // Add a fillet centered on the upperRight point of the rectangle
        const filterUpperRight = geometryStore.add(
          ID_PREFIXES.filter,
          FilletFilter.createOnRectangle(
            rectangle.id,
            'upperLeft',
            'upperRight',
            'lowerRight',
            Length.centimeters(20),
          ),
        );

        // Add a fillet centered on the upperRight point of the rectangle
        const filterLowerRight = geometryStore.add(
          ID_PREFIXES.filter,
          FilletFilter.createOnRectangle(
            rectangle.id,
            'upperRight',
            'lowerRight',
            'lowerLeft',
            Length.centimeters(20),
          ),
        );

        // Generate the shape, make sure that the fillet corner is rendered
        const shapes = GeometryComponent.getRenderShapes(rectangle, sheet.defaultUnit, [
          filterUpperRight,
          filterLowerRight,
        ]);

        expect(shapes).toHaveLength(1);
        expect(shapes[0].shape).toStrictEqual('polygon');
        const polygonShape = shapes[0] as RenderShapePolygon;
        expect(polygonShape.points).toHaveLength(7);

        // Make sure all points are positioned where they should be
        expect(polygonShape.points[0].type).toStrictEqual('point');
        expect(polygonShape.points[0].point.x).toStrictEqual(0);
        expect(polygonShape.points[0].point.y).toStrictEqual(0);

        expect(polygonShape.points[1].type).toStrictEqual('point');
        expect(polygonShape.points[1].point.x).toStrictEqual(80);
        expect(polygonShape.points[1].point.y).toStrictEqual(0);

        expect(polygonShape.points[2].type).toStrictEqual('arc-cubic');
        expect(polygonShape.points[2].point.x).toStrictEqual(100);
        expect(polygonShape.points[2].point.y).toStrictEqual(20);
        expect((polygonShape.points[2] as CubicBezierSegment).controlPointA.x).toBeCloseTo(91.045);
        expect((polygonShape.points[2] as CubicBezierSegment).controlPointA.y).toStrictEqual(0);
        expect((polygonShape.points[2] as CubicBezierSegment).controlPointB.x).toStrictEqual(100);
        expect((polygonShape.points[2] as CubicBezierSegment).controlPointB.y).toBeCloseTo(8.954);

        expect(polygonShape.points[3].type).toStrictEqual('point');
        expect(polygonShape.points[3].point.x).toStrictEqual(100);
        expect(polygonShape.points[3].point.y).toStrictEqual(80);

        expect(polygonShape.points[4].type).toStrictEqual('arc-cubic');
        expect(polygonShape.points[4].point.x).toStrictEqual(80);
        expect(polygonShape.points[4].point.y).toStrictEqual(100);
        expect((polygonShape.points[4] as CubicBezierSegment).controlPointA.x).toStrictEqual(100);
        expect((polygonShape.points[4] as CubicBezierSegment).controlPointA.y).toBeCloseTo(91.045);
        expect((polygonShape.points[4] as CubicBezierSegment).controlPointB.x).toBeCloseTo(91.045);
        expect((polygonShape.points[4] as CubicBezierSegment).controlPointB.y).toStrictEqual(100);

        expect(polygonShape.points[5].type).toStrictEqual('point');
        expect(polygonShape.points[5].point.x).toStrictEqual(0);
        expect(polygonShape.points[5].point.y).toStrictEqual(100);

        expect(polygonShape.points[6].type).toStrictEqual('point');
        expect(polygonShape.points[6].point.x).toStrictEqual(0);
        expect(polygonShape.points[6].point.y).toStrictEqual(0);
      });
    });

    it('should mirror rectangles across a line', async () => {
      // Create a new rectangle
      const rectangle = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(100, 100)),
      );

      const filter = geometryStore.add(
        ID_PREFIXES.filter,
        MirrorFilter.create(rectangle.id, new SheetPosition(200, 0), new SheetPosition(200, 100)),
      );

      // Generate the shape, make sure that the fillet corner is rendered
      const shapes = GeometryComponent.getRenderShapes(rectangle, sheet.defaultUnit, [filter]);

      expect(shapes).toHaveLength(2);

      expect(shapes[0].shape).toStrictEqual('rectangle');
      const rectangleOriginal = shapes[0] as RenderShapeRectangle;
      expect(rectangleOriginal.upperLeft.x).toStrictEqual(0);
      expect(rectangleOriginal.upperLeft.y).toStrictEqual(0);
      expect(rectangleOriginal.lowerRight.x).toStrictEqual(100);
      expect(rectangleOriginal.lowerRight.y).toStrictEqual(100);

      // The mirrored version should be a polygon
      expect(shapes[1].shape).toStrictEqual('polygon');
      const mirrored = shapes[1] as RenderShapePolygon;
      expect(mirrored.points).toHaveLength(5);
      expect(mirrored.points[0].point.x).toStrictEqual(400);
      expect(mirrored.points[0].point.y).toStrictEqual(0);
      expect(mirrored.points[1].point.x).toStrictEqual(300);
      expect(mirrored.points[1].point.y).toStrictEqual(0);
      expect(mirrored.points[2].point.x).toStrictEqual(300);
      expect(mirrored.points[2].point.y).toStrictEqual(100);
      expect(mirrored.points[3].point.x).toStrictEqual(400);
      expect(mirrored.points[3].point.y).toStrictEqual(100);
      expect(mirrored.points[4].point.x).toStrictEqual(400);
      expect(mirrored.points[4].point.y).toStrictEqual(0);
    });

    it('should mirror rectangle with fillet across a line', async () => {
      // Create a new rectangle
      const rectangle = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(100, 100)),
      );

      // Add a fillet centered on the upperRight point of the rectangle
      const filletFilter = geometryStore.add(
        ID_PREFIXES.filter,
        FilletFilter.createOnRectangle(
          rectangle.id,
          'upperLeft',
          'upperRight',
          'lowerRight',
          Length.centimeters(20),
        ),
      );

      const mirrorFilter = geometryStore.add(
        ID_PREFIXES.filter,
        MirrorFilter.create(rectangle.id, new SheetPosition(200, 0), new SheetPosition(200, 100)),
      );

      // Generate the shape, make sure that the fillet corner is rendered
      const shapes = GeometryComponent.getRenderShapes(rectangle, sheet.defaultUnit, [
        // NOTE: the order here is backwards from the order they should be applied in,
        // that's also part of the test. Fillet should be applied first, then the rectangle with
        // fillet shape should be mirrored.
        mirrorFilter,
        filletFilter,
      ]);

      expect(shapes).toHaveLength(2);
      expect(shapes[0].shape).toStrictEqual('polygon');

      // Render the original polygon (rendered on left)
      const originalShape = shapes[0] as RenderShapePolygon;
      expect(originalShape.points).toHaveLength(6);

      // Make sure all points are positioned where they should be
      expect(originalShape.points[0].type).toStrictEqual('point');
      expect(originalShape.points[0].point.x).toStrictEqual(0);
      expect(originalShape.points[0].point.y).toStrictEqual(0);

      expect(originalShape.points[1].type).toStrictEqual('point');
      expect(originalShape.points[1].point.x).toStrictEqual(80);
      expect(originalShape.points[1].point.y).toStrictEqual(0);

      expect(originalShape.points[2].type).toStrictEqual('arc-cubic');
      expect(originalShape.points[2].point.x).toStrictEqual(100);
      expect(originalShape.points[2].point.y).toStrictEqual(20);
      expect((originalShape.points[2] as CubicBezierSegment).controlPointA.x).toBeCloseTo(91.045);
      expect((originalShape.points[2] as CubicBezierSegment).controlPointA.y).toStrictEqual(0);
      expect((originalShape.points[2] as CubicBezierSegment).controlPointB.x).toStrictEqual(100);
      expect((originalShape.points[2] as CubicBezierSegment).controlPointB.y).toBeCloseTo(8.954);

      expect(originalShape.points[3].type).toStrictEqual('point');
      expect(originalShape.points[3].point.x).toStrictEqual(100);
      expect(originalShape.points[3].point.y).toStrictEqual(100);

      expect(originalShape.points[4].type).toStrictEqual('point');
      expect(originalShape.points[4].point.x).toStrictEqual(0);
      expect(originalShape.points[4].point.y).toStrictEqual(100);

      expect(originalShape.points[5].type).toStrictEqual('point');
      expect(originalShape.points[5].point.x).toStrictEqual(0);
      expect(originalShape.points[5].point.y).toStrictEqual(0);

      expect(shapes[1].shape).toStrictEqual('polygon');

      // Render the mirrored polygon (flipped over x=200 vertical line)
      const mirroredShape = shapes[1] as RenderShapePolygon;
      expect(mirroredShape.points).toHaveLength(6);

      // Make sure all points are positioned where they should be
      expect(mirroredShape.points[0].type).toStrictEqual('point');
      expect(mirroredShape.points[0].point.x).toStrictEqual(400);
      expect(mirroredShape.points[0].point.y).toStrictEqual(0);

      expect(mirroredShape.points[1].type).toStrictEqual('point');
      expect(mirroredShape.points[1].point.x).toStrictEqual(320);
      expect(mirroredShape.points[1].point.y).toStrictEqual(0);

      expect(mirroredShape.points[2].type).toStrictEqual('arc-cubic');
      expect(mirroredShape.points[2].point.x).toStrictEqual(300);
      expect(mirroredShape.points[2].point.y).toStrictEqual(20);
      expect((mirroredShape.points[2] as CubicBezierSegment).controlPointA.x).toBeCloseTo(308.955);
      expect((mirroredShape.points[2] as CubicBezierSegment).controlPointA.y).toStrictEqual(0);
      expect((mirroredShape.points[2] as CubicBezierSegment).controlPointB.x).toStrictEqual(300);
      expect((mirroredShape.points[2] as CubicBezierSegment).controlPointB.y).toBeCloseTo(8.954);

      expect(mirroredShape.points[3].type).toStrictEqual('point');
      expect(mirroredShape.points[3].point.x).toStrictEqual(300);
      expect(mirroredShape.points[3].point.y).toStrictEqual(100);

      expect(mirroredShape.points[4].type).toStrictEqual('point');
      expect(mirroredShape.points[4].point.x).toStrictEqual(400);
      expect(mirroredShape.points[4].point.y).toStrictEqual(100);

      expect(mirroredShape.points[5].type).toStrictEqual('point');
      expect(mirroredShape.points[5].point.x).toStrictEqual(400);
      expect(mirroredShape.points[5].point.y).toStrictEqual(0);
    });
  });

  describe('PolygonSegment.reverseList', () => {
    it('returns empty array for empty input', () => {
      expect(PolygonSegment.reverseList([])).toEqual([]);
    });

    it('returns single plain point for a one-segment path', () => {
      const result = PolygonSegment.reverseList([
        { type: 'point', point: new SheetPosition(5, 10) },
      ]);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ type: 'point', point: new SheetPosition(5, 10) });
    });

    it('reverses a path of plain point segments', () => {
      // Original: P0(0,0) -> P1(10,0) -> P2(10,10)
      // Reversed: P2(10,10) -> P1(10,0) -> P0(0,0)
      const result = PolygonSegment.reverseList([
        { type: 'point', point: new SheetPosition(0, 0) },
        { type: 'point', point: new SheetPosition(10, 0) },
        { type: 'point', point: new SheetPosition(10, 10) },
      ]);

      expect(result).toHaveLength(3);
      // First element is moveTo at old end
      expect(result[0]).toEqual({ type: 'point', point: new SheetPosition(10, 10) });
      // Second draws from (10,10) to (10,0)
      expect(result[1]).toEqual({ type: 'point', point: new SheetPosition(10, 0) });
      // Third draws from (10,0) to (0,0)
      expect(result[2]).toEqual({ type: 'point', point: new SheetPosition(0, 0) });
    });

    it('reverses a path with a quadratic bezier segment', () => {
      // Original: P0(0,0) -> P1(10,5) via C(5,10) -> P2(20,5)
      // Quadratic bezier is symmetric, control point stays the same
      const result = PolygonSegment.reverseList([
        { type: 'point', point: new SheetPosition(0, 0) },
        {
          type: 'arc-quadratic',
          point: new SheetPosition(10, 5),
          controlPoint: new SheetPosition(5, 10),
        },
        { type: 'point', point: new SheetPosition(20, 5) },
      ]);

      expect(result).toHaveLength(3);
      // moveTo at old end
      expect(result[0]).toEqual({ type: 'point', point: new SheetPosition(20, 5) });
      // previously line from P1(10,5) to P2(20,5), reversed as line from P2 to P1
      expect(result[1]).toEqual({ type: 'point', point: new SheetPosition(10, 5) });
      // previously quadratic from P0(0,0) to P1(10,5) via C(5,10),
      // reversed as quadratic from P1 to P0 with same control point
      const revQuad = result[2] as QuadraticBezierSegment;
      expect(revQuad.type).toBe('arc-quadratic');
      expect(revQuad.point.x).toBeCloseTo(0, 0);
      expect(revQuad.point.y).toBeCloseTo(0, 0);
      expect(revQuad.controlPoint.x).toBeCloseTo(5, 0);
      expect(revQuad.controlPoint.y).toBeCloseTo(10, 0);
    });

    it('reverses a path with a cubic bezier segment, swapping control points', () => {
      // Original: P0(0,0) -> P1(20,0) via CA(5,5), CB(15,5) -> P2(30,0)
      const result = PolygonSegment.reverseList([
        { type: 'point', point: new SheetPosition(0, 0) },
        {
          type: 'arc-cubic',
          point: new SheetPosition(20, 0),
          controlPointA: new SheetPosition(5, 5),
          controlPointB: new SheetPosition(15, 5),
        },
        { type: 'point', point: new SheetPosition(30, 0) },
      ]);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ type: 'point', point: new SheetPosition(30, 0) });
      // line from P1(20,0) to P2(30,0) reversed = line from P2 to P1
      expect(result[1]).toEqual({ type: 'point', point: new SheetPosition(20, 0) });
      // cubic from P0(0,0) to P1(20,0) via CA(5,5),CB(15,5) reversed:
      // cubic from P1 to P0 via CB(15,5),CA(5,5)
      const revCubic = result[2] as CubicBezierSegment;
      expect(revCubic.type).toBe('arc-cubic');
      expect(revCubic.point.x).toBeCloseTo(0, 0);
      expect(revCubic.point.y).toBeCloseTo(0, 0);
      expect(revCubic.controlPointA.x).toBeCloseTo(15, 0);
      expect(revCubic.controlPointA.y).toBeCloseTo(5, 0);
      expect(revCubic.controlPointB.x).toBeCloseTo(5, 0);
      expect(revCubic.controlPointB.y).toBeCloseTo(5, 0);
    });

    it('reverses a mixed path with point, quadratic, and cubic segments', () => {
      // Original: P0(0,0) -> P1(10,0) -> P2(20,5) cubic via cA(12,10),cB(18,10) -> P3(30,10)
      const segments: Array<PolygonSegment> = [
        { type: 'point', point: new SheetPosition(0, 0) },
        { type: 'point', point: new SheetPosition(10, 0) },
        {
          type: 'arc-cubic',
          point: new SheetPosition(20, 5),
          controlPointA: new SheetPosition(12, 10),
          controlPointB: new SheetPosition(18, 10),
        },
        {
          type: 'arc-quadratic',
          point: new SheetPosition(30, 10),
          controlPoint: new SheetPosition(25, 15),
        },
      ];

      const result = PolygonSegment.reverseList(segments);

      expect(result).toHaveLength(4);

      // moveTo at old end P3(30,10)
      expect(result[0]).toEqual({ type: 'point', point: new SheetPosition(30, 10) });

      // quadratic reverse: from P3(30,10) to P2(20,5), same control
      const revQuad = result[1] as QuadraticBezierSegment;
      expect(revQuad.type).toBe('arc-quadratic');
      expect(revQuad.point.x).toBeCloseTo(20, 0);
      expect(revQuad.point.y).toBeCloseTo(5, 0);
      expect(revQuad.controlPoint.x).toBeCloseTo(25, 0);
      expect(revQuad.controlPoint.y).toBeCloseTo(15, 0);

      // cubic reverse: from P2(20,5) to P1(10,0), control points swapped
      const revCubic = result[2] as CubicBezierSegment;
      expect(revCubic.type).toBe('arc-cubic');
      expect(revCubic.point.x).toBeCloseTo(10, 0);
      expect(revCubic.point.y).toBeCloseTo(0, 0);
      expect(revCubic.controlPointA.x).toBeCloseTo(18, 0);
      expect(revCubic.controlPointA.y).toBeCloseTo(10, 0);
      expect(revCubic.controlPointB.x).toBeCloseTo(12, 0);
      expect(revCubic.controlPointB.y).toBeCloseTo(10, 0);

      // line reverse: from P1(10,0) to P0(0,0)
      expect(result[3]).toEqual({ type: 'point', point: new SheetPosition(0, 0) });
    });
  });
});
