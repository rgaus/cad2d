/* eslint-disable @typescript-eslint/no-namespace */
import { applyToPoint } from 'transformation-matrix';
import { RenderShape } from '@/lib/entity/render-shape';
import { type FieldOptionsList, Fields } from '@/lib/selection/fields';
import type { SelectionInspectorContext } from '@/lib/selection/selection-inspector-context';
import { Angle } from '@/lib/units/angle';
import { Length, type UnitType } from '@/lib/units/length';
import {
  GeometryRelativeSheetPosition,
  type KeyPoints,
  type OrientedRect,
  type Rect,
  SheetPosition,
} from '@/lib/viewport/types';
import { ConstraintEndpoint, LinearConstraint } from '../constraints';
import { Datum } from '../datum';
import { PatternFilter } from '../filters/pattern';
import { Polygon } from '../polygon';
import {
  type ListTransformableAdapterUndoEntryCreators,
  TransformableAdapter,
  registerTransformableAdapter,
} from '../transformable';
import { Entity, EntityComponent, type EntityOmitComponents } from '../types';
import { AnchorPointComponent } from './AnchorPointComponent';
import { FillColorComponent } from './FillColorComponent';
import { RotationComponent } from './RotationComponent';

export const GEAR_MAX_TEETH = 200;
export const DEFAULT_GEAR_FILL_COLOR = 0xcbd5e1;
const INVOLUTE_SEGMENTS = 16;
const TIP_ARC_SEGMENTS = 8;

export type GearPitchMode = 'module' | 'diametral-pitch';

export type InvoluteGearParams = {
  pitchMode: GearPitchMode;
  pitch: number;
  teeth: number;
  pressureAngle: Angle;
  addendumCoefficient: number;
  dedendumCoefficient: number;
  profileShift: number;
  backlash: number;
};

export type InvoluteGearData = {
  type: 'involute-gear';
  position: SheetPosition;
  params: InvoluteGearParams;
  /** Module in sheet units, cached so the entity remains self-contained. */
  moduleSheetUnits: number;
};

export type InvoluteGearComponent = EntityComponent<'involuteGear', InvoluteGearData>;

export type InvoluteGearMetrics = {
  moduleSheetUnits: number;
  pitchRadius: number;
  baseRadius: number;
  outerRadius: number;
  rootRadius: number;
  addendum: number;
  dedendum: number;
};

export function defaultInvoluteGearParams(): InvoluteGearParams {
  return {
    pitchMode: 'module',
    pitch: 2,
    teeth: 20,
    pressureAngle: Angle.degrees(20),
    addendumCoefficient: 1,
    dedendumCoefficient: 1.25,
    profileShift: 0,
    backlash: 0,
  };
}

export function computeModuleSheetUnits(
  params: InvoluteGearParams,
  sheetDefaultUnit: UnitType,
): number {
  const moduleMm = params.pitchMode === 'module' ? params.pitch : 25.4 / params.pitch;
  return Length.millimeters(moduleMm).toSheetUnits(sheetDefaultUnit).magnitude;
}

export function computeMetrics(
  params: InvoluteGearParams,
  moduleSheetUnits: number,
): InvoluteGearMetrics {
  const pitchRadius = (moduleSheetUnits * params.teeth) / 2;
  const pressureAngleRadians = params.pressureAngle.toRadians().magnitude;
  const baseRadius = pitchRadius * Math.cos(pressureAngleRadians);
  const addendum = params.addendumCoefficient * moduleSheetUnits;
  const dedendum = params.dedendumCoefficient * moduleSheetUnits;
  return {
    moduleSheetUnits,
    pitchRadius,
    baseRadius,
    outerRadius: pitchRadius + addendum,
    rootRadius: Math.max(1e-9, pitchRadius - dedendum),
    addendum,
    dedendum,
  };
}

