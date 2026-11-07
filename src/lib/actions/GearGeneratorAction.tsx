import { Cog } from 'lucide-react';
import React from 'react';
import { ConstraintEndpoint, Datum, LinearConstraint, Polygon, PolygonSegment } from '@/lib/entity';
import { ID_PREFIXES } from '@/lib/entity/GeometryStore';
import { FilterComponent } from '@/lib/entity/components/FilterComponent';
import { PatternFilter, PatternRadialFilterData } from '@/lib/entity/filters/pattern';
import { RenderShape } from '@/lib/entity/render-shape';
import { round } from '@/lib/math';
import { Angle } from '@/lib/units/angle';
import { Length, type UnitType } from '@/lib/units/length';
import { SheetPosition } from '@/lib/viewport/types';
import { ActionsManager } from './ActionsManager';
import { BaseAction } from './BaseAction';

/** Number of straight segments used to approximate each involute flank. */
const INVOLUTE_SEGMENTS = 16;
/** Number of segments used to approximate the addendum (tip) arc. */
const TIP_ARC_SEGMENTS = 8;
/** Maximum number of teeth the generator supports. */
export const GEAR_MAX_TEETH = 200;

export type GearPitchMode = 'module' | 'diametral-pitch';

export type GearParams = {
  pitchMode: GearPitchMode;
  /** Module in millimeters, or diametral pitch in inverse inches. */
  pitch: number;
  teeth: number;
  pressureAngle: Angle;
  addendumCoefficient: number;
  dedendumCoefficient: number;
  profileShift: number;
  /** Total backlash in module units. */
  backlash: number;
  /** Absolute sheet-space center of the gear. */
  center: SheetPosition;
};

export type GearMetrics = {
  moduleMillimeters: number;
  moduleSheetUnits: number;
  pitchRadius: number;
  baseRadius: number;
  outerRadius: number;
  rootRadius: number;
  addendum: number;
  dedendum: number;
  circularPitch: number;
};

export type GearValidation = {
  valid: boolean;
  errors: Array<string>;
};

export type GearToothKeyPointIndices = {
  rootLeft: number;
  rootRight: number;
  tipLeft: number;
  tipRight: number;
  pitchLeft: number | null;
};

export type GearToothProfile = {
  segments: Array<PolygonSegment<SheetPosition>>;
  keyPointIndices: GearToothKeyPointIndices;
};

export type GearPreview = {
  center: SheetPosition;
  toothSegments: Array<PolygonSegment<SheetPosition>>;
  shapes: Array<RenderShape>;
};

export type GearGeneratorState = {
  panelVisible: boolean;
  params: GearParams;
  metrics: GearMetrics | null;
  validation: GearValidation;
  preview: GearPreview | null;
};

export type GearGeneratorActionEvents = {
  stateChange: (state: GearGeneratorState) => void;
  panelVisibilityChange: (visible: boolean) => void;
};

/** Default parameters for a new gear. */
export function defaultGearParams(): GearParams {
  return {
    pitchMode: 'module',
    pitch: 2,
    teeth: 20,
    pressureAngle: Angle.degrees(20),
    addendumCoefficient: 1,
    dedendumCoefficient: 1.25,
    profileShift: 0,
    backlash: 0,
    center: new SheetPosition(0, 0),
  };
}

function moduleMillimeters(params: GearParams): number {
  return params.pitchMode === 'module' ? params.pitch : 25.4 / params.pitch;
}

