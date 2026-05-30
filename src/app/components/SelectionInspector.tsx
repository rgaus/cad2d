'use client';

import debounce from 'lodash.debounce';
import { Link2Icon, Link2OffIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import {
  Fragment,
  createRef,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import RenderOrderInput from '@/components/RenderOrderInput';
import { Button } from '@/components/ui/button';
import { ActionsManager } from '@/lib/actions/ActionsManager';
import {
  type Ellipse,
  type Id,
  type Polygon,
  type PolygonSegment,
  type Rectangle,
} from '@/lib/geometry';
import { GeometryStore } from '@/lib/geometry/GeometryStore';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { UndoEntry } from '@/lib/history/types';
import { boundingBox, interpolatePolygonPoints } from '@/lib/math';
import { Sheet } from '@/lib/sheet/Sheet';
import { SelectionManager } from '@/lib/tools/SelectionManager';
import { Length, type UnitType } from '@/lib/units/length';
import { cn } from '@/lib/utils';
import { SheetPosition } from '@/lib/viewport/types';
import type { Rect } from '@/lib/viewport/types';
import ColorInput from './ColorInput';
import FloatingPanel from './FloatingPanel';
import LabeledRow from './LabeledRow';
import LengthInput, { type LengthInputHandle } from './LengthInput';
import ShapePreview, { ShapePreviewEditingDimension, ShapePreviewHighlight } from './ShapePreview';

type SelectionInspectorProps = {
  sheet: Sheet;
  geometryStore: GeometryStore;
  selectionManager: SelectionManager;
  historyManager: HistoryManager;
  actionsManager: ActionsManager;
};

function getSharedValue(values: Array<unknown>): { shared: boolean; value: unknown } {
  const first = values[0];
  const shared = values.every((v) => v === first);
  return { shared, value: first };
}

function LinkButton({ linked, onToggle }: { linked: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'w-6 h-6 flex items-center justify-center rounded-[4px] transition-colors border',
        {
          'bg-[var(--red-3)] text-[var(--red-10)] border-[var(--red-7)]': linked,
          'bg-[var(--slate-3)] text-[var(--slate-11)] border-transparent hover:bg-[var(--slate-5)]':
            !linked,
        },
      )}
      title={linked ? 'Unlink dimensions' : 'Link dimensions'}
    >
      {linked ? <Link2Icon size={14} /> : <Link2OffIcon size={14} />}
    </button>
  );
}

/** Common fields shared by single-shape inspector panels (Rectangle, Ellipse, Polygon). */
const CommonFields: React.FunctionComponent<{
  geometryId: Id;
  renderOrder: number;
  fillColor: number | null;
  showFill: boolean;
  geometryStore: GeometryStore;
  onRenderOrderChange: (val: number) => void;
  onFillChange: (color: number | null) => void;
}> = ({
  geometryId,
  renderOrder,
  fillColor,
  showFill,
  geometryStore,
  onRenderOrderChange,
  onFillChange,
}) => {
  return (
    <>
      <LabeledRow label="Id:">
        <span className="text-xs text-[var(--slate-8)] font-mono truncate" title={geometryId}>
          {geometryId.slice(0, 8)}
        </span>
      </LabeledRow>
      <LabeledRow label="Render order:">
        <RenderOrderInput
          key={geometryId}
          value={renderOrder}
          onChange={onRenderOrderChange}
          geometryStore={geometryStore}
          geometryId={geometryId}
        />
      </LabeledRow>
      {showFill && (
        <LabeledRow label="Fill:">
          <ColorInput value={fillColor} onChange={onFillChange} />
        </LabeledRow>
      )}
    </>
  );
};

/** Listening to a full fidelity stream of geometry update events and rerendering on each event
 * update is probhibitively expensive, especially for geometry moves which can easily be sent many
 * tens of times per seconds. So, debounce the event stream to speed things up. */
const GEOMETRY_UPDATE_DEBOUNCE_MS = 250;

