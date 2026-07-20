import { ActionsManager } from '@/lib/actions/ActionsManager';
import {
  CubicBezierSegment,
  GeometryComponent,
  PointSegment,
  Polygon,
  Rectangle,
  RenderShapePolygon,
  RenderShapeRectangle,
} from '@/lib/entity';
import { GeometryStore, ID_PREFIXES } from '@/lib/entity/GeometryStore';
import { FilletFilter } from '@/lib/entity/filters/fillet';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { SerializationManager } from '@/lib/serialization/SerializationManager';
import { Sheet } from '@/lib/sheet/Sheet';
import { FilletTool } from '@/lib/tools/FilletTool';
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
  let filletTool: FilletTool;
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
    filletTool = toolManager.getTool('edit').activeSubTool as FilletTool;
  });

  describe('getRenderShapes', () => {
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

    it('should return polygons unprocessed', async () => {
      // Create a new polygon (triangle)
      const polygon = geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(0, 0), makePoint(100, 0), makePoint(100, 100), makePoint(0, 0)], {
          closed: true,
        }),
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

    it('should render rectangles with fillets properly', async () => {
      // Create a new rectangle
      const rectangle = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(100, 100)),
      );

      // Add a fillet centered on the upperLeft point of the rectangle
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
});
