import { UndoEntry } from '@/lib/history/types';
import { type FieldHandlers, type FieldOptionsList, Fields } from '@/lib/selection/fields';
import type { SelectionInspectorContext } from '@/lib/selection/selection-inspector-context';
import { Length } from '@/lib/units/length';
import { Constraint, type ConstraintData, type ConstraintEndpoint } from '../constraints';
import { type Entity, type EntityComponent } from '../types';

/**
 * Geometry component for a constraint.
 */
export type ConstraintComponent<C extends ConstraintData = ConstraintData> = EntityComponent<
  'constraint',
  C
>;

export namespace ConstraintComponent {
  export const key: keyof ConstraintComponent = 'constraint';

  export function create<C extends ConstraintData>(constraint: C): ConstraintComponent<C> {
    return { constraint };
  }

  export function get<C extends ConstraintData>(geometry: Entity<ConstraintComponent<C>>): C;
  export function get(geometry: Constraint): ConstraintData;
  export function get<C extends ConstraintData>(geometry: Entity<ConstraintComponent<C>>): C {
    return geometry.components.constraint;
  }

  export function update<
    Data extends ConstraintData = ConstraintData,
    Ent extends Entity<ConstraintComponent<Data>> = Entity<ConstraintComponent<Data>>,
  >(geometry: Ent, partial: Partial<Data>): Ent {
    const merged = { ...geometry.components.constraint, ...partial } as ConstraintData;
    return {
      ...geometry,
      components: {
        ...geometry.components,
        constraint: merged,
      },
    };
  }