export function validateParams(params: InvoluteGearParams): Array<string> {
  const errors: Array<string> = [];
  const finite = (value: number) => Number.isFinite(value);
  if (!finite(params.pitch) || params.pitch <= 0) {
    errors.push('Pitch must be greater than zero.');
  }
  if (!Number.isInteger(params.teeth) || params.teeth < 3 || params.teeth > GEAR_MAX_TEETH) {
    errors.push(`Teeth must be a whole number from 3 to ${GEAR_MAX_TEETH}.`);
  }
  const pressureAngle = params.pressureAngle.toDegrees().magnitude;
  if (!finite(pressureAngle) || pressureAngle < 5 || pressureAngle > 45) {
    errors.push('Pressure angle must be between 5° and 45°.');
  }
  if (!finite(params.addendumCoefficient) || params.addendumCoefficient <= 0) {
    errors.push('Addendum must be greater than zero.');
  }
  if (!finite(params.dedendumCoefficient) || params.dedendumCoefficient <= 0) {
    errors.push('Dedendum must be greater than zero.');
  }
  return errors;
}

type ToothGeometry = {
  thetaAt: (t: number) => number;
  tStart: number;
  tTip: number;
  angularPitchHalf: number;
};

function toothGeometry(params: InvoluteGearParams): ToothGeometry {
  const pressureAngleRadians = params.pressureAngle.toRadians().magnitude;
  const moduleSheetUnits = 1;
  const pitchRadius = (moduleSheetUnits * params.teeth) / 2;
  const baseRadius = pitchRadius * Math.cos(pressureAngleRadians);
  const outerRadius = pitchRadius + params.addendumCoefficient * moduleSheetUnits;
  const rootRadius = Math.max(1e-9, pitchRadius - params.dedendumCoefficient * moduleSheetUnits);
  const thetaHalf =
    (Math.PI / 2 + 2 * params.profileShift * Math.tan(pressureAngleRadians) - params.backlash) /
    params.teeth;
  return {
    thetaAt: (t) =>
      thetaHalf + (Math.tan(pressureAngleRadians) - pressureAngleRadians) - (t - Math.atan(t)),
    tStart: rootRadius <= baseRadius ? 0 : Math.sqrt((rootRadius / baseRadius) ** 2 - 1),
    tTip: Math.sqrt(Math.max(0, (outerRadius / baseRadius) ** 2 - 1)),
    angularPitchHalf: Math.PI / params.teeth,
  };
}

function polar(center: SheetPosition, radius: number, theta: number): SheetPosition {
  return new SheetPosition(
    center.x + radius * Math.sin(theta),
    center.y - radius * Math.cos(theta),
  );
}

/** Builds the raw open tooth profile in sheet space. */
export function buildToothProfilePoints(
  params: InvoluteGearParams,
  moduleSheetUnits: number,
  position: SheetPosition,
): Array<SheetPosition> {
  const metrics = computeMetrics(params, moduleSheetUnits);
  const geometry = toothGeometry(params);
  const radiusAt = (t: number) => metrics.baseRadius * Math.sqrt(1 + t * t);
  const points: Array<SheetPosition> = [];

  points.push(polar(position, metrics.rootRadius, -geometry.angularPitchHalf));

  const ts: Array<number> = [];
  for (let i = 0; i <= INVOLUTE_SEGMENTS; i += 1) {
    ts.push(geometry.tStart + ((geometry.tTip - geometry.tStart) * i) / INVOLUTE_SEGMENTS);
  }
  for (const t of ts) {
    points.push(polar(position, radiusAt(t), -geometry.thetaAt(t)));
  }

  const tipHalfAngle = geometry.thetaAt(geometry.tTip);
  for (let i = 1; i < TIP_ARC_SEGMENTS; i += 1) {
    const theta = -tipHalfAngle + (2 * tipHalfAngle * i) / TIP_ARC_SEGMENTS;
    points.push(polar(position, metrics.outerRadius, theta));
  }

  for (let i = ts.length - 1; i >= 0; i -= 1) {
    const t = ts[i];
    points.push(polar(position, radiusAt(t), geometry.thetaAt(t)));
  }

  points.push(polar(position, metrics.rootRadius, geometry.angularPitchHalf));
  return points;
}

