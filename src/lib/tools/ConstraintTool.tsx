import {
  CrosshairIcon,
  EqualIcon,
  MoveHorizontalIcon,
  MoveVerticalIcon,
  RulerIcon,
  TriangleRightIcon,
} from 'lucide-react';
import {
  ConstraintEndpoint,
  Datum,
  LINEAR_CONSTRAINT_DEFAULT_CONNECTOR_LINE_OFFSET_PX,
  LinearConstraint,
  ParallelConstraint,
  type ParallelConstraintTemplate,
  PerpendicularConstraint,
} from '@/lib/geometry';
import { ID_PREFIXES } from '@/lib/geometry/GeometryStore';
import { applySnapping } from '@/lib/snapping';
import { Length } from '@/lib/units/length';
import { ScreenPosition, SheetPosition, type ViewportState } from '@/lib/viewport/types';
import { BaseMultiTool, BaseTool } from './BaseTool';
import {
  LineSegmentConstraintTool,
  TwoConnectedSegmentConstraintCreationTool,
  TwoSegmentConstraintCreationTool,
} from './abstract';
import {
  WorkingConstraint,
  WorkingLinearConstraint,
  WorkingParallelConstraint,
  WorkingPerpendicularConstraint,
} from './types';

export type ConstraintToolEvents = {
  previewSheetPositionChange: (
    data: { position: SheetPosition; isSnappedToKeyPoint: boolean } | null,
  ) => void;
};

/** A tool for creating linear constraints. */
export class LinearConstraintTool extends LineSegmentConstraintTool<
  WorkingLinearConstraint,
  'linear-constraint'
