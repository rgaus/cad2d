"use client";

import { Fragment, useCallback, useEffect, useState, memo, useMemo, useRef, createRef } from "react";
import { GeometryStore } from "@/lib/tools/GeometryStore";
import { SelectionManager } from "@/lib/tools/SelectionManager";
import { type Id, type Rectangle, type Ellipse, type Polygon, type PolygonSegment } from "@/lib/tools/types";
import { boundingBox } from "@/lib/math";
import { SheetPosition } from "@/lib/viewport/types";
import { Lengths, type Length } from "@/lib/units/length";
import FloatingPanel from "./FloatingPanel";
import LabeledRow from "./LabeledRow";
import LengthInput, { type LengthInputHandle } from "./LengthInput";
import ShapePreview, { ShapePreviewEditingDimension, ShapePreviewHighlight } from "./ShapePreview";
import ColorInput from "./ColorInput";
import { cn } from '@/lib/utils';
import { Button } from "@/components/ui/button";
import debounce from 'lodash.debounce';

type SelectionInspectorProps = {
  geometryStore: GeometryStore;
  selectionManager: SelectionManager;
};

function getSharedValue(values: Array<unknown>): { shared: boolean; value: unknown } {
  const first = values[0];
  const shared = values.every(v => v === first);
  return { shared, value: first };
}

