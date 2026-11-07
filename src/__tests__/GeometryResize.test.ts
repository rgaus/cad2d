import {
  Ellipse,
  Entity,
  GeometryComponent,
  Polygon,
  Rectangle,
  type ResizeMode,
  type ResizeParams,
} from '@/lib/entity';
import { GeometryStore, ID_PREFIXES } from '@/lib/entity/GeometryStore';
import { AnchorPointComponent } from '@/lib/entity/components/AnchorPointComponent';
import { RotationComponent } from '@/lib/entity/components/RotationComponent';
import { EllipseData } from '@/lib/entity/geometry/ellipse';
import { PolygonData } from '@/lib/entity/geometry/polygon';
import { RectangleData } from '@/lib/entity/geometry/rectangle';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { Angle } from '@/lib/units/angle';
import { type OrientedRect, type Rect, SheetPosition } from '@/lib/viewport/types';

const DIRECTIONS: Array<{ label: string; mode: ResizeMode }> = [
  { label: 'top-left corner', mode: { type: 'corner', corner: 'top-left' } },
  { label: 'top-right corner', mode: { type: 'corner', corner: 'top-right' } },
  { label: 'bottom-left corner', mode: { type: 'corner', corner: 'bottom-left' } },
  { label: 'bottom-right corner', mode: { type: 'corner', corner: 'bottom-right' } },
  { label: 'top edge', mode: { type: 'edge', edge: 'top' } },
  { label: 'bottom edge', mode: { type: 'edge', edge: 'bottom' } },
  { label: 'left edge', mode: { type: 'edge', edge: 'left' } },
  { label: 'right edge', mode: { type: 'edge', edge: 'right' } },
];

function baseParams(to: SheetPosition, mode: ResizeMode): ResizeParams {
  return {
    to,
    mode,
    altHeld: false,
    shiftHeld: false,
    linkDimensions: false,
  };
}

/** A handle target which expands the given local bounding box in the requested direction. */
function expandedTarget(bbox: Rect<SheetPosition>, mode: ResizeMode): SheetPosition {
  const left = bbox.position.x;
  const top = bbox.position.y;
  const right = left + bbox.width;
  const bottom = top + bbox.height;
  const midX = (left + right) / 2;
  const midY = (top + bottom) / 2;

  if (mode.type === 'corner') {
    switch (mode.corner) {
      case 'top-left':
        return new SheetPosition(left - 2, top - 1);
      case 'top-right':
        return new SheetPosition(right + 2, top - 1);
      case 'bottom-left':
        return new SheetPosition(left - 2, bottom + 1);
      case 'bottom-right':
        return new SheetPosition(right + 2, bottom + 1);
    }
  }

  switch (mode.edge) {
    case 'top':
      return new SheetPosition(midX, top - 1);
    case 'bottom':
      return new SheetPosition(midX, bottom + 1);
    case 'left':
      return new SheetPosition(left - 2, midY);
    case 'right':
      return new SheetPosition(right + 2, midY);
  }
}

/** Projects a local (raw) absolute point into rendered sheet space. */
function renderPoint(geometry: Entity<GeometryComponent>, raw: SheetPosition): SheetPosition {
  return Entity.generateRenderTransformFunction(geometry)(raw);
}

/** The geometry's oriented bounding box in rendered sheet space. */
function renderedOrientedBBox(geometry: Entity<GeometryComponent>): OrientedRect<SheetPosition> {
  const local = GeometryComponent.orientedBoundingBox(geometry);
  return { ...local, position: local.position.toSheet(geometry) };
}