const RectangleInspector: React.FunctionComponent<{
  rectangleId: Id;
  geometryStore: GeometryStore;
  selectionManager: SelectionManager;
  sheetUnitPlaces: Sheet['unitPlaces'];
  sheetDefaultUnit: UnitType;
  actionsManager: ActionsManager;
}> = ({
  rectangleId,
  geometryStore,
  selectionManager,
  sheetUnitPlaces,
  sheetDefaultUnit,
  actionsManager,
}) => {
  const [rectangle, setRectangle] = useState<Rectangle | null>(() =>
    geometryStore.getRectangleById(rectangleId),
  );
  const [editingDimension, setEditingDimension] = useState<ShapePreviewEditingDimension | null>(
    null,
  );

  const xInputRef = useRef<LengthInputHandle>(null);
  const yInputRef = useRef<LengthInputHandle>(null);
  const wInputRef = useRef<LengthInputHandle>(null);
  const hInputRef = useRef<LengthInputHandle>(null);

  useEffect(() => {
    const rect = geometryStore.getRectangleById(rectangleId);
    if (rect) {
      setRectangle(rect);
    }
  }, [geometryStore, rectangleId]);

  useEffect(() => {
    const handler = (rectangles: Array<Rectangle>) => {
      const updated = rectangles.find((r) => r.id === rectangleId);
      if (updated) {
        // Update frequently updating fields directly via refs
        xInputRef.current?.setDisplayValue(
          Length.fromSheetUnits(sheetDefaultUnit, updated.upperLeft.x),
        );
        yInputRef.current?.setDisplayValue(
          Length.fromSheetUnits(sheetDefaultUnit, updated.upperLeft.y),
        );
        const w = updated.lowerRight.x - updated.upperLeft.x;
        wInputRef.current?.setDisplayValue(Length.fromSheetUnits(sheetDefaultUnit, w));
        const h = updated.lowerRight.y - updated.upperLeft.y;
        hInputRef.current?.setDisplayValue(Length.fromSheetUnits(sheetDefaultUnit, h));

        // Update less frequently updating fields by updating state directly
        //
        // NOTE: it's important to ensure that if these less frequently updated fields are NOT
        // changed, that this returns the old ref unchanged to avoid performance degredation.
        setRectangle((oldRectangle) => {
          if (!oldRectangle) {
            return null;
          }

          let newRectangle = oldRectangle;
          if (oldRectangle?.fillColor !== updated.fillColor) {
            newRectangle = { ...newRectangle, fillColor: updated.fillColor };
          }
          if (oldRectangle?.linkDimensions !== updated.linkDimensions) {
            newRectangle = { ...newRectangle, linkDimensions: updated.linkDimensions };
          }

          return newRectangle;
        });
      }
    };
    geometryStore.on('rectanglesChanged', handler);
    return () => {
      geometryStore.off('rectanglesChanged', handler);
    };
  }, [geometryStore, rectangleId]);

  useEffect(() => {
    const debouncedHandler = debounce((rectangles: Array<Rectangle>) => {
      const updated = rectangles.find((r) => r.id === rectangleId);
      if (updated) {
        setRectangle(updated);
      }
    }, GEOMETRY_UPDATE_DEBOUNCE_MS);

    geometryStore.on('rectanglesChanged', debouncedHandler);
    return () => {
      geometryStore.off('rectanglesChanged', debouncedHandler);
    };
  }, [geometryStore, rectangleId]);

  const width = rectangle ? rectangle.lowerRight.x - rectangle.upperLeft.x : 0;
  const height = rectangle ? rectangle.lowerRight.y - rectangle.upperLeft.y : 0;

  const handleConvertToPolygon = useCallback(() => {
    if (!rectangle) return;
    actionsManager.execute('convert-to-polygon');
  }, [actionsManager, rectangle]);

  const handleXChange = useCallback(
    (len: Length) => {
      if (!rectangle) {
        return;
      }
      const newX = len.toSheetUnits(sheetDefaultUnit).magnitude;
      const deltaX = newX - rectangle.upperLeft.x;
      geometryStore.updateRectangle(rectangle.id, {
        upperLeft: new SheetPosition(newX, rectangle.upperLeft.y),
        lowerRight: new SheetPosition(rectangle.lowerRight.x + deltaX, rectangle.lowerRight.y),
      });
    },
    [geometryStore, rectangle, sheetDefaultUnit],
  );

  const handleYChange = useCallback(
    (len: Length) => {
      if (!rectangle) {
        return;
      }
      const newY = len.toSheetUnits(sheetDefaultUnit).magnitude;
      const deltaY = newY - rectangle.upperLeft.y;
      geometryStore.updateRectangle(rectangle.id, {
        upperLeft: new SheetPosition(rectangle.upperLeft.x, newY),
        lowerRight: new SheetPosition(rectangle.lowerRight.x, rectangle.lowerRight.y + deltaY),
      });
    },
    [geometryStore, rectangle, sheetDefaultUnit],
  );

  const handleWChange = useCallback(
    (len: Length) => {
      if (!rectangle) {
        return;
      }
      const w = len.toSheetUnits(sheetDefaultUnit).magnitude;

      let newLowerRight = new SheetPosition(rectangle.upperLeft.x + w, rectangle.lowerRight.y);
      if (rectangle.linkDimensions) {
        newLowerRight.y = rectangle.upperLeft.y + w;
      }

      geometryStore.updateRectangle(rectangle.id, { lowerRight: newLowerRight });
    },
    [geometryStore, rectangle, sheetDefaultUnit],
  );

  const handleHChange = useCallback(
    (len: Length) => {
      if (!rectangle) {
        return;
      }
      const h = len.toSheetUnits(sheetDefaultUnit).magnitude;

      let newLowerRight = new SheetPosition(rectangle.lowerRight.x, rectangle.upperLeft.y + h);
      if (rectangle.linkDimensions) {
        newLowerRight.x = rectangle.upperLeft.x + h;
      }

      geometryStore.updateRectangle(rectangle.id, { lowerRight: newLowerRight });
    },
    [geometryStore, rectangle, sheetDefaultUnit],
  );

  const handleLinkToggle = useCallback(() => {
    if (!rectangle) return;
    actionsManager.execute('toggle-link-dimensions');
  }, [actionsManager, rectangle]);

  const handleFillChange = useCallback(
    (color: number | null) => {
      if (!rectangle) return;
      geometryStore.setRectangleFillColor(rectangle.id, color);
    },
    [geometryStore, rectangle],
  );

  const handleRenderOrderChange = useCallback(
    (val: number) => {
      if (!rectangle?.id) {
        return;
      }
      geometryStore.setRectangleRenderOrder(rectangle.id, val);
    },
    [geometryStore, rectangle?.id],
  );

  if (!rectangle) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-row justify-center w-full py-2">
        <div className="w-20 shrink-0 aspect-square overflow-hidden">
          <ShapePreview shape={rectangle} editingDimension={editingDimension} />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0 pr-8">
          <LabeledRow label="X:">
            <LengthInput
              ref={xInputRef}
              value={Length.fromSheetUnits(sheetDefaultUnit, rectangle.upperLeft.x)}
              onChange={handleXChange}
              onFocus={() => setEditingDimension('origin')}
              onBlur={() => setEditingDimension(null)}
              roundPlaces={sheetUnitPlaces}
              readOnlyUnit
            />
          </LabeledRow>
        </div>
        <div className="flex-1 min-w-0">
          <LabeledRow label="Y:">
            <LengthInput
              ref={yInputRef}
              value={Length.fromSheetUnits(sheetDefaultUnit, rectangle.upperLeft.y)}
              onChange={handleYChange}
              onFocus={() => setEditingDimension('origin')}
              onBlur={() => setEditingDimension(null)}
              roundPlaces={sheetUnitPlaces}
              readOnlyUnit
            />
          </LabeledRow>
        </div>
      </div>
      <div className="flex gap-2 items-center">
        <div className="flex-1 min-w-0">
          <LabeledRow label="W:">
            <LengthInput
              ref={wInputRef}
              value={Length.fromSheetUnits(sheetDefaultUnit, width)}
              onChange={handleWChange}
              onFocus={() => setEditingDimension('width')}
              onBlur={() => setEditingDimension(null)}
              roundPlaces={sheetUnitPlaces}
              readOnlyUnit
            />
          </LabeledRow>
        </div>
        <LinkButton linked={rectangle.linkDimensions} onToggle={handleLinkToggle} />
        <div className="flex-1 min-w-0">
          <LabeledRow label="H:">
            <LengthInput
              ref={hInputRef}
              value={Length.fromSheetUnits(sheetDefaultUnit, height)}
              onChange={handleHChange}
              onFocus={() => setEditingDimension('height')}
              onBlur={() => setEditingDimension(null)}
              roundPlaces={sheetUnitPlaces}
              readOnlyUnit
            />
          </LabeledRow>
        </div>
      </div>
      <CommonFields
        geometryId={rectangle.id}
        renderOrder={rectangle.renderOrder}
        fillColor={rectangle.fillColor}
        showFill={true}
        geometryStore={geometryStore}
        onRenderOrderChange={handleRenderOrderChange}
        onFillChange={handleFillChange}
      />
      <button
        type="button"
        onClick={handleConvertToPolygon}
        className="px-3 py-1.5 bg-[var(--slate-5)] text-[var(--slate-12)] text-sm rounded-[4px] border border-[var(--slate-5)] hover:border-[var(--slate-8)] transition-colors"
        style={{ fontFamily: 'var(--font-roboto-mono), monospace' }}
      >
        To polygon...
      </button>
    </div>
  );
};

