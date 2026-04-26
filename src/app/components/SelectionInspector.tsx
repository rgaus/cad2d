"use client";

import { useCallback, useEffect, useState } from "react";
import { GeometryStore } from "@/lib/tools/GeometryStore";
import { SelectionManager } from "@/lib/tools/SelectionManager";
import { type Rectangle, type Ellipse, type Polygon, type PolygonSegment } from "@/lib/tools/types";
import { boundingBox } from "@/lib/math";
import { SheetPosition } from "@/lib/viewport/types";
import { Lengths, type Length } from "@/lib/units/length";
import FloatingPanel from "./FloatingPanel";
import LabeledRow from "./LabeledRow";
import LengthInput from "./LengthInput";
import ShapePreview from "./ShapePreview";
import ColorInput from "./ColorInput";

type SelectionInspectorProps = {
  geometryStore: GeometryStore;
  selectionManager: SelectionManager;
  defaultUnit: "mm" | "cm" | "m" | "in" | "ft";
};

function valueOrUndefined(value: unknown): string {
  return value === undefined ? "\u2014" : String(value);
}

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

function RectangleInspector({
  rectangle,
  geometryStore,
  defaultUnit,
}: {
  rectangle: Rectangle;
  geometryStore: GeometryStore;
  defaultUnit: SelectionInspectorProps["defaultUnit"];
}) {
  const [rect, setRect] = useState(rectangle);

  useEffect(() => {
    const handler = (rectangles: Array<Rectangle>) => {
      const updated = rectangles.find(r => r.id === rectangle.id);
      if (updated) {
        setRect(updated);
      }
    };
    geometryStore.on('rectanglesChanged', handler);
    return () => {
      geometryStore.off('rectanglesChanged', handler);
    };
  }, [geometryStore, rectangle.id]);

  const width = rect.lowerRight.x - rect.upperLeft.x;
  const height = rect.lowerRight.y - rect.upperLeft.y;

  const handleXChange = useCallback(
    (len: Length) => {
      const deltaX = len.toCentimeters().magnitude - rect.upperLeft.x;
      geometryStore.updateRectangle(rect.id, {
        upperLeft: new SheetPosition(len.toCentimeters().magnitude, rect.upperLeft.y),
        lowerRight: new SheetPosition(rect.lowerRight.x + deltaX, rect.lowerRight.y),
      });
    },
    [geometryStore, rect]
  );

  const handleYChange = useCallback(
    (len: Length) => {
      const deltaY = len.toCentimeters().magnitude - rect.upperLeft.y;
      geometryStore.updateRectangle(rect.id, {
        upperLeft: new SheetPosition(rect.upperLeft.x, len.toCentimeters().magnitude),
        lowerRight: new SheetPosition(rect.lowerRight.x, rect.lowerRight.y + deltaY),
      });
    },
    [geometryStore, rect]
  );

  const handleWChange = useCallback(
    (len: Length) => {
      const w = len.toCentimeters().magnitude;
      if (rect.linkDimensions) {
        geometryStore.updateRectangle(rect.id, {
          lowerRight: new SheetPosition(rect.upperLeft.x + w, rect.upperLeft.y + w),
        });
      } else {
        geometryStore.updateRectangle(rect.id, {
          lowerRight: new SheetPosition(rect.upperLeft.x + w, rect.lowerRight.y),
        });
      }
    },
    [geometryStore, rect]
  );

  const handleHChange = useCallback(
    (len: Length) => {
      const h = len.toCentimeters().magnitude;
      geometryStore.updateRectangle(rect.id, {
        lowerRight: new SheetPosition(rect.lowerRight.x, rect.upperLeft.y + h),
      });
    },
    [geometryStore, rect]
  );

  const handleLinkToggle = useCallback(() => {
    const newLink = !rect.linkDimensions;
    if (newLink) {
      const w = rect.lowerRight.x - rect.upperLeft.x;
      geometryStore.setRectangleLinkDimensions(rect.id, true);
      geometryStore.updateRectangle(rect.id, {
        lowerRight: new SheetPosition(rect.upperLeft.x + w, rect.upperLeft.y + w),
      });
    } else {
      geometryStore.setRectangleLinkDimensions(rect.id, false);
    }
  }, [geometryStore, rect]);

  const handleFillChange = useCallback(
    (color: number | null) => {
      geometryStore.setRectangleFillColor(rect.id, color);
    },
    [geometryStore, rect]
  );

  return (
    <div className="flex flex-col gap-3">
      <ShapePreview shape={rect} />
      <LabeledRow label="Id:">
        <span className="text-xs text-[#888] font-mono truncate" title={rect.id}>
          {rect.id.slice(0, 8)}
        </span>
      </LabeledRow>
      <LabeledRow label="X:">
        <LengthInput value={Lengths.centimeters(rect.upperLeft.x)} onChange={handleXChange} />
      </LabeledRow>
      <LabeledRow label="Y:">
        <LengthInput value={Lengths.centimeters(rect.upperLeft.y)} onChange={handleYChange} />
      </LabeledRow>
      <div className="flex items-center gap-2">
        <div className="flex-1 max-w-[160px]">
          <LengthInput value={Lengths.centimeters(width)} onChange={handleWChange} />
        </div>
        <LinkButton linked={rect.linkDimensions} onToggle={handleLinkToggle} />
        <div className="flex-1 max-w-[160px]">
          {rect.linkDimensions ? (
            <LengthInput value={Lengths.centimeters(width)} onChange={handleHChange} />
          ) : (
            <LengthInput value={Lengths.centimeters(height)} onChange={handleHChange} />
          )}
        </div>
      </div>
      <LabeledRow label="Fill:">
        <ColorInput value={rect.fillColor} onChange={handleFillChange} />
      </LabeledRow>
    </div>
  );
}

