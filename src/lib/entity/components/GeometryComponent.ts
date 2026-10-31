import { UndoEntry } from '@/lib/history/types';
import { BoundingBox } from '@/lib/math';
import { POLYGON_OPEN_SEGMENT_HIGHLIGHT_COLOR } from '@/lib/selection/constants';
import { type FieldOptionsList, Fields } from '@/lib/selection/fields';
import { computeOpenAtIndex } from '@/lib/selection/polygon-point-row';
import type { SelectionInspectorContext } from '@/lib/selection/selection-inspector-context';
import { Length, type UnitType } from '@/lib/units/length';
import { KeyPoints, Rect, SheetPosition } from '@/lib/viewport/types';
import { FilletFilter, Filter, FilterData } from '../filters';
import { MirrorFilter } from '../filters/mirror';
import { PatternFilter } from '../filters/pattern';
import { type Geometry, type GeometryData } from '../geometry';
import { EllipseData } from '../geometry/ellipse';
import { PolygonData, PolygonSegment } from '../geometry/polygon';
import { RectangleData } from '../geometry/rectangle';
import { RectangleEndpoint } from '../rectangle';
import { Entity, type EntityComponent, ResizeParams } from '../types';
import { AnchorPointComponent } from './AnchorPointComponent';
import { ConstraintComponent } from './ConstraintComponent';
import { FilterComponent } from './FilterComponent';
import { FrameComponent } from './FrameComponent';
import { LinkDimensionsComponent } from './LinkDimensionsComponent';

export type RenderShapePolygon = {
  shape: 'polygon';
  key: string;
  primary: boolean;
  points: Array<PolygonSegment>;
  closed: boolean;
};
export type RenderShapeRectangle = {
  shape: 'rectangle';
  key: string;
  primary: boolean;
  upperLeft: SheetPosition;
  lowerRight: SheetPosition;
};
export type RenderShapeEllipse = {
  shape: 'ellipse';
  key: string;
  primary: boolean;
  center: SheetPosition;
  radiusX: number;
  radiusY: number;
};

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

export type RenderShape = RenderShapePolygon | RenderShapeRectangle | RenderShapeEllipse;

export namespace RenderShape {
  export function polygon(
    key: string,
    points: Array<PolygonSegment>,
    options?: { closed?: boolean; primary?: boolean },
  ): RenderShape {
    return {
      shape: 'polygon' as const,
      key,
      primary: options?.primary ?? false,
      points,
      closed: options?.closed ?? false,
    };
  }
  export function rectangle(
    key: string,
    upperLeft: SheetPosition,
    lowerRight: SheetPosition,
    options?: { primary?: boolean },
  ): RenderShape {
    return {
      shape: 'rectangle' as const,
      key,
      primary: options?.primary ?? false,
      upperLeft,
      lowerRight,
    };
  }
  export function ellipse(
    key: string,
    center: SheetPosition,
    args: { radiusX: number; radiusY: number; primary?: boolean },
  ): RenderShape {
    return {
      shape: 'ellipse' as const,
      key,
      primary: args?.primary ?? false,
      center,
      radiusX: args.radiusX,
      radiusY: args.radiusY,
    };
  }

