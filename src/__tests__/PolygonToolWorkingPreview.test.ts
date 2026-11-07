import { Entity, GeometryComponent, Polygon } from '@/lib/entity';
import { GeometryStore, ID_PREFIXES } from '@/lib/entity/GeometryStore';
import { RotationComponent } from '@/lib/entity/components/RotationComponent';
import { PolygonData } from '@/lib/entity/geometry/polygon';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { PolygonTool } from '@/lib/tools/PolygonTool';
import { SelectionManager } from '@/lib/tools/SelectionManager';
import { ToolManager } from '@/lib/tools/ToolManager';
import { Angle } from '@/lib/units/angle';
import {
  ScreenPosition,
  SheetPosition,
  ViewportPosition,
  type ViewportState,
} from '@/lib/viewport/types';

function createViewportState(scale: number = 1): ViewportState {
  return {
    position: new ViewportPosition(0, 0),
    scale,
  };
}

describe('PolygonTool rendered working preview', () => {
  let historyManager: HistoryManager;
  let geometryStore: GeometryStore;
  let selectionManager: SelectionManager;
  let toolManager: ToolManager;
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
    polygonTool.setSnappingOptions({ primaryGridSize: 0.001, secondaryGridSize: 0.001 });
  });

  it('builds working points in rendered space and converts them back on commit', () => {
    const polygon = geometryStore.addOrdered(
      ID_PREFIXES.polygon,
      Polygon.create(
        [
          { type: 'point', point: new SheetPosition(10, 10) },
          { type: 'point', point: new SheetPosition(20, 10) },
        ],
        { closed: false, fillColor: null, openAtIndex: 0 },
      ),
    );
    geometryStore.updateById(polygon.id, (geometry) =>
      RotationComponent.update(geometry as Entity<RotationComponent>, {
        angle: Angle.degrees(90),
      }),
    );
    const rotated = geometryStore.getByIdWithComponent(polygon.id, GeometryComponent)!;
    const rendered = PolygonData.renderedSegments(rotated);

    expect(rendered[0].point.x).toBeCloseTo(10);
    expect(rendered[0].point.y).toBeCloseTo(10);
    expect(rendered[1].point.x).toBeCloseTo(10);
    expect(rendered[1].point.y).toBeCloseTo(20);

    polygonTool.setHoveringEndpointOfPolygon({
      polygonId: polygon.id,
      pointIndex: 1,
      isStartPoint: false,
    });
    toolManager.handleMouseDown(rendered[1].point.toWorld().toScreen(viewport), viewport);
    polygonTool.setHoveringEndpointOfPolygon(null);

    const workingPolygon = geometryStore.workingPolygon!;
    expect(workingPolygon.points[0].point.x).toBeCloseTo(rendered[0].point.x);
    expect(workingPolygon.points[0].point.y).toBeCloseTo(rendered[0].point.y);
    expect(workingPolygon.points[1].point.x).toBeCloseTo(rendered[1].point.x);
    expect(workingPolygon.points[1].point.y).toBeCloseTo(rendered[1].point.y);

    const newRenderedPoint = new SheetPosition(20, 20);
    const expectedLocal = newRenderedPoint.toGeometryRelativeSheetPosition(rotated);
    toolManager.handleMouseDown(newRenderedPoint.toWorld().toScreen(viewport), viewport);
    toolManager.handleKeyDown({ key: 'Enter' } as KeyboardEvent);

    const updated = geometryStore.getByIdWithComponent(polygon.id, GeometryComponent)!;
    const updatedData = GeometryComponent.get(updated);
    expect(updatedData.type).toBe('polygon');
    if (updatedData.type !== 'polygon') {
      return;
    }

    expect(updatedData.points[0].point.x).toBeCloseTo(0);
    expect(updatedData.points[0].point.y).toBeCloseTo(0);
    expect(updatedData.points[1].point.x).toBeCloseTo(10);
    expect(updatedData.points[1].point.y).toBeCloseTo(0);
    expect(updatedData.points.at(-1)!.point.x).toBeCloseTo(expectedLocal.x);
    expect(updatedData.points.at(-1)!.point.y).toBeCloseTo(expectedLocal.y);
  });
});