/** Compares two geometries allowing for the small floating point error introduced by rotation. */
function expectGeometryClose(
  actual: Entity<GeometryComponent>,
  expected: Entity<GeometryComponent>,
) {
  const a = GeometryComponent.get(actual);
  const e = GeometryComponent.get(expected);
  expect(a.type).toBe(e.type);

  if (a.type === 'rectangle' && e.type === 'rectangle') {
    expect(a.origin.x).toBeCloseTo(e.origin.x, 6);
    expect(a.origin.y).toBeCloseTo(e.origin.y, 6);
    expect(a.width).toBeCloseTo(e.width, 6);
    expect(a.height).toBeCloseTo(e.height, 6);
  } else if (a.type === 'ellipse' && e.type === 'ellipse') {
    expect(a.center.x).toBeCloseTo(e.center.x, 6);
    expect(a.center.y).toBeCloseTo(e.center.y, 6);
    expect(a.radiusX).toBeCloseTo(e.radiusX, 6);
    expect(a.radiusY).toBeCloseTo(e.radiusY, 6);
  } else if (a.type === 'polygon' && e.type === 'polygon') {
    const actualSegments = PolygonData.rawSegments(actual as Entity<GeometryComponent<never>>);
    const expectedSegments = PolygonData.rawSegments(expected as Entity<GeometryComponent<never>>);
    expect(actualSegments).toHaveLength(expectedSegments.length);
    for (let i = 0; i < actualSegments.length; i += 1) {
      expect(actualSegments[i].point.x).toBeCloseTo(expectedSegments[i].point.x, 6);
      expect(actualSegments[i].point.y).toBeCloseTo(expectedSegments[i].point.y, 6);
    }
  }
}

