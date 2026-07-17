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
import { useGeometriesById } from '@/hooks/useGeometryById';
import { ActionsManager } from '@/lib/actions/ActionsManager';
import {
  EllipseComponent,
  Entity,
  FillColorComponent,
  type Id,
  LinkDimensionsComponent,
  type Polygon,
  PolygonComponent,
  type PolygonSegment,
  RectangleComponent,
  RenderOrderComponent,
} from '@/lib/entity';
import { GeometryStore } from '@/lib/entity/GeometryStore';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { UndoEntry } from '@/lib/history/types';
import { BoundingBox } from '@/lib/math';
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

/** Listening to a full fidelity stream of geometry update events and rerendering on each event
 * update is probhibitively expensive, especially for geometry moves which can easily be sent many
 * tens of times per seconds. So, debounce the event stream to speed things up. */
const GEOMETRY_UPDATE_DEBOUNCE_MS = 250;

const RectangleInspector: React.FunctionComponent<{
  rectangleId: Id;
  geometryStore: GeometryStore;
  sheetUnitPlaces: Sheet['unitPlaces'];
  sheetDefaultUnit: UnitType;
  actionsManager: ActionsManager;
}> = ({ rectangleId, geometryStore, sheetUnitPlaces, sheetDefaultUnit, actionsManager }) => {
  const [geometry, setGeometry] = useState<Entity<
    RectangleComponent & LinkDimensionsComponent
  > | null>(null);
  const rectangle = useMemo(() => (geometry ? RectangleComponent.get(geometry) : null), [geometry]);
  const linkDimensions = useMemo(
    () => (geometry ? LinkDimensionsComponent.get(geometry) : null),
    [geometry],
  );
  useEffect(() => {
    const geom = geometryStore.getById(rectangleId);
    if (geom && Entity.hasComponents(geom, RectangleComponent, LinkDimensionsComponent)) {
      setGeometry(geom);
    }
  }, [geometryStore, rectangleId]);

  const [editingDimension, setEditingDimension] = useState<ShapePreviewEditingDimension | null>(
    null,
  );

  // On every state update, manually write to the input fields
  //
  // When moving a rectangle, these updates can come fast enough where actually going through the
  // whole react render loop can add a lot of latency and add non trivial amounts of lag to the
  // application.
  const xInputRef = useRef<LengthInputHandle>(null);
  const yInputRef = useRef<LengthInputHandle>(null);
  const wInputRef = useRef<LengthInputHandle>(null);
  const hInputRef = useRef<LengthInputHandle>(null);
  useEffect(() => {
    const handler = (geometry: Entity) => {
      if (geometry.id !== rectangleId || !Entity.hasComponent(geometry, RectangleComponent)) {
        return;
      }
      const updated = RectangleComponent.get(geometry);

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
    };
    geometryStore.on('geometryUpdated', handler);
    return () => {
      geometryStore.off('geometryUpdated', handler);
    };
  }, [geometryStore, rectangleId]);

  useEffect(() => {
    const debouncedHandler = debounce((geometry: Entity) => {
      if (
        geometry.id !== rectangleId ||
        !Entity.hasComponent(geometry, RectangleComponent) ||
        !Entity.hasComponent(geometry, LinkDimensionsComponent)
      ) {
        return;
      }
      setGeometry(geometry);
    }, GEOMETRY_UPDATE_DEBOUNCE_MS);

    geometryStore.on('geometryUpdated', debouncedHandler);
    return () => {
      geometryStore.off('geometryUpdated', debouncedHandler);
    };
  }, [geometryStore, rectangleId]);

  const width = rectangle ? rectangle.lowerRight.x - rectangle.upperLeft.x : 0;
  const height = rectangle ? rectangle.lowerRight.y - rectangle.upperLeft.y : 0;

  const handleConvertToPolygon = useCallback(() => {
    if (!rectangle) {
      return;
    }
    actionsManager.execute('convert-to-polygon');
  }, [actionsManager, rectangle]);

  const handleXChange = useCallback(
    (len: Length) => {
      if (!rectangle) {
        return;
      }
      const newX = len.toSheetUnits(sheetDefaultUnit).magnitude;
      const deltaX = newX - rectangle.upperLeft.x;

      const upperLeft = new SheetPosition(newX, rectangle.upperLeft.y);
      const lowerRight = new SheetPosition(rectangle.lowerRight.x + deltaX, rectangle.lowerRight.y);
      geometryStore.updateByIdWithComponent(rectangleId, RectangleComponent, (old) =>
        RectangleComponent.update(old, { upperLeft, lowerRight }),
      );
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
      const upperLeft = new SheetPosition(rectangle.upperLeft.x, newY);
      const lowerRight = new SheetPosition(rectangle.lowerRight.x, rectangle.lowerRight.y + deltaY);
      geometryStore.updateByIdWithComponent(rectangleId, RectangleComponent, (old) =>
        RectangleComponent.update(old, { upperLeft, lowerRight }),
      );
    },
    [geometryStore, rectangle, sheetDefaultUnit],
  );

  const handleWChange = useCallback(
    (len: Length) => {
      if (!rectangle || typeof linkDimensions !== 'boolean') {
        return;
      }
      const w = len.toSheetUnits(sheetDefaultUnit).magnitude;

      let newLowerRight = new SheetPosition(rectangle.upperLeft.x + w, rectangle.lowerRight.y);
      if (linkDimensions) {
        newLowerRight.y = rectangle.upperLeft.y + w;
      }

      geometryStore.updateByIdWithComponent(rectangleId, RectangleComponent, (old) =>
        RectangleComponent.update(old, { lowerRight: newLowerRight }),
      );
    },
    [geometryStore, rectangleId, rectangle, linkDimensions, sheetDefaultUnit],
  );

  const handleHChange = useCallback(
    (len: Length) => {
      if (!rectangle) {
        return;
      }
      const h = len.toSheetUnits(sheetDefaultUnit).magnitude;

      let newLowerRight = new SheetPosition(rectangle.lowerRight.x, rectangle.upperLeft.y + h);
      if (linkDimensions) {
        newLowerRight.x = rectangle.upperLeft.x + h;
      }

      geometryStore.updateByIdWithComponent(rectangleId, RectangleComponent, (old) =>
        RectangleComponent.update(old, { lowerRight: newLowerRight }),
      );
    },
    [geometryStore, rectangleId, rectangle, linkDimensions, sheetDefaultUnit],
  );

  const handleLinkToggle = useCallback(() => {
    if (!rectangle) {
      return;
    }
    actionsManager.execute('toggle-link-dimensions');
  }, [actionsManager, rectangle]);

  if (!rectangle) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-row justify-center w-full py-2">
        <div className="w-20 shrink-0 aspect-square overflow-hidden">
          {geometry ? <ShapePreview shape={geometry} editingDimension={editingDimension} /> : null}
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
        <LinkButton linked={linkDimensions ?? false} onToggle={handleLinkToggle} />
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
  sheetUnitPlaces: Sheet['unitPlaces'];
  sheetDefaultUnit: UnitType;
  actionsManager: ActionsManager;
}> = ({ ellipseId, geometryStore, sheetUnitPlaces, sheetDefaultUnit, actionsManager }) => {
  const [geometry, setGeometry] = useState<Entity<
    EllipseComponent & LinkDimensionsComponent
  > | null>(null);
  const ellipse = useMemo(() => (geometry ? EllipseComponent.get(geometry) : null), [geometry]);
  const linkDimensions = useMemo(
    () => (geometry ? LinkDimensionsComponent.get(geometry) : null),
    [geometry],
  );
  useEffect(() => {
    const geom = geometryStore.getById(ellipseId);
    if (geom && Entity.hasComponents(geom, EllipseComponent, LinkDimensionsComponent)) {
      setGeometry(geom);
    }
  }, [geometryStore, ellipseId]);

  const [editingDimension, setEditingDimension] = useState<ShapePreviewEditingDimension | null>(
    null,
  );

  // On every state update, manually write to the input fields
  //
  // When moving a ellipse, these updates can come fast enough where actually going through the
  // whole react render loop can add a lot of latency and add non trivial amounts of lag to the
  // application.
  const cxInputRef = useRef<LengthInputHandle>(null);
  const cyInputRef = useRef<LengthInputHandle>(null);
  const rxInputRef = useRef<LengthInputHandle>(null);
  const ryInputRef = useRef<LengthInputHandle>(null);
  useEffect(() => {
    const handler = (geometry: Entity) => {
      if (geometry.id !== ellipseId || !Entity.hasComponent(geometry, EllipseComponent)) {
        return;
      }
      const updated = EllipseComponent.get(geometry);

      // Update frequently updating fields directly via refs
      cxInputRef.current?.setDisplayValue(
        Length.fromSheetUnits(sheetDefaultUnit, updated.center.x),
      );
      cyInputRef.current?.setDisplayValue(
        Length.fromSheetUnits(sheetDefaultUnit, updated.center.y),
      );
      rxInputRef.current?.setDisplayValue(Length.fromSheetUnits(sheetDefaultUnit, updated.radiusX));
      ryInputRef.current?.setDisplayValue(Length.fromSheetUnits(sheetDefaultUnit, updated.radiusY));
    };
    geometryStore.on('geometryUpdated', handler);
    return () => {
      geometryStore.off('geometryUpdated', handler);
    };
  }, [geometryStore, ellipseId]);

  useEffect(() => {
    const debouncedHandler = debounce((geometry: Entity) => {
      if (
        geometry.id !== ellipseId ||
        !Entity.hasComponents(geometry, EllipseComponent, LinkDimensionsComponent)
      ) {
        return;
      }
      setGeometry(geometry);
    }, GEOMETRY_UPDATE_DEBOUNCE_MS);

    geometryStore.on('geometryUpdated', debouncedHandler);
    return () => {
      geometryStore.off('geometryUpdated', debouncedHandler);
    };
  }, [geometryStore, ellipseId]);

  const handleConvertToPolygon = useCallback(() => {
    if (!geometry?.id) {
      return;
    }
    actionsManager.execute('convert-to-polygon');
  }, [actionsManager, geometry?.id]);

  const handleCXChange = useCallback(
    (len: Length) => {
      if (!ellipse) {
        return;
      }
      const newCX = len.toSheetUnits(sheetDefaultUnit).magnitude;
      geometryStore.updateByIdWithComponent(ellipseId, EllipseComponent, (old) =>
        EllipseComponent.update(old, {
          center: new SheetPosition(newCX, EllipseComponent.get(old).center.y),
        }),
      );
    },
    [geometryStore, ellipseId, sheetDefaultUnit],
  );

  const handleCYChange = useCallback(
    (len: Length) => {
      if (!ellipse) {
        return;
      }
      const newCY = len.toSheetUnits(sheetDefaultUnit).magnitude;
      geometryStore.updateByIdWithComponent(ellipseId, EllipseComponent, (old) =>
        EllipseComponent.update(old, {
          center: new SheetPosition(EllipseComponent.get(old).center.x, newCY),
        }),
      );
    },
    [geometryStore, ellipseId, sheetDefaultUnit],
  );

  const handleRXChange = useCallback(
    (len: Length) => {
      if (!ellipse || typeof linkDimensions !== 'boolean') {
        return;
      }
      const rx = len.toSheetUnits(sheetDefaultUnit).magnitude;
      if (linkDimensions) {
        geometryStore.updateByIdWithComponent(ellipseId, EllipseComponent, (old) =>
          EllipseComponent.update(old, { radiusX: rx, radiusY: rx }),
        );
      } else {
        geometryStore.updateByIdWithComponent(ellipseId, EllipseComponent, (old) =>
          EllipseComponent.update(old, { radiusX: rx }),
        );
      }
    },
    [geometryStore, ellipseId, ellipse, linkDimensions, sheetDefaultUnit],
  );

  const handleRYChange = useCallback(
    (len: Length) => {
      if (!ellipse || typeof linkDimensions !== 'boolean') {
        return;
      }
      const ry = len.toSheetUnits(sheetDefaultUnit).magnitude;
      if (linkDimensions) {
        geometryStore.updateByIdWithComponent(ellipseId, EllipseComponent, (old) =>
          EllipseComponent.update(old, { radiusX: ry, radiusY: ry }),
        );
      } else {
        geometryStore.updateByIdWithComponent(ellipseId, EllipseComponent, (old) =>
          EllipseComponent.update(old, { radiusY: ry }),
        );
      }
    },
    [geometryStore, ellipseId, ellipse, linkDimensions, sheetDefaultUnit],
  );

  const handleLinkToggle = useCallback(() => {
    if (!ellipse) {
      return;
    }
    actionsManager.execute('toggle-link-dimensions');
  }, [actionsManager, ellipse]);

  if (!ellipse) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-row justify-center w-full py-2">
        <div className="w-20 shrink-0 aspect-square overflow-hidden">
          {geometry ? <ShapePreview shape={geometry} editingDimension={editingDimension} /> : null}
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
        <LinkButton linked={linkDimensions ?? false} onToggle={handleLinkToggle} />
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
  sheetUnitPlaces: Sheet['unitPlaces'];
  sheetDefaultUnit: UnitType;
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
    sheetUnitPlaces,
    sheetDefaultUnit,
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
  const [polygon, setPolygon] = useState<Entity<PolygonComponent> | null>(() =>
    geometryStore.getByIdWithComponent(polygonId, PolygonComponent),
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
    const polygon = geometryStore.getByIdWithComponent(polygonId, PolygonComponent);
    if (polygon) {
      setPolygon(polygon);
    }
  }, [geometryStore, polygonId]);

  useEffect(() => {
    const handler = (updated: Entity) => {
      if (updated.id !== polygonId || !Entity.hasComponent(updated, PolygonComponent)) {
        return;
      }
      const updatedData = PolygonComponent.get(updated);
      // Update frequently updating point fields directly via refs
      const refs = pointInputRefs.current;
      for (let i = 0; i < updatedData.points.length; i++) {
        const pointRef = refs.get(i);
        if (pointRef) {
          pointRef.x.current?.setDisplayValue(
            Length.fromSheetUnits(sheetDefaultUnit, updatedData.points[i].point.x),
          );
          pointRef.y.current?.setDisplayValue(
            Length.fromSheetUnits(sheetDefaultUnit, updatedData.points[i].point.y),
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

        const oldData = PolygonComponent.get(oldPolygon);
        let newPolygon = oldPolygon;
        if (
          Entity.hasComponent(newPolygon, FillColorComponent) &&
          Entity.hasComponent(updated, FillColorComponent)
        ) {
          if (
            FillColorComponent.getOptional(oldPolygon) !== FillColorComponent.getOptional(updated)
          ) {
            newPolygon = FillColorComponent.update(newPolygon, FillColorComponent.get(updated));
          }
        }
        if (
          oldData.closed !== updatedData.closed ||
          oldData.openAtIndex !== updatedData.openAtIndex ||
          oldData.points.length !== updatedData.points.length
        ) {
          newPolygon = PolygonComponent.update(newPolygon, updatedData);
        }

        return newPolygon;
      });
    };
    geometryStore.on('geometryUpdated', handler);
    return () => {
      geometryStore.off('geometryUpdated', handler);
    };
  }, [geometryStore, polygonId]);

  useEffect(() => {
    const debouncedHandler = debounce((geometry: Entity) => {
      if (geometry.id !== polygonId || !Entity.hasComponent(geometry, PolygonComponent)) {
        return;
      }
      setPolygon(geometry as Polygon);
    }, GEOMETRY_UPDATE_DEBOUNCE_MS);

    geometryStore.on('geometryUpdated', debouncedHandler);
    return () => {
      geometryStore.off('geometryUpdated', debouncedHandler);
    };
  }, [geometryStore, polygonId]);

  const bounds = useMemo(
    () =>
      polygon
        ? BoundingBox.fromPoints(PolygonComponent.get(polygon).points.map((s) => s.point))
        : null,
    [polygon],
  );

  const handlePointXChange = useCallback(
    (index: number, len: Length) => {
      if (!polygon) {
        return;
      }
      const newX = len.toSheetUnits(sheetDefaultUnit).magnitude;
      geometryStore.updateByIdWithComponent(polygon.id, PolygonComponent, (prev) => {
        const prevData = PolygonComponent.get(prev);
        const segments = prevData.points.map((s, i) => {
          // First point of closed polygons updates the first and last points
          if (prevData.closed && index === 0 && (i === 0 || i === prevData.points.length - 1)) {
            return { ...s, point: new SheetPosition(newX, s.point.y) };
          }

          // Just update regular points normally
          if (i === index) {
            return { ...s, point: new SheetPosition(newX, s.point.y) };
          }

          return s;
        });
        return PolygonComponent.update(prev, {
          points: segments,
        });
      });
    },
    [geometryStore, polygon, sheetDefaultUnit],
  );

  const handlePointYChange = useCallback(
    (index: number, len: Length) => {
      if (!polygon) return;
      const newY = len.toSheetUnits(sheetDefaultUnit).magnitude;
      geometryStore.updateByIdWithComponent(polygon.id, PolygonComponent, (prev) => {
        const prevData = PolygonComponent.get(prev);
        const segments = prevData.points.map((s, i) => {
          if (i !== index) {
            return s;
          }
          return { ...s, point: new SheetPosition(s.point.x, newY) };
        });
        return PolygonComponent.update(prev, {
          points: segments,
        });
      });
    },
    [geometryStore, polygon, sheetDefaultUnit],
  );

  const handleDeletePoint = useCallback(
    (index: number) => {
      setPolygon((prev) => {
        if (!prev) {
          return prev;
        }
        geometryStore.updateByIdWithComponent(prev.id, PolygonComponent, (old) => {
          const oldData = PolygonComponent.get(old);
          return PolygonComponent.update(old, {
            points: oldData.points.filter((_, i) => i !== index),
          });
        });
        return prev;
      });
    },
    [geometryStore],
  );

  const handleInsertPoint = useCallback(
    (index: number) => {
      setPolygon((prev) => {
        if (!prev) {
          return prev;
        }
        const prevData = PolygonComponent.get(prev);
        const seg = prevData.points[index];
        const nextSeg = prevData.points[index + 1];
        if (!seg || !nextSeg) {
          return prev;
        }
        const midX = (seg.point.x + nextSeg.point.x) / 2;
        const midY = (seg.point.y + nextSeg.point.y) / 2;
        geometryStore.addPointOnLineSegmentEdge(prev.id, index, new SheetPosition(midX, midY));
        return prev;
      });
    },
    [geometryStore],
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
      const polygonData = PolygonComponent.get(polygon);
      const beforePoint = (polygonData.points[index] as any)[pointKey];
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
      const polygonData = PolygonComponent.get(polygon);
      const afterSegments = BoundingBox.interpolatePoints(polygonData.points, bounds, newBounds);

      historyManager.apply(
        UndoEntry.polygonBoundingBoxResize(polygon.id, polygonData.points, afterSegments),
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
      const polygonData = PolygonComponent.get(polygon);
      const afterSegments = BoundingBox.interpolatePoints(polygonData.points, bounds, newBounds);

      historyManager.apply(
        UndoEntry.polygonBoundingBoxResize(polygon.id, polygonData.points, afterSegments),
      );
    },
    [polygon, bounds, sheetDefaultUnit],
  );

  const handleCloseOpen = useCallback(() => {
    if (!polygon) return;
    const polygonData = PolygonComponent.get(polygon);
    if (polygonData.closed) {
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

    const polygonData = PolygonComponent.get(polygon);
    const initialOpenAtIndex = polygonData.openAtIndex;
    const initialPoints = polygonData.points;
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
          [i, offsetInPx] = [i - 1, offsetInPx - POINT_ROW_HEIGHT_PX_BY_TYPE[initialPoints[i].type]]
        ) {
          const rowHeightInPx = POINT_ROW_HEIGHT_PX_BY_TYPE[initialPoints[i].type];
          if (deltaYPx > offsetInPx - rowHeightInPx / 2) {
            index = i;
            break;
          }
        }
      } else {
        // Work forwards from the current `initialOpenAtIndex` to determine the new index
        for (
          let i = initialOpenAtIndex, offsetInPx = 0;
          i < initialPoints.length;
          [i, offsetInPx] = [i + 1, offsetInPx + POINT_ROW_HEIGHT_PX_BY_TYPE[initialPoints[i].type]]
        ) {
          const rowHeightInPx = POINT_ROW_HEIGHT_PX_BY_TYPE[initialPoints[i].type];
          if (deltaYPx < offsetInPx + rowHeightInPx / 2) {
            index = i;
            break;
          }
        }
      }
      const bounded = Math.min(Math.max(index, 0), initialPoints.length);

      newOpenAtIndex = bounded;
      geometryStore.updateByIdWithComponentDirect(polygon.id, PolygonComponent, (old) =>
        PolygonComponent.update(old, {
          openAtIndex: newOpenAtIndex,
        }),
      );
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

      // After the update is complete, then push the history event once, so a single ctrl+z undos
      // back to the initial state.
      historyManager.push(
        UndoEntry.polygonOpenAtIndex(polygon.id, initialOpenAtIndex, newOpenAtIndex),
      );

      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mouseup', onMouseUp);
  }, [polygon]);

  if (!polygon) {
    return null;
  }

  const polygonData = PolygonComponent.get(polygon);
  const displayedPoints = polygonData.closed ? polygonData.points.slice(0, -1) : polygonData.points;

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
          <span className="text-xs text-[var(--slate-8)] font-mono">
            {polygonData.points.length}
          </span>
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
                  sheetUnitPlaces={sheetUnitPlaces}
                  sheetDefaultUnit={sheetDefaultUnit}
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

                {polygonData.closed && polygonData.openAtIndex === index ? (
                  <SplitPointIndicator
                    dragging={openAtIndexDragging}
                    onMouseEnter={() =>
                      setShapePreviewHighlight({
                        type: 'segment',
                        index: polygonData.openAtIndex,
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
      <Button
        type="button"
        variant="secondary"
        onClick={handleCloseOpen}
        className={cn('w-full border border-2 border-transparent', {
          'hover:border-[var(--teal-5)]': polygonData.closed,
        })}
        style={{ fontFamily: 'var(--font-roboto-mono), monospace' }}
        onMouseEnter={() => {
          if (polygonData.closed) {
            setOpenAtIndexDragging(true);
            setShapePreviewHighlight({
              type: 'segment',
              index: polygonData.openAtIndex,
              color: POLYGON_OPEN_SEGMENT_HIGHLIGHT_COLOR,
            });
          }
        }}
        onMouseLeave={() => {
          if (polygonData.closed) {
            setOpenAtIndexDragging(false);
            setShapePreviewHighlight(null);
          }
        }}
      >
        {polygonData.closed ? 'Open polygon' : 'Close polygon'}
      </Button>
    </div>
  );
};

const SelectionInspector: React.FunctionComponent<SelectionInspectorProps> = ({
  sheet,
  geometryStore,
  selectionManager,
  historyManager,
  actionsManager,
}) => {
  const [selectedIds, setSelectedIds] = useState<Array<Id>>(() =>
    selectionManager.getSelectedIds(),
  );
  useEffect(() => {
    selectionManager.on('selectionChange', setSelectedIds);
    return () => {
      selectionManager.off('selectionChange', setSelectedIds);
    };
  }, [selectionManager]);

  const selectedGeometries = useGeometriesById(geometryStore, selectedIds);

  const sheetDefaultUnit = sheet.defaultUnit;
  const [sheetUnitPlaces, setSheetUnitPlaces] = useState(sheet.unitPlaces);
  useEffect(() => {
    sheet.on('unitPlacesChanged', setSheetUnitPlaces);
    return () => {
      sheet.off('unitPlacesChanged', setSheetUnitPlaces);
    };
  }, [sheet]);

  const [singleRectangle, singleEllipse, singlePolygon] = useMemo(() => {
    const rectangles = Array.from(selectedGeometries.values()).filter(
      (g): g is Entity<RectangleComponent> => Entity.hasComponent(g, RectangleComponent),
    );
    const ellipses = Array.from(selectedGeometries.values()).filter(
      (g): g is Entity<EllipseComponent> => Entity.hasComponent(g, EllipseComponent),
    );
    const polygons = Array.from(selectedGeometries.values()).filter(
      (g): g is Entity<PolygonComponent> => Entity.hasComponent(g, PolygonComponent),
    );

    const singleRectangle =
      rectangles.length === 1 && ellipses.length === 0 && polygons.length === 0
        ? rectangles[0]
        : null;
    const singleEllipse =
      ellipses.length === 1 && rectangles.length === 0 && polygons.length === 0
        ? ellipses[0]
        : null;
    const singlePolygon =
      polygons.length === 1 && rectangles.length === 0 && ellipses.length === 0
        ? polygons[0]
        : null;
    return [singleRectangle, singleEllipse, singlePolygon];
  }, [selectedGeometries]);

  // "non-homogenous" means the value is set differently across all selected geometries
  // "not-all" means that some selected geometries do NOT have that component
  const getCombinedComponentValue = useCallback(
    <V = unknown,>(Component: {
      key: string;
      get: (geometry: Entity<any>) => V;
    }): { type: 'value'; value: V } | { type: 'not-all' } | { type: 'non-homogenous' } => {
      let firstValue: V | undefined;
      for (const geometry of selectedGeometries.values()) {
        if (!Entity.hasComponent(geometry, Component)) {
          return { type: 'not-all' };
        }

        const value = Component.get(geometry);
        if (typeof firstValue === 'undefined') {
          firstValue = value;
          continue;
        } else if (firstValue !== value) {
          return { type: 'non-homogenous' };
        }
      }

      return typeof firstValue !== 'undefined'
        ? { type: 'value', value: firstValue }
        : { type: 'not-all' };
    },
    [selectedGeometries],
  );

  const fillColor = getCombinedComponentValue(FillColorComponent);
  const handleFillChange = useCallback(
    (color: number | null) => {
      // FIXME: wrap in history transaction?
      for (const id of selectedIds) {
        geometryStore.setFillColor(id, color);
      }
    },
    [geometryStore, selectedIds],
  );

  const renderOrder = getCombinedComponentValue(RenderOrderComponent);
  const handleRenderOrderChange = useCallback(
    (renderOrder: number) => {
      // FIXME: wrap in history transaction?
      for (const id of selectedIds) {
        geometryStore.setRenderOrder(id, renderOrder);
      }
    },
    [geometryStore, selectedIds],
  );

  if (selectedIds.length === 0) {
    return null;
  }

  return (
    <div className="absolute right-4 bottom-4 z-30 w-[320px]">
      <FloatingPanel>
        <div className="flex flex-col gap-3">
          {singleRectangle && (
            <RectangleInspector
              rectangleId={singleRectangle.id}
              geometryStore={geometryStore}
              sheetUnitPlaces={sheetUnitPlaces}
              sheetDefaultUnit={sheetDefaultUnit}
              actionsManager={actionsManager}
            />
          )}
          {singleEllipse && (
            <EllipseInspector
              ellipseId={singleEllipse.id}
              geometryStore={geometryStore}
              sheetUnitPlaces={sheetUnitPlaces}
              sheetDefaultUnit={sheetDefaultUnit}
              actionsManager={actionsManager}
            />
          )}
          {singlePolygon && (
            <PolygonInspector
              polygonId={singlePolygon.id}
              geometryStore={geometryStore}
              historyManager={historyManager}
              sheetUnitPlaces={sheetUnitPlaces}
              sheetDefaultUnit={sheetDefaultUnit}
              actionsManager={actionsManager}
            />
          )}

          <LabeledRow label="Id:">
            <span className="text-xs text-[var(--slate-8)] font-mono truncate">
              {selectedIds.length === 1
                ? selectedIds[0].slice(0, 8)
                : `${selectedIds.length} selected`}
            </span>
          </LabeledRow>

          {renderOrder.type !== 'not-all' ? (
            <LabeledRow label="Render order:">
              <RenderOrderInput
                key={selectedIds.join(',')}
                value={
                  renderOrder.type === 'value'
                    ? renderOrder.value
                    : 0 /* FIXME: add non-homogeneous */
                }
                onChange={handleRenderOrderChange}
                geometryStore={geometryStore}
                geometryId={selectedIds.length === 1 ? selectedIds[0] : undefined}
              />
            </LabeledRow>
          ) : null}

          {fillColor.type !== 'not-all' ? (
            <LabeledRow label="Fill:">
              <ColorInput
                value={fillColor.type === 'value' ? fillColor.value : 'non-homogeneous'}
                onChange={handleFillChange}
              />
            </LabeledRow>
          ) : null}
        </div>
      </FloatingPanel>
    </div>
  );
};

export default SelectionInspector;
