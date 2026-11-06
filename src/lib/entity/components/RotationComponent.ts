import { type FieldOptionsList, Fields } from '@/lib/selection/fields';
import { type SelectionInspectorContext } from '@/lib/selection/selection-inspector-context';
import { SheetPosition } from '@/lib/viewport/types';
import { Entity, EntityComponent, EntityOmitComponents } from '../types';
import { GeometryComponent } from './GeometryComponent';
import { Angle } from '@/lib/units/angle';

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

  /** Rotates a point around a center point by the given angle in degrees. */
  function rotatePointAround(
    point: SheetPosition,
    center: SheetPosition,
    angleDeg: number,
  ): SheetPosition {
    const rad = Angle.degrees(angleDeg).toRadians().magnitude;
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return new SheetPosition(center.x + dx * cos - dy * sin, center.y + dx * sin + dy * cos);
  }

  /**
   * Builds the translation function which maps raw stored geometry positions into their rendered
   * ("rotated") positions. Pass it to {@link GeometryComponent.transform} to render geometry, or
   * invert it to convert rendered positions back into raw positions.
   */
  export function generateRenderTransformFunction(
    entity: Entity<RotationComponent>,
  ): (position: SheetPosition) => SheetPosition {
    if (Entity.hasComponent(entity, GeometryComponent)) {
      const { angle } = RotationComponent.get(entity);
      return (position) => {
        return rotatePointAround(
          position,
          GeometryComponent.getOrigin(entity),
          angle.toDegrees().magnitude,
        );
      };
    }
    return (position) => new SheetPosition(position.x, position.y);
  }

  /** Builds the angle row shown in the selection inspector for this entity. */
  export function computeSelectionInspectorFields(
    entity: Entity<RotationComponent>,
    ctx: SelectionInspectorContext,
  ): FieldOptionsList {
    if (!Entity.hasComponent(entity, GeometryComponent)) {
      return [];
    }
    const rotationData = RotationComponent.get(entity);
    const id = entity.id;

    return [
      Fields.row('rotation', [
        Fields.labelled(
          'rotation',
          'Angle:',
          Fields.angle(
            'rotationDegrees',
            rotationData.angle,
            {
              onChange: (nextAngle) => {
                ctx.geometryStore.updateByIdWithComponent(id, RotationComponent, (entity) =>
                  RotationComponent.update(entity, {
                    ...RotationComponent.get(entity),
                    angle: nextAngle,
                  }),
                );
                ctx.recomputeFields();
              },
            },
          ),
        ),
      ]),
    ];
  }
}
