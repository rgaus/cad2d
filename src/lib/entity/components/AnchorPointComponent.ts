import { type FieldOptionsList, Fields } from '@/lib/selection/fields';
import type { SelectionInspectorContext } from '@/lib/selection/selection-inspector-context';
import { Length } from '@/lib/units/length';
import { SheetPosition } from '@/lib/viewport/types';
import { Entity, EntityComponent, EntityOmitComponents } from '../types';
import { GeometryComponent } from './GeometryComponent';

/** Configuration for a geometry's anchor point: a named key point on the geometry plus a sheet-unit
 * offset from that key point. The anchor handle renders at `keyPointPosition + offset`. */
export type AnchorPointData = {
  /** Name of the key point - one of the named perimeter labels or extras keys exposed by the
   * geometry's {@link GeometryComponent.keyPoints}. */
  keyPoint: string;
  /** Offset in sheet units from the key point. */
  offset: SheetPosition;
};

/** Controls the point which acts as the origin for drawing the geometry. */
export type AnchorPointComponent = EntityComponent<'anchorPoint', AnchorPointData>;

export namespace AnchorPointComponent {
  export const key: keyof AnchorPointComponent = 'anchorPoint';

  export function create(anchorPoint: AnchorPointData): AnchorPointComponent {
    return { anchorPoint };
  }
  export function get(geometry: Entity<AnchorPointComponent>): AnchorPointData {
    return geometry.components.anchorPoint;
  }
  export function update<G extends Entity<AnchorPointComponent>>(
    geometry: G,
    anchorPoint: AnchorPointData,
  ): G {
    return { ...geometry, components: { ...geometry.components, anchorPoint } };
  }
  /** Remove a given {@link AnchorPointComponent} from a given {@link Entity}. */
  export function remove<G extends Entity<AnchorPointComponent>>(
    geometry: G,
  ): EntityOmitComponents<G, AnchorPointComponent> {
    const components: Partial<G['components']> = { ...geometry.components };
    delete components.anchorPoint;
    return { ...geometry, components };
  }

  /** All named key points available on the geometry (named perimeter labels plus extras keys). */
  export function getAvailableKeyPoints(geometry: Entity<GeometryComponent>): Array<string> {
    const keyPoints = GeometryComponent.keyPoints(geometry);
    const perimeterLabels = keyPoints.perimeterLabels.filter(
      (label): label is string => label !== null,
    );
    return [...perimeterLabels, ...Object.keys(keyPoints.extras)];
  }

  /** Resolves a named key point to its position on the geometry, or null if it does not exist. */
  export function resolveKeyPointPosition(
    geometry: Entity<GeometryComponent>,
    keyPoint: string,
  ): SheetPosition | null {
    const keyPoints = GeometryComponent.keyPoints(geometry);
    const index = keyPoints.perimeterLabels.indexOf(keyPoint);
    if (index !== -1) {
      return keyPoints.perimeter[index] ?? null;
    }
    const extras = keyPoints.extras as Record<string, SheetPosition>;
    return extras[keyPoint] ?? null;
  }

  /** The offset that the associated geometry should be rendered at from it's natural origin, given
   * the anchor point position */
  export function computeAssociatedGeometryOffset(
    geometry: Entity<AnchorPointComponent & GeometryComponent>,
  ): SheetPosition {
    const { keyPoint, offset } = AnchorPointComponent.get(geometry);
    // Resolve the key point against the geometry without its own anchor applied, so both the key
    // point and the origin are in the same (raw) space and the anchor does not cancel itself out.
    const withoutAnchor = AnchorPointComponent.remove(geometry);
    const keyPointPosition = resolveKeyPointPosition(withoutAnchor, keyPoint);
    if (!keyPointPosition) {
      return new SheetPosition(0, 0);
    }
    const origin = GeometryComponent.getOrigin(withoutAnchor);

    return new SheetPosition(
      keyPointPosition.x - origin.x + offset.x,
      keyPointPosition.y - origin.y + offset.y,
    );
  }

