import { ActionsManager } from '@/lib/actions/ActionsManager';
import {
  CubicBezierSegment,
  GeometryComponent,
  PointSegment,
  Rectangle,
  RenderShapePolygon,
} from '@/lib/entity';
import { GeometryStore, ID_PREFIXES } from '@/lib/entity/GeometryStore';
import { FilletFilter } from '@/lib/entity/filters/fillet';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { SerializationManager } from '@/lib/serialization/SerializationManager';
import { Sheet } from '@/lib/sheet/Sheet';
import { CornerState } from '@/lib/tools/BaseCornerGeometryReplacerTool';
import { FilletTool } from '@/lib/tools/FilletTool';
import { SelectionManager } from '@/lib/tools/SelectionManager';
import { ToolManager } from '@/lib/tools/ToolManager';
import { Length } from '@/lib/units/length';
import { ViewportControls } from '@/lib/viewport/ViewportControls';
import { ScreenPosition, SheetPosition, type ViewportState } from '@/lib/viewport/types';

function makePoint(x: number, y: number): PointSegment {
  return { type: 'point', point: new SheetPosition(x, y) };
}

function sheetToScreen(x: number, y: number, viewport: ViewportState): ScreenPosition {
  return new SheetPosition(x, y).toWorld().toScreen(viewport);
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
  });
});
