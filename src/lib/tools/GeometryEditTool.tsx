import { type CornerReplacementToolEvents } from './BaseCornerGeometryReplacerTool';
import { BaseMultiTool } from './BaseTool';
import { ChamferTool } from './ChamferTool';
import { FilletTool } from './FilletTool';
import { MirrorTool, MirrorToolEvents } from './MirrorTool';
import { TrimSplitTool, TrimSplitToolEvents } from './TrimSplitTool';

type ModifySubToolTypes = 'trim-split' | 'fillet' | 'chamfer' | 'mirror';

/** A multi tool containing a list of ways one can modify a geometry. */
export class GeometryEditTool extends BaseMultiTool<
  TrimSplitToolEvents & CornerReplacementToolEvents & MirrorToolEvents,
  ModifySubToolTypes,
  'g'
> {
  type = 'edit' as const;

  focusKeyCombo = 'g' as const;

  subTools = [TrimSplitTool, FilletTool, ChamferTool, MirrorTool];
}
