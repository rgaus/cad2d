import { UndoEntry } from '@/lib/history/types';
import { BoundingBox, OrientedBoundingBox, rotatePointAround } from '@/lib/math';
import { POLYGON_OPEN_SEGMENT_HIGHLIGHT_COLOR } from '@/lib/selection/constants';
import { type FieldOptionsList, Fields } from '@/lib/selection/fields';
import { computeOpenAtIndex } from '@/lib/selection/polygon-point-row';
import type { SelectionInspectorContext } from '@/lib/selection/selection-inspector-context';
import { Length, type UnitType } from '@/lib/units/length';
import {
  GeometryRelativeSheetPosition,
  KeyPoints,
  OrientedRect,
  Rect,
  SheetPosition,
} from '@/lib/viewport/types';
import { FilletFilter, Filter, FilterData } from '../filters';
import { MirrorFilter } from '../filters/mirror';
import { PatternFilter } from '../filters/pattern';
import { type Geometry, type GeometryData } from '../geometry';
import { EllipseData } from '../geometry/ellipse';
import { PolygonData, PolygonSegment } from '../geometry/polygon';
import { RectangleData } from '../geometry/rectangle';
import { RectangleEndpoint } from '../rectangle';
import { registerComponent } from '../registry';
import { RenderShape } from '../render-shape';
import { Entity, type EntityComponent, type ResizeFrame, ResizeParams } from '../types';
import { AnchorPointComponent } from './AnchorPointComponent';
import { ConstraintComponent } from './ConstraintComponent';
import { FilterComponent } from './FilterComponent';
import { FrameComponent } from './FrameComponent';
import { LinkDimensionsComponent } from './LinkDimensionsComponent';
import { RotationComponent } from './RotationComponent';
import type { ReadableTemplate } from './templates/ReadableTemplate';
import type { WritableTemplate } from './templates/WritableTemplate';

export type GetRenderShapesOptions<D extends GeometryData = GeometryData> = {
  /** Defaults to true. When set to false, a non closed polygon which would become closed (ie,
   * polygon mirrored over a mirror line) will be returned as two distinct polygons (one
   * primary, one not) so that the two halves can be rendered differently. */
  combineNonClosedPolygons: boolean;
  /**
   * When provided, `getRenderShapes` (and any filter it applies) populates this map as a side
   * effect, keyed by each feature of the source geometry (point `number` indexes for polygons,
   * `RectangleEndpoint` corners for rectangles), and valued with every destination point that
   * feature maps to across the returned render shapes. Omit to skip this bookkeeping entirely.
   */
  destinationPointMapping?: Map<
    | (D extends PolygonData ? number : never)
    | (D extends RectangleData ? RectangleEndpoint : never),
    Array<DestinationPoint>
  >;
};

/** PolygonData as projected into absolute rendered sheet space. The `position` is a zero local
 * frame and `points` are absolute rendered sheet segments. */
export type ProjectedPolygonData = Omit<PolygonData, 'position' | 'points'> & {
  position: SheetPosition;
  points: Array<PolygonSegment<SheetPosition>>;
};

export type DestinationPoint =
  | {
      shapeIndex: number;
      type: 'polygon';
      pointIndex: number;
    }
  | {
      shapeIndex: number;
      type: 'rectangle';
      corner: RectangleEndpoint;
    };

/**
 * Entity component for a geometry - a rectangle, ellipse, or polygon.
 */
export type GeometryComponent<D extends GeometryData = GeometryData> = EntityComponent<
  'geometry',
  D
>;

export namespace GeometryComponent {
  export const key: keyof GeometryComponent = 'geometry';

  export function createPolygon(
    points: Array<PolygonSegment<SheetPosition>>,
    options?: { closed?: boolean; openAtIndex?: number },
  ): GeometryComponent<PolygonData> {
    if (points.length < 2) {
      throw new Error(
        `GeometryComponent.createPolygon: points.length must be >= 2, found ${points.length}`,
      );
    }
    return {
      geometry: PolygonData.fromAbsoluteSegments(points, options),
    };
  }

  export function createRectangle(
    upperLeft: SheetPosition,
    lowerRight: SheetPosition,
  ): GeometryComponent<RectangleData> {
    return {
      geometry: {
        type: 'rectangle',
        origin: upperLeft,
        width: lowerRight.x - upperLeft.x,
        height: lowerRight.y - upperLeft.y,
      },
    };
  }

  export function createEllipse(
    center: SheetPosition,
    args: {
      radiusX: number;
      radiusY: number;
    },
  ): GeometryComponent<EllipseData> {
    return {
      geometry: {
        type: 'ellipse',
        center,
        radiusX: args.radiusX,
        radiusY: args.radiusY,
      },
    };
  }

  export function get<D extends GeometryData = GeometryData>(
    geometry: Entity<GeometryComponent<D>>,
  ): D {
    return geometry.components.geometry;
  }

  /** Polygon data projected into absolute rendered sheet space, with a zero local frame. */
  function renderedPolygonData(
    polygon: Entity<GeometryComponent<PolygonData>>,
  ): ProjectedPolygonData {
    return {
      ...get(polygon),
      position: new SheetPosition(0, 0),
      points: PolygonData.renderedSegments(polygon),
    };
  }

  export function isPolygon(
    geometry: Geometry,
  ): geometry is Entity<GeometryComponent<PolygonData>> {
    return geometry.components.geometry.type === 'polygon';
  }

