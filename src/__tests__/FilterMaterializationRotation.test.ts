import { ActionsManager } from '@/lib/actions/ActionsManager';
import {
  ConstraintComponent,
  ConstraintEndpoint,
  Ellipse,
  Entity,
  GeometryComponent,
  HorizontalConstraint,
  LinkDimensionsComponent,
  Polygon,
  Rectangle,
  RenderOrderComponent,
} from '@/lib/entity';
import { GeometryStore, ID_PREFIXES } from '@/lib/entity/GeometryStore';
import { DEFAULT_COLOR } from '@/lib/entity/colors';
import { AnchorPointComponent } from '@/lib/entity/components/AnchorPointComponent';
import { FillColorComponent } from '@/lib/entity/components/FillColorComponent';
import { FilterComponent } from '@/lib/entity/components/FilterComponent';
import { RotationComponent } from '@/lib/entity/components/RotationComponent';
import { ChamferFilter } from '@/lib/entity/filters/chamfer';
import { FilletFilter } from '@/lib/entity/filters/fillet';
import { MirrorFilter } from '@/lib/entity/filters/mirror';
import { PatternFilter } from '@/lib/entity/filters/pattern';
import { RenderShape } from '@/lib/entity/render-shape';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { Sheet } from '@/lib/sheet/Sheet';
import { SelectionManager } from '@/lib/tools/SelectionManager';
import { Angle } from '@/lib/units/angle';
import { Length } from '@/lib/units/length';
import { SheetPosition } from '@/lib/viewport/types';

type PointSegment = { type: 'point'; point: SheetPosition };

function point(x: number, y: number): PointSegment {
  return { type: 'point', point: new SheetPosition(x, y) };
}