/** Builds the full closed gear outline in raw sheet space. */
export function buildGearOutlinePoints(
  params: InvoluteGearParams,
  moduleSheetUnits: number,
  position: SheetPosition,
): Array<SheetPosition> {
  const toothPoints = buildToothProfilePoints(params, moduleSheetUnits, position);
  if (toothPoints.length < 2) {
    return toothPoints;
  }
  const step = (Math.PI * 2) / params.teeth;
  const points: Array<SheetPosition> = [...toothPoints];
  for (let tooth = 1; tooth < params.teeth; tooth += 1) {
    const angle = step * tooth;
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    for (let i = 1; i < toothPoints.length; i += 1) {
      const point = toothPoints[i];
      const dx = point.x - position.x;
      const dy = point.y - position.y;
      points.push(
        new SheetPosition(position.x + dx * cos - dy * sin, position.y + dx * sin + dy * cos),
      );
    }
  }
  points.pop();
  return points;
}

function pointsToSegments(
  points: Array<SheetPosition>,
  matrix: ReturnType<typeof Entity.generateRenderMatrix>,
): Array<{ type: 'point'; point: SheetPosition }> {
  return points.map((point) => {
    const transformed = applyToPoint(matrix, point);
    return {
      type: 'point' as const,
      point: new SheetPosition(transformed.x, transformed.y),
    };
  });
}

export namespace InvoluteGearComponent {
  export const key: keyof InvoluteGearComponent = 'involuteGear';

  export function create(data: InvoluteGearData): InvoluteGearComponent {
    return { involuteGear: data };
  }

  export function get(entity: Entity<InvoluteGearComponent>): InvoluteGearData {
    return entity.components.involuteGear;
  }

  export function getOptional(entity: Entity): InvoluteGearData | null {
    if (InvoluteGearComponent.key in entity.components) {
      return (entity.components as unknown as InvoluteGearComponent).involuteGear;
    }
    return null;
  }

  export function update<E extends Entity<InvoluteGearComponent>>(
    entity: E,
    partial: Partial<InvoluteGearData>,
  ): E {
    return {
      ...entity,
      components: {
        ...entity.components,
        involuteGear: { ...InvoluteGearComponent.get(entity), ...partial },
      },
    };
  }

  export function remove<E extends Entity<InvoluteGearComponent>>(
    entity: E,
  ): EntityOmitComponents<E, InvoluteGearComponent> {
    const components: Partial<E['components']> = { ...entity.components };
    delete components.involuteGear;
    return { ...entity, components };
  }

  export function getOrigin(entity: Entity<InvoluteGearComponent>): SheetPosition {
    return InvoluteGearComponent.get(entity).position;
  }

  export function metricsFor(entity: Entity<InvoluteGearComponent>): InvoluteGearMetrics {
    const data = InvoluteGearComponent.get(entity);
    return computeMetrics(data.params, data.moduleSheetUnits);
  }

  export function rawKeyPoints(
    entity: Entity<InvoluteGearComponent>,
  ): KeyPoints<GeometryRelativeSheetPosition, string, string> {
    const outerRadius = InvoluteGearComponent.metricsFor(entity).outerRadius;
    return {
      perimeter: [],
      perimeterLabels: [],
      extras: {
        center: new GeometryRelativeSheetPosition(0, 0),
        top: new GeometryRelativeSheetPosition(0, -outerRadius),
        right: new GeometryRelativeSheetPosition(outerRadius, 0),
        bottom: new GeometryRelativeSheetPosition(0, outerRadius),
        left: new GeometryRelativeSheetPosition(-outerRadius, 0),
      },
    };
  }

  export function keyPoints(
    entity: Entity<InvoluteGearComponent>,
  ): KeyPoints<GeometryRelativeSheetPosition, string, string> {
    return InvoluteGearComponent.rawKeyPoints(entity);
  }

  export function boundingBox(
    entity: Entity<InvoluteGearComponent>,
  ): Rect<GeometryRelativeSheetPosition> {
    const outerRadius = InvoluteGearComponent.metricsFor(entity).outerRadius;
    return {
      position: new GeometryRelativeSheetPosition(-outerRadius, -outerRadius),
      width: outerRadius * 2,
      height: outerRadius * 2,
    };
  }