function LinkButton({ linked, onToggle }: { linked: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`w-6 h-6 flex items-center justify-center rounded-[4px] transition-colors ${linked ? "bg-[var(--slate-5)] text-[var(--slate-12)]" : "bg-[var(--slate-3)] text-[var(--slate-7)] hover:bg-[var(--slate-5)]"}`}
      title={linked ? "Unlink dimensions" : "Link dimensions"}
    >
      <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="none">
        {linked ? (
          <path d="M16 10l-2-2-4 4-2-2-3 3v6h6l-3-3 2-2 4 4 2-2V10z" />
        ) : (
          <path d="M8 10l4 4m0 0l2 2 3-3v6h-6l3-3-2-2-4 4-2-2V10l2-2z" fill="none" stroke="currentColor" strokeWidth="2" />
        )}
      </svg>
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
  selectionManager: SelectionManager,
}> = ({ rectangleId, geometryStore, selectionManager }) => {
  const [rectangle, setRectangle] = useState<Rectangle | null>(() => geometryStore.getRectangleById(rectangleId));
  const [editingDimension, setEditingDimension] = useState<ShapePreviewEditingDimension | null>(null);

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
      const updated = rectangles.find(r => r.id === rectangleId);
      if (updated) {
        // Update frequently updating fields directly via refs
        xInputRef.current?.setDisplayValue(Lengths.centimeters(updated.upperLeft.x));
        yInputRef.current?.setDisplayValue(Lengths.centimeters(updated.upperLeft.y));
        const w = updated.lowerRight.x - updated.upperLeft.x;
        wInputRef.current?.setDisplayValue(Lengths.centimeters(w));
        const h = updated.lowerRight.y - updated.upperLeft.y;
        hInputRef.current?.setDisplayValue(Lengths.centimeters(h));

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
        })
      }
    };
    geometryStore.on('rectanglesChanged', handler);
    return () => {
      geometryStore.off('rectanglesChanged', handler);
    };
  }, [geometryStore, rectangleId]);

  useEffect(() => {
    const debouncedHandler = debounce((rectangles: Array<Rectangle>) => {
      const updated = rectangles.find(r => r.id === rectangleId);
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
    const polygon = geometryStore.convertRectangleToPolygon(rectangle.id);
    selectionManager.deselect(rectangle.id);
    selectionManager.select(polygon.id);
  }, [geometryStore, rectangle, selectionManager]);

  const handleXChange = useCallback(
    (len: Length) => {
      if (!rectangle) return;
      const deltaX = len.toCentimeters().magnitude - rectangle.upperLeft.x;
      geometryStore.updateRectangle(rectangle.id, {
        upperLeft: new SheetPosition(len.toCentimeters().magnitude, rectangle.upperLeft.y),
        lowerRight: new SheetPosition(rectangle.lowerRight.x + deltaX, rectangle.lowerRight.y),
      });
    },
    [geometryStore, rectangle]
  );

  const handleYChange = useCallback(
    (len: Length) => {
      if (!rectangle) return;
      const deltaY = len.toCentimeters().magnitude - rectangle.upperLeft.y;
      geometryStore.updateRectangle(rectangle.id, {
        upperLeft: new SheetPosition(rectangle.upperLeft.x, len.toCentimeters().magnitude),
        lowerRight: new SheetPosition(rectangle.lowerRight.x, rectangle.lowerRight.y + deltaY),
      });
    },
    [geometryStore, rectangle]
  );

  const handleWChange = useCallback(
    (len: Length) => {
      if (!rectangle) return;
      const w = len.toCentimeters().magnitude;
      if (rectangle.linkDimensions) {
        geometryStore.updateRectangle(rectangle.id, {
          lowerRight: new SheetPosition(rectangle.upperLeft.x + w, rectangle.upperLeft.y + w),
        });
      } else {
        geometryStore.updateRectangle(rectangle.id, {
          lowerRight: new SheetPosition(rectangle.upperLeft.x + w, rectangle.lowerRight.y),
        });
      }
    },
    [geometryStore, rectangle]
  );

  const handleHChange = useCallback(
    (len: Length) => {
      if (!rectangle) return;
      const h = len.toCentimeters().magnitude;
      geometryStore.updateRectangle(rectangle.id, {
        lowerRight: new SheetPosition(rectangle.lowerRight.x, rectangle.upperLeft.y + h),
      });
    },
    [geometryStore, rectangle]
  );

  const handleLinkToggle = useCallback(() => {
    if (!rectangle) return;
    const newLink = !rectangle.linkDimensions;
    if (newLink) {
      const w = rectangle.lowerRight.x - rectangle.upperLeft.x;
      geometryStore.setRectangleLinkDimensions(rectangle.id, true);
      geometryStore.updateRectangle(rectangle.id, {
        lowerRight: new SheetPosition(rectangle.upperLeft.x + w, rectangle.upperLeft.y + w),
      });
    } else {
      geometryStore.setRectangleLinkDimensions(rectangle.id, false);
    }
  }, [geometryStore, rectangle]);

  const handleFillChange = useCallback(
    (color: number | null) => {
      if (!rectangle) return;
      geometryStore.setRectangleFillColor(rectangle.id, color);
    },
    [geometryStore, rectangle]
  );

  const handleRenderOrderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!rectangle) return;
      const val = parseInt(e.target.value, 10);
      if (!isNaN(val)) {
        geometryStore.setRectangleRenderOrder(rectangle.id, val);
      }
    },
    [geometryStore, rectangle]
  );

  if (!rectangle) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3">
      <ShapePreview shape={rectangle} editingDimension={editingDimension} />
      <button
        type="button"
        onClick={handleConvertToPolygon}
        className="px-3 py-1.5 bg-[var(--slate-5)] text-[var(--slate-12)] text-sm rounded-[4px] border border-[var(--slate-5)] hover:border-[var(--slate-8)] transition-colors"
        style={{ fontFamily: "var(--font-roboto-mono), monospace" }}
      >
        To polygon...
      </button>
      <LabeledRow label="Id:">
        <span className="text-xs text-[var(--slate-8)] font-mono truncate" title={rectangle.id}>
          {rectangle.id.slice(0, 8)}
        </span>
      </LabeledRow>
      <LabeledRow label="Render order:">
        <input
          type="number"
          className="w-20 px-2 py-1 text-sm bg-[var(--slate-3)] text-[var(--slate-12)] border border-[var(--slate-5)] rounded-[4px] font-mono"
          value={rectangle.renderOrder}
          onChange={handleRenderOrderChange}
        />
      </LabeledRow>
      <LabeledRow label="X:">
        <LengthInput
          ref={xInputRef}
          value={Lengths.centimeters(rectangle.upperLeft.x)}
          onChange={handleXChange}
          onFocus={() => setEditingDimension('origin')}
          onBlur={() => setEditingDimension(null)}
        />
      </LabeledRow>
      <LabeledRow label="Y:">
        <LengthInput
          ref={yInputRef}
          value={Lengths.centimeters(rectangle.upperLeft.y)}
          onChange={handleYChange}
          onFocus={() => setEditingDimension('origin')}
          onBlur={() => setEditingDimension(null)}
        />
      </LabeledRow>
      <div className="flex items-center gap-2">
        <div className="flex-1 max-w-[160px]">
          <LengthInput
            ref={wInputRef}
            value={Lengths.centimeters(width)}
            onChange={handleWChange}
            onFocus={() => setEditingDimension('width')}
            onBlur={() => setEditingDimension(null)}
          />
        </div>
        <LinkButton linked={rectangle.linkDimensions} onToggle={handleLinkToggle} />
        <div className="flex-1 max-w-[160px]">
          {rectangle.linkDimensions ? (
            <LengthInput
              ref={hInputRef}
              value={Lengths.centimeters(width)}
              onChange={handleHChange}
              onFocus={() => setEditingDimension('height')}
              onBlur={() => setEditingDimension(null)}
            />
          ) : (
            <LengthInput
              ref={hInputRef}
              value={Lengths.centimeters(height)}
              onChange={handleHChange}
              onFocus={() => setEditingDimension('height')}
              onBlur={() => setEditingDimension(null)}
            />
          )}
        </div>
      </div>
      <LabeledRow label="Fill:">
        <ColorInput value={rectangle.fillColor} openDirection="up" onChange={handleFillChange} />
      </LabeledRow>
    </div>
  );
};