function EllipseInspector({
  ellipse,
  geometryStore,
  defaultUnit,
}: {
  ellipse: Ellipse;
  geometryStore: GeometryStore;
  defaultUnit: SelectionInspectorProps["defaultUnit"];
}) {
  const [ell, setEll] = useState(ellipse);

  useEffect(() => {
    const handler = (ellipses: Array<Ellipse>) => {
      const updated = ellipses.find(e => e.id === ellipse.id);
      if (updated) {
        setEll(updated);
      }
    };
    geometryStore.on('ellipsesChanged', handler);
    return () => {
      geometryStore.off('ellipsesChanged', handler);
    };
  }, [geometryStore, ellipse.id]);

  const handleCXChange = useCallback(
    (len: Length) => {
      geometryStore.updateEllipse(ell.id, {
        center: new SheetPosition(len.toCentimeters().magnitude, ell.center.y),
      });
    },
    [geometryStore, ell]
  );

  const handleCYChange = useCallback(
    (len: Length) => {
      geometryStore.updateEllipse(ell.id, {
        center: new SheetPosition(ell.center.x, len.toCentimeters().magnitude),
      });
    },
    [geometryStore, ell]
  );

  const handleRXChange = useCallback(
    (len: Length) => {
      const rx = len.toCentimeters().magnitude;
      if (ell.linkDimensions) {
        geometryStore.updateEllipse(ell.id, { radiusX: rx, radiusY: rx });
      } else {
        geometryStore.updateEllipse(ell.id, { radiusX: rx });
      }
    },
    [geometryStore, ell]
  );

  const handleRYChange = useCallback(
    (len: Length) => {
      geometryStore.updateEllipse(ell.id, { radiusY: len.toCentimeters().magnitude });
    },
    [geometryStore, ell]
  );

  const handleLinkToggle = useCallback(() => {
    const newLink = !ell.linkDimensions;
    if (newLink) {
      geometryStore.setEllipseLinkDimensions(ell.id, true);
      geometryStore.updateEllipse(ell.id, {
        radiusX: ell.radiusX,
        radiusY: ell.radiusX,
      });
    } else {
      geometryStore.setEllipseLinkDimensions(ell.id, false);
    }
  }, [geometryStore, ell]);

  const handleFillChange = useCallback(
    (color: number | null) => {
      geometryStore.setEllipseFillColor(ell.id, color);
    },
    [geometryStore, ell]
  );

  return (
    <div className="flex flex-col gap-3">
      <ShapePreview shape={ell} />
      <LabeledRow label="Id:">
        <span className="text-xs text-[#888] font-mono truncate" title={ell.id}>
          {ell.id.slice(0, 8)}
        </span>
      </LabeledRow>
      <LabeledRow label="CX:">
        <LengthInput value={Lengths.centimeters(ell.center.x)} onChange={handleCXChange} />
      </LabeledRow>
      <LabeledRow label="CY:">
        <LengthInput value={Lengths.centimeters(ell.center.y)} onChange={handleCYChange} />
      </LabeledRow>
      <div className="flex items-center gap-2">
        <div className="flex-1 max-w-[160px]">
          <LengthInput value={Lengths.centimeters(ell.radiusX)} onChange={handleRXChange} />
        </div>
        <LinkButton linked={ell.linkDimensions} onToggle={handleLinkToggle} />
        <div className="flex-1 max-w-[160px]">
          {ell.linkDimensions ? (
            <LengthInput value={Lengths.centimeters(ell.radiusX)} onChange={handleRYChange} />
          ) : (
            <LengthInput value={Lengths.centimeters(ell.radiusY)} onChange={handleRYChange} />
          )}
        </div>
      </div>
      <LabeledRow label="Fill:">
        <ColorInput value={ell.fillColor} onChange={handleFillChange} />
      </LabeledRow>
    </div>
  );
}