  export function orientedBoundingBox(
    entity: Entity<InvoluteGearComponent>,
  ): OrientedRect<GeometryRelativeSheetPosition> {
    const box = InvoluteGearComponent.boundingBox(entity);
    return {
      ...box,
      angleDegrees: RotationComponent.getOptional(entity)?.angle.toDegrees().magnitude ?? 0,
    };
  }

  export function translate(
    entity: Entity<InvoluteGearComponent>,
    transform: (position: SheetPosition) => SheetPosition,
  ): Entity<InvoluteGearComponent> {
    const data = InvoluteGearComponent.get(entity);
    return InvoluteGearComponent.update(entity, {
      position: transform(data.position),
    });
  }

  export function equals(
    a: Entity<InvoluteGearComponent>,
    b: Entity<InvoluteGearComponent>,
  ): boolean {
    const da = InvoluteGearComponent.get(a);
    const db = InvoluteGearComponent.get(b);
    return (
      da.position.x === db.position.x &&
      da.position.y === db.position.y &&
      da.moduleSheetUnits === db.moduleSheetUnits &&
      da.params.pitchMode === db.params.pitchMode &&
      da.params.pitch === db.params.pitch &&
      da.params.teeth === db.params.teeth &&
      da.params.pressureAngle.toDegrees().magnitude ===
        db.params.pressureAngle.toDegrees().magnitude &&
      da.params.addendumCoefficient === db.params.addendumCoefficient &&
      da.params.dedendumCoefficient === db.params.dedendumCoefficient &&
      da.params.profileShift === db.params.profileShift &&
      da.params.backlash === db.params.backlash
    );
  }

  export function getRenderShapes(entity: Entity<InvoluteGearComponent>): Array<RenderShape> {
    const data = InvoluteGearComponent.get(entity);
    const outline = buildGearOutlinePoints(data.params, data.moduleSheetUnits, data.position);
    const matrix = Entity.generateRenderMatrix(entity);
    return [
      RenderShape.polygon(`${entity.id}-involute-gear`, pointsToSegments(outline, matrix), {
        closed: true,
        primary: true,
      }),
    ];
  }

  export function updateParams(
    entity: Entity<InvoluteGearComponent>,
    partial: Partial<InvoluteGearParams>,
    sheetDefaultUnit: UnitType,
  ): Entity<InvoluteGearComponent> {
    const data = InvoluteGearComponent.get(entity);
    const params = { ...data.params, ...partial };
    return InvoluteGearComponent.update(entity, {
      params,
      moduleSheetUnits: computeModuleSheetUnits(params, sheetDefaultUnit),
    });
  }