  export function isRectangle(
    geometry: Geometry,
  ): geometry is Entity<GeometryComponent<RectangleData>> {
    return geometry.components.geometry.type === 'rectangle';
  }

  export function isEllipse(
    geometry: Geometry,
  ): geometry is Entity<GeometryComponent<EllipseData>> {
    return geometry.components.geometry.type === 'ellipse';
  }

  export function update<
    Data extends GeometryData = GeometryData,
    Ent extends Entity<GeometryComponent<Data>> = Entity<GeometryComponent<Data>>,
  >(geometry: Ent, partial: Partial<Data>): Ent {
    return {
      ...geometry,
      components: {
        ...geometry.components,
        geometry: { ...geometry.components.geometry, ...partial },
      },
    };
  }

  /**
   * The offset by which the rendered (anchored) geometry is shifted from the raw stored geometry.
   * Returns `(0, 0)` when the geometry has no anchor point component.
   */
  export function getAnchorPointOffset(
    geometry: Entity<GeometryComponent & Partial<AnchorPointComponent>>,
  ): SheetPosition {
    if (!Entity.hasComponent(geometry, AnchorPointComponent)) {
      return new SheetPosition(0, 0);
    }
    return AnchorPointComponent.computeAssociatedGeometryOffset(geometry);
  }

  /** Key points in geometry-relative coordinates. */
  export function rawKeyPoints(
    geometry: Entity<GeometryComponent>,
  ): KeyPoints<GeometryRelativeSheetPosition, string> {
    const state = GeometryComponent.get(geometry);
    switch (state.type) {
      case 'polygon':
        return PolygonData.rawKeyPoints(geometry as Entity<GeometryComponent<PolygonData>>);
      case 'rectangle':
        return RectangleData.rawKeyPoints(geometry as Entity<GeometryComponent<RectangleData>>);
      case 'ellipse':
        return EllipseData.rawKeyPoints(geometry as Entity<GeometryComponent<EllipseData>>);
      default:
        state satisfies never;
        throw new Error(
          `GeometryComponent.rawKeyPoints: Unknown geometry data type ${(state as any).type}`,
        );
    }
  }

  /**
   * Key points that are added as verticies within the DCEL and available for a user to snap other
   * entities like constraints to. These are expressed in geometry-relative coordinates.
   **/
  export function keyPoints(
    geometry: Entity<GeometryComponent>,
  ): KeyPoints<GeometryRelativeSheetPosition, string> {
    return rawKeyPoints(geometry);
  }

  /** Oriented bounding box in geometry-relative coordinates. */
  export function orientedBoundingBox(
    geometry: Entity<GeometryComponent>,
  ): OrientedRect<GeometryRelativeSheetPosition> {
    const state = GeometryComponent.get(geometry);
    const angleDegrees =
      RotationComponent.getOptional(geometry)?.angle?.toDegrees()?.magnitude ?? 0;

    switch (state.type) {
      case 'polygon':
        return PolygonData.orientedBoundingBox(state, angleDegrees);
      case 'rectangle':
        return RectangleData.orientedBoundingBox(state, angleDegrees);
      case 'ellipse':
        return EllipseData.orientedBoundingBox(state, angleDegrees);
      default:
        state satisfies never;
        throw new Error(
          `GeometryComponent.orientedBoundingBox: Unknown geometry data type ${(state as any).type}`,
        );
    }
  }

  /** Axis-aligned bounding box in geometry-relative coordinates. */
  export function boundingBox(
    geometry: Entity<GeometryComponent>,
  ): Rect<GeometryRelativeSheetPosition> {
    const state = GeometryComponent.get(geometry);
    switch (state.type) {
      case 'polygon':
        return PolygonData.boundingBox(geometry as Entity<GeometryComponent<PolygonData>>);
      case 'rectangle':
        return RectangleData.boundingBox(geometry as Entity<GeometryComponent<RectangleData>>);
      case 'ellipse':
        return EllipseData.boundingBox(geometry as Entity<GeometryComponent<EllipseData>>);
      default:
        state satisfies never;
        throw new Error(
          `GeometryComponent.boundingBox: Unknown geometry data type ${(state as any).type}`,
        );
    }
  }

  export function transform<E extends Entity<GeometryComponent>>(
    geometry: E,
    transform: (input: SheetPosition) => SheetPosition,
  ): E {
    const state = GeometryComponent.get(geometry);
    switch (state.type) {
      case 'polygon':
        return PolygonData.translate(
          geometry as Entity<GeometryComponent<PolygonData>>,
          transform,
        ) as E;
      case 'rectangle':
        return RectangleData.translate(
          geometry as Entity<GeometryComponent<RectangleData>>,
          transform,
        ) as E;
      case 'ellipse':
        return EllipseData.translate(
          geometry as Entity<GeometryComponent<EllipseData>>,
          transform,
        ) as E;
      default:
        state satisfies never;
        throw new Error(
          `GeometryComponent.translate: Unknown geometry data type ${(state as any).type}`,
        );
    }
  }

  export function getOrigin(
    geometry: Entity<GeometryComponent & Partial<AnchorPointComponent>>,
  ): SheetPosition {
    const state = GeometryComponent.get(geometry);
    switch (state.type) {
      case 'polygon':
        return PolygonData.getOrigin(geometry as Entity<GeometryComponent<PolygonData>>);
      case 'rectangle':
        return RectangleData.getOrigin(geometry as Entity<GeometryComponent<RectangleData>>);
      case 'ellipse':
        return EllipseData.getOrigin(geometry as Entity<GeometryComponent<EllipseData>>);
      default:
        state satisfies never;
        throw new Error(
          `GeometryComponent.getOrigin: Unknown geometry data type ${(state as any).type}`,
        );
    }
  }

