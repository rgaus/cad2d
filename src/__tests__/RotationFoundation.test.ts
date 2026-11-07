import { Ellipse, Entity, GeometryComponent, Rectangle } from '@/lib/entity';
import { GeometryStore, ID_PREFIXES } from '@/lib/entity/GeometryStore';
import { AnchorPointComponent } from '@/lib/entity/components/AnchorPointComponent';
import { RotationComponent } from '@/lib/entity/components/RotationComponent';
import { RenderShape } from '@/lib/entity/render-shape';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { BoundingBox } from '@/lib/math';
import { Angle } from '@/lib/units/angle';
import { SheetPosition } from '@/lib/viewport/types';

describe('rotation foundation acceptance', () => {
  let geometryStore: GeometryStore;

  beforeEach(() => {
    const historyManager = new HistoryManager();
    geometryStore = new GeometryStore(historyManager);
    historyManager.setGeometryStore(geometryStore);
  });

  it('projects render shapes to the same bounds as the geometry bounding box', () => {
    const rectangle = geometryStore.addOrdered(
      ID_PREFIXES.rectangle,
      Rectangle.create(new SheetPosition(2, 3), new SheetPosition(8, 6)),
    );
    geometryStore.updateByIdWithComponent(rectangle.id, AnchorPointComponent, (geometry) =>
      AnchorPointComponent.update(geometry, {
        keyPoint: 'center',
        offset: new SheetPosition(1, -1),
      }),
    );
    geometryStore.updateByIdWithComponent(rectangle.id, RotationComponent, (geometry) =>
      RotationComponent.update(geometry, { angle: Angle.degrees(37) }),
    );
    const geometry = geometryStore.getByIdWithComponents(
      rectangle.id,
      GeometryComponent,
      AnchorPointComponent,
    )!;

    const [shape] = GeometryComponent.getRenderShapes(geometry, 'in');
    const renderedBounds = BoundingBox.fromPoints(
      RenderShape.toPolygonSegments(shape).map((segment) => segment.point),
    );
    const bbox = Entity.boundingBoxInSheet(geometry);

    expect(renderedBounds.position.x).toBeCloseTo(bbox.position.x);
    expect(renderedBounds.position.y).toBeCloseTo(bbox.position.y);
    expect(renderedBounds.width).toBeCloseTo(bbox.width);
    expect(renderedBounds.height).toBeCloseTo(bbox.height);
  });

  it('projects ellipse render shapes to the same bounds as the geometry bounding box', () => {
    const ellipse = geometryStore.addOrdered(
      ID_PREFIXES.ellipse,
      Ellipse.create(new SheetPosition(5, 5), { radiusX: 3, radiusY: 1.5 }),
    );
    geometryStore.updateByIdWithComponent(ellipse.id, RotationComponent, (geometry) =>
      RotationComponent.update(geometry, { angle: Angle.degrees(25) }),
    );
    const geometry = geometryStore.getByIdWithComponents(
      ellipse.id,
      GeometryComponent,
      AnchorPointComponent,
    )!;

    const [shape] = GeometryComponent.getRenderShapes(geometry, 'in');
    const renderedBounds = BoundingBox.fromPoints(
      RenderShape.toPolygonSegments(shape).map((segment) => segment.point),
    );
    const bbox = Entity.boundingBoxInSheet(geometry);

    expect(BoundingBox.contains(bbox, renderedBounds)).toBe(true);
    expect(renderedBounds.width).toBeLessThanOrEqual(bbox.width + 1e-6);
    expect(renderedBounds.height).toBeLessThanOrEqual(bbox.height + 1e-6);
  });
});
