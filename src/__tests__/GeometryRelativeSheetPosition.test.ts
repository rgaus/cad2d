import { Ellipse, GeometryComponent, Rectangle } from '@/lib/entity';
import { GeometryStore, ID_PREFIXES } from '@/lib/entity/GeometryStore';
import { AnchorPointComponent } from '@/lib/entity/components/AnchorPointComponent';
import { RotationComponent } from '@/lib/entity/components/RotationComponent';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { Angle } from '@/lib/units/angle';
import { SheetPosition } from '@/lib/viewport/types';

function expectRelative(
  geometry: Parameters<SheetPosition['toGeometryRelativeSheetPosition']>[0],
  sheet: SheetPosition,
  expectedX: number,
  expectedY: number,
) {
  const relative = sheet.toGeometryRelativeSheetPosition(geometry);
  expect(relative.x).toBeCloseTo(expectedX);
  expect(relative.y).toBeCloseTo(expectedY);
  const roundTrip = relative.toSheet(geometry);
  expect(roundTrip.x).toBeCloseTo(sheet.x);
  expect(roundTrip.y).toBeCloseTo(sheet.y);
}

describe('GeometryRelativeSheetPosition', () => {
  let geometryStore: GeometryStore;

  beforeEach(() => {
    const historyManager = new HistoryManager();
    geometryStore = new GeometryStore(historyManager);
    historyManager.setGeometryStore(geometryStore);
  });

  it('is relative to the raw origin when there is no anchor offset or rotation', () => {
    const rectangle = geometryStore.addOrdered(
      ID_PREFIXES.rectangle,
      Rectangle.create(new SheetPosition(10, 20), new SheetPosition(14, 22)),
    );
    const geometry = geometryStore.getByIdWithComponent(rectangle.id, GeometryComponent)!;

    expectRelative(geometry, new SheetPosition(10, 20), 0, 0);
    expectRelative(geometry, new SheetPosition(14, 22), 4, 2);
  });

  it('accounts for an anchor point translation', () => {
    const rectangle = geometryStore.addOrdered(
      ID_PREFIXES.rectangle,
      Rectangle.create(new SheetPosition(11, 15), new SheetPosition(16, 17)),
    );
    geometryStore.updateByIdWithComponent(rectangle.id, AnchorPointComponent, (g) =>
      AnchorPointComponent.update(g, {
        keyPoint: 'lowerRight',
        offset: new SheetPosition(-2, -3),
      }),
    );
    const geometry = geometryStore.getByIdWithComponents(
      rectangle.id,
      GeometryComponent,
      AnchorPointComponent,
    )!;

    // Rendered natural origin is raw origin minus the (3, -1) anchor offset.
    expectRelative(geometry, new SheetPosition(8, 16), 0, 0);
    // Raw upper-right (16, 15) renders at (13, 16).
    expectRelative(geometry, new SheetPosition(13, 16), 5, 0);
    expectRelative(geometry, new SheetPosition(13, 18), 5, 2);
  });

  it('accounts for rotation', () => {
    const rectangle = geometryStore.addOrdered(
      ID_PREFIXES.rectangle,
      Rectangle.create(new SheetPosition(10, 10), new SheetPosition(14, 12)),
    );
    geometryStore.updateByIdWithComponent(rectangle.id, RotationComponent, (g) =>
      RotationComponent.update(g, { angle: Angle.degrees(90) }),
    );
    const geometry = geometryStore.getByIdWithComponents(
      rectangle.id,
      GeometryComponent,
      AnchorPointComponent,
    )!;

    // Raw upper-right (14, 10) renders at (10, 14) after a 90 degree rotation.
    expectRelative(geometry, new SheetPosition(10, 14), 4, 0);
    expectRelative(geometry, new SheetPosition(8, 14), 4, 2);
    expectRelative(geometry, new SheetPosition(10, 10), 0, 0);
  });

  it('accounts for anchor point translation and rotation together', () => {
    const rectangle = geometryStore.addOrdered(
      ID_PREFIXES.rectangle,
      Rectangle.create(new SheetPosition(11, 15), new SheetPosition(16, 17)),
    );
    geometryStore.updateByIdWithComponent(rectangle.id, AnchorPointComponent, (g) =>
      AnchorPointComponent.update(g, {
        keyPoint: 'lowerRight',
        offset: new SheetPosition(-2, -3),
      }),
    );
    geometryStore.updateByIdWithComponent(rectangle.id, RotationComponent, (g) =>
      RotationComponent.update(g, { angle: Angle.degrees(90) }),
    );
    const geometry = geometryStore.getByIdWithComponents(
      rectangle.id,
      GeometryComponent,
      AnchorPointComponent,
    )!;

    // Raw upper-left (11, 15) renders at (10, 12); upper-right (16, 15) renders at (10, 17).
    expectRelative(geometry, new SheetPosition(10, 12), 0, 0);
    expectRelative(geometry, new SheetPosition(10, 17), 5, 0);
    expectRelative(geometry, new SheetPosition(8, 17), 5, 2);
  });

  it('uses the natural origin when there is no anchor point component', () => {
    const rectangle = geometryStore.addOrdered(
      ID_PREFIXES.rectangle,
      Rectangle.create(new SheetPosition(10, 10), new SheetPosition(14, 12)),
    );
    geometryStore.updateByIdWithComponent(rectangle.id, RotationComponent, (g) =>
      RotationComponent.update(g, { angle: Angle.degrees(90) }),
    );
    const withAnchor = geometryStore.getByIdWithComponents(
      rectangle.id,
      GeometryComponent,
      AnchorPointComponent,
    )!;
    const geometry = AnchorPointComponent.remove(withAnchor);

    expectRelative(geometry, new SheetPosition(10, 10), 0, 0);
    expectRelative(geometry, new SheetPosition(10, 14), 4, 0);
  });

  it('works for rotated ellipses around their center', () => {
    const ellipse = geometryStore.addOrdered(
      ID_PREFIXES.ellipse,
      Ellipse.create(new SheetPosition(10, 10), { radiusX: 4, radiusY: 2 }),
    );
    geometryStore.updateByIdWithComponent(ellipse.id, RotationComponent, (g) =>
      RotationComponent.update(g, { angle: Angle.degrees(90) }),
    );
    const geometry = geometryStore.getByIdWithComponents(
      ellipse.id,
      GeometryComponent,
      AnchorPointComponent,
    )!;

    // Raw right point (14, 10) renders at (10, 14) after a 90 degree rotation.
    expectRelative(geometry, new SheetPosition(10, 14), 4, 0);
    expectRelative(geometry, new SheetPosition(10, 10), 0, 0);
  });
});