  /** Origin in anchored (rendered) space. */
  export function getRenderOrigin(geometry: Entity<GeometryComponent>): SheetPosition {
    let working = geometry;
    if (Entity.hasComponents(working, GeometryComponent, AnchorPointComponent)) {
      const translated = GeometryComponent.transform(
        working,
        Entity.generateRenderTransformFunction(working),
      );
      working = AnchorPointComponent.remove(translated);
    }

    return getOrigin(working);
  }

  export function equals(a: Entity<GeometryComponent>, b: Entity<GeometryComponent>): boolean {
    const state = GeometryComponent.get(a);
    switch (state.type) {
      case 'polygon':
        return PolygonData.equals(a as Entity<GeometryComponent<PolygonData>>, b);
      case 'rectangle':
        return RectangleData.equals(a as Entity<GeometryComponent<RectangleData>>, b);
      case 'ellipse':
        return EllipseData.equals(a as Entity<GeometryComponent<EllipseData>>, b);
      default:
        state satisfies never;
        throw new Error(
          `GeometryComponent.equals: Unknown geometry data type ${(state as any).type}`,
        );
    }
  }

  /** Returns the oriented resize frame matching the geometry's current rotation. */
  export function getResizeFrame(geometry: Entity<GeometryComponent>): ResizeFrame {
    return {
      angleDegrees: RotationComponent.getOptional(geometry)?.angle?.toDegrees()?.magnitude ?? 0,
      pivot: getOrigin(geometry),
    };
  }

  /** Returns true when the passed bounding box is finite and has a non-zero area. */
  export function isValidResizeBBox(bbox: Rect<SheetPosition>): boolean {
    return (
      Number.isFinite(bbox.position.x) &&
      Number.isFinite(bbox.position.y) &&
      Number.isFinite(bbox.width) &&
      Number.isFinite(bbox.height) &&
      bbox.width > 0 &&
      bbox.height > 0
    );
  }

  function transformResizeBBox(
    bbox: Rect<SheetPosition> | OrientedRect<SheetPosition>,
    map: (position: SheetPosition) => SheetPosition,
  ): Rect<SheetPosition> {
    const corners =
      'angleDegrees' in bbox
        ? OrientedBoundingBox.cornersToArray(bbox)
        : BoundingBox.cornersToArray(BoundingBox.corners(bbox));
    return BoundingBox.fromPoints(corners.map(map));
  }

  /**
   * Keeps the anchor's associated-geometry offset stable across a resize. The anchor key point moves
   * as the raw geometry changes, so without compensation the rendered shape would jump. We adjust
   * {@link AnchorPointComponent.offset} such that `keyPoint + offset` (the derived offset) is
   * unchanged.
   */
  function compensateAnchorOffset<
    E extends Entity<GeometryComponent & Partial<AnchorPointComponent>>,
  >(before: E, after: E): E {
    if (
      !Entity.hasComponents(before, GeometryComponent, AnchorPointComponent) ||
      !Entity.hasComponents(after, GeometryComponent, AnchorPointComponent)
    ) {
      return after;
    }

    const beforeAnchor = AnchorPointComponent.get(before);
    const afterAnchor = AnchorPointComponent.get(after);
    const keyPointBefore = AnchorPointComponent.resolveKeyPointPosition(
      AnchorPointComponent.remove(before),
      beforeAnchor.keyPoint,
    );
    const keyPointAfter = AnchorPointComponent.resolveKeyPointPosition(
      AnchorPointComponent.remove(after),
      afterAnchor.keyPoint,
    );
    if (!keyPointBefore || !keyPointAfter) {
      return after;
    }

    return AnchorPointComponent.update(after, {
      keyPoint: afterAnchor.keyPoint,
      offset: new SheetPosition(
        keyPointBefore.x + beforeAnchor.offset.x - keyPointAfter.x,
        keyPointBefore.y + beforeAnchor.offset.y - keyPointAfter.y,
      ),
    }) as E;
  }

  export function resize<E extends Entity<GeometryComponent & Partial<AnchorPointComponent>>>(
    geometry: E,
    params: ResizeParams,
    originalBBox?: Rect<SheetPosition> | OrientedRect<SheetPosition>,
  ): E | null {
    // Resize math always happens in the geometry's raw (unrotated) frame, but callers provide
    // handle positions and bounding boxes in rendered sheet space. Invert the render transform
    // (anchor translation, then rotation) before dispatching to the raw resize implementations.
    // With no frame the angle defaults to 0, preserving the legacy anchor-only behavior exactly.
    const offset = GeometryComponent.getAnchorPointOffset(geometry);
    const angleDegrees = params.frame?.angleDegrees ?? 0;
    const pivot = params.frame?.pivot ?? GeometryComponent.getOrigin(geometry);
    const toRaw = (position: SheetPosition): SheetPosition => {
      const unrotated =
        angleDegrees === 0 ? position : rotatePointAround(position, pivot, -angleDegrees);
      return new SheetPosition(unrotated.x + offset.x, unrotated.y + offset.y);
    };

    const rawParams: ResizeParams = { ...params, to: toRaw(params.to) };
    const rawBBox = originalBBox ? transformResizeBBox(originalBBox, toRaw) : undefined;

    const state = GeometryComponent.get(geometry);
    let resized: E | null;
    switch (state.type) {
      case 'polygon':
        resized = PolygonData.resize(
          geometry as Entity<GeometryComponent<PolygonData>>,
          rawParams,
          rawBBox,
        ) as E | null;
        break;
      case 'rectangle':
        resized = RectangleData.resize(
          geometry as Entity<GeometryComponent<RectangleData>>,
          rawParams,
          rawBBox,
        ) as E | null;
        break;
      case 'ellipse':
        resized = EllipseData.resize(
          geometry as Entity<GeometryComponent<EllipseData>>,
          rawParams,
          rawBBox,
        ) as E | null;
        break;
      default:
        state satisfies never;
        throw new Error(
          `GeometryComponent.resize: Unknown geometry data type ${(state as any).type}`,
        );
    }

    if (!resized) {
      return null;
    }
    return compensateAnchorOffset(geometry, resized);
  }

