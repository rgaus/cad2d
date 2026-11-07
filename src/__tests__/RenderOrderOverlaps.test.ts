import { GeometryComponent, Rectangle } from '@/lib/entity';
import { GeometryStore, ID_PREFIXES } from '@/lib/entity/GeometryStore';
import { RotationComponent } from '@/lib/entity/components/RotationComponent';
import { findRenderOrderOverlaps } from '@/lib/entity/render-order-overlaps';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { Angle } from '@/lib/units/angle';
import { SheetPosition } from '@/lib/viewport/types';

describe('findRenderOrderOverlaps', () => {
  let geometryStore: GeometryStore;

  beforeEach(() => {
    const historyManager = new HistoryManager();
    geometryStore = new GeometryStore(historyManager);
    historyManager.setGeometryStore(geometryStore);
  });

  it('compares rendered sheet-space bounds instead of raw bounds', () => {
    const rotated = geometryStore.addOrdered(
      ID_PREFIXES.rectangle,
      Rectangle.create(new SheetPosition(0, 0), new SheetPosition(10, 10)),
    );
    geometryStore.updateByIdWithComponent(rotated.id, RotationComponent, (g) =>
      RotationComponent.update(g, { angle: Angle.degrees(45) }),
    );
    const overlapping = geometryStore.addOrdered(
      ID_PREFIXES.rectangle,
      Rectangle.create(new SheetPosition(-8, 1), new SheetPosition(-6, 2)),
    );

    const overlaps = findRenderOrderOverlaps(geometryStore, rotated.id);

    expect(overlaps.map((overlap) => overlap.id)).toEqual([overlapping.id]);
    const rawBounds = GeometryComponent.boundingBox(
      geometryStore.getByIdWithComponent(rotated.id, GeometryComponent)!,
    );
    expect(rawBounds.position.x).toBeCloseTo(0);
  });
});
