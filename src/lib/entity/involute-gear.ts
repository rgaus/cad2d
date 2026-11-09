/* eslint-disable @typescript-eslint/no-namespace */
import { Angle } from '@/lib/units/angle';
import type { UnitType } from '@/lib/units/length';
import { SheetPosition } from '@/lib/viewport/types';
import { AnchorPointComponent } from './components/AnchorPointComponent';
import { FillColorComponent } from './components/FillColorComponent';
import {
  DEFAULT_GEAR_FILL_COLOR,
  InvoluteGearComponent,
  type InvoluteGearParams,
  computeModuleSheetUnits,
  defaultInvoluteGearParams,
} from './components/InvoluteGearComponent';
import { RenderOrderComponent } from './components/RenderOrderComponent';
import { RotationComponent } from './components/RotationComponent';
import { TransformableComponent } from './components/TransformableComponent';
import type { Entity, EntityOmitComponents } from './types';

export type InvoluteGear = Entity<
  InvoluteGearComponent &
    AnchorPointComponent &
    RotationComponent &
    FillColorComponent &
    TransformableComponent &
    RenderOrderComponent
>;

export type WorkingInvoluteGear = {
  position: SheetPosition;
  params: InvoluteGearParams;
  moduleSheetUnits: number;
};

export type InvoluteGearTemplate = Omit<
  EntityOmitComponents<InvoluteGear, RenderOrderComponent>,
  'id'
>;

export namespace InvoluteGear {
  export function create(
    position: SheetPosition,
    sheetDefaultUnit: UnitType,
    params: InvoluteGearParams = defaultInvoluteGearParams(),
    fillColor: number = DEFAULT_GEAR_FILL_COLOR,
  ): InvoluteGearTemplate {
    return {
      components: {
        ...InvoluteGearComponent.create({
          type: 'involute-gear',
          position,
          params,
          moduleSheetUnits: computeModuleSheetUnits(params, sheetDefaultUnit),
        }),
        ...AnchorPointComponent.create({
          keyPoint: 'center',
          offset: new SheetPosition(0, 0),
        }),
        ...RotationComponent.create(Angle.degrees(0)),
        ...FillColorComponent.create(fillColor),
        ...TransformableComponent.create({
          component: InvoluteGearComponent.key,
          translate: true,
          rotate: true,
          scale: false,
        }),
      },
    };
  }
}