/** Computes all derived gear dimensions in sheet units. */
export function computeGearMetrics(params: GearParams, sheetDefaultUnit: UnitType): GearMetrics {
  const moduleMm = moduleMillimeters(params);
  const moduleSheetUnits = Length.millimeters(moduleMm).toSheetUnits(sheetDefaultUnit).magnitude;
  const pitchRadius = (moduleSheetUnits * params.teeth) / 2;
  const pressureAngleRadians = params.pressureAngle.toRadians().magnitude;
  const baseRadius = pitchRadius * Math.cos(pressureAngleRadians);
  const addendum = params.addendumCoefficient * moduleSheetUnits;
  const dedendum = params.dedendumCoefficient * moduleSheetUnits;
  const outerRadius = pitchRadius + addendum;
  const rootRadius = Math.max(1e-9, pitchRadius - dedendum);
  return {
    moduleMillimeters: moduleMm,
    moduleSheetUnits,
    pitchRadius,
    baseRadius,
    outerRadius,
    rootRadius,
    addendum,
    dedendum,
    circularPitch: Math.PI * moduleSheetUnits,
  };
}

/** Validates gear parameters and checks that the resulting tooth profile is well formed. */
export function validateGearParams(params: GearParams): GearValidation {
  const errors: Array<string> = [];
  const finite = (value: number) => Number.isFinite(value);

  if (!finite(params.pitch) || params.pitch <= 0) {
    errors.push('Pitch must be greater than zero.');
  }
  if (!Number.isInteger(params.teeth) || params.teeth < 3 || params.teeth > GEAR_MAX_TEETH) {
    errors.push(`Teeth must be a whole number from 3 to ${GEAR_MAX_TEETH}.`);
  }
  const pressureAngleDegrees = params.pressureAngle.toDegrees().magnitude;
  if (!finite(pressureAngleDegrees) || pressureAngleDegrees < 5 || pressureAngleDegrees > 45) {
    errors.push('Pressure angle must be between 5° and 45°.');
  }
  if (!finite(params.addendumCoefficient) || params.addendumCoefficient <= 0) {
    errors.push('Addendum must be greater than zero.');
  }
  if (!finite(params.dedendumCoefficient) || params.dedendumCoefficient <= 0) {
    errors.push('Dedendum must be greater than zero.');
  }
  if (!finite(params.profileShift) || params.profileShift < -2 || params.profileShift > 2) {
    errors.push('Profile shift must be between -2 and 2.');
  }
  if (!finite(params.backlash) || params.backlash < 0 || params.backlash > 1.5) {
    errors.push('Backlash must be between 0 and 1.5 module units.');
  }
  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // The profile shape checks are scale-independent, so use a module of 1.
  const moduleSheetUnits = 1;
  const pitchRadius = (moduleSheetUnits * params.teeth) / 2;
  const pressureAngleRadians = params.pressureAngle.toRadians().magnitude;
  const baseRadius = pitchRadius * Math.cos(pressureAngleRadians);
  const outerRadius = pitchRadius + params.addendumCoefficient * moduleSheetUnits;
  const rootRadius = pitchRadius - params.dedendumCoefficient * moduleSheetUnits;
  const thetaHalf =
    (Math.PI / 2 + 2 * params.profileShift * Math.tan(pressureAngleRadians) - params.backlash) /
    params.teeth;
  const angularPitchHalf = Math.PI / params.teeth;
  const tTip = Math.sqrt(Math.max(0, (outerRadius / baseRadius) ** 2 - 1));
  const tipHalfAngle =
    thetaHalf + (Math.tan(pressureAngleRadians) - pressureAngleRadians) - (tTip - Math.atan(tTip));

  if (rootRadius <= 0) {
    errors.push('Dedendum is too large for this tooth count.');
  }
  if (thetaHalf <= 1e-4) {
    errors.push('Tooth thickness at the pitch circle must be positive.');
  }
  if (tipHalfAngle <= 1e-4) {
    errors.push('Tooth tip is pointed. Reduce profile shift or backlash.');
  }
  if (tipHalfAngle >= angularPitchHalf) {
    errors.push('Tooth tip exceeds the tooth space. Reduce profile shift.');
  }
  if (outerRadius <= baseRadius) {
    errors.push('Addendum is too small for this pressure angle.');
  }

  return { valid: errors.length === 0, errors };
}

