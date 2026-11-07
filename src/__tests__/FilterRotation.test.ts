import { Ellipse, GeometryComponent, Polygon, Rectangle } from '@/lib/entity';
import { GeometryStore, ID_PREFIXES } from '@/lib/entity/GeometryStore';
import { AnchorPointComponent } from '@/lib/entity/components/AnchorPointComponent';
import { RotationComponent } from '@/lib/entity/components/RotationComponent';
import { ChamferFilter } from '@/lib/entity/filters/chamfer';
import { FilletFilter, type FilletFilterData } from '@/lib/entity/filters/fillet';
import { getIndicatorGeometryPaths } from '@/lib/entity/filters/indicator-geometry';
import { MirrorFilter, type MirrorFilterData } from '@/lib/entity/filters/mirror';
import { PatternFilter } from '@/lib/entity/filters/pattern';
import {
  RenderShape,
  type RenderShapeEllipse,
  type RenderShapePolygon,
  type RenderShapeRectangle,
} from '@/lib/entity/render-shape';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { OrientedBoundingBox, rotatePointAround } from '@/lib/math';
import { Angle } from '@/lib/units/angle';
import { Length } from '@/lib/units/length';
import { SheetPosition } from '@/lib/viewport/types';

function setup() {
  const historyManager = new HistoryManager();
  const geometryStore = new GeometryStore(historyManager);
  historyManager.setGeometryStore(geometryStore);
  return { geometryStore, historyManager };
}

function rectangleCorners(shape: RenderShapeRectangle) {
  return OrientedBoundingBox.cornersToArray({
    position: shape.upperLeft,
    width: shape.lowerRight.x - shape.upperLeft.x,
    height: shape.lowerRight.y - shape.upperLeft.y,
    angleDegrees: shape.angleDegrees,
  });
}