const EllipseInspector: React.FunctionComponent<{
  ellipseId: Id;
  geometryStore: GeometryStore;
  selectionManager: SelectionManager;
  sheetUnitPlaces: Sheet['unitPlaces'];
  sheetDefaultUnit: UnitType;
  actionsManager: ActionsManager;
}> = ({
  ellipseId,
  geometryStore,
  selectionManager,
  sheetUnitPlaces,
  sheetDefaultUnit,
  actionsManager,
}) => {
  const [ellipse, setEllipse] = useState<Ellipse | null>(() =>
    geometryStore.getEllipseById(ellipseId),
  );
  const [editingDimension, setEditingDimension] = useState<ShapePreviewEditingDimension | null>(
    null,
  );

  const cxInputRef = useRef<LengthInputHandle>(null);
  const cyInputRef = useRef<LengthInputHandle>(null);
  const rxInputRef = useRef<LengthInputHandle>(null);
  const ryInputRef = useRef<LengthInputHandle>(null);

  useEffect(() => {
    const ellipse = geometryStore.getEllipseById(ellipseId);
    if (ellipse) {
      setEllipse(ellipse);
    }
  }, [geometryStore, ellipseId]);

  useEffect(() => {
    const handler = (ellipses: Array<Ellipse>) => {
      const updated = ellipses.find((e) => e.id === ellipseId);
      if (updated) {
        // Update frequently updating fields directly via refs
        cxInputRef.current?.setDisplayValue(
          Length.fromSheetUnits(sheetDefaultUnit, updated.center.x),
        );
        cyInputRef.current?.setDisplayValue(
          Length.fromSheetUnits(sheetDefaultUnit, updated.center.y),
        );
        rxInputRef.current?.setDisplayValue(
          Length.fromSheetUnits(sheetDefaultUnit, updated.radiusX),
        );
        ryInputRef.current?.setDisplayValue(
          Length.fromSheetUnits(sheetDefaultUnit, updated.radiusY),
        );

        // Update less frequently updating fields by updating state directly
        //
        // NOTE: it's important to ensure that if these less frequently updated fields are NOT
        // changed, that this returns the old ref unchanged to avoid performance degredation.
        setEllipse((oldEllipse) => {
          if (!oldEllipse) {
            return null;
          }

          let newEllipse = oldEllipse;
          if (oldEllipse?.fillColor !== updated.fillColor) {
            newEllipse = { ...newEllipse, fillColor: updated.fillColor };
          }
          if (oldEllipse?.linkDimensions !== updated.linkDimensions) {
            newEllipse = { ...newEllipse, linkDimensions: updated.linkDimensions };
          }

          return newEllipse;
        });
      }
    };
    geometryStore.on('ellipsesChanged', handler);
    return () => {
      geometryStore.off('ellipsesChanged', handler);
    };
  }, [geometryStore, ellipseId]);

  useEffect(() => {
    const debouncedHandler = debounce((ellipses: Array<Ellipse>) => {
      const updated = ellipses.find((e) => e.id === ellipseId);
      if (updated) {
        setEllipse(updated);
      }
    }, GEOMETRY_UPDATE_DEBOUNCE_MS);

    geometryStore.on('ellipsesChanged', debouncedHandler);
    return () => {
      geometryStore.off('ellipsesChanged', debouncedHandler);
    };
  }, [geometryStore, ellipseId]);

  const handleConvertToPolygon = useCallback(() => {
    if (!ellipse?.id) {
      return;
    }
    actionsManager.execute('convert-to-polygon');
  }, [actionsManager, ellipse?.id]);

  const handleCXChange = useCallback(
    (len: Length) => {
      if (!ellipse?.id) {
        return;
      }
      const newCX = len.toSheetUnits(sheetDefaultUnit).magnitude;
      geometryStore.updateEllipse(ellipse.id, {
        center: new SheetPosition(newCX, ellipse.center.y),
      });
    },
    [geometryStore, ellipse?.id, ellipse?.center, sheetDefaultUnit],
  );

  const handleCYChange = useCallback(
    (len: Length) => {
      if (!ellipse?.id) {
        return;
      }
      const newCY = len.toSheetUnits(sheetDefaultUnit).magnitude;
      geometryStore.updateEllipse(ellipse.id, {
        center: new SheetPosition(ellipse.center.x, newCY),
      });
    },
    [geometryStore, ellipse?.id, ellipse?.center, sheetDefaultUnit],
  );

  const handleRXChange = useCallback(
    (len: Length) => {
      if (!ellipse?.id) {
        return;
      }
      const rx = len.toSheetUnits(sheetDefaultUnit).magnitude;
      if (ellipse.linkDimensions) {
        geometryStore.updateEllipse(ellipse.id, { radiusX: rx, radiusY: rx });
      } else {
        geometryStore.updateEllipse(ellipse.id, { radiusX: rx });
      }
    },
    [geometryStore, ellipse?.id, ellipse?.linkDimensions, sheetDefaultUnit],
  );

  const handleRYChange = useCallback(
    (len: Length) => {
      if (!ellipse?.id) {
        return;
      }
      const ry = len.toSheetUnits(sheetDefaultUnit).magnitude;
      if (ellipse.linkDimensions) {
        geometryStore.updateEllipse(ellipse.id, { radiusX: ry, radiusY: ry });
      } else {
        geometryStore.updateEllipse(ellipse.id, { radiusY: ry });
      }
    },
    [geometryStore, ellipse?.id, ellipse?.linkDimensions, sheetDefaultUnit],
  );

  const handleLinkToggle = useCallback(() => {
    if (!ellipse?.id) {
      return;
    }
    actionsManager.execute('toggle-link-dimensions');
  }, [actionsManager, ellipse?.id]);

  const handleFillChange = useCallback(
    (color: number | null) => {
      if (!ellipse?.id) {
        return;
      }
      geometryStore.setEllipseFillColor(ellipse.id, color);
    },
    [geometryStore, ellipse?.id],
  );

  const handleRenderOrderChange = useCallback(
    (val: number) => {
      if (!ellipse?.id) return;
      geometryStore.setEllipseRenderOrder(ellipse.id, val);
    },
    [geometryStore, ellipse?.id],
  );

  if (!ellipse) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-row justify-center w-full py-2">
        <div className="w-20 shrink-0 aspect-square overflow-hidden">
          <ShapePreview shape={ellipse} editingDimension={editingDimension} />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0 pr-8">
          <LabeledRow label="X:">
            <LengthInput
              ref={cxInputRef}
              value={Length.fromSheetUnits(sheetDefaultUnit, ellipse.center.x)}
              onChange={handleCXChange}
              onFocus={() => setEditingDimension('origin')}
              onBlur={() => setEditingDimension(null)}
              roundPlaces={sheetUnitPlaces}
              readOnlyUnit
            />
          </LabeledRow>
        </div>
        <div className="flex-1 min-w-0">
          <LabeledRow label="Y:">
            <LengthInput
              ref={cyInputRef}
              value={Length.fromSheetUnits(sheetDefaultUnit, ellipse.center.y)}
              onChange={handleCYChange}
              onFocus={() => setEditingDimension('origin')}
              onBlur={() => setEditingDimension(null)}
              roundPlaces={sheetUnitPlaces}
              readOnlyUnit
            />
          </LabeledRow>
        </div>
      </div>
      <div className="flex gap-2 items-center">
        <div className="flex-1 min-w-0">
          <LabeledRow label="RX:">
            <LengthInput
              ref={rxInputRef}
              value={Length.fromSheetUnits(sheetDefaultUnit, ellipse.radiusX)}
              onChange={handleRXChange}
              onFocus={() => setEditingDimension('radiusX')}
              onBlur={() => setEditingDimension(null)}
              roundPlaces={sheetUnitPlaces}
              readOnlyUnit
            />
          </LabeledRow>
        </div>
        <LinkButton linked={ellipse.linkDimensions} onToggle={handleLinkToggle} />
        <div className="flex-1 min-w-0">
          <LabeledRow label="RY:">
            <LengthInput
              ref={ryInputRef}
              value={Length.fromSheetUnits(sheetDefaultUnit, ellipse.radiusY)}
              onChange={handleRYChange}
              onFocus={() => setEditingDimension('radiusY')}
              onBlur={() => setEditingDimension(null)}
              roundPlaces={sheetUnitPlaces}
              readOnlyUnit
            />
          </LabeledRow>
        </div>
      </div>

      <CommonFields
        geometryId={ellipse.id}
        renderOrder={ellipse.renderOrder}
        fillColor={ellipse.fillColor}
        showFill={true}
        geometryStore={geometryStore}
        onRenderOrderChange={handleRenderOrderChange}
        onFillChange={handleFillChange}
      />
      <button
        type="button"
        onClick={handleConvertToPolygon}
        className="px-3 py-1.5 bg-[var(--slate-5)] text-[var(--slate-12)] text-sm rounded-[4px] border border-[var(--slate-5)] hover:border-[var(--slate-8)] transition-colors"
        style={{ fontFamily: 'var(--font-roboto-mono), monospace' }}
      >
        To polygon...
      </button>
    </div>
  );
};

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