type NormalizedToothGeometry = {
  pitchRadius: number;
  baseRadius: number;
  outerRadius: number;
  rootRadius: number;
  thetaHalf: number;
  angularPitchHalf: number;
  thetaAt: (t: number) => number;
  tStart: number;
  tTip: number;
  tPitch: number;
};

function normalizedToothGeometry(params: GearParams): NormalizedToothGeometry {
  const moduleSheetUnits = 1;
  const pressureAngleRadians = params.pressureAngle.toRadians().magnitude;
  const pitchRadius = (moduleSheetUnits * params.teeth) / 2;
  const baseRadius = pitchRadius * Math.cos(pressureAngleRadians);
  const outerRadius = pitchRadius + params.addendumCoefficient * moduleSheetUnits;
  const rootRadius = Math.max(1e-9, pitchRadius - params.dedendumCoefficient * moduleSheetUnits);
  const thetaHalf =
    (Math.PI / 2 + 2 * params.profileShift * Math.tan(pressureAngleRadians) - params.backlash) /
    params.teeth;
  const angularPitchHalf = Math.PI / params.teeth;
  const tStart = rootRadius <= baseRadius ? 0 : Math.sqrt((rootRadius / baseRadius) ** 2 - 1);
  const tTip = Math.sqrt(Math.max(0, (outerRadius / baseRadius) ** 2 - 1));
  const tPitch = Math.tan(pressureAngleRadians);
  const thetaAt = (t: number) =>
    thetaHalf + (Math.tan(pressureAngleRadians) - pressureAngleRadians) - (t - Math.atan(t));
  return {
    pitchRadius,
    baseRadius,
    outerRadius,
    rootRadius,
    thetaHalf,
    angularPitchHalf,
    thetaAt,
    tStart,
    tTip,
    tPitch,
  };
}

function insertIntoSorted(values: Array<number>, value: number): void {
  let index = 0;
  while (index < values.length && values[index] < value) {
    index += 1;
  }
  if (index < values.length && Math.abs(values[index] - value) < 1e-12) {
    return;
  }
  values.splice(index, 0, value);
}

/**
 * Builds a single open tooth profile. The first and last points sit on the radial
 * pattern's slice lines so the radial filter can merge the copies into a closed gear.
 */