  export function resizeBBox(
    bbox: Rect<SheetPosition>,
    params: ResizeParams,
  ): Rect<SheetPosition> | null {
    return FrameComponent.resizeBBox(bbox, params);
  }

  export function addPointOnEdge<G extends Entity<GeometryComponent<PolygonData>>>(
    geometry: G,
    constraints: Array<Entity<ConstraintComponent>>,
    segmentIndex: number,
    newPointPosition: { type: 't'; t: number } | { type: 'point'; point: SheetPosition },
  ) {
    return PolygonData.addPointOnEdge(geometry, constraints, segmentIndex, newPointPosition);
  }

  /** A map used to look up each filter and determine the order in which they should be applied.
   * Lower number = applied earlier, larger number = applied later. */
  const FILTER_DATA_TYPE_SORT_ORDER: { [key in FilterData['type']]: number } = {
    fillet: 1,
    chamfer: 1,
    mirror: 2,
    pattern: 2,
  };

  export function getRenderShapes<D extends GeometryData = GeometryData>(
    geometry: Entity<GeometryComponent<D> & Partial<AnchorPointComponent>>,
    sheetDefaultUnit: UnitType,
    filters: Array<Filter> = [],
    options: GetRenderShapesOptions<D> = { combineNonClosedPolygons: true },
  ): Array<RenderShape> {
    let shapes;

    // Render shapes are always expressed in anchored (rendered) space.
    const mapping =
      options.destinationPointMapping as GetRenderShapesOptions<GeometryData>['destinationPointMapping'];
    const state = get(geometry);
    const renderPosition = Entity.generateRenderTransformFunction(geometry);
    switch (state.type) {
      case 'polygon': {
        const rendered = renderedPolygonData(geometry as Entity<GeometryComponent<PolygonData>>);
        shapes = [
          RenderShape.polygon(geometry.id, rendered.points, {
            closed: rendered.closed,
            primary: true,
          }),
        ];
        if (mapping) {
          for (let i = 0; i < rendered.points.length; i += 1) {
            mapping.set(i, [{ shapeIndex: 0, type: 'polygon', pointIndex: i }]);
          }
        }
        break;
      }
      case 'rectangle': {
        const upperLeft = renderPosition(state.origin);
        const lowerRight = new SheetPosition(upperLeft.x + state.width, upperLeft.y + state.height);
        shapes = [
          RenderShape.rectangle(geometry.id, upperLeft, lowerRight, {
            primary: true,
            angleDegrees:
              RotationComponent.getOptional(geometry)?.angle?.toDegrees()?.magnitude ?? 0,
          }),
        ];
        if (mapping) {
          for (const corner of RectangleEndpoint.LIST) {
            mapping.set(corner, [{ shapeIndex: 0, type: 'rectangle', corner }]);
          }
        }
        break;
      }
      case 'ellipse': {
        const center = renderPosition(state.center);
        shapes = [
          RenderShape.ellipse(geometry.id, center, {
            radiusX: state.radiusX,
            radiusY: state.radiusY,
            primary: true,
            angleDegrees:
              RotationComponent.getOptional(geometry)?.angle?.toDegrees()?.magnitude ?? 0,
          }),
        ];
        break;
      }
      default:
        state satisfies never;
        throw new Error(
          `GeometryComponent.getRenderShapes: Unknown geometry data type ${(state as any).type}`,
        );
    }

    let filterApplicationCounter = 0;
    for (const filter of [...filters].sort((a, b) => {
      const aScore = FILTER_DATA_TYPE_SORT_ORDER[FilterComponent.get(a).type];
      const bScore = FILTER_DATA_TYPE_SORT_ORDER[FilterComponent.get(b).type];
      return aScore - bScore;
    })) {
      const generateFilterKey = () => {
        filterApplicationCounter += 1;
        return `${filter.id}_${filterApplicationCounter}`;
      };

      const filterData = FilterComponent.get(filter);
      switch (filterData.type) {
        case 'mirror': {
          shapes = MirrorFilter.applyToRenderShape(filterData, shapes, generateFilterKey, options);
          break;
        }
        case 'fillet':
        case 'chamfer': {
          shapes = FilletFilter.applyToRenderShape(
            filterData,
            shapes,
            generateFilterKey,
            sheetDefaultUnit,
          );
          break;
        }
        case 'pattern': {
          shapes = PatternFilter.applyToRenderShape(
            filterData,
            filter,
            shapes,
            generateFilterKey,
            options,
          );
          break;
        }
        default:
          filterData satisfies never;
          break;
      }
    }

    return shapes;
  }

