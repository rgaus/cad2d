import { type CornerReplacementToolEvents } from './BaseCornerGeometryReplacerTool';
import { BaseMultiTool } from './BaseTool';
import { ChamferFilterTool } from './ChamferFilterTool';
import { FilletFilterTool } from './FilletFilterTool';
import { MirrorFilterTool, MirrorFilterToolEvents } from './MirrorFilterTool';
import { PatternGridFilterTool, PatternGridFilterToolEvents } from './PatternGridFilterTool';
import { PatternRadialFilterTool, PatternRadialFilterToolEvents } from './PatternRadialFilterTool';

type FiltersSubToolTypes = 'fillet' | 'chamfer' | 'mirror' | 'pattern-grid' | 'pattern-radial';

/** A multi tool containing a list of filters that can be applied to a geometry. */
export class FiltersTool extends BaseMultiTool<
  CornerReplacementToolEvents &
    MirrorFilterToolEvents &
    PatternGridFilterToolEvents &
    PatternRadialFilterToolEvents,
  FiltersSubToolTypes,
  'f'
> {
  type = 'filters' as const;

  focusKeyCombo = 'f' as const;

  subTools = [
    FilletFilterTool,
    ChamferFilterTool,
    MirrorFilterTool,
    PatternGridFilterTool,
    PatternRadialFilterTool,
  ];
}