describe('GeometryComponent.resize', () => {
  let historyManager: HistoryManager;
  let geometryStore: GeometryStore;

  beforeEach(() => {
    historyManager = new HistoryManager();
    geometryStore = new GeometryStore(historyManager);
    historyManager.setGeometryStore(geometryStore);
  });

  function addRectangle(upperLeft: SheetPosition, lowerRight: SheetPosition) {
    return geometryStore.addOrdered(ID_PREFIXES.rectangle, Rectangle.create(upperLeft, lowerRight));
  }

  function addEllipse(center: SheetPosition, radiusX: number, radiusY: number) {
    return geometryStore.addOrdered(
      ID_PREFIXES.ellipse,
      Ellipse.create(center, { radiusX, radiusY }),
    );
  }

  function addRectanglePolygon(upperLeft: SheetPosition, lowerRight: SheetPosition) {
    return geometryStore.addOrdered(
      ID_PREFIXES.polygon,
      Polygon.create(
        [
          { type: 'point', point: upperLeft },
          { type: 'point', point: new SheetPosition(lowerRight.x, upperLeft.y) },
          { type: 'point', point: lowerRight },
          { type: 'point', point: new SheetPosition(upperLeft.x, lowerRight.y) },
        ],
        { closed: true, fillColor: null },
      ),
    );
  }

  describe('unrotated behavior', () => {
    it('matches the legacy raw resize when no frame is provided', () => {
      const rectangle = addRectangle(new SheetPosition(10, 10), new SheetPosition(14, 12));
      const geometry = geometryStore.getByIdWithComponent(rectangle.id, GeometryComponent)!;
      const params = baseParams(new SheetPosition(18, 16), {
        type: 'corner',
        corner: 'bottom-right',
      });

      const actual = GeometryComponent.resize(geometry, params);
      const expected = RectangleData.resize(geometry, params)!;

      expect(actual).not.toBeNull();
      expectGeometryClose(actual!, expected);
      expect(GeometryComponent.get(actual!)).toMatchObject({
        origin: { x: 10, y: 10 },
        width: 8,
        height: 6,
      });
    });
  });

  describe('rotated rectangle', () => {
    it.each(DIRECTIONS)('resizes from the $label in the local frame', ({ mode }) => {
      const rectangle = addRectangle(new SheetPosition(10, 10), new SheetPosition(14, 12));
      geometryStore.updateByIdWithComponent(rectangle.id, RotationComponent, (g) =>
        RotationComponent.update(g, { angle: Angle.degrees(30) }),
      );
      const geometry = geometryStore.getByIdWithComponents(
        rectangle.id,
        GeometryComponent,
        AnchorPointComponent,
        RotationComponent,
      )!;

      const rawBBox = {
        position: new SheetPosition(10, 10),
        width: 4,
        height: 2,
      };
      const localTarget = expandedTarget(rawBBox, mode);
      const expected = RectangleData.resize(geometry, baseParams(localTarget, mode), rawBBox)!;
      const actual = GeometryComponent.resize(
        geometry,
        {
          ...baseParams(renderPoint(geometry, localTarget), mode),
          frame: { angleDegrees: 30 },
        },
        renderedOrientedBBox(geometry),
      );

      expect(actual).not.toBeNull();
      expectGeometryClose(actual!, expected);
      expect(RotationComponent.get(actual!).angle.toDegrees().magnitude).toBeCloseTo(30);
    });
  });

  describe('rotated ellipse', () => {
    it.each(DIRECTIONS)('resizes from the $label in the local frame', ({ mode }) => {
      const ellipse = addEllipse(new SheetPosition(10, 10), 4, 2);
      geometryStore.updateByIdWithComponent(ellipse.id, RotationComponent, (g) =>
        RotationComponent.update(g, { angle: Angle.degrees(30) }),
      );
      const geometry = geometryStore.getByIdWithComponents(
        ellipse.id,
        GeometryComponent,
        AnchorPointComponent,
        RotationComponent,
      )!;

      const rawBBox = {
        position: new SheetPosition(6, 8),
        width: 8,
        height: 4,
      };
      const localTarget = expandedTarget(rawBBox, mode);
      const expected = EllipseData.resize(geometry, baseParams(localTarget, mode), rawBBox)!;
      const actual = GeometryComponent.resize(
        geometry,
        {
          ...baseParams(renderPoint(geometry, localTarget), mode),
          frame: { angleDegrees: 30 },
        },
        renderedOrientedBBox(geometry),
      );

      expect(actual).not.toBeNull();
      expectGeometryClose(actual!, expected);
      expect(RotationComponent.get(actual!).angle.toDegrees().magnitude).toBeCloseTo(30);
    });
  });

  describe('rotated polygon', () => {
    it.each(DIRECTIONS)('resizes from the $label in the local frame', ({ mode }) => {
      const polygon = addRectanglePolygon(new SheetPosition(10, 10), new SheetPosition(14, 12));
      geometryStore.updateById(polygon.id, (g) => ({
        ...g,
        components: { ...g.components, ...RotationComponent.create(Angle.degrees(30)) },
      }));
      const geometry = geometryStore.getByIdWithComponents(
        polygon.id,
        GeometryComponent,
        AnchorPointComponent,
        RotationComponent,
      )!;

      const rawBBox = {
        position: new SheetPosition(10, 10),
        width: 4,
        height: 2,
      };
      const localTarget = expandedTarget(rawBBox, mode);
      const expected = PolygonData.resize(geometry, baseParams(localTarget, mode), rawBBox)!;
      const actual = GeometryComponent.resize(
        geometry,
        {
          ...baseParams(renderPoint(geometry, localTarget), mode),
          frame: { angleDegrees: 30 },
        },
        renderedOrientedBBox(geometry),
      );

      expect(actual).not.toBeNull();
      expectGeometryClose(actual!, expected);
      expect(RotationComponent.get(actual!).angle.toDegrees().magnitude).toBeCloseTo(30);
    });
  });

  describe('anchor compensation', () => {
    it('keeps the derived anchor offset stable for an unrotated resize', () => {
      const rectangle = addRectangle(new SheetPosition(10, 10), new SheetPosition(14, 12));
      geometryStore.updateByIdWithComponent(rectangle.id, AnchorPointComponent, (g) =>
        AnchorPointComponent.update(g, {
          keyPoint: 'lowerRight',
          offset: new SheetPosition(1.5, -0.5),
        }),
      );
      const geometry = geometryStore.getByIdWithComponents(
        rectangle.id,
        GeometryComponent,
        AnchorPointComponent,
      )!;
      const before = AnchorPointComponent.computeAssociatedGeometryOffset(geometry);

      const actual = GeometryComponent.resize(
        geometry,
        baseParams(renderPoint(geometry, new SheetPosition(18, 16)), {
          type: 'corner',
          corner: 'bottom-right',
        }),
      );

      expect(actual).not.toBeNull();
      const after = AnchorPointComponent.computeAssociatedGeometryOffset(actual!);
      expect(after.x).toBeCloseTo(before.x);
      expect(after.y).toBeCloseTo(before.y);
      const resized = GeometryComponent.get(actual!);
      if (resized.type !== 'rectangle') {
        throw new Error('Expected rectangle');
      }
      expect(resized.origin.x).toBeCloseTo(10);
      expect(resized.origin.y).toBeCloseTo(10);
      expect(resized.width).toBeCloseTo(8);
      expect(resized.height).toBeCloseTo(6);
    });

    it('keeps the derived anchor offset and anchor handle stable for a rotated resize', () => {
      const rectangle = addRectangle(new SheetPosition(10, 10), new SheetPosition(14, 12));
      geometryStore.updateByIdWithComponent(rectangle.id, AnchorPointComponent, (g) =>
        AnchorPointComponent.update(g, {
          keyPoint: 'lowerRight',
          offset: new SheetPosition(1.5, -0.5),
        }),
      );
      geometryStore.updateByIdWithComponent(rectangle.id, RotationComponent, (g) =>
        RotationComponent.update(g, { angle: Angle.degrees(30) }),
      );
      const geometry = geometryStore.getByIdWithComponents(
        rectangle.id,
        GeometryComponent,
        AnchorPointComponent,
        RotationComponent,
      )!;
      const beforeOffset = AnchorPointComponent.computeAssociatedGeometryOffset(geometry);
      const beforeHandle = AnchorPointComponent.getHandlePosition(geometry);

      const localTarget = new SheetPosition(18, 14);
      const actual = GeometryComponent.resize(
        geometry,
        {
          ...baseParams(renderPoint(geometry, localTarget), {
            type: 'corner',
            corner: 'bottom-right',
          }),
          frame: { angleDegrees: 30 },
        },
        renderedOrientedBBox(geometry),
      );

      expect(actual).not.toBeNull();
      const afterOffset = AnchorPointComponent.computeAssociatedGeometryOffset(actual!);
      expect(afterOffset.x).toBeCloseTo(beforeOffset.x);
      expect(afterOffset.y).toBeCloseTo(beforeOffset.y);
      const afterHandle = AnchorPointComponent.getHandlePosition(actual!);
      expect(afterHandle.x).toBeCloseTo(beforeHandle.x);
      expect(afterHandle.y).toBeCloseTo(beforeHandle.y);
      const resized = GeometryComponent.get(actual!);
      if (resized.type !== 'rectangle') {
        throw new Error('Expected rectangle');
      }
      expect(resized.origin.x).toBeCloseTo(10);
      expect(resized.origin.y).toBeCloseTo(10);
      expect(resized.width).toBeCloseTo(8);
      expect(resized.height).toBeCloseTo(4);
    });
  });

  describe('invalid geometry', () => {
    it('returns null for a zero-area original bounding box', () => {
      const rectangle = addRectangle(new SheetPosition(10, 10), new SheetPosition(14, 12));
      const geometry = geometryStore.getByIdWithComponent(rectangle.id, GeometryComponent)!;

      const actual = GeometryComponent.resize(
        geometry,
        baseParams(new SheetPosition(18, 16), { type: 'corner', corner: 'bottom-right' }),
        { position: new SheetPosition(10, 10), width: 0, height: 2 },
      );

      expect(actual).toBeNull();
    });

    it('returns null instead of NaN when a rectangle corner collapses an axis', () => {
      const rectangle = addRectangle(new SheetPosition(10, 10), new SheetPosition(14, 12));
      const geometry = geometryStore.getByIdWithComponent(rectangle.id, GeometryComponent)!;

      const actual = GeometryComponent.resize(
        geometry,
        baseParams(new SheetPosition(10, 16), { type: 'corner', corner: 'bottom-right' }),
      );

      expect(actual).toBeNull();
    });

    it('returns null instead of NaN when an ellipse corner collapses an axis', () => {
      const ellipse = addEllipse(new SheetPosition(10, 10), 4, 2);
      const geometry = geometryStore.getByIdWithComponent(ellipse.id, GeometryComponent)!;

      const actual = GeometryComponent.resize(
        geometry,
        baseParams(new SheetPosition(6, 14), { type: 'corner', corner: 'bottom-right' }),
      );

      expect(actual).toBeNull();
    });

    it('returns null for a zero-size polygon bounding box', () => {
      const point = new SheetPosition(10, 10);
      const polygon = geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create(
          [
            { type: 'point', point },
            { type: 'point', point: new SheetPosition(point.x, point.y) },
          ],
          { closed: true, fillColor: null },
        ),
      );
      const geometry = geometryStore.getByIdWithComponent(polygon.id, GeometryComponent)!;

      const actual = GeometryComponent.resize(
        geometry,
        baseParams(new SheetPosition(14, 14), { type: 'corner', corner: 'bottom-right' }),
      );

      expect(actual).toBeNull();
    });
  });
});
