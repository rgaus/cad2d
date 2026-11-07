import { GeometryComponent, Rectangle } from '@/lib/entity';
import { GeometryStore, ID_PREFIXES } from '@/lib/entity/GeometryStore';
import type { RectangleData } from '@/lib/entity/geometry/rectangle';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { SheetPosition } from '@/lib/viewport/types';

describe('GeometryStore DCEL scheduling', () => {
  let historyManager: HistoryManager;
  let geometryStore: GeometryStore;

  beforeEach(() => {
    jest.useFakeTimers();
    historyManager = new HistoryManager();
    geometryStore = new GeometryStore(historyManager);
    historyManager.setGeometryStore(geometryStore);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('flushes pending DCEL updates immediately', () => {
    const rectangle = geometryStore.addOrdered(
      ID_PREFIXES.rectangle,
      Rectangle.create(new SheetPosition(0, 0), new SheetPosition(1, 1)),
    );
    const spy = jest.spyOn(geometryStore.dcelIndex, 'updateGeometry');

    geometryStore.updateByIdDirect(rectangle.id, (old) =>
      GeometryComponent.update(
        old as Rectangle,
        {
          origin: new SheetPosition(5, 5),
        } as RectangleData,
      ),
    );

    expect(spy).not.toHaveBeenCalled();
    geometryStore.flushDcelUpdates();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('cancels pending DCEL updates on clearAll', () => {
    const rectangle = geometryStore.addOrdered(
      ID_PREFIXES.rectangle,
      Rectangle.create(new SheetPosition(0, 0), new SheetPosition(1, 1)),
    );
    const spy = jest.spyOn(geometryStore.dcelIndex, 'updateGeometry');

    geometryStore.updateByIdDirect(rectangle.id, (old) =>
      GeometryComponent.update(
        old as Rectangle,
        {
          origin: new SheetPosition(5, 5),
        } as RectangleData,
      ),
    );
    geometryStore.clearAll();
    jest.runAllTimers();

    expect(spy).not.toHaveBeenCalled();
  });
});