function setup() {
  const historyManager = new HistoryManager();
  const geometryStore = new GeometryStore(historyManager);
  historyManager.setGeometryStore(geometryStore);
  const selectionManager = new SelectionManager();
  const actionsManager = new ActionsManager(
    Sheet.a4(),
    geometryStore,
    selectionManager,
    historyManager,
  );
  return { historyManager, geometryStore, selectionManager, actionsManager };
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** Stable textual representation of a render shape, ignoring the trailing duplicate closing point. */
function renderShapeSignature(shape: RenderShape): string {
  let segments = RenderShape.toPolygonSegments(shape);
  const first = segments[0];
  const last = segments.at(-1)!;
  if (
    first.type === 'point' &&
    last.type === 'point' &&
    first.point.x === last.point.x &&
    first.point.y === last.point.y
  ) {
    segments = segments.slice(0, -1);
  }
  return segments
    .map((segment) => {
      switch (segment.type) {
        case 'point':
          return `p:${round(segment.point.x)},${round(segment.point.y)}`;
        case 'arc-quadratic':
          return `q:${round(segment.point.x)},${round(segment.point.y)}:${round(
            segment.controlPoint.x,
          )},${round(segment.controlPoint.y)}`;
        case 'arc-cubic':
          return `c:${round(segment.point.x)},${round(segment.point.y)}:${round(
            segment.controlPointA.x,
          )},${round(segment.controlPointA.y)}:${round(segment.controlPointB.x)},${round(
            segment.controlPointB.y,
          )}`;
        default:
          segment satisfies never;
          throw new Error(`Unknown segment`);
      }
    })
    .join('|');
}

function storeSignatures(geometryStore: GeometryStore): Array<string> {
  return geometryStore
    .listWithComponent(GeometryComponent)
    .flatMap((geometry) => GeometryComponent.getRenderShapes(geometry, 'cm'))
    .map(renderShapeSignature)
    .sort();
}

function expectedSignatures(
  geometry: Entity<GeometryComponent>,
  filters: Array<Entity<FilterComponent>> = [],
): Array<string> {
  return GeometryComponent.getRenderShapes(geometry, 'cm', filters)
    .map(renderShapeSignature)
    .sort();
}

function setAnchor(
  geometryStore: GeometryStore,
  id: string,
  keyPoint: string,
  offset: SheetPosition,
) {
  geometryStore.updateByIdWithComponent(id, AnchorPointComponent, (geometry) =>
    AnchorPointComponent.update(geometry, { keyPoint, offset }),
  );
}

function setRotation(geometryStore: GeometryStore, id: string, degrees: number) {
  geometryStore.updateByIdWithComponent(id, RotationComponent, (geometry) =>
    RotationComponent.update(geometry, { angle: Angle.degrees(degrees) }),
  );
}

function addRotationToPolygon(geometryStore: GeometryStore, id: string, degrees: number) {
  geometryStore.updateByIdDirect(id, (geometry) => ({
    ...geometry,
    components: {
      ...geometry.components,
      ...RotationComponent.create(Angle.degrees(degrees)),
    },
  }));
}

function addRectangle(
  geometryStore: GeometryStore,
  upperLeft: SheetPosition,
  lowerRight: SheetPosition,
): Rectangle {
  return geometryStore.addOrdered(
    ID_PREFIXES.rectangle,
    Rectangle.create(upperLeft, lowerRight, {
      fillColor: DEFAULT_COLOR,
      linkDimensions: true,
    }),
  ) as Rectangle;
}

function addEllipse(
  geometryStore: GeometryStore,
  center: SheetPosition,
  radiusX: number,
  radiusY: number,
): Ellipse {
  return geometryStore.addOrdered(
    ID_PREFIXES.ellipse,
    Ellipse.create(center, {
      radiusX,
      radiusY,
      fillColor: DEFAULT_COLOR,
      linkDimensions: true,
    }),
  ) as Ellipse;
}

function addPolygon(
  geometryStore: GeometryStore,
  points: Array<PointSegment>,
  closed: boolean,
): Polygon {
  return geometryStore.addOrdered(
    ID_PREFIXES.polygon,
    Polygon.create(points, { closed }),
  ) as Polygon;
}

describe('rotation-aware filter materialization and conversion', () => {
  let historyManager: HistoryManager;
  let geometryStore: GeometryStore;
  let selectionManager: SelectionManager;
  let actionsManager: ActionsManager;

  beforeEach(() => {
    ({ historyManager, geometryStore, selectionManager, actionsManager } = setup());
  });

  describe('pattern grid on rotated + anchored shapes', () => {
    it('materializes rotated + anchored rectangle copies with rotation preserved', async () => {
      const rectangle = addRectangle(
        geometryStore,
        new SheetPosition(0, 0),
        new SheetPosition(10, 4),
      );
      setAnchor(geometryStore, rectangle.id, 'center', new SheetPosition(3, -2));
      setRotation(geometryStore, rectangle.id, 30);
      const filter = geometryStore.add(
        ID_PREFIXES.filter,
        PatternFilter.createGrid(rectangle.id, new SheetPosition(0, 0), new SheetPosition(20, 0), {
          xRepeats: 2,
          yRepeats: 1,
        }),
      );
      const source = geometryStore.getByIdWithComponents(
        rectangle.id,
        GeometryComponent,
        AnchorPointComponent,
      )!;
      const expected = expectedSignatures(source, [filter]);

      selectionManager.select(filter.id);
      await actionsManager.execute('apply-filter-to-geometry');

      expect(storeSignatures(geometryStore)).toEqual(expected);
      expect(geometryStore.listWithComponent(FilterComponent)).toHaveLength(0);

      const sourceAfter = geometryStore.getByIdWithComponent(rectangle.id, GeometryComponent)!;
      expect(RotationComponent.getOptional(sourceAfter)?.angle.toDegrees().magnitude).toBeCloseTo(
        30,
      );
      expect(
        Entity.hasComponent(sourceAfter, AnchorPointComponent)
          ? AnchorPointComponent.get(sourceAfter).keyPoint
          : undefined,
      ).toBe('center');

      const copies = geometryStore
        .listWithComponent(GeometryComponent)
        .filter((g) => g.id !== rectangle.id);
      expect(copies).toHaveLength(1);
      expect(RotationComponent.getOptional(copies[0])?.angle.toDegrees().magnitude).toBeCloseTo(30);
    });

    it('materializes rotated + anchored ellipse copies with rotation preserved', async () => {
      const ellipse = addEllipse(geometryStore, new SheetPosition(5, 5), 2, 1);
      setAnchor(geometryStore, ellipse.id, 'center', new SheetPosition(2, -1));
      setRotation(geometryStore, ellipse.id, 45);
      const filter = geometryStore.add(
        ID_PREFIXES.filter,
        PatternFilter.createGrid(ellipse.id, new SheetPosition(0, 0), new SheetPosition(20, 0), {
          xRepeats: 2,
          yRepeats: 1,
        }),
      );
      const source = geometryStore.getByIdWithComponents(
        ellipse.id,
        GeometryComponent,
        AnchorPointComponent,
      )!;
      const expected = expectedSignatures(source, [filter]);

      selectionManager.select(filter.id);
      await actionsManager.execute('apply-filter-to-geometry');

      expect(storeSignatures(geometryStore)).toEqual(expected);
      expect(geometryStore.listWithComponent(FilterComponent)).toHaveLength(0);

      const copies = geometryStore
        .listWithComponent(GeometryComponent)
        .filter((g) => g.id !== ellipse.id);
      expect(copies).toHaveLength(1);
      expect(RotationComponent.getOptional(copies[0])?.angle.toDegrees().magnitude).toBeCloseTo(45);
    });

    it('materializes rotated + anchored polygon copies with baked geometry', async () => {
      const polygon = addPolygon(
        geometryStore,
        [point(0, 0), point(10, 0), point(5, 8), point(0, 0)],
        true,
      );
      setAnchor(geometryStore, polygon.id, 'boundingBoxUpperLeft', new SheetPosition(2, -1));
      addRotationToPolygon(geometryStore, polygon.id, 30);
      const filter = geometryStore.add(
        ID_PREFIXES.filter,
        PatternFilter.createGrid(polygon.id, new SheetPosition(0, 0), new SheetPosition(20, 0), {
          xRepeats: 2,
          yRepeats: 1,
        }),
      );
      const source = geometryStore.getByIdWithComponents(
        polygon.id,
        GeometryComponent,
        AnchorPointComponent,
      )!;
      const expected = expectedSignatures(source, [filter]);

      selectionManager.select(filter.id);
      await actionsManager.execute('apply-filter-to-geometry');

      expect(storeSignatures(geometryStore)).toEqual(expected);
      const copies = geometryStore
        .listWithComponent(GeometryComponent)
        .filter((g) => g.id !== polygon.id);
      expect(copies).toHaveLength(1);
      expect(RotationComponent.getOptional(copies[0])?.angle.toDegrees().magnitude).toBeCloseTo(0);
    });
  });

  describe('radial pattern on rotated + anchored shapes', () => {
    it('materializes rotated + anchored rectangle copies', async () => {
      const rectangle = addRectangle(
        geometryStore,
        new SheetPosition(0, 0),
        new SheetPosition(10, 4),
      );
      setAnchor(geometryStore, rectangle.id, 'center', new SheetPosition(3, -2));
      setRotation(geometryStore, rectangle.id, 30);
      const filter = geometryStore.add(
        ID_PREFIXES.filter,
        PatternFilter.createRadial(rectangle.id, new SheetPosition(50, 50), 100, { count: 4 }),
      );
      const source = geometryStore.getByIdWithComponents(
        rectangle.id,
        GeometryComponent,
        AnchorPointComponent,
      )!;
      const expected = expectedSignatures(source, [filter]);

      selectionManager.select(filter.id);
      await actionsManager.execute('apply-filter-to-geometry');

      expect(storeSignatures(geometryStore)).toEqual(expected);
      expect(geometryStore.listWithComponent(FilterComponent)).toHaveLength(0);
    });

    it('materializes rotated + anchored ellipse copies', async () => {
      const ellipse = addEllipse(geometryStore, new SheetPosition(10, 0), 4, 2);
      setAnchor(geometryStore, ellipse.id, 'center', new SheetPosition(1, 2));
      setRotation(geometryStore, ellipse.id, 20);
      const filter = geometryStore.add(
        ID_PREFIXES.filter,
        PatternFilter.createRadial(ellipse.id, new SheetPosition(0, 0), 100, { count: 4 }),
      );
      const source = geometryStore.getByIdWithComponents(
        ellipse.id,
        GeometryComponent,
        AnchorPointComponent,
      )!;
      const expected = expectedSignatures(source, [filter]);

      selectionManager.select(filter.id);
      await actionsManager.execute('apply-filter-to-geometry');

      expect(storeSignatures(geometryStore)).toEqual(expected);
    });

    it('materializes rotated + anchored polygon copies', async () => {
      const polygon = addPolygon(
        geometryStore,
        [point(0, -5), point(5, 5), point(-5, 5), point(0, -5)],
        true,
      );
      setAnchor(geometryStore, polygon.id, 'boundingBoxUpperLeft', new SheetPosition(2, -1));
      addRotationToPolygon(geometryStore, polygon.id, 25);
      const filter = geometryStore.add(
        ID_PREFIXES.filter,
        PatternFilter.createRadial(polygon.id, new SheetPosition(0, 0), 100, { count: 4 }),
      );
      const source = geometryStore.getByIdWithComponents(
        polygon.id,
        GeometryComponent,
        AnchorPointComponent,
      )!;
      const expected = expectedSignatures(source, [filter]);

      selectionManager.select(filter.id);
      await actionsManager.execute('apply-filter-to-geometry');

      expect(storeSignatures(geometryStore)).toEqual(expected);
    });
  });

  describe('mirror on rotated + anchored shapes', () => {
    it('mirrors a rotated + anchored rectangle using its oriented corners', async () => {
      const rectangle = addRectangle(
        geometryStore,
        new SheetPosition(0, 0),
        new SheetPosition(10, 4),
      );
      setAnchor(geometryStore, rectangle.id, 'center', new SheetPosition(3, -2));
      setRotation(geometryStore, rectangle.id, 30);
      const filter = geometryStore.add(
        ID_PREFIXES.filter,
        MirrorFilter.create(rectangle.id, new SheetPosition(20, 0), new SheetPosition(20, 10)),
      );
      const source = geometryStore.getByIdWithComponents(
        rectangle.id,
        GeometryComponent,
        AnchorPointComponent,
      )!;
      const expected = expectedSignatures(source, [filter]);

      selectionManager.select(filter.id);
      await actionsManager.execute('apply-filter-to-geometry');

      expect(storeSignatures(geometryStore)).toEqual(expected);
      expect(geometryStore.listWithComponent(FilterComponent)).toHaveLength(0);
    });

    it('mirrors a rotated + anchored ellipse with reflected orientation', async () => {
      const ellipse = addEllipse(geometryStore, new SheetPosition(10, 5), 4, 2);
      setAnchor(geometryStore, ellipse.id, 'center', new SheetPosition(1, 2));
      setRotation(geometryStore, ellipse.id, 30);
      const filter = geometryStore.add(
        ID_PREFIXES.filter,
        MirrorFilter.create(ellipse.id, new SheetPosition(20, 0), new SheetPosition(20, 10)),
      );
      const source = geometryStore.getByIdWithComponents(
        ellipse.id,
        GeometryComponent,
        AnchorPointComponent,
      )!;
      const expected = expectedSignatures(source, [filter]);

      selectionManager.select(filter.id);
      await actionsManager.execute('apply-filter-to-geometry');

      expect(storeSignatures(geometryStore)).toEqual(expected);
    });

    it('mirrors a rotated + anchored polygon', async () => {
      const polygon = addPolygon(
        geometryStore,
        [point(0, 0), point(10, 0), point(5, 8), point(0, 0)],
        true,
      );
      setAnchor(geometryStore, polygon.id, 'boundingBoxUpperLeft', new SheetPosition(2, -1));
      addRotationToPolygon(geometryStore, polygon.id, 30);
      const filter = geometryStore.add(
        ID_PREFIXES.filter,
        MirrorFilter.create(polygon.id, new SheetPosition(30, 0), new SheetPosition(30, 10)),
      );
      const source = geometryStore.getByIdWithComponents(
        polygon.id,
        GeometryComponent,
        AnchorPointComponent,
      )!;
      const expected = expectedSignatures(source, [filter]);

      selectionManager.select(filter.id);
      await actionsManager.execute('apply-filter-to-geometry');

      expect(storeSignatures(geometryStore)).toEqual(expected);
    });
  });

  describe('fillet / chamfer on rotated rectangles', () => {
    it('applies a fillet in the rendered rotated frame', async () => {
      const rectangle = addRectangle(
        geometryStore,
        new SheetPosition(0, 0),
        new SheetPosition(100, 100),
      );
      setRotation(geometryStore, rectangle.id, 90);
      const filter = geometryStore.add(
        ID_PREFIXES.filter,
        FilletFilter.createOnRectangle(
          rectangle.id,
          'upperLeft',
          'upperRight',
          'lowerRight',
          Length.centimeters(20),
        ),
      );
      const source = geometryStore.getByIdWithComponents(
        rectangle.id,
        GeometryComponent,
        AnchorPointComponent,
      )!;
      const expected = expectedSignatures(source, [filter]);

      selectionManager.select(filter.id);
      await actionsManager.execute('apply-filter-to-geometry');

      expect(storeSignatures(geometryStore)).toEqual(expected);
      expect(geometryStore.listWithComponent(FilterComponent)).toHaveLength(0);

      const [polygon] = geometryStore.listWithComponent(GeometryComponent);
      expect(GeometryComponent.get(polygon).type).toBe('polygon');
      expect(RotationComponent.getOptional(polygon)?.angle.toDegrees().magnitude).toBeCloseTo(0);
    });

    it('applies a chamfer in the rendered rotated frame', async () => {
      const rectangle = addRectangle(
        geometryStore,
        new SheetPosition(0, 0),
        new SheetPosition(100, 100),
      );
      setRotation(geometryStore, rectangle.id, 90);
      const filter = geometryStore.add(
        ID_PREFIXES.filter,
        ChamferFilter.createOnRectangle(
          rectangle.id,
          'upperLeft',
          'upperRight',
          'lowerRight',
          Length.centimeters(20),
        ),
      );
      const source = geometryStore.getByIdWithComponents(
        rectangle.id,
        GeometryComponent,
        AnchorPointComponent,
      )!;
      const expected = expectedSignatures(source, [filter]);

      selectionManager.select(filter.id);
      await actionsManager.execute('apply-filter-to-geometry');

      expect(storeSignatures(geometryStore)).toEqual(expected);
    });
  });

  describe('merging render shapes into the source raw frame', () => {
    it('inverts the full render matrix for a rotated + anchored open polygon', async () => {
      const polygon = addPolygon(geometryStore, [point(0, 0), point(50, 50), point(0, 100)], false);
      setAnchor(geometryStore, polygon.id, 'boundingBoxUpperLeft', new SheetPosition(2, -3));
      addRotationToPolygon(geometryStore, polygon.id, 30);

      const source = geometryStore.getByIdWithComponents(
        polygon.id,
        GeometryComponent,
        AnchorPointComponent,
      )!;
      const rendered = GeometryComponent.getRenderShapes(source, 'cm')[0];
      const segments = RenderShape.toPolygonSegments(rendered);
      const lineA = segments[0].point;
      const lineB = segments.at(-1)!.point;

      const constraintId = geometryStore.add(
        ID_PREFIXES.constraint,
        HorizontalConstraint.create(
          ConstraintEndpoint.lockedToPolygon(polygon.id, 0),
          ConstraintEndpoint.lockedToPolygon(polygon.id, 2),
        ),
      ).id;
      const filter = geometryStore.add(
        ID_PREFIXES.filter,
        MirrorFilter.create(polygon.id, lineA, lineB),
      );
      const expected = expectedSignatures(source, [filter]);

      selectionManager.select(filter.id);
      await actionsManager.execute('apply-filter-to-geometry');

      expect(storeSignatures(geometryStore)).toEqual(expected);
      const [merged] = geometryStore.listWithComponent(GeometryComponent);
      expect(merged.id).toBe(polygon.id);
      expect(GeometryComponent.get(merged).type).toBe('polygon');
      if (GeometryComponent.get(merged).type !== 'polygon') {
        throw new Error('Expected polygon');
      }
      expect(GeometryComponent.get(merged).closed).toBe(true);

      // Rotation/anchor metadata is preserved (not baked) when merging in place.
      expect(RotationComponent.getOptional(merged)?.angle.toDegrees().magnitude).toBeCloseTo(30);
      expect(
        Entity.hasComponent(merged, AnchorPointComponent)
          ? AnchorPointComponent.get(merged).keyPoint
          : undefined,
      ).toBe('boundingBoxUpperLeft');

      // Constraint remains attached to the same polygon id.
      const constraints = geometryStore.findConstraintsByGeometryId(polygon.id);
      expect(constraints).toHaveLength(1);
      expect(constraints[0].id).toBe(constraintId);
    });
  });

  describe('constraint and filter remapping after apply', () => {
    it('remaps constraints and sibling filters when a fillet converts the rectangle', async () => {
      const rectangle = addRectangle(
        geometryStore,
        new SheetPosition(0, 0),
        new SheetPosition(100, 100),
      );
      setRotation(geometryStore, rectangle.id, 90);

      const constraintId = geometryStore.add(
        ID_PREFIXES.constraint,
        HorizontalConstraint.create(
          ConstraintEndpoint.lockedToRectangle(rectangle.id, 'upperLeft'),
          ConstraintEndpoint.lockedToRectangle(rectangle.id, 'upperRight'),
        ),
      ).id;
      const mirrorId = geometryStore.add(
        ID_PREFIXES.filter,
        MirrorFilter.create(rectangle.id, new SheetPosition(0, 0), new SheetPosition(0, 100)),
      ).id;
      const filletId = geometryStore.add(
        ID_PREFIXES.filter,
        FilletFilter.createOnRectangle(
          rectangle.id,
          'upperLeft',
          'upperRight',
          'lowerRight',
          Length.centimeters(20),
        ),
      ).id;

      selectionManager.select(filletId);
      await actionsManager.execute('apply-filter-to-geometry');

      const polygons = geometryStore
        .listWithComponent(GeometryComponent)
        .filter((g) => GeometryComponent.get(g).type === 'polygon');
      expect(polygons).toHaveLength(1);
      const polygonId = polygons[0].id;

      const constraint = geometryStore.getByIdWithComponent(constraintId, ConstraintComponent)!;
      const data = ConstraintComponent.get(constraint);
      if (data.type !== 'horizontal') {
        throw new Error('Expected horizontal constraint');
      }
      expect(data.pointA).toStrictEqual(ConstraintEndpoint.lockedToPolygon(polygonId, 0));
      // The fillet removes the corner this endpoint was attached to, so the apply flow pins it to
      // a datum at the original rendered position instead of deleting the constraint.
      expect(data.pointB.type).toBe('locked-datum');

      const mirror = geometryStore.getByIdWithComponent(mirrorId, FilterComponent)!;
      expect(FilterComponent.get(mirror).geometryId).toBe(polygonId);
      expect(geometryStore.getByIdWithComponent(filletId, FilterComponent)).toBeNull();

      // Every remaining filter must reference an existing geometry.
      for (const filter of geometryStore.listWithComponent(FilterComponent)) {
        expect(geometryStore.hasId(FilterComponent.get(filter).geometryId)).toBe(true);
      }
    });
  });

  describe('rectangle / ellipse -> polygon conversion', () => {
    it('bakes rotation + anchor and preserves metadata, constraints and filters (rectangle)', async () => {
      const rectangle = addRectangle(
        geometryStore,
        new SheetPosition(0, 0),
        new SheetPosition(10, 4),
      );
      setAnchor(geometryStore, rectangle.id, 'center', new SheetPosition(3, -2));
      setRotation(geometryStore, rectangle.id, 30);
      geometryStore.setFillColor(rectangle.id, 0x123456);
      geometryStore.setRenderOrder(rectangle.id, 7);
      geometryStore.setLinkDimensions(rectangle.id, false);

      const constraintId = geometryStore.add(
        ID_PREFIXES.constraint,
        HorizontalConstraint.create(
          ConstraintEndpoint.lockedToRectangle(rectangle.id, 'upperLeft'),
          ConstraintEndpoint.lockedToRectangle(rectangle.id, 'upperRight'),
        ),
      ).id;
      const mirrorId = geometryStore.add(
        ID_PREFIXES.filter,
        MirrorFilter.create(rectangle.id, new SheetPosition(0, 0), new SheetPosition(0, 10)),
      ).id;
      const filletId = geometryStore.add(
        ID_PREFIXES.filter,
        FilletFilter.createOnRectangle(
          rectangle.id,
          'lowerLeft',
          'lowerRight',
          'upperRight',
          Length.centimeters(1),
        ),
      ).id;

      const before = geometryStore.getByIdWithComponent(rectangle.id, GeometryComponent)!;
      const expected = expectedSignatures(before);
      selectionManager.select(rectangle.id);
      await actionsManager.execute('convert-to-polygon');

      expect(geometryStore.getByIdWithComponent(rectangle.id, GeometryComponent)).toBeNull();
      const polygons = geometryStore
        .listWithComponent(GeometryComponent)
        .filter((g) => GeometryComponent.get(g).type === 'polygon');
      expect(polygons).toHaveLength(1);
      const polygon = polygons[0];

      expect(storeSignatures(geometryStore)).toEqual(expected);
      expect(FillColorComponent.getOptional(polygon)).toBe(0x123456);
      expect((polygon.components as any).renderOrder).toBe(7);
      expect(LinkDimensionsComponent.getOptional(polygon)).toBe(false);
      expect(RotationComponent.getOptional(polygon)?.angle.toDegrees().magnitude).toBeCloseTo(0);

      const constraint = geometryStore.getByIdWithComponent(constraintId, ConstraintComponent)!;
      const data = ConstraintComponent.get(constraint);
      if (data.type !== 'horizontal') {
        throw new Error('Expected horizontal constraint');
      }
      expect(data.pointA).toStrictEqual(ConstraintEndpoint.lockedToPolygon(polygon.id, 0));
      expect(data.pointB).toStrictEqual(ConstraintEndpoint.lockedToPolygon(polygon.id, 1));

      const mirror = geometryStore.getByIdWithComponent(mirrorId, FilterComponent)!;
      expect(FilterComponent.get(mirror).geometryId).toBe(polygon.id);

      const fillet = geometryStore.getByIdWithComponent(filletId, FilterComponent)!;
      const filletData = FilterComponent.get(fillet);
      if (filletData.type !== 'fillet' || filletData.geometryType !== 'polygon') {
        throw new Error('Expected polygon-mode fillet');
      }
      expect(filletData.geometryId).toBe(polygon.id);
      expect(filletData.pointCenterIndex).toBe(2);
      expect(filletData.pointAIndex).toBe(3);
      expect(filletData.pointBIndex).toBe(1);
    });

    it('bakes rotation + anchor and preserves metadata, constraints and filters (ellipse)', async () => {
      const ellipse = addEllipse(geometryStore, new SheetPosition(0, 0), 10, 5);
      setAnchor(geometryStore, ellipse.id, 'center', new SheetPosition(2, -3));
      setRotation(geometryStore, ellipse.id, 30);
      geometryStore.setFillColor(ellipse.id, 0xabcdef);
      geometryStore.setRenderOrder(ellipse.id, 9);
      geometryStore.setLinkDimensions(ellipse.id, false);

      const constraintId = geometryStore.add(
        ID_PREFIXES.constraint,
        HorizontalConstraint.create(
          ConstraintEndpoint.lockedToEllipse(ellipse.id, 'top'),
          ConstraintEndpoint.lockedToEllipse(ellipse.id, 'right'),
        ),
      ).id;
      const patternId = geometryStore.add(
        ID_PREFIXES.filter,
        PatternFilter.createRadial(ellipse.id, new SheetPosition(0, 0), 50, { count: 2 }),
      ).id;

      const before = geometryStore.getByIdWithComponent(ellipse.id, GeometryComponent)!;
      const expected = expectedSignatures(before);
      selectionManager.select(ellipse.id);
      await actionsManager.execute('convert-to-polygon');

      expect(geometryStore.getByIdWithComponent(ellipse.id, GeometryComponent)).toBeNull();
      const polygons = geometryStore
        .listWithComponent(GeometryComponent)
        .filter((g) => GeometryComponent.get(g).type === 'polygon');
      expect(polygons).toHaveLength(1);
      const polygon = polygons[0];

      expect(storeSignatures(geometryStore)).toEqual(expected);
      expect(FillColorComponent.getOptional(polygon)).toBe(0xabcdef);
      expect((polygon.components as any).renderOrder).toBe(9);
      expect(LinkDimensionsComponent.getOptional(polygon)).toBe(false);
      expect(RotationComponent.getOptional(polygon)?.angle.toDegrees().magnitude).toBeCloseTo(0);

      const constraint = geometryStore.getByIdWithComponent(constraintId, ConstraintComponent)!;
      const data = ConstraintComponent.get(constraint);
      if (data.type !== 'horizontal') {
        throw new Error('Expected horizontal constraint');
      }
      expect(data.pointA).toStrictEqual(ConstraintEndpoint.lockedToPolygon(polygon.id, 0));
      expect(data.pointB).toStrictEqual(ConstraintEndpoint.lockedToPolygon(polygon.id, 1));

      const pattern = geometryStore.getByIdWithComponent(patternId, FilterComponent)!;
      expect(FilterComponent.get(pattern).geometryId).toBe(polygon.id);
    });

    it('supports undo/redo of conversion including migrated constraints and filters', async () => {
      const rectangle = addRectangle(
        geometryStore,
        new SheetPosition(0, 0),
        new SheetPosition(10, 4),
      );
      setAnchor(geometryStore, rectangle.id, 'center', new SheetPosition(3, -2));
      setRotation(geometryStore, rectangle.id, 30);

      const constraintId = geometryStore.add(
        ID_PREFIXES.constraint,
        HorizontalConstraint.create(
          ConstraintEndpoint.lockedToRectangle(rectangle.id, 'upperLeft'),
          ConstraintEndpoint.lockedToRectangle(rectangle.id, 'upperRight'),
        ),
      ).id;
      const mirrorId = geometryStore.add(
        ID_PREFIXES.filter,
        MirrorFilter.create(rectangle.id, new SheetPosition(0, 0), new SheetPosition(0, 10)),
      ).id;

      selectionManager.select(rectangle.id);
      await actionsManager.execute('convert-to-polygon');
      const polygonId = geometryStore
        .listWithComponent(GeometryComponent)
        .find((g) => GeometryComponent.get(g).type === 'polygon')!.id;

      historyManager.undo();
      expect(geometryStore.getByIdWithComponent(rectangle.id, GeometryComponent)).not.toBeNull();
      expect(geometryStore.getByIdWithComponent(polygonId, GeometryComponent)).toBeNull();
      expect(geometryStore.listWithComponent(ConstraintComponent)).toHaveLength(1);
      const undoneConstraint = geometryStore.getByIdWithComponent(
        constraintId,
        ConstraintComponent,
      )!;
      const undoneData = ConstraintComponent.get(undoneConstraint);
      if (undoneData.type !== 'horizontal') {
        throw new Error('Expected horizontal constraint');
      }
      expect(undoneData.pointA).toStrictEqual(
        ConstraintEndpoint.lockedToRectangle(rectangle.id, 'upperLeft'),
      );
      const undoneMirror = geometryStore.getByIdWithComponent(mirrorId, FilterComponent)!;
      expect(FilterComponent.get(undoneMirror).geometryId).toBe(rectangle.id);

      historyManager.redo();
      expect(geometryStore.getByIdWithComponent(rectangle.id, GeometryComponent)).toBeNull();
      expect(geometryStore.getByIdWithComponent(polygonId, GeometryComponent)).not.toBeNull();
      const redoneConstraint = geometryStore.getByIdWithComponent(
        constraintId,
        ConstraintComponent,
      )!;
      const redoneData = ConstraintComponent.get(redoneConstraint);
      if (redoneData.type !== 'horizontal') {
        throw new Error('Expected horizontal constraint');
      }
      expect(redoneData.pointA).toStrictEqual(ConstraintEndpoint.lockedToPolygon(polygonId, 0));
      const redoneMirror = geometryStore.getByIdWithComponent(mirrorId, FilterComponent)!;
      expect(FilterComponent.get(redoneMirror).geometryId).toBe(polygonId);
    });
  });

  describe('filter cleanup on deletion', () => {
    it('removes every filter type attached to a deleted geometry and restores them on undo', () => {
      const rectangle = addRectangle(
        geometryStore,
        new SheetPosition(0, 0),
        new SheetPosition(10, 10),
      );
      const constraintId = geometryStore.add(
        ID_PREFIXES.constraint,
        HorizontalConstraint.create(
          ConstraintEndpoint.lockedToRectangle(rectangle.id, 'upperLeft'),
          ConstraintEndpoint.lockedToRectangle(rectangle.id, 'upperRight'),
        ),
      ).id;
      const filterIds = [
        geometryStore.add(
          ID_PREFIXES.filter,
          FilletFilter.createOnRectangle(
            rectangle.id,
            'lowerLeft',
            'upperLeft',
            'upperRight',
            Length.centimeters(1),
          ),
        ).id,
        geometryStore.add(
          ID_PREFIXES.filter,
          ChamferFilter.createOnRectangle(
            rectangle.id,
            'lowerLeft',
            'upperLeft',
            'upperRight',
            Length.centimeters(1),
          ),
        ).id,
        geometryStore.add(
          ID_PREFIXES.filter,
          MirrorFilter.create(rectangle.id, new SheetPosition(20, 0), new SheetPosition(20, 10)),
        ).id,
        geometryStore.add(
          ID_PREFIXES.filter,
          PatternFilter.createGrid(
            rectangle.id,
            new SheetPosition(0, 0),
            new SheetPosition(10, 10),
          ),
        ).id,
      ];

      geometryStore.deleteById(rectangle.id);

      expect(geometryStore.getById(rectangle.id)).toBeNull();
      expect(geometryStore.getById(constraintId)).toBeNull();
      expect(geometryStore.listWithComponent(FilterComponent)).toHaveLength(0);

      historyManager.undo();
      expect(geometryStore.getById(rectangle.id)).not.toBeNull();
      expect(geometryStore.getById(constraintId)).not.toBeNull();
      expect(geometryStore.listWithComponent(FilterComponent)).toHaveLength(4);
      for (const filterId of filterIds) {
        expect(geometryStore.getById(filterId)).not.toBeNull();
      }

      historyManager.redo();
      expect(geometryStore.getById(rectangle.id)).toBeNull();
      expect(geometryStore.listWithComponent(FilterComponent)).toHaveLength(0);
    });
  });

  describe('history for apply', () => {
    it('undoes and redoes a materialized mirror of a rotated + anchored polygon', async () => {
      const polygon = addPolygon(
        geometryStore,
        [point(0, 0), point(10, 0), point(5, 8), point(0, 0)],
        true,
      );
      setAnchor(geometryStore, polygon.id, 'boundingBoxUpperLeft', new SheetPosition(2, -1));
      addRotationToPolygon(geometryStore, polygon.id, 30);
      const filter = geometryStore.add(
        ID_PREFIXES.filter,
        MirrorFilter.create(polygon.id, new SheetPosition(30, 0), new SheetPosition(30, 10)),
      );
      const source = geometryStore.getByIdWithComponents(
        polygon.id,
        GeometryComponent,
        AnchorPointComponent,
      )!;
      const expected = expectedSignatures(source, [filter]);

      selectionManager.select(filter.id);
      await actionsManager.execute('apply-filter-to-geometry');
      expect(geometryStore.listWithComponent(GeometryComponent)).toHaveLength(2);
      expect(geometryStore.listWithComponent(FilterComponent)).toHaveLength(0);

      historyManager.undo();
      expect(geometryStore.listWithComponent(GeometryComponent)).toHaveLength(1);
      expect(geometryStore.listWithComponent(FilterComponent)).toHaveLength(1);
      expect(storeSignatures(geometryStore)).toEqual(
        expectedSignatures(geometryStore.getByIdWithComponent(polygon.id, GeometryComponent)!),
      );

      historyManager.redo();
      expect(geometryStore.listWithComponent(GeometryComponent)).toHaveLength(2);
      expect(geometryStore.listWithComponent(FilterComponent)).toHaveLength(0);
      expect(storeSignatures(geometryStore)).toEqual(expected);
    });

    it('undoes and redoes a fillet apply which converts the rectangle', async () => {
      const rectangle = addRectangle(
        geometryStore,
        new SheetPosition(0, 0),
        new SheetPosition(100, 100),
      );
      setRotation(geometryStore, rectangle.id, 90);
      const filter = geometryStore.add(
        ID_PREFIXES.filter,
        FilletFilter.createOnRectangle(
          rectangle.id,
          'upperLeft',
          'upperRight',
          'lowerRight',
          Length.centimeters(20),
        ),
      );
      const source = geometryStore.getByIdWithComponents(
        rectangle.id,
        GeometryComponent,
        AnchorPointComponent,
      )!;
      const expected = expectedSignatures(source, [filter]);

      selectionManager.select(filter.id);
      await actionsManager.execute('apply-filter-to-geometry');
      expect(storeSignatures(geometryStore)).toEqual(expected);
      expect(geometryStore.listWithComponent(FilterComponent)).toHaveLength(0);

      historyManager.undo();
      const undoneGeometry = geometryStore.getByIdWithComponent(rectangle.id, GeometryComponent)!;
      expect(undoneGeometry).not.toBeNull();
      const undoneFilters = geometryStore.listWithComponent(FilterComponent);
      expect(undoneFilters).toHaveLength(1);
      expect(expectedSignatures(undoneGeometry, undoneFilters)).toEqual(expected);

      historyManager.redo();
      expect(geometryStore.getByIdWithComponent(rectangle.id, GeometryComponent)).toBeNull();
      expect(geometryStore.listWithComponent(FilterComponent)).toHaveLength(0);
      expect(storeSignatures(geometryStore)).toEqual(expected);
    });
  });
});
