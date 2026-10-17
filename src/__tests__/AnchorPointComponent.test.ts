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

  describe('getHandlePosition', () => {
    it('renders at the upper-left corner of a rectangle for (0,0)', () => {
      const rectangle = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(1, 2), new SheetPosition(5, 6)),
      );
      const geometry = geometryStore.getByIdWithComponents(
        rectangle.id,
        GeometryComponent,
        AnchorPointComponent,
      )!;

      const pos = AnchorPointComponent.getHandlePosition(geometry);
      expect(pos.x).toBe(1);
      expect(pos.y).toBe(2);
    });

    it('renders at the bounding box upper-left corner of a polygon for (0,0)', () => {
      const polygon = geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(2, 3), makePoint(8, 3), makePoint(5, 9)], { closed: true }),
      );
      const geometry = geometryStore.getByIdWithComponents(
        polygon.id,
        GeometryComponent,
        AnchorPointComponent,
      )!;

      const pos = AnchorPointComponent.getHandlePosition(geometry);
      expect(pos.x).toBe(2);
      expect(pos.y).toBe(3);
    });

    it('renders at the center of an ellipse for (0,0)', () => {
      const ellipse = geometryStore.addOrdered(
        ID_PREFIXES.ellipse,
        Ellipse.create(new SheetPosition(6, 7), { radiusX: 2, radiusY: 4 }),
      );
      const geometry = geometryStore.getByIdWithComponents(
        ellipse.id,
        GeometryComponent,
        AnchorPointComponent,
      )!;

      const pos = AnchorPointComponent.getHandlePosition(geometry);
      expect(pos.x).toBe(6);
      expect(pos.y).toBe(7);
    });

    it('offsets the handle by the anchor point value in sheet units', () => {
      const rectangle = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(1, 2), new SheetPosition(5, 6)),
      );
      geometryStore.updateByIdWithComponent(rectangle.id, AnchorPointComponent, (g) =>
        AnchorPointComponent.update(g, new SheetPosition(10, 20)),
      );
      const geometry = geometryStore.getByIdWithComponents(
        rectangle.id,
        GeometryComponent,
        AnchorPointComponent,
      )!;

      const pos = AnchorPointComponent.getHandlePosition(geometry);
      expect(pos.x).toBe(11);
      expect(pos.y).toBe(22);
    });
  });

  describe('anchorPointMove undo entry', () => {
    it('applies, undoes, and redoes an anchor point move', () => {
      const rectangle = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(4, 4)),
      );
      const readAnchor = () =>
        AnchorPointComponent.get(
          geometryStore.getByIdWithComponent(rectangle.id, AnchorPointComponent)!,
        );

      historyManager.apply(
        UndoEntry.anchorPointMove(rectangle.id, new SheetPosition(0, 0), new SheetPosition(5, 6)),
      );
      expect(readAnchor().x).toBe(5);
      expect(readAnchor().y).toBe(6);

      historyManager.undo();
      expect(readAnchor().x).toBe(0);
      expect(readAnchor().y).toBe(0);

      historyManager.redo();
      expect(readAnchor().x).toBe(5);
      expect(readAnchor().y).toBe(6);
    });
  });
});