const EllipseInspector: React.FunctionComponent<{
  ellipseId: Id;
  geometryStore: GeometryStore;
  selectionManager: SelectionManager;
}> = ({ ellipseId, geometryStore, selectionManager }) => {
  const [ellipse, setEllipse] = useState<Ellipse | null>(() => geometryStore.getEllipseById(ellipseId));
  const [editingDimension, setEditingDimension] = useState<ShapePreviewEditingDimension | null>(null);

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
      const updated = ellipses.find(e => e.id === ellipseId);
      if (updated) {
        // Update frequently updating fields directly via refs
        cxInputRef.current?.setDisplayValue(Lengths.centimeters(updated.center.x));
        cyInputRef.current?.setDisplayValue(Lengths.centimeters(updated.center.y));
        rxInputRef.current?.setDisplayValue(Lengths.centimeters(updated.radiusX));
        ryInputRef.current?.setDisplayValue(Lengths.centimeters(updated.radiusY));

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
      const updated = ellipses.find(e => e.id === ellipseId);
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
    if (!ellipse) {
      return;
    }
    const polygon = geometryStore.convertEllipseToPolygon(ellipse.id);
    selectionManager.deselect(ellipse.id);
    selectionManager.select(polygon.id);
  }, [geometryStore, ellipse, selectionManager]);

  const handleCXChange = useCallback(
    (len: Length) => {
      if (!ellipse?.id) {
        return;
      }
      geometryStore.updateEllipse(ellipse.id, {
        center: new SheetPosition(len.toCentimeters().magnitude, ellipse.center.y),
      });
    },
    [geometryStore, ellipse?.id]
  );

  const handleCYChange = useCallback(
    (len: Length) => {
      if (!ellipse?.id) {
        return;
      }
      geometryStore.updateEllipse(ellipse.id, {
        center: new SheetPosition(ellipse.center.x, len.toCentimeters().magnitude),
      });
    },
    [geometryStore, ellipse?.id]
  );

  const handleRXChange = useCallback(
    (len: Length) => {
      if (!ellipse?.id) {
        return;
      }
      const rx = len.toCentimeters().magnitude;
      if (ellipse.linkDimensions) {
        geometryStore.updateEllipse(ellipse.id, { radiusX: rx, radiusY: rx });
      } else {
        geometryStore.updateEllipse(ellipse.id, { radiusX: rx });
      }
    },
    [geometryStore, ellipse?.id]
  );

  const handleRYChange = useCallback(
    (len: Length) => {
      if (!ellipse?.id) {
        return;
      }
      geometryStore.updateEllipse(ellipse.id, { radiusY: len.toCentimeters().magnitude });
    },
    [geometryStore, ellipse?.id]
  );

  const handleLinkToggle = useCallback(() => {
    if (!ellipse?.id) {
      return;
    }
    const newLink = !ellipse.linkDimensions;
    if (newLink) {
      geometryStore.setEllipseLinkDimensions(ellipse.id, true);
      geometryStore.updateEllipse(ellipse.id, {
        radiusX: ellipse.radiusX,
        radiusY: ellipse.radiusX,
      });
    } else {
      geometryStore.setEllipseLinkDimensions(ellipse.id, false);
    }
  }, [geometryStore, ellipse?.id]);

  const handleFillChange = useCallback(
    (color: number | null) => {
      if (!ellipse?.id) {
        return;
      }
      geometryStore.setEllipseFillColor(ellipse.id, color);
    },
    [geometryStore, ellipse?.id]
  );

  const handleRenderOrderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!ellipse?.id) return;
      const val = parseInt(e.target.value, 10);
      if (!isNaN(val)) {
        geometryStore.setEllipseRenderOrder(ellipse.id, val);
      }
    },
    [geometryStore, ellipse?.id]
  );

  if (!ellipse) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3">
      <ShapePreview shape={ellipse} editingDimension={editingDimension} />
      <button
        type="button"
        onClick={handleConvertToPolygon}
        className="px-3 py-1.5 bg-[var(--slate-5)] text-[var(--slate-12)] text-sm rounded-[4px] border border-[var(--slate-5)] hover:border-[var(--slate-8)] transition-colors"
        style={{ fontFamily: "var(--font-roboto-mono), monospace" }}
      >
        To polygon...
      </button>
      <LabeledRow label="Id:">
        <span className="text-xs text-[var(--slate-8)] font-mono truncate" title={ellipse.id}>
          {ellipse.id.slice(0, 8)}
        </span>
      </LabeledRow>
      <LabeledRow label="Render order:">
        <input
          type="number"
          className="w-20 px-2 py-1 text-sm bg-[var(--slate-3)] text-[var(--slate-12)] border border-[var(--slate-5)] rounded-[4px] font-mono"
          value={ellipse.renderOrder}
          onChange={handleRenderOrderChange}
        />
      </LabeledRow>
      <LabeledRow label="CX:">
        <LengthInput
          ref={cxInputRef}
          value={Lengths.centimeters(ellipse.center.x)}
          onChange={handleCXChange}
          onFocus={() => setEditingDimension('origin')}
          onBlur={() => setEditingDimension(null)}
        />
      </LabeledRow>
      <LabeledRow label="CY:">
        <LengthInput
          ref={cyInputRef}
          value={Lengths.centimeters(ellipse.center.y)}
          onChange={handleCYChange}
          onFocus={() => setEditingDimension('origin')}
          onBlur={() => setEditingDimension(null)}
        />
      </LabeledRow>
      <div className="flex items-center gap-2">
        <div className="flex-1 max-w-[160px]">
          <LengthInput
            ref={rxInputRef}
            value={Lengths.centimeters(ellipse.radiusX)}
            onChange={handleRXChange}
            onFocus={() => setEditingDimension('radiusX')}
            onBlur={() => setEditingDimension(null)}
          />
        </div>
        <LinkButton linked={ellipse.linkDimensions} onToggle={handleLinkToggle} />
        <div className="flex-1 max-w-[160px]">
          {ellipse.linkDimensions ? (
            <LengthInput
              ref={ryInputRef}
              value={Lengths.centimeters(ellipse.radiusX)}
              onChange={handleRYChange}
            />
          ) : (
            <LengthInput
              ref={ryInputRef}
              value={Lengths.centimeters(ellipse.radiusY)}
              onChange={handleRYChange}
              onFocus={() => setEditingDimension('radiusY')}
              onBlur={() => setEditingDimension(null)}
            />
          )}
        </div>
      </div>
      <LabeledRow label="Fill:">
        <ColorInput value={ellipse.fillColor} openDirection="up" onChange={handleFillChange} />
      </LabeledRow>
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
    <div
      className="w-full h-0 shrink-1 relative overflow-visible"
    >
      <div
        className={cn("w-4 h-4 bg-[var(--slate-8)] border border-2 border-[var(--slate-6)] absolute -top-[10px] left-1 rounded-full z-30 cursor-grab", {
          "bg-[var(--teal-10)] border-[var(--teal-11)]": hover || dragging,
        })}
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
        className={cn("h-[2px] bg-[var(--slate-6)] absolute -my-0.75", {
          "bg-[var(--teal-11)]": hover || dragging,
        })}
        style={{ marginLeft: 12, width: 'calc(100% - 24px)' }}
      />
    </div>
  );
};

