import { type Matrix, identity, rotateDEG } from 'transformation-matrix';
import { rotatePointAround } from '@/lib/math';
import { type FieldOptionsList, Fields } from '@/lib/selection/fields';
import { type SelectionInspectorContext } from '@/lib/selection/selection-inspector-context';
import { Angle } from '@/lib/units/angle';
import { SheetPosition } from '@/lib/viewport/types';
import { registerComponent } from '../registry';
import { Entity, EntityComponent, EntityOmitComponents } from '../types';
import { GeometryComponent } from './GeometryComponent';
import { TransformableTemplate } from './templates/TransformableTemplate';

export type RotationData = {
  angle: Angle;
};

/** Controls the amount in which the given entity is rotated. */
export type RotationComponent = EntityComponent<'rotation', RotationData>;

export namespace RotationComponent {
  export const key: keyof RotationComponent = 'rotation';

  export function create(angle: Angle): RotationComponent {
    return { rotation: { angle } };
  }
  export function get(entity: Entity<RotationComponent>): RotationData {
    return entity.components.rotation;
  }
  export function getOptional(entity: Entity): RotationData | undefined {
    if (RotationComponent.key in entity.components) {
      return (entity.components as RotationComponent).rotation;
    }
    return undefined;
  }
  export function update<E extends Entity<RotationComponent>>(
    entity: E,
    rotation: RotationData,
  ): E {
    return { ...entity, components: { ...entity.components, rotation } };
  }

  /** Remove a given {@link RotationComponent} from a given {@link Entity}. */
  export function remove<E extends Entity<RotationComponent>>(
    entity: E,
  ): EntityOmitComponents<E, RotationComponent> {
    const components: Partial<E['components']> = { ...entity.components };
    delete components.rotation;
    return { ...entity, components };
  }

  function getRotationOrigin(entity: Entity): SheetPosition | null {
    const adapter = TransformableTemplate.getForEntity(entity);
    if (adapter) {
      return adapter.getOrigin(entity);
    }
    if (Entity.hasComponent(entity, GeometryComponent)) {
      return GeometryComponent.getOrigin(entity);
    }
    return null;
  }

  /**
   * Builds the matrix which maps raw stored geometry positions into their rendered ("rotated")
   * positions.
   */
  export function generateRenderMatrix(entity: Entity<RotationComponent>): Matrix {
    const origin = getRotationOrigin(entity);
    if (origin) {
      const { angle } = RotationComponent.get(entity);
      return rotateDEG(angle.toDegrees().magnitude, origin.x, origin.y);
    }
    return identity();
  }

  /**
   * Builds the translation function which maps raw stored geometry positions into their rendered
   * ("rotated") positions. Pass it to {@link GeometryComponent.transform} to render geometry, or
   * invert it to convert rendered positions back into raw positions.
   */
  export function generateRenderTransformFunction(
    entity: Entity<RotationComponent>,
  ): (position: SheetPosition) => SheetPosition {
    const origin = getRotationOrigin(entity);
    if (origin) {
      const { angle } = RotationComponent.get(entity);
      return (position) => {
        return rotatePointAround(position, origin, angle.toDegrees().magnitude);
      };
    }
    return (position) => new SheetPosition(position.x, position.y);
  }

  /** Builds the angle row shown in the selection inspector for this entity. */
  export function computeSelectionInspectorFields(
    entity: Entity<RotationComponent>,
    ctx: SelectionInspectorContext,
  ): FieldOptionsList {
    if (!getRotationOrigin(entity)) {
      return [];
    }
    const rotationData = RotationComponent.get(entity);
    const id = entity.id;

    return [
      Fields.row('rotation', [
        Fields.labelled(
          'rotation',
          'Angle:',
          Fields.angle('rotationDegrees', rotationData.angle, {
            onChange: (nextAngle) => {
              ctx.geometryStore.updateByIdWithComponent(id, RotationComponent, (entity) =>
                RotationComponent.update(entity, {
                  ...RotationComponent.get(entity),
                  angle: nextAngle,
                }),
              );
              ctx.recomputeFields();
            },
          }),
        ),
      ]),
    ];
  }
}

registerComponent(RotationComponent);