  export function boundingBox(renderShape: RenderShape) {
    switch (renderShape.shape) {
      case 'polygon':
        return BoundingBox.fromPoints(renderShape.points.map((p) => p.point));
      case 'rectangle':
        return BoundingBox.fromPoints([renderShape.upperLeft, renderShape.lowerRight]);
      case 'ellipse':
        return BoundingBox.fromPoints([
          renderShape.center,
          new SheetPosition(renderShape.center.x, renderShape.center.y + renderShape.radiusY),
          new SheetPosition(renderShape.center.x, renderShape.center.y - renderShape.radiusY),
          new SheetPosition(renderShape.center.x + renderShape.radiusX, renderShape.center.y),
          new SheetPosition(renderShape.center.x - renderShape.radiusX, renderShape.center.y),
        ]);
      default:
        renderShape satisfies never;
        throw new Error(
          `RenderShape.boundingBox: Unknown render shape ${(renderShape as any).shape}`,
        );
    }
  }
}

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
    points: Array<PolygonSegment>,
    options?: { closed?: boolean; openAtIndex?: number },
  ): GeometryComponent<PolygonData> {
    if (points.length < 2) {
      throw new Error(
        `GeometryComponent.createPolygon: points.length must be >= 2, found ${points.length}`,
      );
    }
    return {
      geometry: {
        type: 'polygon',
        points,
        closed: options?.closed ?? points[0].point === points.at(-1)!.point,
        openAtIndex: options?.openAtIndex ?? 0,
      },
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

  /** Returns the geometry data after the entity's render transforms have been applied. */
  export function getRendered<D extends GeometryData = GeometryData>(
    geometry: Entity<GeometryComponent<D> & Partial<AnchorPointComponent>>,
  ): D {
    return get(transform(geometry, AnchorPointComponent.generateTranslationFunction(geometry)));
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

  /**
   * Key points that are added as verticies within the DCEL and available for a user to snap other
   * entities like constraints to. These are expressed in anchored (rendered) space.
   **/
  export function keyPoints(
    geometry: Entity<GeometryComponent & Partial<AnchorPointComponent>>,
  ): KeyPoints<SheetPosition, string> {
    if (Entity.hasComponents(geometry, GeometryComponent, AnchorPointComponent)) {
      // Translate the geometry into anchored space, then drop the anchor so the recursive call
      // below reads plain (unanchored) geometry.
      const translated = GeometryComponent.transform(
        geometry,
        AnchorPointComponent.generateTranslationFunction(geometry),
      );
      return GeometryComponent.keyPoints(AnchorPointComponent.remove(translated));
    }

    const state = GeometryComponent.get(geometry);
    switch (state.type) {
      case 'polygon':
        return PolygonData.keyPoints(geometry as Entity<GeometryComponent<PolygonData>>);
      case 'rectangle':
        return RectangleData.keyPoints(geometry as Entity<GeometryComponent<RectangleData>>);
      case 'ellipse':
        return EllipseData.keyPoints(geometry as Entity<GeometryComponent<EllipseData>>);
      default:
        state satisfies never;
        throw new Error(
          `GeometryComponent.keyPoints: Unknown geometry data type ${(state as any).type}`,
        );
    }
  }

  /** Bounding box in anchored (rendered) space. */
  export function boundingBox(
    geometry: Entity<GeometryComponent & Partial<AnchorPointComponent>>,
  ): Rect<SheetPosition> {
    if (Entity.hasComponents(geometry, GeometryComponent, AnchorPointComponent)) {
      const translated = GeometryComponent.transform(
        geometry,
        AnchorPointComponent.generateTranslationFunction(geometry),
      );
      return GeometryComponent.boundingBox(AnchorPointComponent.remove(translated));
    }

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

  /** Origin in anchored (rendered) space. */
  export function getOrigin(
    geometry: Entity<GeometryComponent & Partial<AnchorPointComponent>>,
  ): SheetPosition {
    if (Entity.hasComponents(geometry, GeometryComponent, AnchorPointComponent)) {
      const translated = GeometryComponent.transform(
        geometry,
        AnchorPointComponent.generateTranslationFunction(geometry),
      );
      return GeometryComponent.getOrigin(AnchorPointComponent.remove(translated));
    }

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

  /**
   * Returns true if a geometry entity and a render shape are geometrically
   * identical (same type, same positions). Ignores metadata like `primary`
   * and `key` on the render shape.
   *
   * Used during serialization to skip rendering a render shape that is a
   * duplicate of the entity's own native SVG element.
   */
  export function isGeometricallyEqual(
    geometry: Entity<GeometryComponent>,
    renderShape: RenderShape,
  ): boolean {
    const data = GeometryComponent.getRendered(geometry);
    switch (data.type) {
      case 'polygon':
        if (renderShape.shape !== 'polygon') {
          return false;
        }
        return PolygonData.isGeometricallyEqualToRenderShape(data.points, data.closed, renderShape);
      case 'rectangle': {
        if (renderShape.shape !== 'rectangle') {
          return false;
        }
        const corners = RectangleData.corners(data);
        return (
          corners.upperLeft.x === renderShape.upperLeft.x &&
          corners.upperLeft.y === renderShape.upperLeft.y &&
          corners.lowerRight.x === renderShape.lowerRight.x &&
          corners.lowerRight.y === renderShape.lowerRight.y
        );
      }
      case 'ellipse':
        if (renderShape.shape !== 'ellipse') {
          return false;
        }
        return (
          data.center.x === renderShape.center.x &&
          data.center.y === renderShape.center.y &&
          data.radiusX === renderShape.radiusX &&
          data.radiusY === renderShape.radiusY
        );
      default:
        data satisfies never;
        return false;
    }
  }

  export function resize<E extends Entity<GeometryComponent & Partial<AnchorPointComponent>>>(
    geometry: E,
    params: ResizeParams,
    originalBBox?: Rect<SheetPosition>,
  ): E {
    // Resize math happens in anchored (rendered) space, but the stored geometry is raw. Translate the
    // inputs back into raw space before dispatching to the raw resize implementations.
    const offset = GeometryComponent.getAnchorPointOffset(geometry);
    const rawParams =
      offset.x === 0 && offset.y === 0
        ? params
        : { ...params, to: new SheetPosition(params.to.x + offset.x, params.to.y + offset.y) };
    const rawBBox =
      originalBBox && (offset.x !== 0 || offset.y !== 0)
        ? {
            ...originalBBox,
            position: new SheetPosition(
              originalBBox.position.x + offset.x,
              originalBBox.position.y + offset.y,
            ),
          }
        : originalBBox;

    const state = GeometryComponent.get(geometry);
    switch (state.type) {
      case 'polygon':
        return PolygonData.resize(
          geometry as Entity<GeometryComponent<PolygonData>>,
          rawParams,
          rawBBox,
        ) as E;
      case 'rectangle':
        return RectangleData.resize(
          geometry as Entity<GeometryComponent<RectangleData>>,
          rawParams,
          rawBBox,
        ) as E;
      case 'ellipse':
        return EllipseData.resize(
          geometry as Entity<GeometryComponent<EllipseData>>,
          rawParams,
          rawBBox,
        ) as E;
      default:
        state satisfies never;
        throw new Error(
          `GeometryComponent.resize: Unknown geometry data type ${(state as any).type}`,
        );
    }
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
    const state = GeometryComponent.getRendered(geometry);
    switch (state.type) {
      case 'polygon':
        shapes = [
          RenderShape.polygon(geometry.id, state.points, { closed: state.closed, primary: true }),
        ];
        if (mapping) {
          for (let i = 0; i < state.points.length; i += 1) {
            mapping.set(i, [{ shapeIndex: 0, type: 'polygon', pointIndex: i }]);
          }
        }
        break;
      case 'rectangle': {
        const corners = RectangleData.corners(state);
        shapes = [
          RenderShape.rectangle(geometry.id, corners.upperLeft, corners.lowerRight, {
            primary: true,
          }),
        ];
        if (mapping) {
          for (const corner of RectangleEndpoint.LIST) {
            mapping.set(corner, [{ shapeIndex: 0, type: 'rectangle', corner }]);
          }
        }
        break;
      }
      case 'ellipse':
        shapes = [
          RenderShape.ellipse(geometry.id, state.center, {
            radiusX: state.radiusX,
            radiusY: state.radiusY,
            primary: true,
          }),
        ];
        break;
      default:
        state satisfies never;
        throw new Error(
          `GeometryComponent.getRenderShapes: Unknown geometry data type ${(state as any).type}`,
        );
    }

    let filterApplicationCounter = 0;
    for (const filter of filters.sort((a, b) => {
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
        const bounds = BoundingBox.fromPoints(geometryData.points.map((s) => s.point));
        const isPolygonFilledDueToFilter = !geometryData.closed && 'fillColor' in entity.components;
        const pointXHandlers = ctx.makePolygonPointLengthHandlers(id, 'x');
        const pointYHandlers = ctx.makePolygonPointLengthHandlers(id, 'y');
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
                  const currentGeom = GeometryComponent.get(current);
                  const newX = value.toSheetUnits(ctx.sheetDefaultUnit).magnitude;
                  const currentBounds = BoundingBox.fromPoints(
                    currentGeom.points.map((s) => s.point),
                  );
                  const deltaX = newX - currentBounds.position.x;
                  if (deltaX === 0) {
                    return null;
                  }
                  const translated = PolygonData.translate(
                    current,
                    (p) => new SheetPosition(p.x + deltaX, p.y),
                  );
                  return { points: GeometryComponent.get(translated).points };
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
                  const currentGeom = GeometryComponent.get(current);
                  const newY = value.toSheetUnits(ctx.sheetDefaultUnit).magnitude;
                  const currentBounds = BoundingBox.fromPoints(
                    currentGeom.points.map((s) => s.point),
                  );
                  const deltaY = newY - currentBounds.position.y;
                  if (deltaY === 0) {
                    return null;
                  }
                  const translated = PolygonData.translate(
                    current,
                    (p) => new SheetPosition(p.x, p.y + deltaY),
                  );
                  return { points: GeometryComponent.get(translated).points };
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
                    const currentGeom = GeometryComponent.get(current);
                    const w = value.toSheetUnits(ctx.sheetDefaultUnit).magnitude;
                    const currentBounds = BoundingBox.fromPoints(
                      currentGeom.points.map((s) => s.point),
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
                      points: BoundingBox.interpolatePoints(
                        currentGeom.points,
                        currentBounds,
                        newBounds,
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
                    const currentGeom = GeometryComponent.get(current);
                    const h = value.toSheetUnits(ctx.sheetDefaultUnit).magnitude;
                    const currentBounds = BoundingBox.fromPoints(
                      currentGeom.points.map((s) => s.point),
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
                      points: BoundingBox.interpolatePoints(
                        currentGeom.points,
                        currentBounds,
                        newBounds,
                      ),
                    };
                  },
                  'height',
                ),
              ),
            ),
          ]),
          Fields.polygonPoints('points', geometryData, isPolygonFilledDueToFilter, {
            onPointXChange: pointXHandlers.onChange,
            onPointYChange: pointYHandlers.onChange,
            onPointXBlur: pointXHandlers.onBlur,
            onPointYBlur: pointYHandlers.onBlur,
            onControlPointChange: (index, pointKey, axis, len) => {
              const current = ctx.geometryStore.getByIdWithComponent(id, GeometryComponent);
              if (!current || !GeometryComponent.isPolygon(current)) {
                return;
              }
              const polygonData = GeometryComponent.get(current);
              const beforePoint = (polygonData.points[index] as any)[pointKey];
              const sheetVal = len.toSheetUnits(ctx.sheetDefaultUnit).magnitude;
              const afterPoint =
                axis === 'x'
                  ? new SheetPosition(sheetVal, beforePoint.y)
                  : new SheetPosition(beforePoint.x, sheetVal);
              ctx.historyManager.apply(
                UndoEntry.polygonMoveControlPoint(id, index, pointKey, beforePoint, afterPoint),
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
              const polygonData = GeometryComponent.get(current);
              const seg = polygonData.points[index];
              const nextSeg = polygonData.points[index + 1];
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
