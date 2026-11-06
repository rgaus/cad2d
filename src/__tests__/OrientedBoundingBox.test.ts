import { Ellipse, Entity, GeometryComponent, Rectangle } from '@/lib/entity';
import { GeometryStore, ID_PREFIXES } from '@/lib/entity/GeometryStore';
import { RotationComponent } from '@/lib/entity/components/RotationComponent';
import { RenderShape } from '@/lib/entity/render-shape';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { OrientedBoundingBox } from '@/lib/math';
import { Angle } from '@/lib/units/angle';
import { SheetPosition } from '@/lib/viewport/types';

describe('OrientedBoundingBox', () => {
  it('returns the corners of an unrotated rect', () => {
    const corners = OrientedBoundingBox.corners(
      OrientedBoundingBox.fromRect({ position: new SheetPosition(2, 3), width: 4, height: 5 }),
    );
    expect(corners.upperLeft).toEqual(new SheetPosition(2, 3));
    expect(corners.upperRight).toEqual(new SheetPosition(6, 3));
    expect(corners.lowerRight).toEqual(new SheetPosition(6, 8));
    expect(corners.lowerLeft).toEqual(new SheetPosition(2, 8));
  });

  it('rotates corners around the upper-left position', () => {
    const corners = OrientedBoundingBox.corners({
      position: new SheetPosition(0, 0),
      width: 4,
      height: 2,
      angleDegrees: 90,
    });
    expect(corners.upperLeft.x).toBeCloseTo(0);
    expect(corners.upperLeft.y).toBeCloseTo(0);
    expect(corners.upperRight.x).toBeCloseTo(0);
    expect(corners.upperRight.y).toBeCloseTo(4);
    expect(corners.lowerRight.x).toBeCloseTo(-2);
    expect(corners.lowerRight.y).toBeCloseTo(4);
    expect(corners.lowerLeft.x).toBeCloseTo(-2);
    expect(corners.lowerLeft.y).toBeCloseTo(0);
  });

  it('computes an axis-aligned bounding box around rotated corners', () => {
    const aabb = OrientedBoundingBox.toRect({
      position: new SheetPosition(0, 0),
      width: 4,
      height: 2,
      angleDegrees: 90,
    });
    expect(aabb.position.x).toBeCloseTo(-2);
    expect(aabb.position.y).toBeCloseTo(0);
    expect(aabb.width).toBeCloseTo(2);
    expect(aabb.height).toBeCloseTo(4);
  });

  it('insets along the local axes', () => {
    const inset = OrientedBoundingBox.inset(
      { position: new SheetPosition(0, 0), width: 10, height: 6, angleDegrees: 90 },
      1,
    );
    expect(inset.position.x).toBeCloseTo(-1);
    expect(inset.position.y).toBeCloseTo(1);
    expect(inset.width).toBeCloseTo(8);
    expect(inset.height).toBeCloseTo(4);
    expect(inset.angleDegrees).toBe(90);
  });

  it('returns an axis-aligned union and does not preserve orientation', () => {
    const union = OrientedBoundingBox.union([
      { position: new SheetPosition(0, 0), width: 4, height: 2, angleDegrees: 90 },
      { position: new SheetPosition(10, 10), width: 2, height: 2, angleDegrees: 0 },
    ])!;
    expect(union.position.x).toBeCloseTo(-2);
    expect(union.position.y).toBeCloseTo(0);
    expect(union.width).toBeCloseTo(14);
    expect(union.height).toBeCloseTo(12);
  });

  it('detects axis-aligned rotations', () => {
    expect(
      OrientedBoundingBox.isAxisAligned({
        position: new SheetPosition(0, 0),
        width: 1,
        height: 1,
        angleDegrees: 0,
      }),
    ).toBe(true);
    expect(
      OrientedBoundingBox.isAxisAligned({
        position: new SheetPosition(0, 0),
        width: 1,
        height: 1,
        angleDegrees: 180,
      }),
    ).toBe(true);
    expect(
      OrientedBoundingBox.isAxisAligned({
        position: new SheetPosition(0, 0),
        width: 1,
        height: 1,
        angleDegrees: 45,
      }),
    ).toBe(false);
  });
});

