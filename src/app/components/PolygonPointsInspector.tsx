'use client';

import { PlusIcon, Trash2Icon } from 'lucide-react';
import { Fragment, createRef, memo, useRef, useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { type PolygonSegment } from '@/lib/entity';
import { PolygonData } from '@/lib/entity/geometry/polygon';
import { POINT_ROW_HEIGHT_PX_BY_TYPE } from '@/lib/selection/polygon-point-row';
import { Sheet } from '@/lib/sheet/Sheet';
import { Length, type UnitType } from '@/lib/units/length';
import { cn } from '@/lib/utils';
import LengthInput, { type LengthInputHandle } from './LengthInput';
import { type ShapePreviewHighlight } from './ShapePreview';

export { POINT_ROW_HEIGHT_PX_BY_TYPE };

const SplitPointIndicator: React.FunctionComponent<{
  dragging: boolean;
  onMouseDown?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}> = ({ dragging, onMouseDown, onMouseEnter, onMouseLeave }) => {
  const [hover, setHover] = useState(false);
  return (
    <div className="w-full h-0 shrink-1 relative overflow-visible">
      <div
        className={cn(
          'w-4 h-4 bg-[var(--slate-8)] border border-2 border-[var(--slate-6)] absolute -top-[10px] left-1 rounded-full z-30 cursor-grab',
          {
            'bg-[var(--teal-10)] border-[var(--teal-11)]': hover || dragging,
          },
        )}
        onMouseDown={onMouseDown}
        onMouseEnter={() => {
          setHover(true);
          onMouseEnter?.();
        }}
        onMouseLeave={() => {
          setHover(false);
          onMouseLeave?.();
        }}
      />
      <div
        className={cn('h-[2px] bg-[var(--slate-6)] absolute -my-0.75', {
          'bg-[var(--teal-11)]': hover || dragging,
        })}
        style={{ marginLeft: 12, width: 'calc(100% - 24px)' }}
      />
    </div>
  );
};

/** Maps a segment type to the Select value shown in the PointRow type picker. */
const SEGMENT_TYPE_TO_SELECT_VALUE: Record<PolygonSegment['type'], string> = {
  point: 'point',
  'arc-quadratic': 'quadratic',
  'arc-cubic': 'cubic',
};

/** Maps a PointRow type-picker Select value back to a segment type. */
const SELECT_VALUE_TO_SEGMENT_TYPE: Record<string, PolygonSegment['type']> = {
  point: 'point',
  quadratic: 'arc-quadratic',
  cubic: 'arc-cubic',
};

export type PointRowRefs = {
  x: React.RefObject<LengthInputHandle | null>;
  y: React.RefObject<LengthInputHandle | null>;
};

type PointRowProps = {
  segment: PolygonSegment;
  index: number;
  sheetUnitPlaces: Sheet['unitPlaces'];
  sheetDefaultUnit: UnitType;
  onXChange: (index: number, len: Length) => void;
  onYChange: (index: number, len: Length) => void;
  onXBlur?: (index: number) => void;
  onYBlur?: (index: number) => void;
  onControlPointChange: (
    index: number,
    pointKey: 'controlPoint' | 'controlPointA' | 'controlPointB',
    axis: 'x' | 'y',
    len: Length,
  ) => void;
  onDelete: (index: number) => void;
  onInsert: (index: number) => void;
  onTypeChange?: (index: number, type: PolygonSegment['type']) => void;
  isHovered?: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  refs?: PointRowRefs;
};

const PointRow = memo<PointRowProps>(
  ({
    segment,
    index,
    sheetUnitPlaces,
    sheetDefaultUnit,
    onXChange,
    onYChange,
    onXBlur,
    onYBlur,
    onControlPointChange,
    onDelete,
    onInsert,
    onTypeChange,
    isHovered = false,
    onMouseEnter,
    onMouseLeave,
    refs,
  }) => {
    const isPoint = segment.type === 'point';
    const isQuadratic = segment.type === 'arc-quadratic';

    const iconColor = isPoint ? '#888' : isQuadratic ? '#3498db' : '#e74c3c';
    const iconLabel = isPoint ? 'P' : isQuadratic ? 'Q' : 'C';

    return (
      <div
        className="flex items-center gap-1 grow-0 shrink-0 mx-3 px-2 py-1 mb-1 bg-[var(--slate-2)] rounded-[4px] border border-[var(--slate-4)]"
        style={{
          backgroundColor: isHovered ? 'var(--slate-1)' : 'var(--slate-2)',
          height: POINT_ROW_HEIGHT_PX_BY_TYPE[segment.type],
        }}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        {index === 0 ? (
          // The point at index=0 is not editable, as it should always be type=point
          <div className="w-14 w-8 flex justify-center">
            <span
              className="flex items-center justify-center text-[10px] font-bold select-none"
              style={{ color: iconColor, fontFamily: 'var(--font-roboto-mono), monospace' }}
            >
              {iconLabel}
            </span>
          </div>
        ) : (
          <Select
            value={SEGMENT_TYPE_TO_SELECT_VALUE[segment.type]}
            onValueChange={(value) => onTypeChange?.(index, SELECT_VALUE_TO_SEGMENT_TYPE[value])}
            disabled={index === 0}
          >
            <SelectTrigger
              className="w-14 border-[var(--gray-2)] hover:border-[var(--gray-4)] p-0 w-8 flex justify-center"
              caretVisible={false}
            >
              <SelectValue asChild>
                <span
                  className="flex items-center justify-center text-[10px] font-bold rounded-[4px] select-none"
                  style={{ color: iconColor, fontFamily: 'var(--font-roboto-mono), monospace' }}
                >
                  {iconLabel}
                </span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="text-sm">
              <SelectItem value="point">Point</SelectItem>
              <SelectItem value="quadratic">Quadratic</SelectItem>
              <SelectItem value="cubic">Cubic</SelectItem>
            </SelectContent>
          </Select>
        )}
        <div className="flex-1 px-1">
          {segment.type === 'point' ? (
            <div className="flex gap-4">
              <div className="w-24">
                <LengthInput
                  ref={refs?.x}
                  value={Length.fromSheetUnits(sheetDefaultUnit, segment.point.x)}
                  onChange={(len) => onXChange(index, len)}
                  onBlur={onXBlur ? () => onXBlur(index) : undefined}
                  roundPlaces={sheetUnitPlaces}
                  readOnlyUnit
                />
              </div>
              <div className="w-24">
                <LengthInput
                  ref={refs?.y}
                  value={Length.fromSheetUnits(sheetDefaultUnit, segment.point.y)}
                  onChange={(len) => onYChange(index, len)}
                  onBlur={onYBlur ? () => onYBlur(index) : undefined}
                  roundPlaces={sheetUnitPlaces}
                  readOnlyUnit
                />
              </div>
            </div>
          ) : null}
          {segment.type === 'arc-cubic' || segment.type === 'arc-quadratic' ? (
            <div className="flex flex-col gap-1">
              <div className="flex gap-1">
                <div className="w-24">
                  <LengthInput
                    ref={refs?.x}
                    value={Length.fromSheetUnits(sheetDefaultUnit, segment.point.x)}
                    onChange={(len) => onXChange(index, len)}
                    onBlur={onXBlur ? () => onXBlur(index) : undefined}
                    roundPlaces={sheetUnitPlaces}
                    readOnlyUnit
                  />
                </div>
                <div className="w-24">
                  <LengthInput
                    ref={refs?.y}
                    value={Length.fromSheetUnits(sheetDefaultUnit, segment.point.y)}
                    onChange={(len) => onYChange(index, len)}
                    onBlur={onYBlur ? () => onYBlur(index) : undefined}
                    roundPlaces={sheetUnitPlaces}
                    readOnlyUnit
                  />
                </div>
              </div>
              {segment.type === 'arc-quadratic' ? (
                <div className="flex gap-1">
                  <div className="w-24">
                    <LengthInput
                      value={Length.fromSheetUnits(sheetDefaultUnit, segment.controlPoint.x)}
                      onChange={(len) => {
                        onControlPointChange(index, 'controlPoint', 'x', len);
                      }}
                      roundPlaces={sheetUnitPlaces}
                      readOnlyUnit
                    />
                  </div>
                  <div className="w-24">
                    <LengthInput
                      value={Length.fromSheetUnits(sheetDefaultUnit, segment.controlPoint.y)}
                      onChange={(len) => {
                        onControlPointChange(index, 'controlPoint', 'y', len);
                      }}
                      roundPlaces={sheetUnitPlaces}
                      readOnlyUnit
                    />
                  </div>
                </div>
              ) : null}
              {segment.type === 'arc-cubic' ? (
                <>
                  <div className="flex gap-1">
                    <div className="w-24">
                      <LengthInput
                        value={Length.fromSheetUnits(sheetDefaultUnit, segment.controlPointA.x)}
                        onChange={(len) => {
                          onControlPointChange(index, 'controlPointA', 'x', len);
                        }}
                        roundPlaces={sheetUnitPlaces}
                        readOnlyUnit
                      />
                    </div>
                    <div className="w-24">
                      <LengthInput
                        value={Length.fromSheetUnits(sheetDefaultUnit, segment.controlPointA.y)}
                        onChange={(len) => {
                          onControlPointChange(index, 'controlPointA', 'y', len);
                        }}
                        roundPlaces={sheetUnitPlaces}
                        readOnlyUnit
                      />
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <div className="w-24">
                      <LengthInput
                        value={Length.fromSheetUnits(sheetDefaultUnit, segment.controlPointB.x)}
                        onChange={(len) => {
                          onControlPointChange(index, 'controlPointB', 'x', len);
                        }}
                        roundPlaces={sheetUnitPlaces}
                        readOnlyUnit
                      />
                    </div>
                    <div className="w-24">
                      <LengthInput
                        value={Length.fromSheetUnits(sheetDefaultUnit, segment.controlPointB.y)}
                        onChange={(len) => {
                          onControlPointChange(index, 'controlPointB', 'y', len);
                        }}
                        roundPlaces={sheetUnitPlaces}
                        readOnlyUnit
                      />
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => onInsert(index)}
          className="w-5 h-5 flex items-center justify-center text-[var(--slate-8)] hover:text-[var(--slate-12)] transition-colors"
          title="Insert point"
        >
          <PlusIcon size={12} />
        </button>
        <button
          type="button"
          onClick={() => onDelete(index)}
          className="w-5 h-5 flex items-center justify-center text-[var(--slate-8)] hover:text-red-400 transition-colors"
          title="Delete point"
        >
          <Trash2Icon size={12} />
        </button>
      </div>
    );
  },
);

PointRow.displayName = 'PointRow';

type PolygonPointsInspectorProps = {
  data: PolygonData;
  sheetUnitPlaces: Sheet['unitPlaces'];
  sheetDefaultUnit: UnitType;
  pointInputRefs?: Map<number, PointRowRefs>;
  highlight?: ShapePreviewHighlight | null;
  openAtIndexDragging?: boolean;
  onPointXChange?: (index: number, len: Length) => void;
  onPointYChange?: (index: number, len: Length) => void;
  onPointXBlur?: (index: number) => void;
  onPointYBlur?: (index: number) => void;
  onControlPointChange?: (
    index: number,
    pointKey: 'controlPoint' | 'controlPointA' | 'controlPointB',
    axis: 'x' | 'y',
    len: Length,
  ) => void;
  onDeletePoint?: (index: number) => void;
  onInsertPoint?: (index: number) => void;
  onPointTypeChange?: (index: number, type: PolygonSegment['type']) => void;
  onPointMouseEnter?: (index: number) => void;
  onPointMouseLeave?: (index: number) => void;
  onOpenAtIndexMouseEnter?: () => void;
  onOpenAtIndexMouseLeave?: () => void;
  onOpenAtIndexMouseDown?: () => void;
};

export default function PolygonPointsInspector({
  data,
  sheetUnitPlaces,
  sheetDefaultUnit,
  pointInputRefs,
  highlight,
  openAtIndexDragging = false,
  onPointXChange,
  onPointYChange,
  onPointXBlur,
  onPointYBlur,
  onControlPointChange,
  onDeletePoint,
  onInsertPoint,
  onPointTypeChange,
  onPointMouseEnter,
  onPointMouseLeave,
  onOpenAtIndexMouseEnter,
  onOpenAtIndexMouseLeave,
  onOpenAtIndexMouseDown,
}: PolygonPointsInspectorProps) {
  const internalPointInputRefs = useRef<Map<number, PointRowRefs>>(new Map());
  const pointRefsMap = pointInputRefs ?? internalPointInputRefs.current;
  const displayedPoints = data.closed ? data.points.slice(0, -1) : data.points;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span
          className="text-[var(--slate-12)] text-sm font-medium"
          style={{ fontFamily: 'var(--font-roboto-mono), monospace' }}
        >
          Points:
        </span>
        <span className="text-xs text-[var(--slate-8)] font-mono">{data.points.length}</span>
      </div>
      <div className="flex flex-col max-h-40 -mx-3 overflow-y-auto">
        {displayedPoints.map((segment, index) => {
          let refs = pointRefsMap.get(index);
          if (!refs) {
            refs = { x: createRef<LengthInputHandle>(), y: createRef<LengthInputHandle>() };
            pointRefsMap.set(index, refs);
          }
          const pointRefs = refs;
          return (
            <Fragment key={index}>
              <PointRow
                segment={segment}
                index={index}
                sheetUnitPlaces={sheetUnitPlaces}
                sheetDefaultUnit={sheetDefaultUnit}
                onXChange={onPointXChange ?? (() => {})}
                onYChange={onPointYChange ?? (() => {})}
                onXBlur={onPointXBlur}
                onYBlur={onPointYBlur}
                onControlPointChange={onControlPointChange ?? (() => {})}
                onDelete={onDeletePoint ?? (() => {})}
                onInsert={onInsertPoint ?? (() => {})}
                onTypeChange={onPointTypeChange}
                isHovered={highlight?.type === 'point' && highlight.index === index}
                onMouseEnter={onPointMouseEnter ? () => onPointMouseEnter(index) : undefined}
                onMouseLeave={onPointMouseLeave ? () => onPointMouseLeave(index) : undefined}
                refs={pointRefs}
              />

              {data.closed && data.openAtIndex === index ? (
                <SplitPointIndicator
                  dragging={openAtIndexDragging}
                  onMouseEnter={onOpenAtIndexMouseEnter}
                  onMouseLeave={onOpenAtIndexMouseLeave}
                  onMouseDown={onOpenAtIndexMouseDown}
                />
              ) : null}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