  export function computeSelectionInspectorFields(
    entity: Entity<InvoluteGearComponent>,
    ctx: SelectionInspectorContext,
  ): FieldOptionsList {
    const data = InvoluteGearComponent.get(entity);
    const id = entity.id;
    const metrics = computeMetrics(data.params, data.moduleSheetUnits);
    const pitchLabel =
      data.params.pitchMode === 'module' ? 'Module (mm):' : 'Diametral pitch (1/in):';

    const numberHandlers = (
      key: string,
      apply: (value: number, current: InvoluteGearData) => Partial<InvoluteGearData>,
    ) =>
      ctx.makeNumberHandlers(id, key, InvoluteGearComponent, (value) => {
        const current = ctx.geometryStore.getByIdWithComponent(id, InvoluteGearComponent);
        return current ? apply(value, InvoluteGearComponent.get(current)) : null;
      });

    const angleHandlers = ctx.makeAngleHandlers(
      id,
      'pressureAngle',
      InvoluteGearComponent,
      (value) => {
        const current = ctx.geometryStore.getByIdWithComponent(id, InvoluteGearComponent);
        if (!current) {
          return null;
        }
        const currentData = InvoluteGearComponent.get(current);
        return {
          params: { ...currentData.params, pressureAngle: value },
        };
      },
    );

    const positionXHandlers = ctx.makeLengthHandlers(id, 'x', InvoluteGearComponent, (value) => {
      const current = ctx.geometryStore.getByIdWithComponent(id, InvoluteGearComponent);
      if (!current) {
        return null;
      }
      const currentData = InvoluteGearComponent.get(current);
      return {
        position: new SheetPosition(
          value.toSheetUnits(ctx.sheetDefaultUnit).magnitude,
          currentData.position.y,
        ),
      };
    });
    const positionYHandlers = ctx.makeLengthHandlers(id, 'y', InvoluteGearComponent, (value) => {
      const current = ctx.geometryStore.getByIdWithComponent(id, InvoluteGearComponent);
      if (!current) {
        return null;
      }
      const currentData = InvoluteGearComponent.get(current);
      return {
        position: new SheetPosition(
          currentData.position.x,
          value.toSheetUnits(ctx.sheetDefaultUnit).magnitude,
        ),
      };
    });

    return [
      Fields.row('position', [
        Fields.labelled(
          'x',
          'X:',
          Fields.length(
            'x',
            Length.fromSheetUnits(ctx.sheetDefaultUnit, data.position.x),
            { readOnlyUnit: true },
            positionXHandlers,
          ),
        ),
        Fields.labelled(
          'y',
          'Y:',
          Fields.length(
            'y',
            Length.fromSheetUnits(ctx.sheetDefaultUnit, data.position.y),
            { readOnlyUnit: true },
            positionYHandlers,
          ),
        ),
      ]),
      Fields.row('involuteGearPitchMode', [
        Fields.labelled(
          'involuteGearPitchMode',
          'Pitch mode:',
          Fields.choices(
            'involuteGearPitchMode',
            data.params.pitchMode,
            [
              { value: 'module', label: 'Module' },
              { value: 'diametral-pitch', label: 'D.P.' },
            ],
            {
              onChange: (nextMode) => {
                ctx.geometryStore.updateByIdWithComponent(id, InvoluteGearComponent, (current) => {
                  const currentData = InvoluteGearComponent.get(current);
                  const nextPitch =
                    currentData.params.pitch > 0
                      ? 25.4 / currentData.params.pitch
                      : currentData.params.pitch;
                  return InvoluteGearComponent.updateParams(
                    current,
                    { pitchMode: nextMode as GearPitchMode, pitch: nextPitch },
                    ctx.sheetDefaultUnit,
                  ) as typeof current;
                });
                ctx.recomputeFields();
              },
            },
          ),
        ),
      ]),
      Fields.row('involuteGearPitch', [
        Fields.labelled(
          'involuteGearPitch',
          pitchLabel,
          Fields.number(
            'involuteGearPitch',
            data.params.pitch,
            numberHandlers('involuteGearPitch', (value, current) => {
              const params = { ...current.params, pitch: value };
              return {
                params,
                moduleSheetUnits: computeModuleSheetUnits(params, ctx.sheetDefaultUnit),
              };
            }),
          ),
        ),
      ]),
      Fields.row('involuteGearTeeth', [
        Fields.labelled(
          'involuteGearTeeth',
          'Teeth:',
          Fields.number(
            'involuteGearTeeth',
            data.params.teeth,
            numberHandlers('involuteGearTeeth', (value, current) => ({
              params: { ...current.params, teeth: Math.round(value) },
            })),
          ),
        ),
      ]),
      Fields.row('involuteGearPressureAngle', [
        Fields.labelled(
          'involuteGearPressureAngle',
          'Pressure angle:',
          Fields.angle('involuteGearPressureAngle', data.params.pressureAngle, angleHandlers),
        ),
      ]),
      Fields.row('involuteGearCoefficients', [
        Fields.labelled(
          'involuteGearAddendum',
          'Addendum:',
          Fields.number(
            'involuteGearAddendum',
            data.params.addendumCoefficient,
            numberHandlers('involuteGearAddendum', (value, current) => ({
              params: { ...current.params, addendumCoefficient: value },
            })),
          ),
        ),
        Fields.spacing('involuteGearCoefficientsSpacer', 'sm'),
        Fields.labelled(
          'involuteGearDedendum',
          'Dedendum:',
          Fields.number(
            'involuteGearDedendum',
            data.params.dedendumCoefficient,
            numberHandlers('involuteGearDedendum', (value, current) => ({
              params: { ...current.params, dedendumCoefficient: value },
            })),
          ),
        ),
      ]),
      Fields.row('involuteGearShift', [
        Fields.labelled(
          'involuteGearProfileShift',
          'Profile shift:',
          Fields.number(
            'involuteGearProfileShift',
            data.params.profileShift,
            numberHandlers('involuteGearProfileShift', (value, current) => ({
              params: { ...current.params, profileShift: value },
            })),
          ),
        ),
        Fields.spacing('involuteGearShiftSpacer', 'sm'),
        Fields.labelled(
          'involuteGearBacklash',
          'Backlash:',
          Fields.number(
            'involuteGearBacklash',
            data.params.backlash,
            numberHandlers('involuteGearBacklash', (value, current) => ({
              params: { ...current.params, backlash: value },
            })),
          ),
        ),
      ]),
      Fields.row('involuteGearDiameters', [
        Fields.readOnly(
          'involuteGearPitchDiameter',
          `Pitch Ø ${Length.fromSheetUnits(ctx.sheetDefaultUnit, metrics.pitchRadius * 2).toDisplayString()}`,
        ),
        Fields.readOnly(
          'involuteGearOuterDiameter',
          `Outer Ø ${Length.fromSheetUnits(ctx.sheetDefaultUnit, metrics.outerRadius * 2).toDisplayString()}`,
        ),
      ]),
      Fields.button('involuteGearToPolygon', 'To polygon...', {
        onClick: () => {
          const current = ctx.geometryStore.getByIdWithComponent(id, InvoluteGearComponent);
          if (current) {
            InvoluteGearComponent.toPolygon(ctx, current);
          }
        },
      }),
    ];
  }