  /**
   * Builds the translation function which maps raw stored geometry positions into their rendered
   * ("anchored") positions. Pass it to {@link GeometryComponent.translate} to render geometry, or
   * invert it to convert rendered positions back into raw positions. Geometries without an anchor
   * point are translated by zero.
   */
  export function generateTranslationFunction(
    geometry: Entity<GeometryComponent & Partial<AnchorPointComponent>>,
  ): (position: SheetPosition) => SheetPosition {
    if (!Entity.hasComponents(geometry, GeometryComponent, AnchorPointComponent)) {
      return (position) => new SheetPosition(position.x, position.y);
    }
    const offset = AnchorPointComponent.computeAssociatedGeometryOffset(geometry);
    return (position) => new SheetPosition(position.x - offset.x, position.y - offset.y);
  }

  /**
   * Computes the position that the anchor point should be rendered, in absolute sheet coordinates.
   * The handle always sits at the geometry's (raw) natural origin.
   */
  export function getHandlePosition(
    geometry: Entity<AnchorPointComponent & GeometryComponent>,
  ): SheetPosition {
    return GeometryComponent.getOrigin(AnchorPointComponent.remove(geometry));
  }

  /** Human readable label for a key point name, eg `upperLeft` -> `Upper left`. */
  export function formatKeyPointLabel(keyPoint: string): string {
    const spaced = keyPoint.replace(/([A-Z])/g, ' $1').trim();
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  }

  /** Builds the anchor point row shown in the selection inspector for this entity. */
  export function computeSelectionInspectorFields(
    entity: Entity<AnchorPointComponent>,
    ctx: SelectionInspectorContext,
  ): FieldOptionsList {
    if (!Entity.hasComponent(entity, GeometryComponent)) {
      return [];
    }
    const anchorPoint = AnchorPointComponent.get(entity);
    const id = entity.id;
    const availableKeyPoints = AnchorPointComponent.getAvailableKeyPoints(entity);

    const offsetXHandlers = ctx.makeLengthHandlers(
      id,
      'anchorOffsetX',
      AnchorPointComponent,
      (value) => {
        const current = ctx.geometryStore.getByIdWithComponent(id, AnchorPointComponent);
        if (!current) {
          return null;
        }
        const currentAnchor = AnchorPointComponent.get(current);
        return {
          keyPoint: currentAnchor.keyPoint,
          offset: new SheetPosition(
            value.toSheetUnits(ctx.sheetDefaultUnit).magnitude,
            currentAnchor.offset.y,
          ),
        };
      },
    );
    const offsetYHandlers = ctx.makeLengthHandlers(
      id,
      'anchorOffsetY',
      AnchorPointComponent,
      (value) => {
        const current = ctx.geometryStore.getByIdWithComponent(id, AnchorPointComponent);
        if (!current) {
          return null;
        }
        const currentAnchor = AnchorPointComponent.get(current);
        return {
          keyPoint: currentAnchor.keyPoint,
          offset: new SheetPosition(
            currentAnchor.offset.x,
            value.toSheetUnits(ctx.sheetDefaultUnit).magnitude,
          ),
        };
      },
    );

    return [
      Fields.row('anchor', [
        Fields.labelled(
          'anchorKeyPoint',
          'Anchor:',
          Fields.choices(
            'anchorKeyPoint',
            anchorPoint.keyPoint,
            availableKeyPoints.map((value) => ({
              value,
              label: AnchorPointComponent.formatKeyPointLabel(value),
            })),
            {
              onChange: (nextKeyPoint) => {
                ctx.geometryStore.updateByIdWithComponent(id, AnchorPointComponent, (g) =>
                  AnchorPointComponent.update(g, {
                    ...AnchorPointComponent.get(g),
                    keyPoint: nextKeyPoint,
                  }),
                );
                ctx.recomputeFields();
              },
            },
          ),
        ),
      ]),
      Fields.row('anchorOffset', [
        Fields.labelled(
          'anchorOffsetX',
          'X:',
          Fields.length(
            'anchorOffsetX',
            Length.fromSheetUnits(ctx.sheetDefaultUnit, anchorPoint.offset.x),
            { readOnlyUnit: true },
            offsetXHandlers,
          ),
        ),
        Fields.spacing('anchorOffsetSpacer', 'sm'),
        Fields.labelled(
          'anchorOffsetY',
          'Y:',
          Fields.length(
            'anchorOffsetY',
            Length.fromSheetUnits(ctx.sheetDefaultUnit, anchorPoint.offset.y),
            { readOnlyUnit: true },
            offsetYHandlers,
          ),
        ),
      ]),
    ];
  }
}