describe('rotation-aware geometry bounding boxes', () => {
  let geometryStore: GeometryStore;

  beforeEach(() => {
    const historyManager = new HistoryManager();
    geometryStore = new GeometryStore(historyManager);
    historyManager.setGeometryStore(geometryStore);
  });

  it('computes a rotated rectangle bounding box', () => {
    const rectangle = geometryStore.addOrdered(
      ID_PREFIXES.rectangle,
      Rectangle.create(new SheetPosition(10, 10), new SheetPosition(14, 12)),
    );
    geometryStore.updateByIdWithComponent(rectangle.id, RotationComponent, (g) =>
      RotationComponent.update(g, { angle: Angle.degrees(90) }),
    );
    const geometry = geometryStore.getByIdWithComponent(rectangle.id, GeometryComponent)!;

    const oriented = GeometryComponent.orientedBoundingBox(geometry);
    expect(oriented.position.x).toBeCloseTo(0);
    expect(oriented.position.y).toBeCloseTo(0);
    expect(oriented.width).toBeCloseTo(4);
    expect(oriented.height).toBeCloseTo(2);
    expect(oriented.angleDegrees).toBeCloseTo(90);

    const bbox = GeometryComponent.boundingBox(geometry);
    expect(bbox.position.x).toBeCloseTo(0);
    expect(bbox.position.y).toBeCloseTo(0);
    expect(bbox.width).toBeCloseTo(4);
    expect(bbox.height).toBeCloseTo(2);

    const renderedBBox = Entity.boundingBoxInSheet(geometry);
    expect(renderedBBox.position.x).toBeCloseTo(8);
    expect(renderedBBox.position.y).toBeCloseTo(10);
    expect(renderedBBox.width).toBeCloseTo(2);
    expect(renderedBBox.height).toBeCloseTo(4);
  });

  it('computes a rotated ellipse bounding box', () => {
    const ellipse = geometryStore.addOrdered(
      ID_PREFIXES.ellipse,
      Ellipse.create(new SheetPosition(10, 10), { radiusX: 4, radiusY: 2 }),
    );
    geometryStore.updateByIdWithComponent(ellipse.id, RotationComponent, (g) =>
      RotationComponent.update(g, { angle: Angle.degrees(90) }),
    );
    const geometry = geometryStore.getByIdWithComponent(ellipse.id, GeometryComponent)!;

    const oriented = GeometryComponent.orientedBoundingBox(geometry);
    expect(oriented.position.x).toBeCloseTo(-4);
    expect(oriented.position.y).toBeCloseTo(-2);
    expect(oriented.width).toBeCloseTo(8);
    expect(oriented.height).toBeCloseTo(4);
    expect(oriented.angleDegrees).toBeCloseTo(90);

    const bbox = GeometryComponent.boundingBox(geometry);
    expect(bbox.position.x).toBeCloseTo(-4);
    expect(bbox.position.y).toBeCloseTo(-2);
    expect(bbox.width).toBeCloseTo(8);
    expect(bbox.height).toBeCloseTo(4);

    const renderedBBox = Entity.boundingBoxInSheet(geometry);
    expect(renderedBBox.position.x).toBeCloseTo(8);
    expect(renderedBBox.position.y).toBeCloseTo(6);
    expect(renderedBBox.width).toBeCloseTo(4);
    expect(renderedBBox.height).toBeCloseTo(8);
  });
});

describe('RenderShape.boundingBox', () => {
  it('accounts for rectangle rotation', () => {
    const bbox = RenderShape.boundingBox(
      RenderShape.rectangle('rect', new SheetPosition(0, 0), new SheetPosition(4, 2), {
        angleDegrees: 90,
      }),
    );
    expect(bbox.position.x).toBeCloseTo(-2);
    expect(bbox.position.y).toBeCloseTo(0);
    expect(bbox.width).toBeCloseTo(2);
    expect(bbox.height).toBeCloseTo(4);
  });

  it('accounts for ellipse rotation', () => {
    const bbox = RenderShape.boundingBox(
      RenderShape.ellipse('ellipse', new SheetPosition(0, 0), {
        radiusX: 4,
        radiusY: 2,
        angleDegrees: 90,
      }),
    );
    expect(bbox.position.x).toBeCloseTo(-2);
    expect(bbox.position.y).toBeCloseTo(-4);
    expect(bbox.width).toBeCloseTo(4);
    expect(bbox.height).toBeCloseTo(8);
  });
});