describe('rotation-aware filters', () => {
  let geometryStore: GeometryStore;

  beforeEach(() => {
    geometryStore = setup().geometryStore;
  });

  describe('pattern grid', () => {
    it('propagates a rotated rectangle angle to each copy', () => {
      const rectangle = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(10, 4)),
      );
      geometryStore.updateByIdWithComponent(rectangle.id, RotationComponent, (geometry) =>
        RotationComponent.update(geometry, { angle: Angle.degrees(30) }),
      );
      const filter = geometryStore.add(
        ID_PREFIXES.filter,
        PatternFilter.createGrid(rectangle.id, new SheetPosition(0, 0), new SheetPosition(20, 0), {
          xRepeats: 2,
          yRepeats: 1,
        }),
      );
      const geometry = geometryStore.getByIdWithComponents(
        rectangle.id,
        GeometryComponent,
        AnchorPointComponent,
      )!;

      const shapes = GeometryComponent.getRenderShapes(geometry, 'cm', [filter]);
      const source = shapes[0] as RenderShapeRectangle;
      const copy = shapes[1] as RenderShapeRectangle;

      expect(source.angleDegrees).toBeCloseTo(30);
      expect(copy.angleDegrees).toBeCloseTo(source.angleDegrees);
      expect(copy.upperLeft.x).toBeCloseTo(source.upperLeft.x + 20);
      expect(copy.upperLeft.y).toBeCloseTo(source.upperLeft.y);
      expect(copy.lowerRight.x).toBeCloseTo(source.lowerRight.x + 20);
      expect(copy.lowerRight.y).toBeCloseTo(source.lowerRight.y);
    });

    it('propagates a rotated, anchored ellipse angle to each copy', () => {
      const ellipse = geometryStore.addOrdered(
        ID_PREFIXES.ellipse,
        Ellipse.create(new SheetPosition(5, 5), { radiusX: 2, radiusY: 1 }),
      );
      geometryStore.updateByIdWithComponent(ellipse.id, AnchorPointComponent, (geometry) =>
        AnchorPointComponent.update(geometry, {
          keyPoint: 'center',
          offset: new SheetPosition(3, -2),
        }),
      );
      geometryStore.updateByIdWithComponent(ellipse.id, RotationComponent, (geometry) =>
        RotationComponent.update(geometry, { angle: Angle.degrees(45) }),
      );
      const filter = geometryStore.add(
        ID_PREFIXES.filter,
        PatternFilter.createGrid(ellipse.id, new SheetPosition(0, 0), new SheetPosition(20, 10), {
          xRepeats: 2,
          yRepeats: 2,
        }),
      );
      const geometry = geometryStore.getByIdWithComponents(
        ellipse.id,
        GeometryComponent,
        AnchorPointComponent,
      )!;

      const shapes = GeometryComponent.getRenderShapes(geometry, 'cm', [filter]);
      const source = shapes[0] as RenderShapeEllipse;
      // Copy order is (i=0,j=1), (i=1,j=0), (i=1,j=1); pick the +x copy.
      const copy = shapes[2] as RenderShapeEllipse;

      expect(source.angleDegrees).toBeCloseTo(45);
      expect(copy.angleDegrees).toBeCloseTo(source.angleDegrees);
      expect(copy.center.x).toBeCloseTo(source.center.x + 20);
      expect(copy.center.y).toBeCloseTo(source.center.y);
    });
  });

  describe('pattern radial', () => {
    it('rotates oriented rectangle corners instead of an axis-aligned bounding box', () => {
      const rectangle = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(10, 4)),
      );
      geometryStore.updateByIdWithComponent(rectangle.id, AnchorPointComponent, (geometry) =>
        AnchorPointComponent.update(geometry, {
          keyPoint: 'center',
          offset: new SheetPosition(3, -2),
        }),
      );
      geometryStore.updateByIdWithComponent(rectangle.id, RotationComponent, (geometry) =>
        RotationComponent.update(geometry, { angle: Angle.degrees(30) }),
      );
      const filter = geometryStore.add(
        ID_PREFIXES.filter,
        PatternFilter.createRadial(rectangle.id, new SheetPosition(50, 50), 100, { count: 4 }),
      );
      const geometry = geometryStore.getByIdWithComponents(
        rectangle.id,
        GeometryComponent,
        AnchorPointComponent,
      )!;

      const shapes = GeometryComponent.getRenderShapes(geometry, 'cm', [filter]);
      const source = shapes[0] as RenderShapeRectangle;
      const copy = shapes[1] as RenderShapePolygon;
      const expectedCorners = rectangleCorners(source).map((corner) =>
        rotatePointAround(corner, new SheetPosition(50, 50), 90),
      );

      expect(copy.points).toHaveLength(5);
      for (let i = 0; i < expectedCorners.length; i += 1) {
        expect(copy.points[i].point.x).toBeCloseTo(expectedCorners[i].x);
        expect(copy.points[i].point.y).toBeCloseTo(expectedCorners[i].y);
      }
    });

    it('adds the pattern angle to each rotated ellipse copy', () => {
      const ellipse = geometryStore.addOrdered(
        ID_PREFIXES.ellipse,
        Ellipse.create(new SheetPosition(10, 0), { radiusX: 4, radiusY: 2 }),
      );
      geometryStore.updateByIdWithComponent(ellipse.id, AnchorPointComponent, (geometry) =>
        AnchorPointComponent.update(geometry, {
          keyPoint: 'center',
          offset: new SheetPosition(1, 2),
        }),
      );
      geometryStore.updateByIdWithComponent(ellipse.id, RotationComponent, (geometry) =>
        RotationComponent.update(geometry, { angle: Angle.degrees(20) }),
      );
      const filter = geometryStore.add(
        ID_PREFIXES.filter,
        PatternFilter.createRadial(ellipse.id, new SheetPosition(0, 0), 100, { count: 4 }),
      );
      const geometry = geometryStore.getByIdWithComponents(
        ellipse.id,
        GeometryComponent,
        AnchorPointComponent,
      )!;

      const shapes = GeometryComponent.getRenderShapes(geometry, 'cm', [filter]);
      const source = shapes[0] as RenderShapeEllipse;
      const copy = shapes[1] as RenderShapeEllipse;
      const expectedCenter = rotatePointAround(source.center, new SheetPosition(0, 0), 90);

      expect(source.angleDegrees).toBeCloseTo(20);
      expect(copy.center.x).toBeCloseTo(expectedCenter.x);
      expect(copy.center.y).toBeCloseTo(expectedCenter.y);
      expect(copy.angleDegrees).toBeCloseTo(110);
    });
  });

  describe('mirror', () => {
    it('mirrors an oriented rotated rectangle rather than its axis-aligned bounds', () => {
      const rectangle = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(10, 4)),
      );
      geometryStore.updateByIdWithComponent(rectangle.id, RotationComponent, (geometry) =>
        RotationComponent.update(geometry, { angle: Angle.degrees(30) }),
      );
      const filter = geometryStore.add(
        ID_PREFIXES.filter,
        MirrorFilter.create(rectangle.id, new SheetPosition(20, 0), new SheetPosition(20, 10)),
      );
      const geometry = geometryStore.getByIdWithComponents(
        rectangle.id,
        GeometryComponent,
        AnchorPointComponent,
      )!;

      const shapes = GeometryComponent.getRenderShapes(geometry, 'cm', [filter]);
      const source = shapes[0] as RenderShapeRectangle;
      const mirrored = shapes[1] as RenderShapePolygon;
      const expectedCorners = rectangleCorners(source).map(
        (corner) => new SheetPosition(40 - corner.x, corner.y),
      );

      expect(mirrored.points).toHaveLength(5);
      for (let i = 0; i < expectedCorners.length; i += 1) {
        expect(mirrored.points[i].point.x).toBeCloseTo(expectedCorners[i].x);
        expect(mirrored.points[i].point.y).toBeCloseTo(expectedCorners[i].y);
      }
    });

    it('reflects a rotated ellipse orientation across the mirror line', () => {
      const ellipse = geometryStore.addOrdered(
        ID_PREFIXES.ellipse,
        Ellipse.create(new SheetPosition(10, 5), { radiusX: 4, radiusY: 2 }),
      );
      geometryStore.updateByIdWithComponent(ellipse.id, AnchorPointComponent, (geometry) =>
        AnchorPointComponent.update(geometry, {
          keyPoint: 'center',
          offset: new SheetPosition(1, 2),
        }),
      );
      geometryStore.updateByIdWithComponent(ellipse.id, RotationComponent, (geometry) =>
        RotationComponent.update(geometry, { angle: Angle.degrees(30) }),
      );
      const filter = geometryStore.add(
        ID_PREFIXES.filter,
        MirrorFilter.create(ellipse.id, new SheetPosition(20, 0), new SheetPosition(20, 10)),
      );
      const geometry = geometryStore.getByIdWithComponents(
        ellipse.id,
        GeometryComponent,
        AnchorPointComponent,
      )!;

      const shapes = GeometryComponent.getRenderShapes(geometry, 'cm', [filter]);
      const source = shapes[0] as RenderShapeEllipse;
      const mirrored = shapes[1] as RenderShapeEllipse;

      expect(source.angleDegrees).toBeCloseTo(30);
      expect(mirrored.center.x).toBeCloseTo(40 - source.center.x);
      expect(mirrored.center.y).toBeCloseTo(source.center.y);
      // 2 * 90 - 30
      expect(mirrored.angleDegrees).toBeCloseTo(150);
    });

    it('keeps the source point and adds the mirrored point', () => {
      const filterData: MirrorFilterData = {
        type: 'mirror',
        geometryId: 'geometry-id',
        pointA: new SheetPosition(0, -100),
        pointB: new SheetPosition(0, 100),
      };
      const source = RenderShape.point('source', new SheetPosition(5, 7), { primary: true });

      const shapes = MirrorFilter.applyToRenderShape(filterData, [source], () => 'copy', {
        combineNonClosedPolygons: true,
      });

      expect(shapes).toHaveLength(2);
      expect(shapes[0]).toEqual(source);
      expect(shapes[1].shape).toBe('point');
      if (shapes[1].shape === 'point') {
        expect(shapes[1].position.x).toBeCloseTo(-5);
        expect(shapes[1].position.y).toBeCloseTo(7);
      }
    });
  });

  describe('fillet / chamfer', () => {
    it('applies a fillet in local rectangle space and rotates the result', () => {
      const rectangle = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(100, 100)),
      );
      geometryStore.updateByIdWithComponent(rectangle.id, RotationComponent, (geometry) =>
        RotationComponent.update(geometry, { angle: Angle.degrees(90) }),
      );
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
      const geometry = geometryStore.getByIdWithComponents(
        rectangle.id,
        GeometryComponent,
        AnchorPointComponent,
      )!;

      const [shape] = GeometryComponent.getRenderShapes(geometry, 'cm', [filter]);
      expect(shape.shape).toBe('polygon');
      const points = (shape as RenderShapePolygon).points;

      expect(points[0].point.x).toBeCloseTo(0);
      expect(points[0].point.y).toBeCloseTo(0);
      expect(points[1].point.x).toBeCloseTo(0);
      expect(points[1].point.y).toBeCloseTo(80);
      expect(points[2].point.x).toBeCloseTo(-20);
      expect(points[2].point.y).toBeCloseTo(100);
      expect(points[3].point.x).toBeCloseTo(-100);
      expect(points[3].point.y).toBeCloseTo(100);
      expect(points[4].point.x).toBeCloseTo(-100);
      expect(points[4].point.y).toBeCloseTo(0);
    });

    it('applies a chamfer in local rectangle space and rotates the result', () => {
      const rectangle = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(100, 100)),
      );
      geometryStore.updateByIdWithComponent(rectangle.id, RotationComponent, (geometry) =>
        RotationComponent.update(geometry, { angle: Angle.degrees(90) }),
      );
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
      const geometry = geometryStore.getByIdWithComponents(
        rectangle.id,
        GeometryComponent,
        AnchorPointComponent,
      )!;

      const [shape] = GeometryComponent.getRenderShapes(geometry, 'cm', [filter]);
      expect(shape.shape).toBe('polygon');
      const points = (shape as RenderShapePolygon).points;

      expect(points[2].type).toBe('point');
      expect(points[2].point.x).toBeCloseTo(-20);
      expect(points[2].point.y).toBeCloseTo(100);
      expect(points[4].point.x).toBeCloseTo(-100);
      expect(points[4].point.y).toBeCloseTo(0);
    });

    it('keeps the original rectangle render shape when the filter cannot apply', () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const filterData: FilletFilterData = {
        type: 'fillet',
        offset: Length.centimeters(1),
        geometryType: 'polygon',
        geometryId: 'missing',
        pointAIndex: 0,
        pointCenterIndex: 1,
        pointBIndex: 2,
      };
      const source = RenderShape.rectangle(
        'source',
        new SheetPosition(0, 0),
        new SheetPosition(10, 10),
      );

      const shapes = FilletFilter.applyToRenderShape(filterData, [source], () => 'copy', 'cm');

      expect(shapes).toEqual([source]);
      warn.mockRestore();
    });
  });

  describe('equality', () => {
    it('includes fillet corner fields', () => {
      const rectangle = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(10, 10)),
      );
      const a = geometryStore.add(
        ID_PREFIXES.filter,
        FilletFilter.createOnRectangle(
          rectangle.id,
          'upperLeft',
          'upperRight',
          'lowerRight',
          Length.centimeters(1),
        ),
      );
      const b = geometryStore.add(
        ID_PREFIXES.filter,
        FilletFilter.createOnRectangle(
          rectangle.id,
          'upperLeft',
          'lowerRight',
          'lowerLeft',
          Length.centimeters(1),
        ),
      );

      expect(FilletFilter.equals(a, b)).toBe(false);
    });

    it('includes chamfer corner fields', () => {
      const rectangle = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(10, 10)),
      );
      const a = geometryStore.add(
        ID_PREFIXES.filter,
        ChamferFilter.createOnRectangle(
          rectangle.id,
          'upperLeft',
          'upperRight',
          'lowerRight',
          Length.centimeters(1),
        ),
      );
      const b = geometryStore.add(
        ID_PREFIXES.filter,
        ChamferFilter.createOnRectangle(
          rectangle.id,
          'upperLeft',
          'lowerRight',
          'lowerLeft',
          Length.centimeters(1),
        ),
      );

      expect(ChamferFilter.equals(a, b)).toBe(false);
    });

    it('includes fillet polygon indexes', () => {
      const polygon = geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create(
          [
            { type: 'point', point: new SheetPosition(0, 0) },
            { type: 'point', point: new SheetPosition(10, 0) },
            { type: 'point', point: new SheetPosition(10, 10) },
            { type: 'point', point: new SheetPosition(0, 0) },
          ],
          { closed: true },
        ),
      );
      const a = geometryStore.add(
        ID_PREFIXES.filter,
        FilletFilter.createOnPolygon(polygon.id, 0, 1, 2, Length.centimeters(1)),
      );
      const b = geometryStore.add(
        ID_PREFIXES.filter,
        FilletFilter.createOnPolygon(polygon.id, 0, 2, 1, Length.centimeters(1)),
      );

      expect(FilletFilter.equals(a, b)).toBe(false);
    });

    it('includes chamfer polygon indexes', () => {
      const polygon = geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create(
          [
            { type: 'point', point: new SheetPosition(0, 0) },
            { type: 'point', point: new SheetPosition(10, 0) },
            { type: 'point', point: new SheetPosition(10, 10) },
            { type: 'point', point: new SheetPosition(0, 0) },
          ],
          { closed: true },
        ),
      );
      const a = geometryStore.add(
        ID_PREFIXES.filter,
        ChamferFilter.createOnPolygon(polygon.id, 0, 1, 2, Length.centimeters(1)),
      );
      const b = geometryStore.add(
        ID_PREFIXES.filter,
        ChamferFilter.createOnPolygon(polygon.id, 0, 2, 1, Length.centimeters(1)),
      );

      expect(ChamferFilter.equals(a, b)).toBe(false);
    });

    it('does not consider a fillet equal to a chamfer', () => {
      const rectangle = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(10, 10)),
      );
      const fillet = geometryStore.add(
        ID_PREFIXES.filter,
        FilletFilter.createOnRectangle(
          rectangle.id,
          'upperLeft',
          'upperRight',
          'lowerRight',
          Length.centimeters(1),
        ),
      );
      const chamfer = geometryStore.add(
        ID_PREFIXES.filter,
        ChamferFilter.createOnRectangle(
          rectangle.id,
          'upperLeft',
          'upperRight',
          'lowerRight',
          Length.centimeters(1),
        ),
      );

      expect(ChamferFilter.equals(chamfer, fillet)).toBe(false);
      expect(FilletFilter.equals(fillet, chamfer)).toBe(false);
    });
  });

  describe('destination point mapping', () => {
    it('populates both source and mirrored destinations for a merged mirror', () => {
      const polygon = geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create(
          [
            { type: 'point', point: new SheetPosition(0, 0) },
            { type: 'point', point: new SheetPosition(50, 50) },
            { type: 'point', point: new SheetPosition(0, 100) },
          ],
          { closed: false },
        ),
      );
      const filter = geometryStore.add(
        ID_PREFIXES.filter,
        MirrorFilter.create(polygon.id, new SheetPosition(0, 0), new SheetPosition(0, 100)),
      );
      const geometry = geometryStore.getByIdWithComponents(
        polygon.id,
        GeometryComponent,
        AnchorPointComponent,
      )!;
      const destinationPointMapping = new Map();

      const shapes = GeometryComponent.getRenderShapes(geometry, 'cm', [filter], {
        combineNonClosedPolygons: true,
        destinationPointMapping,
      });

      expect(shapes).toHaveLength(1);
      // The base mapping keeps the source-half occurrence and the filter adds the mirrored half.
      expect(destinationPointMapping.get(0)).toEqual([
        { shapeIndex: 0, type: 'polygon', pointIndex: 0 },
        { shapeIndex: 0, type: 'polygon', pointIndex: 5 },
      ]);
      expect(destinationPointMapping.get(1)).toEqual([
        { shapeIndex: 0, type: 'polygon', pointIndex: 1 },
        { shapeIndex: 0, type: 'polygon', pointIndex: 4 },
      ]);

      // The mirrored destination for (50, 50) really is the reflected (-50, 50).
      const merged = shapes[0] as RenderShapePolygon;
      const mirroredIndex = destinationPointMapping.get(1)[1].pointIndex;
      expect(merged.points[mirroredIndex].point.x).toBeCloseTo(-50);
      expect(merged.points[mirroredIndex].point.y).toBeCloseTo(50);
    });

    it('populates the mapped point index for a merged radial pattern', () => {
      const polygon = geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create(
          [
            { type: 'point', point: new SheetPosition(50, -50) },
            { type: 'point', point: new SheetPosition(0, 50) },
            { type: 'point', point: new SheetPosition(-50, -50) },
          ],
          { closed: false },
        ),
      );
      const filter = geometryStore.add(
        ID_PREFIXES.filter,
        PatternFilter.createRadial(polygon.id, new SheetPosition(0, 0), 100, { count: 4 }),
      );
      const geometry = geometryStore.getByIdWithComponents(
        polygon.id,
        GeometryComponent,
        AnchorPointComponent,
      )!;
      const destinationPointMapping = new Map();

      const shapes = GeometryComponent.getRenderShapes(geometry, 'cm', [filter], {
        combineNonClosedPolygons: true,
        destinationPointMapping,
      });

      expect(shapes).toHaveLength(1);
      expect(destinationPointMapping.get(0)[0]).toEqual({
        shapeIndex: 0,
        type: 'polygon',
        pointIndex: 0,
      });
      expect(destinationPointMapping.get(1)[0]).toEqual({
        shapeIndex: 0,
        type: 'polygon',
        pointIndex: 1,
      });
    });
  });

  describe('indicators', () => {
    it('builds the mirror wireframe from rendered rotated geometry', () => {
      const rectangle = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(5, 5), new SheetPosition(15, 9)),
      );
      geometryStore.updateByIdWithComponent(rectangle.id, RotationComponent, (geometry) =>
        RotationComponent.update(geometry, { angle: Angle.degrees(90) }),
      );
      const geometry = geometryStore.getByIdWithComponents(
        rectangle.id,
        GeometryComponent,
        AnchorPointComponent,
      )!;

      const paths = getIndicatorGeometryPaths(geometry, 'cm');

      expect(paths).toHaveLength(1);
      expect(paths[0].closed).toBe(true);
      expect(paths[0].segments[0].point.x).toBeCloseTo(5);
      expect(paths[0].segments[0].point.y).toBeCloseTo(5);
      expect(paths[0].segments[1].point.x).toBeCloseTo(5);
      expect(paths[0].segments[1].point.y).toBeCloseTo(15);
      expect(paths[0].segments[2].point.x).toBeCloseTo(1);
      expect(paths[0].segments[2].point.y).toBeCloseTo(15);
      expect(paths[0].segments[3].point.x).toBeCloseTo(1);
      expect(paths[0].segments[3].point.y).toBeCloseTo(5);
    });

    it('resolves fillet indicator points in the same rendered space as the render shape', () => {
      const rectangle = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(10, 10), new SheetPosition(14, 12)),
      );
      geometryStore.updateByIdWithComponent(rectangle.id, AnchorPointComponent, (geometry) =>
        AnchorPointComponent.update(geometry, {
          keyPoint: 'center',
          offset: new SheetPosition(1, -2),
        }),
      );
      geometryStore.updateByIdWithComponent(rectangle.id, RotationComponent, (geometry) =>
        RotationComponent.update(geometry, { angle: Angle.degrees(90) }),
      );
      const geometry = geometryStore.getByIdWithComponents(
        rectangle.id,
        GeometryComponent,
        AnchorPointComponent,
      )!;

      const [shape] = GeometryComponent.getRenderShapes(geometry, 'cm');
      const corners = rectangleCorners(shape as RenderShapeRectangle);
      const resolved = geometryStore.resolveRectangleKeyPoint(rectangle.id, 'upperRight');

      expect(resolved).not.toBeNull();
      expect(resolved!.x).toBeCloseTo(corners[1].x);
      expect(resolved!.y).toBeCloseTo(corners[1].y);
    });
  });
});