  export function toPolygon(
    ctx: SelectionInspectorContext,
    entity: Entity<InvoluteGearComponent>,
  ): void {
    const data = InvoluteGearComponent.get(entity);
    const metrics = computeMetrics(data.params, data.moduleSheetUnits);
    const toothPoints = buildToothProfilePoints(data.params, data.moduleSheetUnits, data.position);
    const renderMatrix = Entity.generateRenderMatrix(entity);
    const renderedCenter = applyToPoint(renderMatrix, data.position);
    const renderedCenterSheet = new SheetPosition(renderedCenter.x, renderedCenter.y);
    const anchorOffset = AnchorPointComponent.computeAssociatedGeometryOffset(
      entity as Entity<InvoluteGearComponent & AnchorPointComponent>,
    );
    const rotation = RotationComponent.getOptional(entity);
    const fillColor = FillColorComponent.getOptional(entity);

    ctx.historyManager.applyTransaction('involute-gear-to-polygon', () => {
      const absoluteSegments = toothPoints.map((point) => ({
        type: 'point' as const,
        point,
      }));
      const rawTemplate = Polygon.create(absoluteSegments, {
        closed: false,
        openAtIndex: 0,
      });
      const rawData = rawTemplate.components.geometry;
      const originDelta = new GeometryRelativeSheetPosition(
        rawData.position.x - data.position.x,
        rawData.position.y - data.position.y,
      );
      const centeredSegments = rawData.points.map((segment) =>
        'point' in segment
          ? {
              ...segment,
              point: new GeometryRelativeSheetPosition(
                segment.point.x + originDelta.x,
                segment.point.y + originDelta.y,
              ),
            }
          : segment,
      );
      const polygon = ctx.geometryStore.addOrdered(
        'ply',
        {
          ...rawTemplate,
          components: {
            ...rawTemplate.components,
            geometry: {
              ...rawData,
              position: data.position,
              points: centeredSegments,
            },
            ...AnchorPointComponent.create({
              keyPoint: 'boundingBoxUpperLeft',
              offset: anchorOffset,
            }),
            ...(rotation ? RotationComponent.create(rotation.angle) : {}),
            ...(typeof fillColor === 'number' ? FillColorComponent.create(fillColor) : {}),
          },
        },
        {
          renderOrder: (entity.components as { renderOrder?: { renderOrder: number } }).renderOrder
            ?.renderOrder,
        },
      );

      ctx.geometryStore.add(
        'ftr',
        PatternFilter.createRadial(polygon.id, renderedCenterSheet, metrics.outerRadius, {
          count: data.params.teeth,
        }),
      );

      const datum = ctx.geometryStore.add('dtm', Datum.create(renderedCenterSheet));

      const tipLeftIndex = 1 + INVOLUTE_SEGMENTS;
      const tipRightIndex = tipLeftIndex + TIP_ARC_SEGMENTS;
      ctx.geometryStore.add(
        'cns',
        LinearConstraint.create(
          ConstraintEndpoint.lockedToDatum(datum.id),
          ConstraintEndpoint.lockedToPolygon(polygon.id, tipRightIndex),
          Length.fromSheetUnits(ctx.sheetDefaultUnit, metrics.outerRadius),
          { connectorLineOffsetPx: -18 },
        ),
      );

      let pitchIndex: number | null = null;
      let pitchDistance = Infinity;
      for (let i = 1; i <= tipLeftIndex; i += 1) {
        const point = toothPoints[i];
        if (!point) {
          continue;
        }
        const distance = Math.hypot(point.x - data.position.x, point.y - data.position.y);
        const delta = Math.abs(distance - metrics.pitchRadius);
        if (delta < pitchDistance) {
          pitchDistance = delta;
          pitchIndex = i;
        }
      }
      if (pitchIndex !== null) {
        ctx.geometryStore.add(
          'cns',
          LinearConstraint.create(
            ConstraintEndpoint.lockedToDatum(datum.id),
            ConstraintEndpoint.lockedToPolygon(polygon.id, pitchIndex),
            Length.fromSheetUnits(ctx.sheetDefaultUnit, metrics.pitchRadius),
            { connectorLineOffsetPx: 18 },
          ),
        );
      }

      ctx.geometryStore.deleteById(entity.id);
    });

    ctx.recomputeFields();
  }
}

