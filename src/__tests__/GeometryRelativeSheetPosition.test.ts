import { Ellipse, GeometryComponent, Rectangle } from '@/lib/entity';
import { GeometryStore, ID_PREFIXES } from '@/lib/entity/GeometryStore';
import { AnchorPointComponent } from '@/lib/entity/components/AnchorPointComponent';
import { RotationComponent } from '@/lib/entity/components/RotationComponent';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { BoundingBox, OrientedBoundingBox } from '@/lib/math';
import { Angle } from '@/lib/units/angle';
import { GeometryRelativeSheetPosition, SheetPosition, mapKeyPoints } from '@/lib/viewport/types';

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

  it('converts raw absolute positions from the geometry origin', () => {
    const rectangle = geometryStore.addOrdered(
      ID_PREFIXES.rectangle,
      Rectangle.create(new SheetPosition(10, 20), new SheetPosition(14, 22)),
    );
    const geometry = geometryStore.getByIdWithComponent(rectangle.id, GeometryComponent)!;

    const relative = GeometryRelativeSheetPosition.fromRawSheet(
      new SheetPosition(14, 22),
      geometry,
    );
    expect(relative.x).toBeCloseTo(4);
    expect(relative.y).toBeCloseTo(2);
    expect(relative.toSheet(geometry)).toMatchObject({ x: 14, y: 22 });
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

describe('coordinate mapping helpers', () => {
  it('maps rect and oriented rect positions without changing their dimensions', () => {
    const map = (position: SheetPosition) =>
      new GeometryRelativeSheetPosition(position.x - 5, position.y - 6);

    const rect = BoundingBox.mapPositions(
      { position: new SheetPosition(5, 6), width: 4, height: 2 },
      map,
    );
    expect(rect.position).toMatchObject({ x: 0, y: 0 });
    expect(rect.width).toBe(4);
    expect(rect.height).toBe(2);

    const oriented = OrientedBoundingBox.mapPositions(
      { position: new SheetPosition(5, 6), width: 4, height: 2, angleDegrees: 30 },
      map,
    );
    expect(oriented.position).toMatchObject({ x: 0, y: 0 });
    expect(oriented.width).toBe(4);
    expect(oriented.height).toBe(2);
    expect(oriented.angleDegrees).toBe(30);
  });

  it('maps key point positions and preserves labels and extras keys', () => {
    const mapped = mapKeyPoints(
      {
        perimeter: [new SheetPosition(5, 6), new SheetPosition(9, 6)],
        perimeterLabels: ['upperLeft', 'upperRight'],
        extras: { center: new SheetPosition(7, 7) },
      },
      (position) => new GeometryRelativeSheetPosition(position.x - 5, position.y - 6),
    );

    expect(mapped.perimeter.map((p) => `${p.x},${p.y}`)).toEqual(['0,0', '4,0']);
    expect(mapped.perimeterLabels).toEqual(['upperLeft', 'upperRight']);
    expect(mapped.extras.center).toMatchObject({ x: 2, y: 1 });
  });
});