  /** Builds the selection inspector fields for a constraint entity, dispatching on constraint type. */
  export function computeSelectionInspectorFields(
    entity: Entity<ConstraintComponent>,
    ctx: SelectionInspectorContext,
  ): FieldOptionsList {
    const constraintData = ConstraintComponent.get<ConstraintData>(entity);
    const id = entity.id;

    /** Reads the current constraint data for `id`, or null if it no longer exists. */
    const getCurrent = (): ConstraintData | null => {
      const current = ctx.geometryStore.getByIdWithComponent(id, ConstraintComponent);
      if (!current) {
        return null;
      }
      return ConstraintComponent.get(current);
    };

    /** Shared Escape handling for an in-progress constraint edit. */
    const onEditKeyDown = (k: string) => {
      if (k === 'Escape' && ctx.hasDragOriginal(id)) {
        ctx.restoreDragOriginal(id);
        ctx.clearWorkingFieldData();
        ctx.recomputeFields();
      }
    };

    /** Standard edit handlers for a length-valued constraint field. */
    const lengthHandlers = (
      key: string,
      onCommit: (value: Length) => void,
    ): FieldHandlers<Length> => ({
      onChange: (value) => {
        ctx.captureDragOriginal(id);
        ctx.setWorkingFieldData(key, { type: 'length', value });
      },
      onKeyDown: onEditKeyDown,
      onBlur: () => {
        const fieldData = ctx.getWorkingFieldData(key);
        if (!fieldData || fieldData.type !== 'length') {
          return;
        }
        onCommit(fieldData.value);
        ctx.finishEdit(id);
      },
    });

    /** Standard edit handlers for a numeric constraint field. */
    const numberHandlers = (
      key: string,
      onCommit: (value: string) => void,
    ): FieldHandlers<string> => ({
      onChange: (value) => {
        ctx.captureDragOriginal(id);
        ctx.setWorkingFieldData(key, { type: 'number', value });
      },
      onKeyDown: onEditKeyDown,
      onBlur: () => {
        const fieldData = ctx.getWorkingFieldData(key);
        if (!fieldData || fieldData.type !== 'number') {
          return;
        }
        onCommit(fieldData.value);
        ctx.finishEdit(id);
      },
    });

    switch (constraintData.type) {
      case 'linear': {
        const moveEndpoints = (key: 'pointA' | 'pointB', next: ConstraintEndpoint) => {
          const current = ctx.geometryStore.getByIdWithComponent(id, ConstraintComponent);
          if (!current) {
            return;
          }
          const c = ConstraintComponent.get(current);
          if (c.type !== 'linear') {
            return;
          }
          ctx.historyManager.apply(
            UndoEntry.linearConstraintMoveEndpoints(
              id,
              c.pointA,
              c.pointB,
              key === 'pointA' ? next : c.pointA,
              key === 'pointB' ? next : c.pointB,
            ),
          );
        };
        return [
          Fields.constraintEndpoint('pointA', 'A', constraintData.pointA, {
            onChange: (next) => moveEndpoints('pointA', next),
          }),
          Fields.constraintEndpoint('pointB', 'B', constraintData.pointB, {
            onChange: (next) => moveEndpoints('pointB', next),
          }),
          Fields.row('constrainedLength', [
            Fields.labelled(
              'constrainedLength',
              'Length:',
              Fields.length(
                'constrainedLength',
                constraintData.constrainedLength,
                { readOnlyUnit: true },
                lengthHandlers('constrainedLength', (value) => {
                  const c = getCurrent();
                  if (!c || c.type !== 'linear') {
                    return;
                  }
                  ctx.historyManager.apply(
                    UndoEntry.linearConstraintChangeLength(id, c.constrainedLength, value),
                  );
                }),
              ),
            ),
          ]),
          Fields.row('connectorLineOffsetPx', [
            Fields.labelled(
              'connectorLineOffsetPx',
              'Label offset:',
              Fields.number(
                'connectorLineOffsetPx',
                constraintData.connectorLineOffsetPx,
                numberHandlers('connectorLineOffsetPx', (value) => {
                  const val = parseFloat(value);
                  if (isNaN(val)) {
                    return;
                  }
                  const c = getCurrent();
                  if (!c || c.type !== 'linear') {
                    return;
                  }
                  ctx.historyManager.apply(
                    UndoEntry.linearConstraintMoveLabel(id, c.connectorLineOffsetPx, val),
                  );
                }),
              ),
            ),
          ]),
          Fields.row('axis', [
            Fields.labelled(
              'axis',
              'Axis:',
              Fields.choices(
                'axis',
                constraintData.axis ?? 'full',
                [
                  { value: 'full', label: 'Full' },
                  { value: 'x', label: 'X' },
                  { value: 'y', label: 'Y' },
                ],
                {
                  onChange: (next) => {
                    if (next !== 'full' && next !== 'x' && next !== 'y') {
                      return;
                    }
                    const c = getCurrent();
                    if (!c || c.type !== 'linear') {
                      return;
                    }
                    ctx.historyManager.apply(
                      UndoEntry.linearConstraintChangeAxis(
                        id,
                        c.axis,
                        next === 'full' ? null : next,
                      ),
                    );
                  },
                },
              ),
            ),
          ]),
        ];
      }
      case 'perpendicular': {
        const moveEndpoints = (
          key: 'pointA' | 'pointCenter' | 'pointB',
          next: ConstraintEndpoint,
        ) => {
          const c = getCurrent();
          if (!c || c.type !== 'perpendicular') {
            return;
          }
          ctx.historyManager.apply(
            UndoEntry.perpendicularConstraintMoveEndpoints(
              id,
              c.pointA,
              c.pointCenter,
              c.pointB,
              key === 'pointA' ? next : c.pointA,
              key === 'pointCenter' ? next : c.pointCenter,
              key === 'pointB' ? next : c.pointB,
            ),
          );
        };
        return [
          Fields.constraintEndpoint('pointA', 'A', constraintData.pointA, {
            onChange: (next) => moveEndpoints('pointA', next),
          }),
          Fields.constraintEndpoint('pointCenter', 'Center', constraintData.pointCenter, {
            onChange: (next) => moveEndpoints('pointCenter', next),
          }),
          Fields.constraintEndpoint('pointB', 'B', constraintData.pointB, {
            onChange: (next) => moveEndpoints('pointB', next),
          }),
        ];
      }
      case 'parallel': {
        const moveEndpoints = (
          key: 'pointA' | 'pointB' | 'pointC' | 'pointD',
          next: ConstraintEndpoint,
        ) => {
          const c = getCurrent();
          if (!c || c.type !== 'parallel') {
            return;
          }
          ctx.historyManager.apply(
            UndoEntry.parallelConstraintMoveEndpoints(
              id,
              c.pointA,
              c.pointB,
              c.pointC,
              c.pointD,
              key === 'pointA' ? next : c.pointA,
              key === 'pointB' ? next : c.pointB,
              key === 'pointC' ? next : c.pointC,
              key === 'pointD' ? next : c.pointD,
            ),
          );
        };
        return [
          Fields.constraintEndpoint('pointA', 'A', constraintData.pointA, {
            onChange: (next) => moveEndpoints('pointA', next),
          }),
          Fields.constraintEndpoint('pointB', 'B', constraintData.pointB, {
            onChange: (next) => moveEndpoints('pointB', next),
          }),
          Fields.constraintEndpoint('pointC', 'C', constraintData.pointC, {
            onChange: (next) => moveEndpoints('pointC', next),
          }),
          Fields.constraintEndpoint('pointD', 'D', constraintData.pointD, {
            onChange: (next) => moveEndpoints('pointD', next),
          }),
        ];
      }
      case 'horizontal': {
        const moveEndpoints = (key: 'pointA' | 'pointB', next: ConstraintEndpoint) => {
          const c = getCurrent();
          if (!c || c.type !== 'horizontal') {
            return;
          }
          ctx.historyManager.apply(
            UndoEntry.horizontalConstraintMoveEndpoints(
              id,
              c.pointA,
              c.pointB,
              key === 'pointA' ? next : c.pointA,
              key === 'pointB' ? next : c.pointB,
            ),
          );
        };
        return [
          Fields.constraintEndpoint('pointA', 'A', constraintData.pointA, {
            onChange: (next) => moveEndpoints('pointA', next),
          }),
          Fields.constraintEndpoint('pointB', 'B', constraintData.pointB, {
            onChange: (next) => moveEndpoints('pointB', next),
          }),
        ];
      }
      case 'vertical': {
        const moveEndpoints = (key: 'pointA' | 'pointB', next: ConstraintEndpoint) => {
          const c = getCurrent();
          if (!c || c.type !== 'vertical') {
            return;
          }
          ctx.historyManager.apply(
            UndoEntry.verticalConstraintMoveEndpoints(
              id,
              c.pointA,
              c.pointB,
              key === 'pointA' ? next : c.pointA,
              key === 'pointB' ? next : c.pointB,
            ),
          );
        };
        return [
          Fields.constraintEndpoint('pointA', 'A', constraintData.pointA, {
            onChange: (next) => moveEndpoints('pointA', next),
          }),
          Fields.constraintEndpoint('pointB', 'B', constraintData.pointB, {
            onChange: (next) => moveEndpoints('pointB', next),
          }),
        ];
      }
      case 'colinear': {
        const moveEndpoints = (
          key: 'pointTarget' | 'pointA' | 'pointB',
          next: ConstraintEndpoint,
        ) => {
          const c = getCurrent();
          if (!c || c.type !== 'colinear') {
            return;
          }
          ctx.historyManager.apply(
            UndoEntry.colinearConstraintMoveEndpoints(
              id,
              c.pointTarget,
              c.pointA,
              c.pointB,
              key === 'pointTarget' ? next : c.pointTarget,
              key === 'pointA' ? next : c.pointA,
              key === 'pointB' ? next : c.pointB,
            ),
          );
        };
        return [
          Fields.constraintEndpoint('pointTarget', 'Target', constraintData.pointTarget, {
            onChange: (next) => moveEndpoints('pointTarget', next),
          }),
          Fields.constraintEndpoint('pointA', 'A', constraintData.pointA, {
            onChange: (next) => moveEndpoints('pointA', next),
          }),
          Fields.constraintEndpoint('pointB', 'B', constraintData.pointB, {
            onChange: (next) => moveEndpoints('pointB', next),
          }),
        ];
      }
      default:
        constraintData satisfies never;
        return [];
    }
  }
}