function PolygonInspector({
  polygon,
  geometryStore,
  defaultUnit,
}: {
  polygon: Polygon;
  geometryStore: GeometryStore;
  defaultUnit: SelectionInspectorProps["defaultUnit"];
}) {
  const [poly, setPoly] = useState(polygon);

  useEffect(() => {
    const handler = (polygons: Array<Polygon>) => {
      const updated = polygons.find(p => p.id === polygon.id);
      if (updated) {
        setPoly(updated);
      }
    };
    geometryStore.on('polygonsChanged', handler);
    return () => {
      geometryStore.off('polygonsChanged', handler);
    };
  }, [geometryStore, polygon.id]);

  const bounds = boundingBox(poly.points.map(s => s.point));

  const handlePointXChange = useCallback(
    (index: number, len: Length) => {
      const segments = poly.points.map((s, i) => {
        if (i !== index) return s;
        return { ...s, point: new SheetPosition(len.toCentimeters().magnitude, s.point.y) };
      });
      geometryStore.updatePolygon(poly.id, { points: segments });
    },
    [geometryStore, poly]
  );

  const handlePointYChange = useCallback(
    (index: number, len: Length) => {
      const segments = poly.points.map((s, i) => {
        if (i !== index) return s;
        return { ...s, point: new SheetPosition(s.point.x, len.toCentimeters().magnitude) };
      });
      geometryStore.updatePolygon(poly.id, { points: segments });
    },
    [geometryStore, poly]
  );

  const handleDeletePoint = useCallback(
    (index: number) => {
      const segments = poly.points.filter((_, i) => i !== index);
      geometryStore.updatePolygon(poly.id, { points: segments });
    },
    [geometryStore, poly]
  );

  const handleInsertPoint = useCallback(
    (index: number) => {
      const seg = poly.points[index];
      const nextSeg = poly.points[index + 1];
      if (!seg || !nextSeg) return;
      const midX = (seg.point.x + nextSeg.point.x) / 2;
      const midY = (seg.point.y + nextSeg.point.y) / 2;
      geometryStore.addPointOnEdge(poly.id, index, new SheetPosition(midX, midY));
    },
    [geometryStore, poly]
  );

  const handleFillChange = useCallback(
    (color: number | null) => {
      geometryStore.setPolygonFillColor(poly.id, color);
    },
    [geometryStore, poly]
  );

  const handleCloseOpen = useCallback(() => {
    if (poly.closed) {
      geometryStore.openPolygon(poly.id);
    } else {
      geometryStore.closePolygon(poly.id);
    }
  }, [geometryStore, poly]);

  return (
    <div className="flex flex-col gap-3">
      <ShapePreview shape={poly} />
      <LabeledRow label="Id:">
        <span className="text-xs text-[#888] font-mono truncate" title={poly.id}>
          {poly.id.slice(0, 8)}
        </span>
      </LabeledRow>
      <div className="flex gap-2">
        <LabeledRow label="X:">
          <LengthInput value={Lengths.centimeters(bounds.position.x)} onChange={() => {}} />
        </LabeledRow>
        <LabeledRow label="Y:">
          <LengthInput value={Lengths.centimeters(bounds.position.y)} onChange={() => {}} />
        </LabeledRow>
      </div>
      <div className="flex gap-2">
        <LabeledRow label="W:">
          <LengthInput value={Lengths.centimeters(bounds.width)} onChange={() => {}} />
        </LabeledRow>
        <LabeledRow label="H:">
          <LengthInput value={Lengths.centimeters(bounds.height)} onChange={() => {}} />
        </LabeledRow>
      </div>
      {poly.closed && (
        <LabeledRow label="Fill:">
          <ColorInput value={poly.fillColor} onChange={handleFillChange} />
        </LabeledRow>
      )}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-white text-sm font-medium" style={{ fontFamily: "var(--font-roboto-mono), monospace" }}>
            Points
          </span>
          <span className="text-xs text-[#888] font-mono">{poly.points.length}</span>
        </div>
        <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
          {poly.points.map((segment, index) => (
            <PointRow
              key={index}
              segment={segment}
              index={index}
              onXChange={handlePointXChange}
              onYChange={handlePointYChange}
              onDelete={handleDeletePoint}
              onInsert={handleInsertPoint}
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
        {poly.closed ? "Open polygon" : "Close polygon"}
      </button>
    </div>
  );
}

function PointRow({
  segment,
  index,
  onXChange,
  onYChange,
  onDelete,
  onInsert,
}: {
  segment: PolygonSegment;
  index: number;
  onXChange: (index: number, len: Length) => void;
  onYChange: (index: number, len: Length) => void;
  onDelete: (index: number) => void;
  onInsert: (index: number) => void;
}) {
  const isPoint = segment.type === "point";
  const isQuadratic = segment.type === "arc-quadratic";
  const isCubic = segment.type === "arc-cubic";

  const iconColor = isPoint ? "#888" : isQuadratic ? "#3498db" : "#e74c3c";
  const iconLabel = isPoint ? "P" : isQuadratic ? "Q" : "C";

  return (
    <div className="flex items-center gap-1 px-2 py-1 bg-[#2a2a2a] rounded border border-[#444]">
      <span
        className="w-4 h-4 flex items-center justify-center text-[10px] font-bold rounded"
        style={{ color: iconColor, fontFamily: "var(--font-roboto-mono), monospace" }}
      >
        {iconLabel}
      </span>
      <div className="flex-1">
        {isPoint ? (
          <div className="flex gap-1">
            <LengthInput
              value={Lengths.centimeters(segment.point.x)}
              onChange={(len) => onXChange(index, len)}
            />
            <LengthInput
              value={Lengths.centimeters(segment.point.y)}
              onChange={(len) => onYChange(index, len)}
            />
          </div>
        ) : (
          <div className="flex gap-1 flex-wrap">
            <LengthInput
              value={Lengths.centimeters(segment.point.x)}
              onChange={(len) => onXChange(index, len)}
            />
            <LengthInput
              value={Lengths.centimeters(segment.point.y)}
              onChange={(len) => onYChange(index, len)}
            />
            {isQuadratic && (
              <>
                <LengthInput value={Lengths.centimeters(segment.controlPoint.x)} onChange={() => {}} />
                <LengthInput value={Lengths.centimeters(segment.controlPoint.y)} onChange={() => {}} />
              </>
            )}
            {isCubic && (
              <>
                <LengthInput value={Lengths.centimeters(segment.controlPointA.x)} onChange={() => {}} />
                <LengthInput value={Lengths.centimeters(segment.controlPointA.y)} onChange={() => {}} />
                <LengthInput value={Lengths.centimeters(segment.controlPointB.x)} onChange={() => {}} />
                <LengthInput value={Lengths.centimeters(segment.controlPointB.y)} onChange={() => {}} />
              </>
            )}
          </div>
        )}
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

  const allClosed = fillColorValue.value !== null || selectedIds.length === 0;

  return (
    <div className="flex flex-col gap-3">
      {allClosed && (
        <LabeledRow label="Fill:">
          <ColorInput
            value={fillColorValue.shared ? (fillColorValue.value as number | null) : null}
            onChange={handleFillChange}
          />
        </LabeledRow>
      )}
    </div>
  );
}

export default function SelectionInspector({
  geometryStore,
  selectionManager,
  defaultUnit,
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
      <FloatingPanel title={`Selection (${selectedIds.length})`}>
        {rectangles.length === 1 && ellipses.length === 0 && polygons.length === 0 && (
          <RectangleInspector
            rectangle={rectangles[0]}
            geometryStore={geometryStore}
            defaultUnit={defaultUnit}
          />
        )}
        {ellipses.length === 1 && rectangles.length === 0 && polygons.length === 0 && (
          <EllipseInspector
            ellipse={ellipses[0]}
            geometryStore={geometryStore}
            defaultUnit={defaultUnit}
          />
        )}
        {polygons.length === 1 && rectangles.length === 0 && ellipses.length === 0 && (
          <PolygonInspector
            polygon={polygons[0]}
            geometryStore={geometryStore}
            defaultUnit={defaultUnit}
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
