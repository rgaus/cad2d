import { type CornerReplacementToolEvents } from './BaseCornerGeometryReplacerTool';
import { BaseMultiTool } from './BaseTool';
import { ChamferFilterTool } from './ChamferFilterTool';
import { FilletFilterTool } from './FilletFilterTool';
import { MirrorFilterTool, MirrorFilterToolEvents } from './MirrorFilterTool';
import { PatternGridFilterTool, PatternGridFilterToolEvents } from './PatternGridFilterTool';
import { PatternRadialFilterTool, PatternRadialFilterToolEvents } from './PatternRadialFilterTool';
import { TrimSplitTool, TrimSplitToolEvents } from './TrimSplitTool';

type ModifySubToolTypes =
  | 'trim-split'
  | 'fillet'
  | 'chamfer'
  | 'mirror'
  | 'pattern-grid'
  | 'pattern-radial';

/** A multi tool containing a list of ways one can modify a geometry. */
export class GeometryEditTool extends BaseMultiTool<
  TrimSplitToolEvents &
    CornerReplacementToolEvents &
    MirrorFilterToolEvents &
    PatternGridFilterToolEvents &
    PatternRadialFilterToolEvents,
  ModifySubToolTypes,
  'g'
> {
  type = 'edit' as const;

  focusKeyCombo = 'g' as const;

  subTools = [
    TrimSplitTool,
    FilletFilterTool,
    ChamferFilterTool,
    MirrorFilterTool,
    PatternGridFilterTool,
    PatternRadialFilterTool,
  ];
}