export function buildGearToothProfile(
  params: GearParams,
  sheetDefaultUnit: UnitType,
): GearToothProfile {
  const metrics = computeGearMetrics(params, sheetDefaultUnit);
  const geometry = normalizedToothGeometry(params);
  const center = params.center;

  const toPoint = (radius: number, theta: number) =>
    new SheetPosition(center.x + radius * Math.sin(theta), center.y - radius * Math.cos(theta));

  const segments: Array<PolygonSegment<SheetPosition>> = [];
  const addPoint = (radius: number, theta: number) => {
    segments.push({ type: 'point', point: toPoint(radius, theta) });
  };

  const involuteRadius = (t: number) => metrics.baseRadius * Math.sqrt(1 + t * t);

  // The tooth is centered on "up" (negative sheet-space y).
  addPoint(metrics.rootRadius, -geometry.angularPitchHalf);
  const rootLeft = segments.length - 1;

  const involuteTs: Array<number> = [];
  for (let i = 0; i <= INVOLUTE_SEGMENTS; i += 1) {
    involuteTs.push(geometry.tStart + ((geometry.tTip - geometry.tStart) * i) / INVOLUTE_SEGMENTS);
  }
  if (geometry.tPitch >= geometry.tStart && geometry.tPitch <= geometry.tTip) {
    insertIntoSorted(involuteTs, geometry.tPitch);
  }

  let pitchLeft: number | null = null;
  for (const t of involuteTs) {
    addPoint(involuteRadius(t), -geometry.thetaAt(t));
    if (Math.abs(t - geometry.tPitch) < 1e-9) {
      pitchLeft = segments.length - 1;
    }
  }
  const tipLeft = segments.length - 1;

  const tipHalfAngle = geometry.thetaAt(geometry.tTip);
  for (let i = 1; i < TIP_ARC_SEGMENTS; i += 1) {
    const theta = -tipHalfAngle + (2 * tipHalfAngle * i) / TIP_ARC_SEGMENTS;
    addPoint(metrics.outerRadius, theta);
  }

  let tipRight: number | null = null;
  for (let i = involuteTs.length - 1; i >= 0; i -= 1) {
    const t = involuteTs[i];
    addPoint(involuteRadius(t), geometry.thetaAt(t));
    if (i === involuteTs.length - 1) {
      tipRight = segments.length - 1;
    }
  }

  addPoint(metrics.rootRadius, geometry.angularPitchHalf);
  const rootRight = segments.length - 1;

  let keyPointIndices: GearToothKeyPointIndices = {
    rootLeft,
    rootRight,
    tipLeft,
    tipRight: tipRight ?? tipLeft,
    pitchLeft,
  };

  const checkFilterData: PatternRadialFilterData = {
    type: 'pattern',
    mode: 'radial',
    geometryId: 'gear-winding-check',
    center,
    radius: metrics.outerRadius,
    repeats: { type: 'count', count: params.teeth },
  };
  if (PatternFilter.arePolygonEndpointsOnEdgeLine(checkFilterData, segments) === null) {
    segments.reverse();
    const lastIndex = segments.length - 1;
    keyPointIndices = {
      rootLeft: lastIndex - keyPointIndices.rootLeft,
      rootRight: lastIndex - keyPointIndices.rootRight,
      tipLeft: lastIndex - keyPointIndices.tipLeft,
      tipRight: lastIndex - keyPointIndices.tipRight,
      pitchLeft: keyPointIndices.pitchLeft === null ? null : lastIndex - keyPointIndices.pitchLeft,
    };
  }

  return { segments, keyPointIndices };
}

/** Builds the preview render shapes by running the same radial pattern used on the sheet. */
export function buildGearPreview(params: GearParams, sheetDefaultUnit: UnitType): GearPreview {
  const metrics = computeGearMetrics(params, sheetDefaultUnit);
  const profile = buildGearToothProfile(params, sheetDefaultUnit);
  const filterData: PatternRadialFilterData = {
    type: 'pattern',
    mode: 'radial',
    geometryId: 'gear-preview',
    center: params.center,
    radius: metrics.outerRadius,
    repeats: { type: 'count', count: params.teeth },
  };
  const filterEntity = {
    id: 'gear-preview-filter',
    components: FilterComponent.create(filterData),
  };
  const toothShape = RenderShape.polygon('gear-preview-tooth', profile.segments, {
    closed: false,
    primary: true,
  });
  const shapes = PatternFilter.applyToRenderShape(
    filterData,
    filterEntity,
    [toothShape],
    () => 'gear-preview-copy',
    { combineNonClosedPolygons: true },
  );
  return {
    center: params.center,
    toothSegments: profile.segments,
    shapes,
  };
}

/** Opens the gear generator panel and manages the live preview + creation transaction. */
export class GearGeneratorAction extends BaseAction<GearGeneratorActionEvents> {
  type = 'gear-generator' as const;
  label = 'Generate Gear';

  get icon(): React.ReactNode {
    return <Cog size={20} />;
  }

  #panelVisible = false;
  #params: GearParams = defaultGearParams();
  #metrics: GearMetrics | null = null;
  #validation: GearValidation = validateGearParams(this.#params);
  #profile: GearToothProfile | null = null;
  #preview: GearPreview | null = null;

  constructor(actionsManager: ActionsManager) {
    super(actionsManager);
    this.getSheet().on('defaultUnitChange', this.handleDefaultUnitChange);
    this.recompute();
  }

