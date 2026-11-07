import { GeometryComponent, Rectangle } from '@/lib/entity';
import { GeometryStore, ID_PREFIXES } from '@/lib/entity/GeometryStore';
import { RotationComponent } from '@/lib/entity/components/RotationComponent';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { Angle } from '@/lib/units/angle';
import { SheetPosition } from '@/lib/viewport/types';

describe('RotationComponent history', () => {
  let historyManager: HistoryManager;
  let geometryStore: GeometryStore;

  beforeEach(() => {
    historyManager = new HistoryManager();
    geometryStore = new GeometryStore(historyManager);
    historyManager.setGeometryStore(geometryStore);
  });

  function getAngle(id: string) {
    const geometry = geometryStore.getByIdWithComponents(id, GeometryComponent, RotationComponent)!;
    return RotationComponent.get(geometry).angle.toDegrees().magnitude;
  }

  it('undoes and redoes rotation changes', () => {
    const rectangle = geometryStore.addOrdered(
      ID_PREFIXES.rectangle,
      Rectangle.create(new SheetPosition(0, 0), new SheetPosition(4, 2)),
    );

    geometryStore.updateByIdWithComponent(rectangle.id, RotationComponent, (geometry) =>
      RotationComponent.update(geometry, { angle: Angle.degrees(45) }),
    );
    expect(getAngle(rectangle.id)).toBeCloseTo(45);

    historyManager.undo();
    expect(getAngle(rectangle.id)).toBeCloseTo(0);

    historyManager.redo();
    expect(getAngle(rectangle.id)).toBeCloseTo(45);
  });

  it('records rotation changes even when geometry data is unchanged', () => {
    const rectangle = geometryStore.addOrdered(
      ID_PREFIXES.rectangle,
      Rectangle.create(new SheetPosition(0, 0), new SheetPosition(4, 2)),
    );
    const undoDepthBefore = historyManager.getUndoStack().length;

    geometryStore.updateByIdWithComponent(rectangle.id, RotationComponent, (geometry) =>
      RotationComponent.update(geometry, { angle: Angle.degrees(90) }),
    );

    expect(historyManager.getUndoStack().length).toBe(undoDepthBefore + 1);
    expect(historyManager.getUndoStack().at(-1)?.type).toBe('rotation-change');
  });
});