const involuteGearUndoEntries = TransformableAdapter.history.generateUndoEntryEvents(
  'involute-gear',
  {
    get: (entity) => InvoluteGearComponent.get(entity as Entity<InvoluteGearComponent>),
    update: (entity, data) =>
      InvoluteGearComponent.update(entity as Entity<InvoluteGearComponent>, data),
  },
);

export type InvoluteGearHistoryEntries = ListTransformableAdapterUndoEntryCreators<
  typeof involuteGearUndoEntries
>;

export { involuteGearUndoEntries };

export const involuteGearAdapter: TransformableAdapter<InvoluteGearData> = {
  get: (entity) => InvoluteGearComponent.get(entity as Entity<InvoluteGearComponent>),
  update: (entity, data) =>
    InvoluteGearComponent.update(entity as Entity<InvoluteGearComponent>, data),
  getOrigin: (entity) => InvoluteGearComponent.getOrigin(entity as Entity<InvoluteGearComponent>),
  rawKeyPoints: (entity) =>
    InvoluteGearComponent.rawKeyPoints(entity as Entity<InvoluteGearComponent>),
  keyPoints: (entity) => InvoluteGearComponent.keyPoints(entity as Entity<InvoluteGearComponent>),
  boundingBox: (entity) =>
    InvoluteGearComponent.boundingBox(entity as Entity<InvoluteGearComponent>),
  orientedBoundingBox: (entity) =>
    InvoluteGearComponent.orientedBoundingBox(entity as Entity<InvoluteGearComponent>),
  translate: (entity, transform) =>
    InvoluteGearComponent.translate(entity as Entity<InvoluteGearComponent>, transform),
  equals: (a, b) =>
    InvoluteGearComponent.equals(
      a as Entity<InvoluteGearComponent>,
      b as Entity<InvoluteGearComponent>,
    ),
  createMoveUndoEntry: (id, before, after) =>
    involuteGearUndoEntries.creators.move(id, before, after),
  getRenderShapes: (entity) =>
    InvoluteGearComponent.getRenderShapes(entity as Entity<InvoluteGearComponent>),
};

registerTransformableAdapter('involute-gear', involuteGearAdapter);