  private handleDefaultUnitChange = () => {
    if (this.#panelVisible) {
      this.recompute();
    }
  };

  async execute(): Promise<void> {
    this.open();
  }

  open(): void {
    this.getSheet().hideSheetSettingsPanel();
    this.#panelVisible = true;
    this.emit('panelVisibilityChange', true);
    this.recompute();
  }

  cancel(): void {
    if (!this.#panelVisible) {
      return;
    }
    this.#panelVisible = false;
    this.emit('panelVisibilityChange', false);
    this.recompute();
  }

  getState(): GearGeneratorState {
    return {
      panelVisible: this.#panelVisible,
      params: this.#params,
      metrics: this.#metrics,
      validation: this.#validation,
      preview: this.#preview,
    };
  }

  getParams(): GearParams {
    return this.#params;
  }

  updateParams(partial: Partial<GearParams>): void {
    this.#params = { ...this.#params, ...partial };
    this.recompute();
  }

  setCenter(center: SheetPosition): void {
    this.updateParams({ center });
  }

  setPitchMode(pitchMode: GearPitchMode): void {
    if (pitchMode === this.#params.pitchMode) {
      return;
    }
    const pitch = this.#params.pitch > 0 ? round(25.4 / this.#params.pitch, 6) : this.#params.pitch;
    this.updateParams({ pitchMode, pitch });
  }

  create(): void {
    if (!this.#validation.valid || this.#metrics === null || this.#profile === null) {
      return;
    }

    const sheet = this.getSheet();
    const sheetDefaultUnit = sheet.defaultUnit;
    const geometryStore = this.getGeometryStore();
    const historyManager = this.getHistoryManager();
    const params = this.#params;
    const metrics = this.#metrics;
    const profile = this.#profile;

    historyManager.applyTransaction('create-gear', () => {
      const polygon = geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create(profile.segments, { closed: false, openAtIndex: 0 }),
      );

      geometryStore.add(
        ID_PREFIXES.filter,
        PatternFilter.createRadial(polygon.id, params.center, metrics.outerRadius, {
          count: params.teeth,
        }),
      );

      const datum = geometryStore.add(ID_PREFIXES.datum, Datum.create(params.center));

      geometryStore.add(
        ID_PREFIXES.constraint,
        LinearConstraint.create(
          ConstraintEndpoint.lockedToDatum(datum.id),
          ConstraintEndpoint.lockedToPolygon(polygon.id, profile.keyPointIndices.tipRight),
          Length.fromSheetUnits(sheetDefaultUnit, metrics.outerRadius),
          { connectorLineOffsetPx: -18 },
        ),
      );

      if (profile.keyPointIndices.pitchLeft !== null) {
        geometryStore.add(
          ID_PREFIXES.constraint,
          LinearConstraint.create(
            ConstraintEndpoint.lockedToDatum(datum.id),
            ConstraintEndpoint.lockedToPolygon(polygon.id, profile.keyPointIndices.pitchLeft),
            Length.fromSheetUnits(sheetDefaultUnit, metrics.pitchRadius),
            { connectorLineOffsetPx: 18 },
          ),
        );
      }
    });

    this.cancel();
  }

  private recompute(): void {
    const validation = validateGearParams(this.#params);
    this.#validation = validation;

    if (!validation.valid) {
      this.#metrics = null;
      this.#profile = null;
      this.#preview = null;
      this.emitState();
      return;
    }

    const sheetDefaultUnit = this.getSheet().defaultUnit;
    this.#metrics = computeGearMetrics(this.#params, sheetDefaultUnit);
    this.#profile = buildGearToothProfile(this.#params, sheetDefaultUnit);
    this.#preview = this.#panelVisible ? buildGearPreview(this.#params, sheetDefaultUnit) : null;
    this.emitState();
  }

  private emitState(): void {
    this.emit('stateChange', this.getState());
  }
}
