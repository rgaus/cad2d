import { Ellipse, GeometryComponent, Polygon, Rectangle } from '@/lib/entity';
import { GeometryStore, ID_PREFIXES } from '@/lib/entity/GeometryStore';
import { AnchorPointComponent } from '@/lib/entity/components/AnchorPointComponent';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { UndoEntry } from '@/lib/history/types';
import { SheetPosition } from '@/lib/viewport/types';

function makePoint(x: number, y: number) {
  return { type: 'point' as const, point: new SheetPosition(x, y) };
}

describe('AnchorPointComponent', () => {
  let historyManager: HistoryManager;
  let geometryStore: GeometryStore;

  beforeEach(() => {
    historyManager = new HistoryManager();
    geometryStore = new GeometryStore(historyManager);
    historyManager.setGeometryStore(geometryStore);
  });

  function getAnchorGeometry(id: string) {
    return geometryStore.getByIdWithComponents(id, GeometryComponent, AnchorPointComponent)!;
  }

  describe('defaults', () => {
    it('defaults a rectangle to its upperLeft key point', () => {
      const rectangle = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(1, 2), new SheetPosition(5, 6)),
      );
      const anchor = AnchorPointComponent.get(
        geometryStore.getByIdWithComponents(rectangle.id, GeometryComponent, AnchorPointComponent)!,
      );
      expect(anchor.keyPoint).toBe('upperLeft');
      expect(anchor.offset.x).toBe(0);
      expect(anchor.offset.y).toBe(0);
    });

    it('defaults a polygon to its boundingBoxUpperLeft key point', () => {
      const polygon = geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(2, 3), makePoint(8, 3), makePoint(5, 9)], { closed: true }),
      );
      const anchor = AnchorPointComponent.get(
        geometryStore.getByIdWithComponents(polygon.id, GeometryComponent, AnchorPointComponent)!,
      );
      expect(anchor.keyPoint).toBe('boundingBoxUpperLeft');
    });

    it('defaults an ellipse to its center key point', () => {
      const ellipse = geometryStore.addOrdered(
        ID_PREFIXES.ellipse,
        Ellipse.create(new SheetPosition(6, 7), { radiusX: 2, radiusY: 4 }),
      );
      const anchor = AnchorPointComponent.get(getAnchorGeometry(ellipse.id));
      expect(anchor.keyPoint).toBe('center');
    });
  });

  describe('getHandlePosition', () => {
    it('renders at the geometry origin regardless of the key point and offset', () => {
      const rectangle = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(1, 2), new SheetPosition(5, 6)),
      );
      geometryStore.updateByIdWithComponent(rectangle.id, AnchorPointComponent, (g) =>
        AnchorPointComponent.update(g, {
          keyPoint: 'upperRight',
          offset: new SheetPosition(-10, -20),
        }),
      );
      const pos = AnchorPointComponent.getHandlePosition(
        geometryStore.getByIdWithComponents(rectangle.id, GeometryComponent, AnchorPointComponent)!,
      );
      expect(pos.x).toBe(1);
      expect(pos.y).toBe(2);
    });

    it('renders at the center for an ellipse', () => {
      const ellipse = geometryStore.addOrdered(
        ID_PREFIXES.ellipse,
        Ellipse.create(new SheetPosition(6, 7), { radiusX: 2, radiusY: 4 }),
      );
      const pos = AnchorPointComponent.getHandlePosition(
        geometryStore.getByIdWithComponents(ellipse.id, GeometryComponent, AnchorPointComponent)!,
      );
      expect(pos.x).toBe(6);
      expect(pos.y).toBe(7);
    });
  });

  describe('getAvailableKeyPoints', () => {
    it('lists the rectangle corners and center', () => {
      const rectangle = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(1, 2), new SheetPosition(5, 6)),
      );
      expect(
        AnchorPointComponent.getAvailableKeyPoints(
          geometryStore.getByIdWithComponent(rectangle.id, GeometryComponent)!,
        ),
      ).toEqual(['upperLeft', 'upperRight', 'lowerRight', 'lowerLeft', 'center']);
    });

    it('lists the polygon vertices, bounding box upper-left, and centroid', () => {
      const polygon = geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(2, 3), makePoint(8, 3), makePoint(5, 9)], { closed: true }),
      );
      expect(
        AnchorPointComponent.getAvailableKeyPoints(
          geometryStore.getByIdWithComponent(polygon.id, GeometryComponent)!,
        ),
      ).toEqual(['Point 1', 'Point 2', 'Point 3', 'boundingBoxUpperLeft', 'centroid']);
    });
  });

  describe('anchorPointMove undo entry', () => {
    it('applies, undoes, and redoes an anchor point change', () => {
      const rectangle = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(1, 2), new SheetPosition(5, 6)),
      );
      const readAnchor = () => AnchorPointComponent.get(getAnchorGeometry(rectangle.id));

      historyManager.apply(
        UndoEntry.anchorPointMove(
          rectangle.id,
          { keyPoint: 'upperLeft', offset: new SheetPosition(0, 0) },
          { keyPoint: 'center', offset: new SheetPosition(5, 6) },
        ),
      );

      let anchor = AnchorPointComponent.get(getAnchorGeometry(rectangle.id));
      expect(anchor.keyPoint).toBe('center');
      expect(anchor.offset.x).toBe(5);
      expect(anchor.offset.y).toBe(6);

      historyManager.undo();
      anchor = AnchorPointComponent.get(getAnchorGeometry(rectangle.id));
      expect(anchor.keyPoint).toBe('upperLeft');
      expect(anchor.offset.x).toBe(0);
      expect(anchor.offset.y).toBe(0);

      historyManager.redo();
      anchor = AnchorPointComponent.get(getAnchorGeometry(rectangle.id));
      expect(anchor.keyPoint).toBe('center');
      expect(anchor.offset.x).toBe(5);
      expect(anchor.offset.y).toBe(6);
    });
  });
});