/** The height of each PointRow depending on polygon type. Used for computing
 * {@link SplitPointIndicator} position. */
const POINT_ROW_HEIGHT_PX_BY_TYPE: { [key in PolygonSegment['type']]: number } = {
  'arc-cubic': 114,
  'arc-quadratic': 78,
  point: 42,
};

type PointRowRefs = {
  x: React.RefObject<LengthInputHandle | null>;
  y: React.RefObject<LengthInputHandle | null>;
};

type PointRowProps = {
  segment: PolygonSegment;
  index: number;
  polygonId: Id;
  sheetUnitPlaces: Sheet['unitPlaces'];
  sheetDefaultUnit: UnitType;
  geometryStore: GeometryStore;
  historyManager: HistoryManager;
  onXChange: (index: number, len: Length) => void;
  onYChange: (index: number, len: Length) => void;
  onControlPointChange: (
    index: number,
    pointKey: 'controlPoint' | 'controlPointA' | 'controlPointB',
    axis: 'x' | 'y',
    len: Length,
  ) => void;
  onDelete: (index: number) => void;
  onInsert: (index: number) => void;
  isHovered?: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  refs?: PointRowRefs;
};

const PointRow = memo<PointRowProps>(
  ({
    segment,
    index,
    polygonId,
    sheetUnitPlaces,
    sheetDefaultUnit,
    geometryStore,
    historyManager,
    onXChange,
    onYChange,
    onControlPointChange,
    onDelete,
    onInsert,
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
        <span
          className="w-4 h-4 flex items-center justify-center text-[10px] font-bold rounded-[4px] select-none"
          style={{ color: iconColor, fontFamily: 'var(--font-roboto-mono), monospace' }}
        >
          {iconLabel}
        </span>
        <div className="flex-1 px-1">
          {segment.type === 'point' ? (
            <div className="flex gap-4">
              <div className="w-24">
                <LengthInput
                  ref={refs?.x}
                  value={Length.fromSheetUnits(sheetDefaultUnit, segment.point.x)}
                  onChange={(len) => onXChange(index, len)}
                  roundPlaces={sheetUnitPlaces}
                  readOnlyUnit
                />
              </div>
              <div className="w-24">
                <LengthInput
                  ref={refs?.y}
                  value={Length.fromSheetUnits(sheetDefaultUnit, segment.point.y)}
                  onChange={(len) => onYChange(index, len)}
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
                    roundPlaces={sheetUnitPlaces}
                    readOnlyUnit
                  />
                </div>
                <div className="w-24">
                  <LengthInput
                    ref={refs?.y}
                    value={Length.fromSheetUnits(sheetDefaultUnit, segment.point.y)}
                    onChange={(len) => onYChange(index, len)}
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

/** Color which should be used in the shape preview to indicate the polygon open segment. */
const POLYGON_OPEN_SEGMENT_HIGHLIGHT_COLOR = 'var(--teal-10)';

const PolygonInspector: React.FunctionComponent<{
  polygonId: Id;
  geometryStore: GeometryStore;
  historyManager: HistoryManager;
  sheetUnitPlaces: Sheet['unitPlaces'];
  sheetDefaultUnit: UnitType;
  actionsManager: ActionsManager;
}> = ({
  polygonId,
  geometryStore,
  historyManager,
  sheetUnitPlaces,
  sheetDefaultUnit,
  actionsManager,
}) => {
  const [polygon, setPolygon] = useState<Polygon | null>(() =>
    geometryStore.getPolygonById(polygonId),
  );
  const [shapePreviewHighlight, setShapePreviewHighlight] = useState<ShapePreviewHighlight | null>(
    null,
  );
  const [editingDimension, setEditingDimension] = useState<ShapePreviewEditingDimension | null>(
    null,
  );
  const [openAtIndexDragging, setOpenAtIndexDragging] = useState(false);

  const pointInputRefs = useRef<Map<number, PointRowRefs>>(new Map());

  useEffect(() => {
    const polygon = geometryStore.getPolygonById(polygonId);
    if (polygon) {
      setPolygon(polygon);
    }
  }, [geometryStore, polygonId]);

  useEffect(() => {
    const handler = (polygons: Array<Polygon>) => {
      const updated = polygons.find((p) => p.id === polygonId);
      if (updated) {
        // Update frequently updating point fields directly via refs
        const refs = pointInputRefs.current;
        for (let i = 0; i < updated.points.length; i++) {
          const pointRef = refs.get(i);
          if (pointRef) {
            pointRef.x.current?.setDisplayValue(
              Length.fromSheetUnits(sheetDefaultUnit, updated.points[i].point.x),
            );
            pointRef.y.current?.setDisplayValue(
              Length.fromSheetUnits(sheetDefaultUnit, updated.points[i].point.y),
            );
          }
        }

        // Update less frequently updating fields by updating state directly
        //
        // NOTE: it's important to ensure that if these less frequently updated fields are NOT
        // changed, that this returns the old ref unchanged to avoid performance degredation.
        setPolygon((oldPolygon) => {
          if (!oldPolygon) {
            return null;
          }

          let newPolygon = oldPolygon;
          if (oldPolygon?.fillColor !== updated.fillColor) {
            newPolygon = { ...newPolygon, fillColor: updated.fillColor };
          }
          if (oldPolygon?.closed !== updated.closed) {
            newPolygon = { ...newPolygon, closed: updated.closed };
          }
          if (oldPolygon?.openAtIndex !== updated.openAtIndex) {
            newPolygon = { ...newPolygon, openAtIndex: updated.openAtIndex };
          }
          if (oldPolygon.points.length !== updated.points.length) {
            newPolygon = { ...newPolygon, points: updated.points };
          }

          return newPolygon;
        });
      }
    };
    geometryStore.on('polygonsChanged', handler);
    return () => {
      geometryStore.off('polygonsChanged', handler);
    };
  }, [geometryStore, polygonId]);

  useEffect(() => {
    const debouncedHandler = debounce((polygons: Array<Polygon>) => {
      const updated = polygons.find((p) => p.id === polygonId);
      if (updated) {
        setPolygon(updated);
      }
    }, GEOMETRY_UPDATE_DEBOUNCE_MS);

    geometryStore.on('polygonsChanged', debouncedHandler);
    return () => {
      geometryStore.off('polygonsChanged', debouncedHandler);
    };
  }, [geometryStore, polygonId]);

  const bounds = useMemo(
    () => (polygon ? boundingBox(polygon.points.map((s) => s.point)) : null),
    [polygon],
  );

  const handlePointXChange = useCallback(
    (index: number, len: Length) => {
      if (!polygon) return;
      const newX = len.toSheetUnits(sheetDefaultUnit).magnitude;
      geometryStore.updatePolygon(polygon.id, (prev) => {
        const segments = prev.points.map((s, i) => {
          if (i !== index) {
            return s;
          }
          return { ...s, point: new SheetPosition(newX, s.point.y) };
        });
        return { ...prev, points: segments };
      });
    },
    [geometryStore, polygon, sheetDefaultUnit],
  );

  const handlePointYChange = useCallback(
    (index: number, len: Length) => {
      if (!polygon) return;
      const newY = len.toSheetUnits(sheetDefaultUnit).magnitude;
      geometryStore.updatePolygon(polygon.id, (prev) => {
        const segments = prev.points.map((s, i) => {
          if (i !== index) {
            return s;
          }
          return { ...s, point: new SheetPosition(s.point.x, newY) };
        });
        return { ...prev, points: segments };
      });
    },
    [geometryStore, polygon, sheetDefaultUnit],
  );

  const handleDeletePoint = useCallback(
    (index: number) => {
      setPolygon((prev) => {
        if (!prev) return prev;
        const segments = prev.points.filter((_, i) => i !== index);
        geometryStore.updatePolygon(prev.id, { points: segments });
        return prev;
      });
    },
    [geometryStore],
  );

  const handleInsertPoint = useCallback(
    (index: number) => {
      setPolygon((prev) => {
        if (!prev) return prev;
        const seg = prev.points[index];
        const nextSeg = prev.points[index + 1];
        if (!seg || !nextSeg) return prev;
        const midX = (seg.point.x + nextSeg.point.x) / 2;
        const midY = (seg.point.y + nextSeg.point.y) / 2;
        geometryStore.addPointOnLineSegmentEdge(prev.id, index, new SheetPosition(midX, midY));
        return prev;
      });
    },
    [geometryStore],
  );

  const handleFillChange = useCallback(
    (color: number | null) => {
      if (!polygon) return;
      geometryStore.setPolygonFillColor(polygon.id, color);
    },
    [geometryStore, polygon],
  );

  const handleRenderOrderChange = useCallback(
    (val: number) => {
      if (!polygon?.id) return;
      geometryStore.setPolygonRenderOrder(polygon.id, val);
    },
    [geometryStore, polygon?.id],
  );

  const handleControlPointChange = useCallback(
    (
      index: number,
      pointKey: 'controlPoint' | 'controlPointA' | 'controlPointB',
      axis: 'x' | 'y',
      len: Length,
    ) => {
      if (!polygon) {
        return;
      }
      const beforePoint = (polygon.points[index] as any)[pointKey];
      const sheetVal = len.toSheetUnits(sheetDefaultUnit).magnitude;
      const afterPoint =
        axis === 'x'
          ? new SheetPosition(sheetVal, beforePoint.y)
          : new SheetPosition(beforePoint.x, sheetVal);

      historyManager.apply(
        UndoEntry.polygonMoveControlPoint(polygon.id, index, pointKey, beforePoint, afterPoint),
      );
    },
    [polygon, sheetDefaultUnit],
  );

  const handleBoundsXChange = useCallback(
    (len: Length) => {
      if (!polygon || !bounds) {
        return;
      }
      const newX = len.toSheetUnits(sheetDefaultUnit).magnitude;
      const deltaX = newX - bounds.position.x;
      if (deltaX === 0) {
        return;
      }

      historyManager.apply(UndoEntry.polygonTranslate(polygon.id, deltaX, 0));
    },
    [polygon, bounds, sheetDefaultUnit],
  );

  const handleBoundsYChange = useCallback(
    (len: Length) => {
      if (!polygon || !bounds) {
        return;
      }
      const newY = len.toSheetUnits(sheetDefaultUnit).magnitude;
      const deltaY = newY - bounds.position.y;
      if (deltaY === 0) {
        return;
      }

      historyManager.apply(UndoEntry.polygonTranslate(polygon.id, 0, deltaY));
    },
    [polygon, bounds, sheetDefaultUnit],
  );

  const handleBoundsWChange = useCallback(
    (len: Length) => {
      if (!polygon || !bounds) {
        return;
      }
      const newWidth = len.toSheetUnits(sheetDefaultUnit).magnitude;
      if (newWidth === bounds.width) {
        return;
      }

      const newBounds: Rect<SheetPosition> = {
        position: bounds.position,
        width: newWidth,
        height: bounds.height,
      };
      const afterSegments = interpolatePolygonPoints(polygon.points, bounds, newBounds);

      historyManager.apply(
        UndoEntry.polygonBoundingBoxResize(polygon.id, polygon.points, afterSegments),
      );
    },
    [polygon, bounds, sheetDefaultUnit],
  );

  const handleBoundsHChange = useCallback(
    (len: Length) => {
      if (!polygon || !bounds) {
        return;
      }
      const newHeight = len.toSheetUnits(sheetDefaultUnit).magnitude;
      if (newHeight === bounds.height) {
        return;
      }

      const newBounds: Rect<SheetPosition> = {
        position: bounds.position,
        width: bounds.width,
        height: newHeight,
      };
      const afterSegments = interpolatePolygonPoints(polygon.points, bounds, newBounds);

      historyManager.apply(
        UndoEntry.polygonBoundingBoxResize(polygon.id, polygon.points, afterSegments),
      );
    },
    [polygon, bounds, sheetDefaultUnit],
  );

  const handleCloseOpen = useCallback(() => {
    if (!polygon) return;
    if (polygon.closed) {
      actionsManager.execute('open-close-polygon');
      setOpenAtIndexDragging(false);
      setShapePreviewHighlight(null);
    } else {
      actionsManager.execute('open-close-polygon');
    }
  }, [actionsManager, polygon]);

  const handleOpenAtIndexDragStart = useCallback(() => {
    if (!polygon) {
      return;
    }
    setOpenAtIndexDragging(true);

    const initialOpenAtIndex = polygon.openAtIndex;
    let newOpenAtIndex = initialOpenAtIndex;
    let deltaYPx = 0;

    const onMouseMove = (e: MouseEvent) => {
      deltaYPx += e.movementY;

      let index = 0;
      if (deltaYPx < 0) {
        // Work backwards from the current `initialOpenAtIndex` to determine the new index
        for (
          let i = initialOpenAtIndex, offsetInPx = 0;
          i >= 0;
          [i, offsetInPx] = [
            i - 1,
            offsetInPx - POINT_ROW_HEIGHT_PX_BY_TYPE[polygon.points[i].type],
          ]
        ) {
          const rowHeightInPx = POINT_ROW_HEIGHT_PX_BY_TYPE[polygon.points[i].type];
          if (deltaYPx > offsetInPx - rowHeightInPx / 2) {
            index = i;
            break;
          }
        }
      } else {
        // Work forwards from the current `initialOpenAtIndex` to determine the new index
        for (
          let i = initialOpenAtIndex, offsetInPx = 0;
          i < polygon.points.length;
          [i, offsetInPx] = [
            i + 1,
            offsetInPx + POINT_ROW_HEIGHT_PX_BY_TYPE[polygon.points[i].type],
          ]
        ) {
          const rowHeightInPx = POINT_ROW_HEIGHT_PX_BY_TYPE[polygon.points[i].type];
          if (deltaYPx < offsetInPx + rowHeightInPx / 2) {
            index = i;
            break;
          }
        }
      }
      const bounded = Math.min(Math.max(index, 0), polygon.points.length);

      newOpenAtIndex = bounded;
      geometryStore.updatePolygon(polygon.id, { openAtIndex: newOpenAtIndex });
      setShapePreviewHighlight({
        type: 'segment',
        index: newOpenAtIndex,
        color: POLYGON_OPEN_SEGMENT_HIGHLIGHT_COLOR,
      });
    };

    window.addEventListener('mousemove', onMouseMove);

    const onMouseUp = () => {
      setOpenAtIndexDragging(false);
      setShapePreviewHighlight(null);

      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mouseup', onMouseUp);
  }, [polygon]);

  if (!polygon) {
    return null;
  }

  const displayedPoints = polygon.closed ? polygon.points.slice(0, -1) : polygon.points;

  return (
    <div className={cn('flex flex-col gap-3', { 'select-none': openAtIndexDragging })}>
      <div className="flex flex-row justify-center w-full py-2">
        <div className="w-20 shrink-0 aspect-square overflow-hidden">
          <ShapePreview
            shape={polygon}
            highlight={shapePreviewHighlight}
            editingDimension={editingDimension}
          />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-6">
          <div className="flex-1 min-w-0">
            <LabeledRow label="X:">
              <LengthInput
                value={Length.fromSheetUnits(sheetDefaultUnit, bounds ? bounds.position.x : 0)}
                onChange={handleBoundsXChange}
                roundPlaces={sheetUnitPlaces}
                readOnlyUnit
              />
            </LabeledRow>
          </div>
          <div className="flex-1 min-w-0">
            <LabeledRow label="Y:">
              <LengthInput
                value={Length.fromSheetUnits(sheetDefaultUnit, bounds ? bounds.position.y : 0)}
                onChange={handleBoundsYChange}
                roundPlaces={sheetUnitPlaces}
                readOnlyUnit
              />
            </LabeledRow>
          </div>
        </div>
        {bounds ? (
          <div className="flex items-center gap-6">
            <div className="flex-1 min-w-0">
              <LabeledRow label="W:">
                <LengthInput
                  value={Length.fromSheetUnits(sheetDefaultUnit, bounds.width)}
                  onChange={handleBoundsWChange}
                  onFocus={() => setEditingDimension('width')}
                  onBlur={() => setEditingDimension(null)}
                  roundPlaces={sheetUnitPlaces}
                  readOnlyUnit
                />
              </LabeledRow>
            </div>
            <div className="flex-1 min-w-0">
              <LabeledRow label="H:">
                <LengthInput
                  value={Length.fromSheetUnits(sheetDefaultUnit, bounds.height)}
                  onChange={handleBoundsHChange}
                  roundPlaces={sheetUnitPlaces}
                  readOnlyUnit
                />
              </LabeledRow>
            </div>
          </div>
        ) : null}
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <span
            className="text-[var(--slate-12)] text-sm font-medium"
            style={{ fontFamily: 'var(--font-roboto-mono), monospace' }}
          >
            Points:
          </span>
          <span className="text-xs text-[var(--slate-8)] font-mono">{polygon.points.length}</span>
        </div>
        <div className="flex flex-col max-h-40 -mx-3 overflow-y-auto">
          {displayedPoints.map((segment, index) => {
            let refs = pointInputRefs.current.get(index);
            if (!refs) {
              refs = { x: createRef<LengthInputHandle>(), y: createRef<LengthInputHandle>() };
              pointInputRefs.current.set(index, refs);
            }
            const pointRefs = refs;
            return (
              <Fragment key={index}>
                <PointRow
                  segment={segment}
                  index={index}
                  polygonId={polygon.id}
                  sheetUnitPlaces={sheetUnitPlaces}
                  sheetDefaultUnit={sheetDefaultUnit}
                  geometryStore={geometryStore}
                  historyManager={historyManager}
                  onXChange={handlePointXChange}
                  onYChange={handlePointYChange}
                  onControlPointChange={handleControlPointChange}
                  onDelete={handleDeletePoint}
                  onInsert={handleInsertPoint}
                  isHovered={
                    shapePreviewHighlight?.type === 'point' && shapePreviewHighlight.index === index
                  }
                  onMouseEnter={() => {
                    if (openAtIndexDragging) {
                      return;
                    }
                    setShapePreviewHighlight({ type: 'point', index });
                  }}
                  onMouseLeave={() => {
                    if (openAtIndexDragging) {
                      return;
                    }
                    setShapePreviewHighlight(null);
                  }}
                  refs={pointRefs}
                />

                {polygon.closed && polygon.openAtIndex === index ? (
                  <SplitPointIndicator
                    dragging={openAtIndexDragging}
                    onMouseEnter={() =>
                      setShapePreviewHighlight({
                        type: 'segment',
                        index: polygon.openAtIndex,
                        color: POLYGON_OPEN_SEGMENT_HIGHLIGHT_COLOR,
                      })
                    }
                    onMouseLeave={() => setShapePreviewHighlight(null)}
                    onMouseDown={handleOpenAtIndexDragStart}
                  />
                ) : null}
              </Fragment>
            );
          })}
        </div>
      </div>
      <CommonFields
        geometryId={polygon.id}
        renderOrder={polygon.renderOrder}
        fillColor={polygon.fillColor}
        showFill={polygon.closed}
        geometryStore={geometryStore}
        onRenderOrderChange={handleRenderOrderChange}
        onFillChange={handleFillChange}
      />
      <Button
        type="button"
        variant="secondary"
        onClick={handleCloseOpen}
        className={cn('w-full border border-2 border-transparent', {
          'hover:border-[var(--teal-5)]': polygon.closed,
        })}
        style={{ fontFamily: 'var(--font-roboto-mono), monospace' }}
        onMouseEnter={() => {
          if (polygon.closed) {
            setOpenAtIndexDragging(true);
            setShapePreviewHighlight({
              type: 'segment',
              index: polygon.openAtIndex,
              color: POLYGON_OPEN_SEGMENT_HIGHLIGHT_COLOR,
            });
          }
        }}
        onMouseLeave={() => {
          if (polygon.closed) {
            setOpenAtIndexDragging(false);
            setShapePreviewHighlight(null);
          }
        }}
      >
        {polygon.closed ? 'Open polygon' : 'Close polygon'}
      </Button>
    </div>
  );
};

const MultiSelectInspector: React.FunctionComponent<{
  selectedIds: Array<Id>;
  geometryStore: GeometryStore;
}> = ({ selectedIds, geometryStore }) => {
  const [fillColorValue, setFillColorValue] = useState<{ shared: boolean; value: unknown }>({
    shared: false,
    value: null,
  });
  const [renderOrderValue, setRenderOrderValue] = useState<number>(0);

  useEffect(() => {
    const updateFillColor = () => {
      const rects = selectedIds
        .map((id) => geometryStore.getRectangleById(id))
        .filter((r): r is Rectangle => r !== null);
      const ellipses = selectedIds
        .map((id) => geometryStore.getEllipseById(id))
        .filter((e): e is Ellipse => e !== null);
      const polygons = selectedIds
        .map((id) => geometryStore.getPolygonById(id))
        .filter((p): p is Polygon => p !== null);

      const allClosed = polygons.length === 0 || polygons.every((p) => p.closed);
      if (!allClosed && polygons.length > 0) {
        setFillColorValue({ shared: false, value: null });
        return;
      }

      if (rects.length > 0) {
        const colors = rects.map((r) => r.fillColor);
        setFillColorValue(getSharedValue(colors));
        return;
      }
      if (ellipses.length > 0) {
        const colors = ellipses.map((e) => e.fillColor);
        setFillColorValue(getSharedValue(colors));
        return;
      }
      if (polygons.length > 0 && allClosed) {
        const colors = polygons.map((p) => p.fillColor);
        setFillColorValue(getSharedValue(colors));
        return;
      }
      setFillColorValue({ shared: false, value: null });
    };

    updateFillColor();

    const rectHandler = () => updateFillColor();
    const ellHandler = () => updateFillColor();
    const polyHandler = () => updateFillColor();

    geometryStore.on('rectanglesChanged', rectHandler);
    geometryStore.on('ellipsesChanged', ellHandler);
    geometryStore.on('polygonsChanged', polyHandler);

    return () => {
      geometryStore.off('rectanglesChanged', rectHandler);
      geometryStore.off('ellipsesChanged', ellHandler);
      geometryStore.off('polygonsChanged', polyHandler);
    };
  }, [geometryStore, selectedIds]);

  useEffect(() => {
    const updateRenderOrder = () => {
      const rects = selectedIds
        .map((id) => geometryStore.getRectangleById(id))
        .filter((r): r is Rectangle => r !== null);
      const ellipses = selectedIds
        .map((id) => geometryStore.getEllipseById(id))
        .filter((e): e is Ellipse => e !== null);
      const polygons = selectedIds
        .map((id) => geometryStore.getPolygonById(id))
        .filter((p): p is Polygon => p !== null);

      if (rects.length > 0) {
        setRenderOrderValue(rects[0].renderOrder);
        return;
      }
      if (ellipses.length > 0) {
        setRenderOrderValue(ellipses[0].renderOrder);
        return;
      }
      if (polygons.length > 0) {
        setRenderOrderValue(polygons[0].renderOrder);
        return;
      }
    };

    updateRenderOrder();

    const rectHandler = () => updateRenderOrder();
    const ellHandler = () => updateRenderOrder();
    const polyHandler = () => updateRenderOrder();

    geometryStore.on('rectanglesChanged', rectHandler);
    geometryStore.on('ellipsesChanged', ellHandler);
    geometryStore.on('polygonsChanged', polyHandler);

    return () => {
      geometryStore.off('rectanglesChanged', rectHandler);
      geometryStore.off('ellipsesChanged', ellHandler);
      geometryStore.off('polygonsChanged', polyHandler);
    };
  }, [geometryStore, selectedIds]);

  const handleFillChange = useCallback(
    (color: number | null) => {
      for (const id of selectedIds) {
        const rect = geometryStore.getRectangleById(id);
        if (rect) {
          geometryStore.setRectangleFillColor(rect.id, color);
        }
        const ellipse = geometryStore.getEllipseById(id);
        if (ellipse) {
          geometryStore.setEllipseFillColor(ellipse.id, color);
        }
        const polygon = geometryStore.getPolygonById(id);
        if (polygon && polygon.closed) {
          geometryStore.setPolygonFillColor(polygon.id, color);
        }
      }
    },
    [geometryStore, selectedIds],
  );

  const handleRenderOrderChange = useCallback(
    (val: number) => {
      setRenderOrderValue(val);
      for (const id of selectedIds) {
        const rect = geometryStore.getRectangleById(id);
        if (rect) {
          geometryStore.setRectangleRenderOrder(rect.id, val);
        }
        const ellipse = geometryStore.getEllipseById(id);
        if (ellipse) {
          geometryStore.setEllipseRenderOrder(ellipse.id, val);
        }
        const polygon = geometryStore.getPolygonById(id);
        if (polygon) {
          geometryStore.setPolygonRenderOrder(polygon.id, val);
        }
      }
    },
    [geometryStore, selectedIds],
  );

  return (
    <div className="flex flex-col gap-3">
      <LabeledRow label="Render order:">
        <RenderOrderInput
          key={selectedIds.join(',')}
          value={renderOrderValue}
          onChange={handleRenderOrderChange}
          geometryStore={geometryStore}
        />
      </LabeledRow>
      <LabeledRow label="Fill:">
        <ColorInput
          openDirection="up"
          value={fillColorValue.shared ? (fillColorValue.value as number | null) : null}
          onChange={handleFillChange}
        />
      </LabeledRow>
    </div>
  );
};

export default function SelectionInspector({
  sheet,
  geometryStore,
  selectionManager,
  historyManager,
  actionsManager,
}: SelectionInspectorProps) {
  const [selectedIds, setSelectedIds] = useState<Array<Id>>(() =>
    selectionManager.getSelectedIds(),
  );
  useEffect(() => {
    selectionManager.on('selectionChange', setSelectedIds);
    return () => {
      selectionManager.off('selectionChange', setSelectedIds);
    };
  }, [selectionManager]);

  const sheetDefaultUnit = sheet.defaultUnit;
  const [sheetUnitPlaces, setSheetUnitPlaces] = useState(sheet.unitPlaces);
  useEffect(() => {
    sheet.on('unitPlacesChanged', setSheetUnitPlaces);
    return () => {
      sheet.off('unitPlacesChanged', setSheetUnitPlaces);
    };
  }, [sheet]);

  if (selectedIds.length === 0) {
    return null;
  }

  const rectangleIds = selectedIds.filter((id) => geometryStore.getRectangleById(id) !== null);
  const ellipseIds = selectedIds.filter((id) => geometryStore.getEllipseById(id) !== null);
  const polygonIds = selectedIds.filter((id) => geometryStore.getPolygonById(id) !== null);

  const singleRectangle =
    rectangleIds.length === 1 && ellipseIds.length === 0 && polygonIds.length === 0;
  const singleEllipse =
    ellipseIds.length === 1 && rectangleIds.length === 0 && polygonIds.length === 0;
  const singlePolygon =
    polygonIds.length === 1 && rectangleIds.length === 0 && ellipseIds.length === 0;
  const multiSelect = selectedIds.length > 1;

  if (rectangleIds.length === 0 && ellipseIds.length === 0 && polygonIds.length === 0) {
    return null;
  }

  return (
    <div className="absolute right-4 bottom-4 z-30 w-[320px]">
      <FloatingPanel>
        {singleRectangle && (
          <RectangleInspector
            rectangleId={rectangleIds[0]}
            geometryStore={geometryStore}
            selectionManager={selectionManager}
            sheetUnitPlaces={sheetUnitPlaces}
            sheetDefaultUnit={sheetDefaultUnit}
            actionsManager={actionsManager}
          />
        )}
        {singleEllipse && (
          <EllipseInspector
            ellipseId={ellipseIds[0]}
            geometryStore={geometryStore}
            selectionManager={selectionManager}
            sheetUnitPlaces={sheetUnitPlaces}
            sheetDefaultUnit={sheetDefaultUnit}
            actionsManager={actionsManager}
          />
        )}
        {singlePolygon && (
          <PolygonInspector
            polygonId={polygonIds[0]}
            geometryStore={geometryStore}
            historyManager={historyManager}
            sheetUnitPlaces={sheetUnitPlaces}
            sheetDefaultUnit={sheetDefaultUnit}
            actionsManager={actionsManager}
          />
        )}
        {multiSelect && (
          <MultiSelectInspector selectedIds={selectedIds} geometryStore={geometryStore} />
        )}
      </FloatingPanel>
    </div>
  );
}