  /** Builds the selection inspector fields (position / dimensions / points / actions) for a
   * geometry entity. Dispatches on the underlying {@link GeometryData} type. */
  export function computeSelectionInspectorFields(
    entity: Entity<GeometryComponent>,
    ctx: SelectionInspectorContext,
  ): FieldOptionsList {
    const geometryData = GeometryComponent.get<GeometryData>(entity);
    const isLinked = LinkDimensionsComponent.getOptional(entity) ?? false;
    switch (geometryData.type) {
      case 'rectangle': {
        const id = entity.id;
        return [
          Fields.row('position', [
            Fields.labelled(
              'x',
              'X:',
              Fields.length(
                'x',
                Length.fromSheetUnits(ctx.sheetDefaultUnit, geometryData.origin.x),
                { readOnlyUnit: true },
                ctx.makeLengthHandlers(
                  id,
                  'x',
                  GeometryComponent,
                  (value) => {
                    const current = ctx.geometryStore.getByIdWithComponent(id, GeometryComponent);
                    if (!current) {
                      return null;
                    }
                    const currentGeom = GeometryComponent.get<GeometryData>(current);
                    if (currentGeom.type !== 'rectangle') {
                      return null;
                    }
                    const newX = value.toSheetUnits(ctx.sheetDefaultUnit).magnitude;
                    const origin = new SheetPosition(newX, currentGeom.origin.y);
                    return { origin };
                  },
                  'origin',
                ),
              ),
            ),
            Fields.spacing('link-spacer', 'sm'),
            Fields.labelled(
              'y',
              'Y:',
              Fields.length(
                'y',
                Length.fromSheetUnits(ctx.sheetDefaultUnit, geometryData.origin.y),
                { readOnlyUnit: true },
                ctx.makeLengthHandlers(
                  id,
                  'y',
                  GeometryComponent,
                  (value) => {
                    const current = ctx.geometryStore.getByIdWithComponent(id, GeometryComponent);
                    if (!current) {
                      return null;
                    }
                    const currentGeom = GeometryComponent.get<GeometryData>(current);
                    if (currentGeom.type !== 'rectangle') {
                      return null;
                    }
                    const newY = value.toSheetUnits(ctx.sheetDefaultUnit).magnitude;
                    const origin = new SheetPosition(currentGeom.origin.x, newY);
                    return { origin };
                  },
                  'origin',
                ),
              ),
            ),
          ]),
          Fields.row('dimensions', [
            Fields.labelled(
              'width',
              'W:',
              Fields.length(
                'width',
                Length.fromSheetUnits(ctx.sheetDefaultUnit, geometryData.width),
                { readOnlyUnit: true },
                ctx.makeLengthHandlers(
                  id,
                  'width',
                  GeometryComponent,
                  (value) => {
                    const current = ctx.geometryStore.getByIdWithComponent(id, GeometryComponent);
                    if (!current) {
                      return null;
                    }
                    const currentGeom = GeometryComponent.get<GeometryData>(current);
                    if (currentGeom.type !== 'rectangle') {
                      return null;
                    }
                    const isLinkedNow = LinkDimensionsComponent.getOptional(current) ?? false;
                    const w = value.toSheetUnits(ctx.sheetDefaultUnit).magnitude;
                    return {
                      width: w,
                      height: isLinkedNow ? w : currentGeom.height,
                    };
                  },
                  'width',
                ),
              ),
            ),
            Fields.linkDimensionsButton('link', isLinked, {
              onClick: () => {
                ctx.actionsManager?.execute('toggle-link-dimensions');
              },
            }),
            Fields.labelled(
              'height',
              'H:',
              Fields.length(
                'height',
                Length.fromSheetUnits(ctx.sheetDefaultUnit, geometryData.height),
                { readOnlyUnit: true },
                ctx.makeLengthHandlers(
                  id,
                  'height',
                  GeometryComponent,
                  (value) => {
                    const current = ctx.geometryStore.getByIdWithComponent(id, GeometryComponent);
                    if (!current) {
                      return null;
                    }
                    const currentGeom = GeometryComponent.get<GeometryData>(current);
                    if (currentGeom.type !== 'rectangle') {
                      return null;
                    }
                    const isLinkedNow = LinkDimensionsComponent.getOptional(current) ?? false;
                    const h = value.toSheetUnits(ctx.sheetDefaultUnit).magnitude;
                    return {
                      width: isLinkedNow ? h : currentGeom.width,
                      height: h,
                    };
                  },
                  'height',
                ),
              ),
            ),
          ]),
          Fields.button('convert-to-polygon', 'To polygon...', {
            onClick: () => {
              ctx.actionsManager?.execute('convert-to-polygon');
            },
          }),
        ];
      }
      case 'ellipse': {
        const id = entity.id;
        return [
          Fields.row('position', [
            Fields.labelled(
              'x',
              'X:',
              Fields.length(
                'x',
                Length.fromSheetUnits(ctx.sheetDefaultUnit, geometryData.center.x),
                { readOnlyUnit: true },
                ctx.makeLengthHandlers(
                  id,
                  'x',
                  GeometryComponent,
                  (value) => {
                    const current = ctx.geometryStore.getByIdWithComponent(id, GeometryComponent);
                    if (!current) {
                      return null;
                    }
                    const currentGeom = GeometryComponent.get<GeometryData>(current);
                    if (currentGeom.type !== 'ellipse') {
                      return null;
                    }
                    const newCX = value.toSheetUnits(ctx.sheetDefaultUnit).magnitude;
                    return { center: new SheetPosition(newCX, currentGeom.center.y) };
                  },
                  'origin',
                ),
              ),
            ),
            Fields.labelled(
              'y',
              'Y:',
              Fields.length(
                'y',
                Length.fromSheetUnits(ctx.sheetDefaultUnit, geometryData.center.y),
                { readOnlyUnit: true },
                ctx.makeLengthHandlers(
                  id,
                  'y',
                  GeometryComponent,
                  (value) => {
                    const current = ctx.geometryStore.getByIdWithComponent(id, GeometryComponent);
                    if (!current) {
                      return null;
                    }
                    const currentGeom = GeometryComponent.get<GeometryData>(current);
                    if (currentGeom.type !== 'ellipse') {
                      return null;
                    }
                    const newCY = value.toSheetUnits(ctx.sheetDefaultUnit).magnitude;
                    return { center: new SheetPosition(currentGeom.center.x, newCY) };
                  },
                  'origin',
                ),
              ),
            ),
          ]),
          Fields.row('radius', [
            Fields.labelled(
              'rx',
              'RX:',
              Fields.length(
                'rx',
                Length.fromSheetUnits(ctx.sheetDefaultUnit, geometryData.radiusX),
                { readOnlyUnit: true },
                ctx.makeLengthHandlers(
                  id,
                  'rx',
                  GeometryComponent,
                  (value) => {
                    const current = ctx.geometryStore.getByIdWithComponent(id, GeometryComponent);
                    if (!current) {
                      return null;
                    }
                    const currentGeom = GeometryComponent.get<GeometryData>(current);
                    if (currentGeom.type !== 'ellipse') {
                      return null;
                    }
                    const isLinkedNow = LinkDimensionsComponent.getOptional(current) ?? false;
                    const rx = value.toSheetUnits(ctx.sheetDefaultUnit).magnitude;
                    return {
                      radiusX: rx,
                      radiusY: isLinkedNow ? rx : currentGeom.radiusY,
                    };
                  },
                  'radiusX',
                ),
              ),
            ),
            Fields.linkDimensionsButton('link', isLinked, {
              onClick: () => {
                ctx.actionsManager?.execute('toggle-link-dimensions');
              },
            }),
            Fields.labelled(
              'ry',
              'RY:',
              Fields.length(
                'ry',
                Length.fromSheetUnits(ctx.sheetDefaultUnit, geometryData.radiusY),
                { readOnlyUnit: true },
                ctx.makeLengthHandlers(
                  id,
                  'ry',
                  GeometryComponent,
                  (value) => {
                    const current = ctx.geometryStore.getByIdWithComponent(id, GeometryComponent);
                    if (!current) {
                      return null;
                    }
                    const currentGeom = GeometryComponent.get<GeometryData>(current);
                    if (currentGeom.type !== 'ellipse') {
                      return null;
                    }
                    const isLinkedNow = LinkDimensionsComponent.getOptional(current) ?? false;
                    const ry = value.toSheetUnits(ctx.sheetDefaultUnit).magnitude;
                    return {
                      radiusX: isLinkedNow ? ry : currentGeom.radiusX,
                      radiusY: ry,
                    };
                  },
                  'radiusY',
                ),
              ),
            ),
          ]),
          Fields.button('convert-to-polygon', 'To polygon...', {
            onClick: () => {
              ctx.actionsManager?.execute('convert-to-polygon');
            },
          }),
        ];
      }
      case 'polygon': {
        const id = entity.id;
        const polygonEntity = entity as Entity<GeometryComponent<PolygonData>>;
        const rawSegments = PolygonData.rawSegments(polygonEntity);
        const bounds = BoundingBox.fromPoints(rawSegments.map((s) => s.point));
        const projectedPolygon = renderedPolygonData(polygonEntity);
        const isPolygonFilledDueToFilter = !geometryData.closed && 'fillColor' in entity.components;
        const pointXHandlers = ctx.makePolygonPointLengthHandlers(id, 'x');
        const pointYHandlers = ctx.makePolygonPointLengthHandlers(id, 'y');
        const toLocalSegments = (
          current: Entity<GeometryComponent<PolygonData>>,
          segments: Array<PolygonSegment<SheetPosition>>,
        ): Array<PolygonSegment<GeometryRelativeSheetPosition>> => {
          const position = GeometryComponent.get(current).position;
          return segments.map((segment) =>
            PolygonSegment.transform(
              segment,
              (point) =>
                new GeometryRelativeSheetPosition(point.x - position.x, point.y - position.y),
            ),
          );
        };
        return [
          Fields.row('position', [
            Fields.labelled(
              'x',
              'X:',
              Fields.length(
                'x',
                Length.fromSheetUnits(ctx.sheetDefaultUnit, bounds.position.x),
                { readOnlyUnit: true },
                ctx.makeLengthHandlers(id, 'x', GeometryComponent, (value) => {
                  const current = ctx.geometryStore.getByIdWithComponent(id, GeometryComponent);
                  if (!current || !GeometryComponent.isPolygon(current)) {
                    return null;
                  }
                  const newX = value.toSheetUnits(ctx.sheetDefaultUnit).magnitude;
                  const currentBounds = BoundingBox.fromPoints(
                    PolygonData.rawSegments(current).map((s) => s.point),
                  );
                  const deltaX = newX - currentBounds.position.x;
                  if (deltaX === 0) {
                    return null;
                  }
                  const translated = PolygonData.translate(
                    current,
                    (p) => new SheetPosition(p.x + deltaX, p.y),
                  );
                  const translatedData = GeometryComponent.get(translated);
                  return {
                    position: translatedData.position,
                    points: translatedData.points,
                  };
                }),
              ),
            ),
            Fields.labelled(
              'y',
              'Y:',
              Fields.length(
                'y',
                Length.fromSheetUnits(ctx.sheetDefaultUnit, bounds.position.y),
                { readOnlyUnit: true },
                ctx.makeLengthHandlers(id, 'y', GeometryComponent, (value) => {
                  const current = ctx.geometryStore.getByIdWithComponent(id, GeometryComponent);
                  if (!current || !GeometryComponent.isPolygon(current)) {
                    return null;
                  }
                  const newY = value.toSheetUnits(ctx.sheetDefaultUnit).magnitude;
                  const currentBounds = BoundingBox.fromPoints(
                    PolygonData.rawSegments(current).map((s) => s.point),
                  );
                  const deltaY = newY - currentBounds.position.y;
                  if (deltaY === 0) {
                    return null;
                  }
                  const translated = PolygonData.translate(
                    current,
                    (p) => new SheetPosition(p.x, p.y + deltaY),
                  );
                  const translatedData = GeometryComponent.get(translated);
                  return {
                    position: translatedData.position,
                    points: translatedData.points,
                  };
                }),
              ),
            ),
          ]),
          Fields.row('dimensions', [
            Fields.labelled(
              'width',
              'W:',
              Fields.length(
                'width',
                Length.fromSheetUnits(ctx.sheetDefaultUnit, bounds.width),
                { readOnlyUnit: true },
                ctx.makeLengthHandlers(
                  id,
                  'width',
                  GeometryComponent,
                  (value) => {
                    const current = ctx.geometryStore.getByIdWithComponent(id, GeometryComponent);
                    if (!current || !GeometryComponent.isPolygon(current)) {
                      return null;
                    }
                    const w = value.toSheetUnits(ctx.sheetDefaultUnit).magnitude;
                    const currentRawSegments = PolygonData.rawSegments(current);
                    const currentBounds = BoundingBox.fromPoints(
                      currentRawSegments.map((s) => s.point),
                    );
                    if (w === currentBounds.width) {
                      return null;
                    }
                    const newBounds = {
                      position: currentBounds.position,
                      width: w,
                      height: currentBounds.height,
                    };
                    return {
                      points: toLocalSegments(
                        current,
                        BoundingBox.interpolatePoints(currentRawSegments, currentBounds, newBounds),
                      ),
                    };
                  },
                  'width',
                ),
              ),
            ),
            Fields.labelled(
              'height',
              'H:',
              Fields.length(
                'height',
                Length.fromSheetUnits(ctx.sheetDefaultUnit, bounds.height),
                { readOnlyUnit: true },
                ctx.makeLengthHandlers(
                  id,
                  'height',
                  GeometryComponent,
                  (value) => {
                    const current = ctx.geometryStore.getByIdWithComponent(id, GeometryComponent);
                    if (!current || !GeometryComponent.isPolygon(current)) {
                      return null;
                    }
                    const h = value.toSheetUnits(ctx.sheetDefaultUnit).magnitude;
                    const currentRawSegments = PolygonData.rawSegments(current);
                    const currentBounds = BoundingBox.fromPoints(
                      currentRawSegments.map((s) => s.point),
                    );
                    if (h === currentBounds.height) {
                      return null;
                    }
                    const newBounds = {
                      position: currentBounds.position,
                      width: currentBounds.width,
                      height: h,
                    };
                    return {
                      points: toLocalSegments(
                        current,
                        BoundingBox.interpolatePoints(currentRawSegments, currentBounds, newBounds),
                      ),
                    };
                  },
                  'height',
                ),
              ),
            ),
          ]),
          Fields.polygonPoints('points', projectedPolygon, isPolygonFilledDueToFilter, {
            onPointXChange: pointXHandlers.onChange,
            onPointYChange: pointYHandlers.onChange,
            onPointXBlur: pointXHandlers.onBlur,
            onPointYBlur: pointYHandlers.onBlur,
            onControlPointChange: (index, pointKey, axis, len) => {
              const current = ctx.geometryStore.getByIdWithComponent(id, GeometryComponent);
              if (!current || !GeometryComponent.isPolygon(current)) {
                return;
              }
              const projected = renderedPolygonData(current);
              const beforeRendered: SheetPosition = (projected.points[index] as any)[pointKey];
              const sheetVal = len.toSheetUnits(ctx.sheetDefaultUnit).magnitude;
              const afterRendered: SheetPosition =
                axis === 'x'
                  ? new SheetPosition(sheetVal, beforeRendered.y)
                  : new SheetPosition(beforeRendered.x, sheetVal);
              const currentForInverse = current as Entity<
                GeometryComponent & Partial<AnchorPointComponent>
              >;
              const beforePoint = beforeRendered.toGeometryRelativeSheetPosition(currentForInverse);
              const afterPoint = afterRendered.toGeometryRelativeSheetPosition(currentForInverse);
              ctx.historyManager.apply(
                UndoEntry.polygonMoveControlPoint(
                  id,
                  index,
                  pointKey,
                  new SheetPosition(beforePoint.x, beforePoint.y),
                  new SheetPosition(afterPoint.x, afterPoint.y),
                ),
              );
            },
            onDeletePoint: (index) => {
              ctx.geometryStore.updateByIdWithComponent(id, GeometryComponent, (old) => {
                if (!GeometryComponent.isPolygon(old)) {
                  return old;
                }
                const oldData = GeometryComponent.get(old);
                return GeometryComponent.update(old, {
                  points: oldData.points.filter((_, i) => i !== index),
                });
              });
            },
            onInsertPoint: (index) => {
              const current = ctx.geometryStore.getByIdWithComponent(id, GeometryComponent);
              if (!current || !GeometryComponent.isPolygon(current)) {
                return;
              }
              const rawSegments = PolygonData.rawSegments(current);
              const seg = rawSegments[index];
              const nextSeg = rawSegments[index + 1];
              if (!seg || !nextSeg) {
                return;
              }
              const midX = (seg.point.x + nextSeg.point.x) / 2;
              const midY = (seg.point.y + nextSeg.point.y) / 2;
              ctx.geometryStore.addPointOnLineSegmentEdge(id, index, new SheetPosition(midX, midY));
            },
            onPointTypeChange: (index, type) => {
              if (index === 0) {
                // Point at index=0 must always stay a point
                return;
              }
              ctx.geometryStore.updateByIdWithComponent(id, GeometryComponent, (old) => {
                if (!GeometryComponent.isPolygon(old)) {
                  return old;
                }
                const oldData = GeometryComponent.get(old);
                const current = oldData.points[index];
                if (!current || current.type === type) {
                  return old;
                }
                const points = oldData.points.map((seg, i) => {
                  if (i !== index) {
                    return seg;
                  }
                  const previousSeg = i > 0 ? oldData.points[i - 1] : oldData.points.at(-1);
                  if (!previousSeg) {
                    return seg;
                  }
                  return PolygonSegment.changePointType(seg, previousSeg, type);
                });
                return GeometryComponent.update(old, { points });
              });
            },
            onPointMouseEnter: (index) => {
              ctx.shapePreview.setHighlight({ type: 'point', index });
            },
            onPointMouseLeave: () => {
              ctx.shapePreview.setHighlight(null);
            },
            onOpenAtIndexMouseEnter: () => {
              ctx.shapePreview.setHighlight({
                type: 'segment',
                index: geometryData.openAtIndex,
                color: POLYGON_OPEN_SEGMENT_HIGHLIGHT_COLOR,
              });
            },
            onOpenAtIndexMouseLeave: () => {
              ctx.shapePreview.setHighlight(null);
            },
            onOpenAtIndexMouseDown: () => {
              const current = ctx.geometryStore.getByIdWithComponent(id, GeometryComponent);
              if (!current || !GeometryComponent.isPolygon(current)) {
                return;
              }
              const polygonData = GeometryComponent.get(current);
              const initialOpenAtIndex = polygonData.openAtIndex;
              // Only drag across the displayed rows: closed polygons hide their duplicated
              // closing point.
              const initialPoints = polygonData.closed
                ? polygonData.points.slice(0, -1)
                : polygonData.points;
              let newOpenAtIndex = initialOpenAtIndex;
              let deltaYPx = 0;

              ctx.setOpenAtIndexState('dragging');
              ctx.shapePreview.setHighlight({
                type: 'segment',
                index: newOpenAtIndex,
                color: POLYGON_OPEN_SEGMENT_HIGHLIGHT_COLOR,
              });

              const onMouseMove = (e: MouseEvent) => {
                deltaYPx += e.movementY;
                newOpenAtIndex = computeOpenAtIndex(initialOpenAtIndex, initialPoints, deltaYPx);
                ctx.geometryStore.updateByIdWithComponentDirect(id, GeometryComponent, (old) =>
                  GeometryComponent.update(old, { openAtIndex: newOpenAtIndex }),
                );
                ctx.shapePreview.setHighlight({
                  type: 'segment',
                  index: newOpenAtIndex,
                  color: POLYGON_OPEN_SEGMENT_HIGHLIGHT_COLOR,
                });
              };

              const cleanup = () => {
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
                ctx.clearOpenAtIndexDragCleanup(cleanup);
              };

              const onMouseUp = () => {
                ctx.setOpenAtIndexState('idle');
                ctx.shapePreview.setHighlight(null);
                if (newOpenAtIndex !== initialOpenAtIndex) {
                  ctx.historyManager.push(
                    UndoEntry.polygonOpenAtIndex(id, initialOpenAtIndex, newOpenAtIndex),
                  );
                }
                cleanup();
              };

              ctx.setOpenAtIndexDragCleanup(cleanup);
              window.addEventListener('mousemove', onMouseMove);
              window.addEventListener('mouseup', onMouseUp);
            },
            onCloseOpen: () => {
              ctx.actionsManager?.execute('open-close-polygon');
            },
            onCloseOpenMouseEnter: () => {
              if (!geometryData.closed) {
                return;
              }

              // When hovering the open / close button, highlight the line, but don't actually
              // mark it as being dragged.
              ctx.setOpenAtIndexState('highlighted');

              ctx.shapePreview.setHighlight({
                type: 'segment',
                index: geometryData.openAtIndex,
                color: POLYGON_OPEN_SEGMENT_HIGHLIGHT_COLOR,
              });
            },
            onCloseOpenMouseLeave: () => {
              if (!geometryData.closed) {
                return;
              }
              ctx.setOpenAtIndexState('idle');
              ctx.shapePreview.setHighlight(null);
            },
          }),
        ];
      }
      default:
        geometryData satisfies never;
        return [];
    }
  }
}

registerComponent<
  ReadableTemplate<GeometryData, Entity<GeometryComponent>> &
    WritableTemplate<Partial<GeometryData>, Entity<GeometryComponent>>
>(GeometryComponent);
