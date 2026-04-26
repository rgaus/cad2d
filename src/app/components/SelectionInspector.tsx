"use client";

import { useCallback, useEffect, useState } from "react";
import { GeometryStore } from "@/lib/tools/GeometryStore";
import { SelectionManager } from "@/lib/tools/SelectionManager";
import { type Rectangle, type Ellipse, type Polygon, type PolygonSegment } from "@/lib/tools/types";
import { boundingBox } from "@/lib/math";
import { SheetPosition } from "@/lib/viewport/types";
import { Length } from "@/lib/units/length";
import { type Sheet } from "@/lib/sheet/Sheet";
import FloatingPanel from "./FloatingPanel";
import LabeledRow from "./LabeledRow";
import LengthInput from "./LengthInput";
import ShapePreview, { ShapePreviewEditingDimension } from "./ShapePreview";
import ColorInput from "./ColorInput";

type SelectionInspectorProps = {
  geometryStore: GeometryStore;
  selectionManager: SelectionManager;
  sheet: Sheet;
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
      className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${linked ? "bg-[#555] text-white" : "bg-[#333] text-[#555] hover:bg-[#444]"}`}
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

const RectangleInspector: React.FunctionComponent<{
  initialRectangle: Rectangle;
  geometryStore: GeometryStore;
  sheet: Sheet;
}> = ({ initialRectangle, geometryStore, sheet }) => {
  const [rectangle, setRectangle] = useState(initialRectangle);
  const [editingDimension, setEditingDimension] = useState<ShapePreviewEditingDimension | null>(null);

  useEffect(() => {
    const handler = (rectangles: Array<Rectangle>) => {
      const updated = rectangles.find(r => r.id === initialRectangle.id);
      if (updated) {
        setRectangle(updated);
      }
    };
    geometryStore.on('rectanglesChanged', handler);
    return () => {
      geometryStore.off('rectanglesChanged', handler);
    };
  }, [geometryStore, initialRectangle.id]);

  const width = rectangle.lowerRight.x - rectangle.upperLeft.x;
  const height = rectangle.lowerRight.y - rectangle.upperLeft.y;

  const handleXChange = useCallback(
    (len: Length) => {
      const newX = len.toSheetUnits(sheet).magnitude;
      const deltaX = newX - rectangle.upperLeft.x;
      geometryStore.updateRectangle(rectangle.id, {
        upperLeft: new SheetPosition(newX, rectangle.upperLeft.y),
        lowerRight: new SheetPosition(rectangle.lowerRight.x + deltaX, rectangle.lowerRight.y),
      });
    },
    [geometryStore, rectangle, sheet]
  );

  const handleYChange = useCallback(
    (len: Length) => {
      const newY = len.toSheetUnits(sheet).magnitude;
      const deltaY = newY - rectangle.upperLeft.y;
      geometryStore.updateRectangle(rectangle.id, {
        upperLeft: new SheetPosition(rectangle.upperLeft.x, newY),
        lowerRight: new SheetPosition(rectangle.lowerRight.x, rectangle.lowerRight.y + deltaY),
      });
    },
    [geometryStore, rectangle, sheet]
  );

  const handleWChange = useCallback(
    (len: Length) => {
      const w = len.toSheetUnits(sheet).magnitude;
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
    [geometryStore, rectangle, sheet]
  );

  const handleHChange = useCallback(
    (len: Length) => {
      const h = len.toSheetUnits(sheet).magnitude;
      geometryStore.updateRectangle(rectangle.id, {
        lowerRight: new SheetPosition(rectangle.lowerRight.x, rectangle.upperLeft.y + h),
      });
    },
    [geometryStore, rectangle, sheet]
  );

  const handleLinkToggle = useCallback(() => {
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
      geometryStore.setRectangleFillColor(rectangle.id, color);
    },
    [geometryStore, rectangle]
  );

  return (
    <div className="flex flex-col gap-3">
      <ShapePreview shape={rectangle} editingDimension={editingDimension} />
      <LabeledRow label="Id:">
        <span className="text-xs text-[#888] font-mono truncate" title={rectangle.id}>
          {rectangle.id.slice(0, 8)}
        </span>
      </LabeledRow>
      <LabeledRow label="X:">
        <LengthInput
          value={Length.fromSheetUnits(sheet, rectangle.upperLeft.x)}
          onChange={handleXChange}
          onFocus={() => setEditingDimension('origin')}
          onBlur={() => setEditingDimension(null)}
          disableUnitSelector
        />
      </LabeledRow>
      <LabeledRow label="Y:">
        <LengthInput
          value={Length.fromSheetUnits(sheet, rectangle.upperLeft.y)}
          onChange={handleYChange}
          onFocus={() => setEditingDimension('origin')}
          onBlur={() => setEditingDimension(null)}
          disableUnitSelector
        />
      </LabeledRow>
      <div className="flex items-center gap-2">
        <div className="flex-1 max-w-[160px]">
          <LengthInput
            value={Length.fromSheetUnits(sheet, width)}
            onChange={handleWChange}
            onFocus={() => setEditingDimension('width')}
            onBlur={() => setEditingDimension(null)}
            disableUnitSelector
          />
        </div>
        <LinkButton linked={rectangle.linkDimensions} onToggle={handleLinkToggle} />
        <div className="flex-1 max-w-[160px]">
          {rectangle.linkDimensions ? (
            <LengthInput
              value={Length.fromSheetUnits(sheet, width)}
              onChange={handleHChange}
              onFocus={() => setEditingDimension('height')}
              onBlur={() => setEditingDimension(null)}
              disableUnitSelector
            />
          ) : (
            <LengthInput
              value={Length.fromSheetUnits(sheet, height)}
              onChange={handleHChange}
              onFocus={() => setEditingDimension('height')}
              onBlur={() => setEditingDimension(null)}
              disableUnitSelector
            />
          )}
        </div>
      </div>
      <LabeledRow label="Fill:">
        <ColorInput value={rectangle.fillColor} openDirection="up" onChange={handleFillChange} />
      </LabeledRow>
    </div>
  );
}

function EllipseInspector({
  initialEllipse,
  geometryStore,
  sheet,
}: {
  initialEllipse: Ellipse;
  geometryStore: GeometryStore;
  sheet: Sheet;
}) {
  const [ellipse, setEllipse] = useState(initialEllipse);
  const [editingDimension, setEditingDimension] = useState<ShapePreviewEditingDimension | null>(null);

  useEffect(() => {
    const handler = (ellipses: Array<Ellipse>) => {
      const updated = ellipses.find(e => e.id === initialEllipse.id);
      if (updated) {
        setEllipse(updated);
      }
    };
    geometryStore.on('ellipsesChanged', handler);
    return () => {
      geometryStore.off('ellipsesChanged', handler);
    };
  }, [geometryStore, initialEllipse.id]);

  const handleCXChange = useCallback(
    (len: Length) => {
      geometryStore.updateEllipse(ellipse.id, {
        center: new SheetPosition(len.toSheetUnits(sheet).magnitude, ellipse.center.y),
      });
    },
    [geometryStore, ellipse, sheet]
  );

  const handleCYChange = useCallback(
    (len: Length) => {
      geometryStore.updateEllipse(ellipse.id, {
        center: new SheetPosition(ellipse.center.x, len.toSheetUnits(sheet).magnitude),
      });
    },
    [geometryStore, ellipse, sheet]
  );

  const handleRXChange = useCallback(
    (len: Length) => {
      const rx = len.toSheetUnits(sheet).magnitude;
      if (ellipse.linkDimensions) {
        geometryStore.updateEllipse(ellipse.id, { radiusX: rx, radiusY: rx });
      } else {
        geometryStore.updateEllipse(ellipse.id, { radiusX: rx });
      }
    },
    [geometryStore, ellipse, sheet]
  );

  const handleRYChange = useCallback(
    (len: Length) => {
      geometryStore.updateEllipse(ellipse.id, { radiusY: len.toSheetUnits(sheet).magnitude });
    },
    [geometryStore, ellipse, sheet]
  );

  const handleLinkToggle = useCallback(() => {
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
  }, [geometryStore, ellipse]);

  const handleFillChange = useCallback(
    (color: number | null) => {
      geometryStore.setEllipseFillColor(ellipse.id, color);
    },
    [geometryStore, ellipse]
  );

  return (
    <div className="flex flex-col gap-3">
      <ShapePreview shape={ellipse} editingDimension={editingDimension} />
      <LabeledRow label="Id:">
        <span className="text-xs text-[#888] font-mono truncate" title={ellipse.id}>
          {ellipse.id.slice(0, 8)}
        </span>
      </LabeledRow>
      <LabeledRow label="CX:">
        <LengthInput
          value={Length.fromSheetUnits(sheet, ellipse.center.x)}
          onChange={handleCXChange}
          onFocus={() => setEditingDimension('origin')}
          onBlur={() => setEditingDimension(null)}
          disableUnitSelector
        />
      </LabeledRow>
      <LabeledRow label="CY:">
        <LengthInput
          value={Length.fromSheetUnits(sheet, ellipse.center.y)}
          onChange={handleCYChange}
          onFocus={() => setEditingDimension('origin')}
          onBlur={() => setEditingDimension(null)}
          disableUnitSelector
        />
      </LabeledRow>
      <div className="flex items-center gap-2">
        <div className="flex-1 max-w-[160px]">
          <LengthInput
            value={Length.fromSheetUnits(sheet, ellipse.radiusX)}
            onChange={handleRXChange}
            onFocus={() => setEditingDimension('radiusX')}
            onBlur={() => setEditingDimension(null)}
            disableUnitSelector
          />
        </div>
        <LinkButton linked={ellipse.linkDimensions} onToggle={handleLinkToggle} />
        <div className="flex-1 max-w-[160px]">
          {ellipse.linkDimensions ? (
            <LengthInput
              value={Length.fromSheetUnits(sheet, ellipse.radiusX)}
              onChange={handleRYChange}
              disableUnitSelector
            />
          ) : (
            <LengthInput
              value={Length.fromSheetUnits(sheet, ellipse.radiusY)}
              onChange={handleRYChange}
              onFocus={() => setEditingDimension('radiusY')}
              onBlur={() => setEditingDimension(null)}
              disableUnitSelector
            />
          )}
        </div>
      </div>
      <LabeledRow label="Fill:">
        <ColorInput value={ellipse.fillColor} openDirection="up" onChange={handleFillChange} />
      </LabeledRow>
    </div>
  );
}

const PolygonInspector: React.FunctionComponent<{
  initialPolygon: Polygon;
  geometryStore: GeometryStore;
  sheet: Sheet;
}> = ({ initialPolygon, geometryStore, sheet }) => {
  const [polygon, setPolygon] = useState(initialPolygon);
  const [highlightedPointIndex, setHighlightedPointIndex] = useState<number | null>(null);
  const [editingDimension, setEditingDimension] = useState<ShapePreviewEditingDimension | null>(null);

  useEffect(() => {
    const handler = (polygons: Array<Polygon>) => {
      const updated = polygons.find(p => p.id === initialPolygon.id);
      if (updated) {
        setPolygon(updated);
      }
    };
    geometryStore.on('polygonsChanged', handler);
    return () => {
      geometryStore.off('polygonsChanged', handler);
    };
  }, [geometryStore, initialPolygon.id]);

  const bounds = boundingBox(polygon.points.map(s => s.point));

  const handlePointXChange = useCallback(
    (index: number, len: Length) => {
      const segments = polygon.points.map((s, i) => {
        if (i !== index) return s;
        return { ...s, point: new SheetPosition(len.toSheetUnits(sheet).magnitude, s.point.y) };
      });
      geometryStore.updatePolygon(polygon.id, { points: segments });
    },
    [geometryStore, polygon, sheet]
  );

  const handlePointYChange = useCallback(
    (index: number, len: Length) => {
      const segments = polygon.points.map((s, i) => {
        if (i !== index) return s;
        return { ...s, point: new SheetPosition(s.point.x, len.toSheetUnits(sheet).magnitude) };
      });
      geometryStore.updatePolygon(polygon.id, { points: segments });
    },
    [geometryStore, polygon, sheet]
  );

  const handleDeletePoint = useCallback(
    (index: number) => {
      const segments = polygon.points.filter((_, i) => i !== index);
      geometryStore.updatePolygon(polygon.id, { points: segments });
    },
    [geometryStore, polygon]
  );

  const handleInsertPoint = useCallback(
    (index: number) => {
      const seg = polygon.points[index];
      const nextSeg = polygon.points[index + 1];
      if (!seg || !nextSeg) return;
      const midX = (seg.point.x + nextSeg.point.x) / 2;
      const midY = (seg.point.y + nextSeg.point.y) / 2;
      geometryStore.addPointOnEdge(polygon.id, index, new SheetPosition(midX, midY));
    },
    [geometryStore, polygon]
  );

  const handleFillChange = useCallback(
    (color: number | null) => {
      geometryStore.setPolygonFillColor(polygon.id, color);
    },
    [geometryStore, polygon]
  );

  const handleCloseOpen = useCallback(() => {
    if (polygon.closed) {
      geometryStore.openPolygon(polygon.id);
    } else {
      geometryStore.closePolygon(polygon.id);
    }
  }, [geometryStore, polygon]);

  return (
    <div className="flex flex-col gap-3">
      <ShapePreview
        shape={polygon}
        highlight={typeof highlightedPointIndex === 'number' ? { type: 'point', index: highlightedPointIndex } : undefined}
        editingDimension={editingDimension}
      />
      <LabeledRow label="Id:">
        <span className="text-xs text-[#888] font-mono truncate" title={polygon.id}>
          {polygon.id.slice(0, 8)}
        </span>
      </LabeledRow>
      <div className="flex gap-2">
        <LabeledRow label="X:">
          <LengthInput
            value={Length.fromSheetUnits(sheet, bounds.position.x)}
            onChange={() => {}} // FIXME: wire this up
            disableUnitSelector
          />
        </LabeledRow>
        <LabeledRow label="H:">
          <LengthInput
            value={Length.fromSheetUnits(sheet, bounds.height)}
            onChange={() => {}} // FIXME: wire this up
            disableUnitSelector
          />
        </LabeledRow>
      </div>
      <div className="flex gap-2">
        <LabeledRow label="Y:">
          <LengthInput
            value={Length.fromSheetUnits(sheet, bounds.position.y)}
            onChange={() => {}} // FIXME: wire this up
            disableUnitSelector
          />
        </LabeledRow>
        <LabeledRow label="W:">
          <LengthInput
            value={Length.fromSheetUnits(sheet, bounds.width)}
            onChange={() => {}} // FIXME: wire this up
            onFocus={() => setEditingDimension('width')}
            onBlur={() => setEditingDimension(null)}
            disableUnitSelector
          />
        </LabeledRow>
      </div>
      {polygon.closed && (
        <LabeledRow label="Fill:">
          <ColorInput value={polygon.fillColor} onChange={handleFillChange} />
        </LabeledRow>
      )}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-white text-sm font-medium" style={{ fontFamily: "var(--font-roboto-mono), monospace" }}>
            Points:
          </span>
          <span className="text-xs text-[#888] font-mono">{polygon.points.length}</span>
        </div>
        <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
          {(polygon.closed && polygon.points.length > 2 ? polygon.points.slice(0, -1) : polygon.points).map((segment, index) => (
            <PointRow
              key={index}
              segment={segment}
              index={index}
              onXChange={handlePointXChange}
              onYChange={handlePointYChange}
              onDelete={handleDeletePoint}
              onInsert={handleInsertPoint}
              isHovered={highlightedPointIndex === index}
              onMouseEnter={() => setHighlightedPointIndex(index)}
              onMouseLeave={() => setHighlightedPointIndex(null)}
              sheet={sheet}
            />
          ))}
        </div>
      </div>
      <button
        type="button"
        onClick={handleCloseOpen}
        className="w-full px-3 py-1.5 bg-[#444] text-white text-sm rounded border border-[#555] hover:border-[#888] transition-colors"
        style={{ fontFamily: "var(--font-roboto-mono), monospace" }}
      >
        {polygon.closed ? "Open polygon" : "Close polygon"}
      </button>
    </div>
  );
}

const PointRow: React.FunctionComponent<{
  segment: PolygonSegment;
  index: number;
  onXChange: (index: number, len: Length) => void;
  onYChange: (index: number, len: Length) => void;
  onDelete: (index: number) => void;
  onInsert: (index: number) => void;
  isHovered?: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  sheet: Sheet;
}> = ({
  segment,
  index,
  onXChange,
  onYChange,
  onDelete,
  onInsert,
  isHovered = false,
  onMouseEnter,
  onMouseLeave,
  sheet,
}) => {
  const isPoint = segment.type === "point";
  const isQuadratic = segment.type === "arc-quadratic";

  const iconColor = isPoint ? "#888" : isQuadratic ? "#3498db" : "#e74c3c";
  const iconLabel = isPoint ? "P" : isQuadratic ? "Q" : "C";

  return (
    <div
      className="flex items-center gap-1 px-2 py-1 bg-[#2a2a2a] rounded border border-[#444]"
      style={{ backgroundColor: isHovered ? '#222' : '#2a2a2a' }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <span
        className="w-4 h-4 flex items-center justify-center text-[10px] font-bold rounded select-none"
        style={{ color: iconColor, fontFamily: "var(--font-roboto-mono), monospace" }}
      >
        {iconLabel}
      </span>
      <div className="flex-1">
        {segment.type === 'point' ? (
          <div className="flex gap-1">
            <LengthInput
              value={Length.fromSheetUnits(sheet, segment.point.x)}
              onChange={(len) => onXChange(index, len)}
              disableUnitSelector
            />
            <LengthInput
              value={Length.fromSheetUnits(sheet, segment.point.y)}
              onChange={(len) => onYChange(index, len)}
              disableUnitSelector
            />
          </div>
        ) : null}
        {segment.type === 'arc-cubic' || segment.type === 'arc-quadratic' ? (
          <div className="flex flex-col gap-1">
            <div className="flex gap-1">
              <LengthInput
                value={Length.fromSheetUnits(sheet, segment.point.x)}
                onChange={(len) => onXChange(index, len)}
                disableUnitSelector
              />
              <LengthInput
                value={Length.fromSheetUnits(sheet, segment.point.y)}
                onChange={(len) => onYChange(index, len)}
                disableUnitSelector
              />
            </div>
            {segment.type === "arc-quadratic" ? (
              <div className="flex gap-1">
                <LengthInput value={Length.fromSheetUnits(sheet, segment.controlPoint.x)} onChange={() => {}} disableUnitSelector />
                <LengthInput value={Length.fromSheetUnits(sheet, segment.controlPoint.y)} onChange={() => {}} disableUnitSelector />
              </div>
            ) : null}
            {segment.type === "arc-cubic" ? (
              <>
                <div className="flex gap-1">
                  <LengthInput value={Length.fromSheetUnits(sheet, segment.controlPointA.x)} onChange={() => {}} disableUnitSelector />
                  <LengthInput value={Length.fromSheetUnits(sheet, segment.controlPointA.y)} onChange={() => {}} disableUnitSelector />
                </div>
                <div className="flex gap-1">
                  <LengthInput value={Length.fromSheetUnits(sheet, segment.controlPointB.x)} onChange={() => {}} disableUnitSelector />
                  <LengthInput value={Length.fromSheetUnits(sheet, segment.controlPointB.y)} onChange={() => {}} disableUnitSelector />
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => onInsert(index)}
        className="w-5 h-5 flex items-center justify-center text-[#888] hover:text-white transition-colors"
        title="Insert point"
      >
        <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
          <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" fill="none" />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => onDelete(index)}
        className="w-5 h-5 flex items-center justify-center text-[#888] hover:text-red-400 transition-colors"
        title="Delete point"
      >
        <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
          <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
        </svg>
      </button>
    </div>
  );
}

function MultiSelectInspector({
  selectedIds,
  geometryStore,
}: {
  selectedIds: Array<string>;
  geometryStore: GeometryStore;
}) {
  const [fillColorValue, setFillColorValue] = useState<{ shared: boolean; value: unknown }>({ shared: false, value: null });

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

  return (
    <div className="flex flex-col gap-3">
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
  sheet,
}: SelectionInspectorProps) {
  const [selectedIds, setSelectedIds] = useState(selectionManager.getSelectedIds());
  useEffect(() => {
    selectionManager.on('selectionChange', setSelectedIds);
    return () => {
      selectionManager.off('selectionChange', setSelectedIds);
    };
  }, [selectionManager]);

  if (selectedIds.length === 0) {
    return null;
  }

  const rectangles = selectedIds
    .map(id => geometryStore.getRectangleById(id))
    .filter((r): r is Rectangle => r !== null);
  const ellipses = selectedIds
    .map(id => geometryStore.getEllipseById(id))
    .filter((e): e is Ellipse => e !== null);
  const polygons = selectedIds
    .map(id => geometryStore.getPolygonById(id))
    .filter((p): p is Polygon => p !== null);

  if (rectangles.length === 0 && ellipses.length === 0 && polygons.length === 0) {
    return null;
  }

  return (
    <div className="absolute right-4 bottom-4 z-30">
      <FloatingPanel>
        {rectangles.length === 1 && ellipses.length === 0 && polygons.length === 0 && (
          <RectangleInspector
            initialRectangle={rectangles[0]}
            geometryStore={geometryStore}
            sheet={sheet}
          />
        )}
        {ellipses.length === 1 && rectangles.length === 0 && polygons.length === 0 && (
          <EllipseInspector
            initialEllipse={ellipses[0]}
            geometryStore={geometryStore}
            sheet={sheet}
          />
        )}
        {polygons.length === 1 && rectangles.length === 0 && ellipses.length === 0 && (
          <PolygonInspector
            initialPolygon={polygons[0]}
            geometryStore={geometryStore}
            sheet={sheet}
          />
        )}
        {selectedIds.length > 1 && (
          <MultiSelectInspector
            selectedIds={selectedIds}
            geometryStore={geometryStore}
          />
        )}
      </FloatingPanel>
    </div>
  );
}
