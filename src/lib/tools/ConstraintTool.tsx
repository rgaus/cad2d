import { RulerIcon, TriangleRightIcon } from 'lucide-react';
import { Length } from '@/lib/units/length';
import { SheetPosition } from '@/lib/viewport/types';
import {
  ConstraintEndpoint,
  LINEAR_CONSTRAINT_DEFAULT_CONNECTOR_LINE_OFFSET_PX,
  LinearConstraint,
  PerpendicularConstraint,
} from '@/lib/geometry';
import { BaseMultiTool } from './BaseTool';
import { LineSegmentConstraintTool, TwoConnectedSegmentConstraintCreationTool } from './abstract';
import { WorkingConstraint, WorkingLinearConstraint, WorkingPerpendicularConstraint } from './types';

export type ConstraintToolEvents = {
  previewSheetPositionChange: (
    data: { position: SheetPosition; isSnappedToKeyPoint: boolean } | null,
  ) => void;
};

/** A tool for creating linear constraints. */
export class LinearConstraintTool extends LineSegmentConstraintTool<WorkingLinearConstraint, 'linear-constraint'> {
  type = 'linear-constraint' as const;
  label = 'Linear Constraint';

  get icon(): React.ReactNode {
    return <RulerIcon size={24} color="white" />;
  }

  focusKeyCombo = 'c l' as const;

  protected deriveWorkingConstraintFromEndPoints(pointA: ConstraintEndpoint, pointB: ConstraintEndpoint) {
    return {
      type: 'linear' as const,
      pointA,
      pointB,
      constrainedLength: null,
      connectorLineOffsetPx: LINEAR_CONSTRAINT_DEFAULT_CONNECTOR_LINE_OFFSET_PX,
      disabled: false,
      shadowsConstraintId: null,
    };
  }

  protected convertWorkingConstraintIntoConstraint(wc: WorkingLinearConstraint, lengthBetweenPoints: Length) {
    const sheet = this.getSheet();
    if (!sheet) {
      throw new Error('LinearConstraintTool.convertWorkingConstraintIntoConstraint: Cannot get sheet context from this.getSheet()!');
    }

    return LinearConstraint.create(
      wc.pointA,
      wc.pointB,
      wc.constrainedLength ?? lengthBetweenPoints,
      {
        connectorLineOffsetPx: -1 * wc.connectorLineOffsetPx,
      },
    );
  }

  protected isWorkingConstraint(wc: WorkingConstraint): wc is WorkingLinearConstraint {
    return wc.type === 'linear';
  }
}

/** A tool for creating perpendicular constraints (center + two endpoints forming a right angle). */
export class PerpendicularConstraintTool extends TwoConnectedSegmentConstraintCreationTool<
  WorkingPerpendicularConstraint,
  'perpendicular-constraint'
> {
  type = 'perpendicular-constraint' as const;
  label = 'Perpendicular Constraint';

  get icon(): React.ReactNode {
    return <TriangleRightIcon size={24} color="white" />;
  }

  focusKeyCombo = 'c p' as const;

  protected deriveWorkingConstraintFromThreePoints(pointA: ConstraintEndpoint, pointCenter: ConstraintEndpoint, pointB: ConstraintEndpoint) {
    return {
      type: 'perpendicular' as const,
      pointA,
      pointCenter,
      pointB,
      disabled: false,
      shadowsConstraintId: null,
    };
  }

  protected convertWorkingConstraintIntoConstraint(wc: WorkingPerpendicularConstraint) {
    return PerpendicularConstraint.create(wc.pointA, wc.pointCenter, wc.pointB);
  }

  protected isWorkingConstraint(wc: WorkingConstraint): wc is WorkingPerpendicularConstraint {
    return wc.type === 'perpendicular';
  }
}

type ConstraintSubToolTypes = 'linear-constraint' | 'perpendicular-constraint';

/** A multi tool for creating all types of constraints. */
export class ConstraintTool extends BaseMultiTool<ConstraintToolEvents, ConstraintSubToolTypes, 'c'> {
  type = 'constraint' as const;

  focusKeyCombo = 'c' as const;

  subTools = [LinearConstraintTool, PerpendicularConstraintTool];
}