> {
  type = 'linear-constraint' as const;
  label = 'Linear Constraint';

  get icon(): React.ReactNode {
    return <RulerIcon size={24} color="white" />;
  }

  focusKeyCombo = 'c l' as const;

  protected deriveWorkingConstraintFromEndPoints(
    pointA: ConstraintEndpoint,
    pointB: ConstraintEndpoint,
  ) {
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

  protected convertWorkingConstraintIntoConstraint(
    wc: WorkingLinearConstraint,
    lengthBetweenPoints: Length,
    _xAxisLengthBetweenPoints: Length,
    _yAxisLengthBetweenPoints: Length,
  ) {
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

/** A tool for creating linear constraints that measure only the horizontal (x) distance. */
export class LinearXConstraintTool extends LineSegmentConstraintTool<
  WorkingLinearConstraint,
  'linear-x-constraint'
> {
  type = 'linear-x-constraint' as const;
  label = 'Horizontal Constraint';

  get icon(): React.ReactNode {
    return (
      <svg width="24" height="24" viewBox="0 0 24 24">
        <g transform="translate(0, 4)">
          <RulerIcon size={20} color="white" strokeWidth={2.33} />
        </g>
        <g transform="translate(12, 0)">
          <MoveHorizontalIcon size={12} color="white" strokeWidth={2.33} />
        </g>
      </svg>
    );
  }

  focusKeyCombo = 'c x' as const;

  protected deriveWorkingConstraintFromEndPoints(
    pointA: ConstraintEndpoint,
    pointB: ConstraintEndpoint,
  ) {
    return {
      type: 'linear' as const,
      pointA,
      pointB,
      constrainedLength: null,
      connectorLineOffsetPx: LINEAR_CONSTRAINT_DEFAULT_CONNECTOR_LINE_OFFSET_PX,
      disabled: false,
      axis: 'x' as const,
      shadowsConstraintId: null,
    };
  }

  protected convertWorkingConstraintIntoConstraint(
    wc: WorkingLinearConstraint,
    _lengthBetweenPoints: Length,
    xAxisLengthBetweenPoints: Length,
    _yAxisLengthBetweenPoints: Length,
  ) {
    return LinearConstraint.create(
      wc.pointA,
      wc.pointB,
      wc.constrainedLength ?? xAxisLengthBetweenPoints,
      {
        connectorLineOffsetPx: -1 * wc.connectorLineOffsetPx,
        axis: 'x',
      },
    );
  }

  protected isWorkingConstraint(wc: WorkingConstraint): wc is WorkingLinearConstraint {
    return wc.type === 'linear';
  }
}

/** A tool for creating linear constraints that measure only the vertical (y) distance. */
export class LinearYConstraintTool extends LineSegmentConstraintTool<
  WorkingLinearConstraint,
  'linear-y-constraint'
> {
  type = 'linear-y-constraint' as const;
  label = 'Vertical Constraint';

  get icon(): React.ReactNode {
    return (
      <svg width="24" height="24" viewBox="0 0 24 24">
        <g transform="translate(0, 4)">
          <RulerIcon size={20} color="white" strokeWidth={2.33} />
        </g>
        <g transform="translate(12, 0)">
          <MoveVerticalIcon size={12} color="white" strokeWidth={2.33} />
        </g>
      </svg>
    );
  }

  focusKeyCombo = 'c y' as const;

  protected deriveWorkingConstraintFromEndPoints(
    pointA: ConstraintEndpoint,
    pointB: ConstraintEndpoint,
  ) {
    return {
      type: 'linear' as const,
      pointA,
      pointB,
      constrainedLength: null,
      connectorLineOffsetPx: LINEAR_CONSTRAINT_DEFAULT_CONNECTOR_LINE_OFFSET_PX,
      disabled: false,
      axis: 'y' as const,
      shadowsConstraintId: null,
    };
  }

  protected convertWorkingConstraintIntoConstraint(
    wc: WorkingLinearConstraint,
    _lengthBetweenPoints: Length,
    _xAxisLengthBetweenPoints: Length,
    yAxisLengthBetweenPoints: Length,
  ) {
    return LinearConstraint.create(
      wc.pointA,
      wc.pointB,
      wc.constrainedLength ?? yAxisLengthBetweenPoints,
      {
        connectorLineOffsetPx: -1 * wc.connectorLineOffsetPx,
        axis: 'y',
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
    return (
      <svg width="24" height="24" viewBox="0 0 24 24">
        <g transform="translate(0, 4)">
          <RulerIcon size={20} color="white" strokeWidth={2.33} />
        </g>
        <g transform="translate(12, 0)">
          <TriangleRightIcon size={12} color="white" strokeWidth={2.33} />
        </g>
      </svg>
    );
  }

  focusKeyCombo = 'c p' as const;

  protected deriveWorkingConstraintFromThreePoints(
    pointA: ConstraintEndpoint,
    pointCenter: ConstraintEndpoint,
    pointB: ConstraintEndpoint,
  ) {
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

/** A tool for creating parallel constraints (two independent line segments that must stay parallel). */
export class ParallelConstraintTool extends TwoSegmentConstraintCreationTool<
  WorkingParallelConstraint,
  'parallel-constraint'
> {
  type = 'parallel-constraint' as const;
  label = 'Parallel Constraint';

  get icon(): React.ReactNode {
    return (
      <svg width="24" height="24" viewBox="0 0 24 24">
        <g transform="translate(0, 4)">
          <RulerIcon size={20} color="white" strokeWidth={2.33} />
        </g>
        <g transform="translate(12, 0)">
          <EqualIcon size={16} color="white" strokeWidth={2.33} />
        </g>
      </svg>
    );
  }

  focusKeyCombo = 'c P' as const;

  protected deriveWorkingConstraintFromFourPoints(
    pointA: ConstraintEndpoint,
    pointB: ConstraintEndpoint,
    pointC: ConstraintEndpoint,
    pointD: ConstraintEndpoint,
  ): WorkingParallelConstraint {
    return {
      type: 'parallel',
      pointA,
      pointB,
      pointC,
      pointD,
      disabled: false,
      shadowsConstraintId: null,
    };
  }

  protected convertWorkingConstraintIntoConstraint(
    wc: WorkingParallelConstraint,
  ): ParallelConstraintTemplate {
    return ParallelConstraint.create(wc.pointA, wc.pointB, wc.pointC, wc.pointD);
  }

  protected isWorkingConstraint(wc: WorkingConstraint): wc is WorkingParallelConstraint {
    return wc.type === 'parallel';
  }
}

/** A tool for placing datums with a single click. */
export class DatumTool extends BaseTool<ConstraintToolEvents, 'datum'> {
  type = 'datum' as const;
  label = 'Datum';

  get icon(): React.ReactNode {
    return <CrosshairIcon size={24} color="white" />;
  }

  focusKeyCombo = 'c d' as const;

  handleToolBlur(): void {
    this.getGeometryStore().clearWorkingDatum();
  }

  handleMouseMove(screenPos: ScreenPosition, viewport: ViewportState): void {
    const worldPos = screenPos.toWorld(viewport);
    const sheetPos = worldPos.toSheet();
    const snapped = applySnapping(sheetPos, {
      primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
      secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
      shiftHeld: this.toolManager.getShiftHeld(),
      superHeld: this.toolManager.getSuperHeld(),
    });
    this.getGeometryStore().setWorkingDatum({ position: snapped });
  }

  handleMouseDown(screenPos: ScreenPosition, viewport: ViewportState): void {
    const worldPos = screenPos.toWorld(viewport);
    const sheetPos = worldPos.toSheet();
    const snapped = applySnapping(sheetPos, {
      primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
      secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
      shiftHeld: this.toolManager.getShiftHeld(),
      superHeld: this.toolManager.getSuperHeld(),
    });
    this.getGeometryStore().add(ID_PREFIXES.datum, Datum.create(snapped));
  }
}

type ConstraintSubToolTypes =
  | 'linear-constraint'
  | 'linear-x-constraint'
  | 'linear-y-constraint'
  | 'perpendicular-constraint'
  | 'parallel-constraint'
  | 'datum';

/** A multi tool for creating all types of constraints. */
export class ConstraintTool extends BaseMultiTool<
  ConstraintToolEvents,
  ConstraintSubToolTypes,
  'c'
> {
  type = 'constraint' as const;

  focusKeyCombo = 'c' as const;

  subTools = [
    LinearConstraintTool,
    LinearXConstraintTool,
    LinearYConstraintTool,
    PerpendicularConstraintTool,
    ParallelConstraintTool,
    DatumTool,
  ];
}