/** The height of each PointRow depending on polygon type. Used for computing
  * {@link SplitPointIndicator} position. */
const POINT_ROW_HEIGHT_PX_BY_TYPE: { [key in PolygonSegment["type"]]: number } = {
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
  onXChange: (index: number, len: Length) => void;
  onYChange: (index: number, len: Length) => void;
  onDelete: (index: number) => void;
  onInsert: (index: number) => void;
  isHovered?: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  refs?: PointRowRefs;
};

const PointRow = memo<PointRowProps>(({
  segment,
  index,
  onXChange,
  onYChange,
  onDelete,
  onInsert,
  isHovered = false,
  onMouseEnter,
  onMouseLeave,
  refs,
}) => {
  const isPoint = segment.type === "point";
  const isQuadratic = segment.type === "arc-quadratic";

  const iconColor = isPoint ? "#888" : isQuadratic ? "#3498db" : "#e74c3c";
  const iconLabel = isPoint ? "P" : isQuadratic ? "Q" : "C";

  return (
    <div
      className="flex items-center gap-1 grow-0 shrink-0 mx-3 px-2 py-1 mb-1 bg-[var(--slate-2)] rounded-[4px] border border-[var(--slate-4)]"
      style={{ backgroundColor: isHovered ? 'var(--slate-1)' : 'var(--slate-2)', height: POINT_ROW_HEIGHT_PX_BY_TYPE[segment.type] }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <span
        className="w-4 h-4 flex items-center justify-center text-[10px] font-bold rounded-[4px] select-none"
        style={{ color: iconColor, fontFamily: "var(--font-roboto-mono), monospace" }}
      >
        {iconLabel}
      </span>
      <div className="flex-1">
        {segment.type === 'point' ? (
          <div className="flex gap-1">
            <LengthInput
              ref={refs?.x}
              value={Lengths.centimeters(segment.point.x)}
              onChange={(len) => onXChange(index, len)}
            />
            <LengthInput
              ref={refs?.y}
              value={Lengths.centimeters(segment.point.y)}
              onChange={(len) => onYChange(index, len)}
            />
          </div>
        ) : null}
        {segment.type === 'arc-cubic' || segment.type === 'arc-quadratic' ? (
          <div className="flex flex-col gap-1">
            <div className="flex gap-1">
              <LengthInput
                ref={refs?.x}
                value={Lengths.centimeters(segment.point.x)}
                onChange={(len) => onXChange(index, len)}
              />
              <LengthInput
                ref={refs?.y}
                value={Lengths.centimeters(segment.point.y)}
                onChange={(len) => onYChange(index, len)}
              />
            </div>
            {segment.type === "arc-quadratic" ? (
              <div className="flex gap-1">
                <LengthInput value={Lengths.centimeters(segment.controlPoint.x)} onChange={() => {}} />
                <LengthInput value={Lengths.centimeters(segment.controlPoint.y)} onChange={() => {}} />
              </div>
            ) : null}
            {segment.type === "arc-cubic" ? (
              <>
                <div className="flex gap-1">
                  <LengthInput value={Lengths.centimeters(segment.controlPointA.x)} onChange={() => {}} />
                  <LengthInput value={Lengths.centimeters(segment.controlPointA.y)} onChange={() => {}} />
                </div>
                <div className="flex gap-1">
                  <LengthInput value={Lengths.centimeters(segment.controlPointB.x)} onChange={() => {}} />
                  <LengthInput value={Lengths.centimeters(segment.controlPointB.y)} onChange={() => {}} />
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
        <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
          <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" fill="none" />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => onDelete(index)}
        className="w-5 h-5 flex items-center justify-center text-[var(--slate-8)] hover:text-red-400 transition-colors"
        title="Delete point"
      >
        <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
          <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
        </svg>
      </button>
    </div>
  );
});

PointRow.displayName = 'PointRow';

/** Color which should be used in the shape preview to indicate the polygon open segment. */
const POLYGON_OPEN_SEGMENT_HIGHLIGHT_COLOR = "var(--teal-10)";

const PolygonInspector: React.FunctionComponent<{
  polygonId: Id;
  geometryStore: GeometryStore;
}> = ({ polygonId, geometryStore }) => {
  const [polygon, setPolygon] = useState<Polygon | null>(() => geometryStore.getPolygonById(polygonId));
  const [shapePreviewHighlight, setShapePreviewHighlight] = useState<ShapePreviewHighlight | null>(null);
  const [editingDimension, setEditingDimension] = useState<ShapePreviewEditingDimension | null>(null);
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
      const updated = polygons.find(p => p.id === polygonId);
      if (updated) {
        // Update frequently updating point fields directly via refs
        const refs = pointInputRefs.current;
        for (let i = 0; i < updated.points.length; i++) {
          const pointRef = refs.get(i);
          if (pointRef) {
            pointRef.x.current?.setDisplayValue(Lengths.centimeters(updated.points[i].point.x));
            pointRef.y.current?.setDisplayValue(Lengths.centimeters(updated.points[i].point.y));
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
      const updated = polygons.find(p => p.id === polygonId);
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
    () => polygon ? boundingBox(polygon.points.map(s => s.point)) : null,
    [polygon]
  );

  const handlePointXChange = useCallback(
    (index: number, len: Length) => {
      setPolygon(prev => {
        if (!prev) return prev;
        const segments = prev.points.map((s, i) => {
          if (i !== index) return s;
          return { ...s, point: new SheetPosition(len.toCentimeters().magnitude, s.point.y) };
        });
        geometryStore.updatePolygon(prev.id, { points: segments });
        return prev;
      });
    },
    [geometryStore]
  );

  const handlePointYChange = useCallback(
    (index: number, len: Length) => {
      setPolygon(prev => {
        if (!prev) return prev;
        const segments = prev.points.map((s, i) => {
          if (i !== index) return s;
          return { ...s, point: new SheetPosition(s.point.x, len.toCentimeters().magnitude) };
        });
        geometryStore.updatePolygon(prev.id, { points: segments });
        return prev;
      });
    },
    [geometryStore]
  );

  const handleDeletePoint = useCallback(
    (index: number) => {
      setPolygon(prev => {
        if (!prev) return prev;
        const segments = prev.points.filter((_, i) => i !== index);
        geometryStore.updatePolygon(prev.id, { points: segments });
        return prev;
      });
    },
    [geometryStore]
  );

  const handleInsertPoint = useCallback(
    (index: number) => {
      setPolygon(prev => {
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
    [geometryStore]
  );

  const handleFillChange = useCallback(
    (color: number | null) => {
      if (!polygon) return;
      geometryStore.setPolygonFillColor(polygon.id, color);
    },
    [geometryStore, polygon]
  );

  const handleRenderOrderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!polygon) return;
      const val = parseInt(e.target.value, 10);
      if (!isNaN(val)) {
        geometryStore.setPolygonRenderOrder(polygon.id, val);
      }
    },
    [geometryStore, polygon]
  );

  const handleCloseOpen = useCallback(() => {
    if (!polygon) return;
    if (polygon.closed) {
      geometryStore.openPolygon(polygon.id);
      setOpenAtIndexDragging(false);
      setShapePreviewHighlight(null);
    } else {
      geometryStore.closePolygon(polygon.id);
    }
  }, [geometryStore, polygon]);

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
          [i, offsetInPx] = [i-1, offsetInPx-POINT_ROW_HEIGHT_PX_BY_TYPE[polygon.points[i].type]]
        ) {
          const rowHeightInPx = POINT_ROW_HEIGHT_PX_BY_TYPE[polygon.points[i].type];
          if (deltaYPx > offsetInPx - (rowHeightInPx / 2)) {
            index = i;
            break;
          }
        }
      } else {
        // Work forwards from the current `initialOpenAtIndex` to determine the new index
        for (
          let i = initialOpenAtIndex, offsetInPx = 0;
          i < polygon.points.length;
          [i, offsetInPx] = [i+1, offsetInPx+POINT_ROW_HEIGHT_PX_BY_TYPE[polygon.points[i].type]]
        ) {
          const rowHeightInPx = POINT_ROW_HEIGHT_PX_BY_TYPE[polygon.points[i].type];
          if (deltaYPx < offsetInPx + (rowHeightInPx / 2)) {
            index = i;
            break;
          }
        }
      }
      const bounded = Math.min(Math.max(index, 0), polygon.points.length);

      newOpenAtIndex = bounded;
      geometryStore.updatePolygon(polygon.id, { openAtIndex: newOpenAtIndex });
      setShapePreviewHighlight({ type: 'segment', index: newOpenAtIndex, color: POLYGON_OPEN_SEGMENT_HIGHLIGHT_COLOR});
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
    <div className={cn("flex flex-col gap-3", { "select-none": openAtIndexDragging })}>
      <ShapePreview
        shape={polygon}
        highlight={shapePreviewHighlight}
        editingDimension={editingDimension}
      />
      <LabeledRow label="Id:">
        <span className="text-xs text-[var(--slate-8)] font-mono truncate" title={polygon.id}>
          {polygon.id.slice(0, 8)}
        </span>
      </LabeledRow>
      <LabeledRow label="Render order:">
        <input
          type="number"
          className="w-20 px-2 py-1 text-sm bg-[var(--slate-3)] text-[var(--slate-12)] border border-[var(--slate-5)] rounded-[4px] font-mono"
          value={polygon.renderOrder}
          onChange={handleRenderOrderChange}
        />
      </LabeledRow>
      {bounds && (
        <>
          <div className="flex gap-2">
            <LabeledRow label="X:">
              <LengthInput
                value={Lengths.centimeters(bounds.position.x)}
                onChange={() => {}} // FIXME: wire this up
              />
            </LabeledRow>
            <LabeledRow label="H:">
              <LengthInput
                value={Lengths.centimeters(bounds.height)}
                onChange={() => {}} // FIXME: wire this up
              />
            </LabeledRow>
          </div>
          <div className="flex gap-2">
            <LabeledRow label="Y:">
              <LengthInput
                value={Lengths.centimeters(bounds.position.y)}
                onChange={() => {}} // FIXME: wire this up
              />
            </LabeledRow>
            <LabeledRow label="W:">
              <LengthInput
                value={Lengths.centimeters(bounds.width)}
                onChange={() => {}} // FIXME: wire this up
                onFocus={() => setEditingDimension('width')}
                onBlur={() => setEditingDimension(null)}
              />
            </LabeledRow>
          </div>
        </>
      )}
      {polygon.closed && (
        <LabeledRow label="Fill:">
          <ColorInput value={polygon.fillColor} onChange={handleFillChange} />
        </LabeledRow>
      )}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[var(--slate-12)] text-sm font-medium" style={{ fontFamily: "var(--font-roboto-mono), monospace" }}>
            Points:
          </span>
          <span className="text-xs text-[var(--slate-8)] font-mono">{polygon.points.length}</span>
        </div>
        <div className="flex flex-col max-h-48 -mx-3 overflow-y-auto">
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
                  onXChange={handlePointXChange}
                  onYChange={handlePointYChange}
                  onDelete={handleDeletePoint}
                  onInsert={handleInsertPoint}
                  isHovered={shapePreviewHighlight?.type === 'point' && shapePreviewHighlight.index === index}
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
                    onMouseEnter={() => setShapePreviewHighlight({ type: 'segment', index: polygon.openAtIndex, color: POLYGON_OPEN_SEGMENT_HIGHLIGHT_COLOR })}
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
        className={cn("w-full border border-2 border-transparent", {
          "hover:border-[var(--teal-5)]": polygon.closed,
        })}
        style={{ fontFamily: "var(--font-roboto-mono), monospace" }}
        onMouseEnter={() => {
          if (polygon.closed) {
            setOpenAtIndexDragging(true);
            setShapePreviewHighlight({ type: 'segment', index: polygon.openAtIndex, color: POLYGON_OPEN_SEGMENT_HIGHLIGHT_COLOR });
          }
        }}
        onMouseLeave={() => {
          if (polygon.closed) {
            setOpenAtIndexDragging(false);
            setShapePreviewHighlight(null);
          }
        }}
      >
        {polygon.closed ? "Open polygon" : "Close polygon"}
      </Button>
    </div>
  );
};

function MultiSelectInspector({
  selectedIds,
  geometryStore,
}: {
  selectedIds: Array<Id>;
  geometryStore: GeometryStore;
}) {
  const [fillColorValue, setFillColorValue] = useState<{ shared: boolean; value: unknown }>({ shared: false, value: null });
  const [renderOrderValue, setRenderOrderValue] = useState<number>(0);

  useEffect(() => {
    const updateFillColor = () => {
      const rects = selectedIds
        .map(id => geometryStore.getRectangleById(id))
        .filter((r): r is Rectangle => r !== null);
      const ellipses = selectedIds
        .map(id => geometryStore.getEllipseById(id))
        .filter((e): e is Ellipse => e !== null);
      const polygons = selectedIds
        .map(id => geometryStore.getPolygonById(id))
        .filter((p): p is Polygon => p !== null);

      const allClosed = polygons.length === 0 || polygons.every(p => p.closed);
      if (!allClosed && polygons.length > 0) {
        setFillColorValue({ shared: false, value: null });
        return;
      }

      if (rects.length > 0) {
        const colors = rects.map(r => r.fillColor);
        setFillColorValue(getSharedValue(colors));
        return;
      }
      if (ellipses.length > 0) {
        const colors = ellipses.map(e => e.fillColor);
        setFillColorValue(getSharedValue(colors));
        return;
      }
      if (polygons.length > 0 && allClosed) {
        const colors = polygons.map(p => p.fillColor);
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
        .map(id => geometryStore.getRectangleById(id))
        .filter((r): r is Rectangle => r !== null);
      const ellipses = selectedIds
        .map(id => geometryStore.getEllipseById(id))
        .filter((e): e is Ellipse => e !== null);
      const polygons = selectedIds
        .map(id => geometryStore.getPolygonById(id))
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
    [geometryStore, selectedIds]
  );

  const handleRenderOrderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = parseInt(e.target.value, 10);
      if (isNaN(val)) return;
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
    [geometryStore, selectedIds]
  );

  return (
    <div className="flex flex-col gap-3">
      <LabeledRow label="Render order:">
        <input
          type="number"
          className="w-20 px-2 py-1 text-sm bg-[var(--slate-3)] text-[var(--slate-12)] border border-[var(--slate-5)] rounded-[4px] font-mono"
          value={renderOrderValue}
          onChange={handleRenderOrderChange}
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
}

export default function SelectionInspector({
  geometryStore,
  selectionManager,
}: SelectionInspectorProps) {
  const [selectedIds, setSelectedIds] = useState<Array<Id>>(() => selectionManager.getSelectedIds());

  useEffect(() => {
    selectionManager.on('selectionChange', setSelectedIds);
    return () => {
      selectionManager.off('selectionChange', setSelectedIds);
    };
  }, [selectionManager]);

  if (selectedIds.length === 0) {
    return null;
  }

  const rectangleIds = selectedIds.filter(id => geometryStore.getRectangleById(id) !== null);
  const ellipseIds = selectedIds.filter(id => geometryStore.getEllipseById(id) !== null);
  const polygonIds = selectedIds.filter(id => geometryStore.getPolygonById(id) !== null);

  const singleRectangle = rectangleIds.length === 1 && ellipseIds.length === 0 && polygonIds.length === 0;
  const singleEllipse = ellipseIds.length === 1 && rectangleIds.length === 0 && polygonIds.length === 0;
  const singlePolygon = polygonIds.length === 1 && rectangleIds.length === 0 && ellipseIds.length === 0;
  const multiSelect = selectedIds.length > 1;

  if (rectangleIds.length === 0 && ellipseIds.length === 0 && polygonIds.length === 0) {
    return null;
  }

  return (
    <div className="absolute right-4 bottom-4 z-30">
      <FloatingPanel>
        {singleRectangle && (
          <RectangleInspector
            rectangleId={rectangleIds[0]}
            geometryStore={geometryStore}
            selectionManager={selectionManager}
          />
        )}
        {singleEllipse && (
          <EllipseInspector
            ellipseId={ellipseIds[0]}
            geometryStore={geometryStore}
            selectionManager={selectionManager}
          />
        )}
        {singlePolygon && (
          <PolygonInspector
            polygonId={polygonIds[0]}
            geometryStore={geometryStore}
          />
        )}
        {multiSelect && (
          <MultiSelectInspector
            selectedIds={selectedIds}
            geometryStore={geometryStore}
          />
        )}
      </FloatingPanel>
    </div>
  );
}
