import { type FieldOptionsList, Fields } from '@/lib/selection/fields';
import type { SelectionInspectorContext } from '@/lib/selection/selection-inspector-context';
import { Entity, EntityComponent, EntityOmitComponents } from '../types';
import { SheetPosition } from '@/lib/viewport/types';
import { Length } from '@/lib/units/length';

/** Controls the x/y coordinate that acts as the origin for drawing the geometry. */
export type AnchorPointComponent = EntityComponent<'anchorPoint', SheetPosition>;

export namespace AnchorPointComponent {
  export const key: keyof AnchorPointComponent = 'anchorPoint';

  export function create(anchorPoint: SheetPosition): AnchorPointComponent {
    return { anchorPoint };
  }
  export function get(geometry: Entity<AnchorPointComponent>): SheetPosition {
    return geometry.components.anchorPoint;
  }
  export function update<G extends Entity<AnchorPointComponent>>(
    geometry: G,
    anchorPoint: SheetPosition,
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

  /** Builds the render-order row shown in the selection inspector for this entity. */
  export function computeSelectionInspectorFields(
    entity: Entity<AnchorPointComponent>,
    ctx: SelectionInspectorContext,
  ): FieldOptionsList {
    const anchorPoint = AnchorPointComponent.get(entity);
    const id = entity.id;
    return [
      Fields.labelled('anchor', 'Anchor:', [
        Fields.length('anchorPointX', Length.fromSheetUnits(ctx.sheetDefaultUnit, anchorPoint.x), { readOnlyUnit: true }, {
          onChange: (value) => {
            ctx.captureDragOriginal(id);
            ctx.setWorkingFieldData('anchorPointX', { type: 'length', value });
          },
          onKeyDown: (k) => {
            if (k === 'Escape' && ctx.hasDragOriginal(id)) {
              ctx.restoreDragOriginal(id);
              ctx.clearWorkingFieldData();
              ctx.recomputeFields();
            }
          },
          onBlur: () => {
            const fieldData = ctx.getWorkingFieldData('anchorPointX');
            if (!fieldData || fieldData.type !== 'length') {
              return;
            }
            const val = fieldData.value.toSheetUnits(ctx.sheetDefaultUnit).magnitude;
            ctx.geometryStore.updateByIdWithComponent(id, AnchorPointComponent, (g) =>
              AnchorPointComponent.update(g, new SheetPosition(val, AnchorPointComponent.get(g).y)),
            );
            ctx.finishEdit(id);
          },
        }),
        Fields.length('anchorPointY', Length.fromSheetUnits(ctx.sheetDefaultUnit, anchorPoint.y), { readOnlyUnit: true }, {
          onChange: (value) => {
            ctx.captureDragOriginal(id);
            ctx.setWorkingFieldData('anchorPointY', { type: 'length', value });
          },
          onKeyDown: (k) => {
            if (k === 'Escape' && ctx.hasDragOriginal(id)) {
              ctx.restoreDragOriginal(id);
              ctx.clearWorkingFieldData();
              ctx.recomputeFields();
            }
          },
          onBlur: () => {
            const fieldData = ctx.getWorkingFieldData('anchorPointY');
            if (!fieldData || fieldData.type !== 'length') {
              return;
            }
            const val = fieldData.value.toSheetUnits(ctx.sheetDefaultUnit).magnitude;
            ctx.geometryStore.updateByIdWithComponent(id, AnchorPointComponent, (g) =>
              AnchorPointComponent.update(g, new SheetPosition(val, AnchorPointComponent.get(g).y)),
            );
            ctx.finishEdit(id);
          },
        }),
      ]),
    ];
  }
}
