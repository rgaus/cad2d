import { type FieldOptionsList, Fields } from '@/lib/selection/fields';
import type { SelectionInspectorContext } from '@/lib/selection/selection-inspector-context';
import { Entity, EntityComponent, EntityOmitComponents } from '../types';

/** Controls rendering order. Higher values render on top of lower values. */
export type RenderOrderComponent = EntityComponent<'renderOrder', number>;

export namespace RenderOrderComponent {
  export const key: keyof RenderOrderComponent = 'renderOrder';

  export function create(renderOrder: number): RenderOrderComponent {
    return { renderOrder };
  }
  export function get(geometry: Entity<RenderOrderComponent>): number {
    return geometry.components.renderOrder;
  }
  export function update<G extends Entity<RenderOrderComponent>>(
    geometry: G,
    renderOrder: number,
  ): G {
    return { ...geometry, components: { ...geometry.components, renderOrder } };
  }
  /** Remove a given {@link RenderOrderComponent} from a given {@link Entity}. */
  export function remove<G extends Entity<RenderOrderComponent>>(
    geometry: G,
  ): EntityOmitComponents<G, RenderOrderComponent> {
    const components: Partial<G['components']> = { ...geometry.components };
    delete components.renderOrder;
    return { ...geometry, components };
  }

  /** Builds the render-order row shown in the selection inspector for this entity. */
  export function computeSelectionInspectorFields(
    entity: Entity<RenderOrderComponent>,
    ctx: SelectionInspectorContext,
  ): FieldOptionsList {
    const renderOrderValue = RenderOrderComponent.get(entity);
    const id = entity.id;
    return [
      Fields.row('renderOrder', [
        Fields.labelled(
          'renderOrder',
          'Render order:',
          Fields.renderOrder('renderOrder', renderOrderValue, entity.id, {
            onChange: (value) => {
              ctx.captureDragOriginal(id);
              ctx.setWorkingFieldData('renderOrder', { type: 'render-order', value });
              ctx.geometryStore.updateByIdWithComponentDirect(id, RenderOrderComponent, (old) =>
                RenderOrderComponent.update(old, value),
              );
            },
            onBlur: () => {
              if (!ctx.hasDragOriginal(id)) {
                return;
              }
              const fieldData = ctx.getWorkingFieldData('renderOrder');
              if (!fieldData || fieldData.type !== 'render-order') {
                return;
              }
              ctx.geometryStore.updateByIdDirect(id, ctx.getDragOriginal(id)!);
              ctx.geometryStore.setRenderOrder(id, fieldData.value);
              ctx.clearDragOriginal(id);
            },
            onKeyDown: (k) => {
              if (k === 'Escape' && ctx.hasDragOriginal(id)) {
                ctx.restoreDragOriginal(id);
                ctx.clearWorkingFieldData();
                ctx.recomputeFields();
              }
            },
          }),
        ),
      ]),
    ];
  }
}
