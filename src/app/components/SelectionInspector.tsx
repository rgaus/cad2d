'use client';

import debounce from 'lodash.debounce';
import { Link2Icon, Link2OffIcon, ListChevronsUpDownIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import RenderOrderInput from '@/components/RenderOrderInput';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useGeometriesById } from '@/hooks/useGeometryById';
import { ActionsManager } from '@/lib/actions/ActionsManager';
import {
  Entity,
  FillColorComponent,
  FrameComponent,
  GeometryComponent,
  type Id,
  LinkDimensionsComponent,
  RenderOrderComponent,
} from '@/lib/entity';
import { GeometryStore } from '@/lib/entity/GeometryStore';
import { ConstraintComponent } from '@/lib/entity/components/ConstraintComponent';
import { FilterComponent } from '@/lib/entity/components/FilterComponent';
import {
  ColinearConstraintData,
  HorizontalConstraintData,
  LinearConstraintData,
  ParallelConstraintData,
  PerpendicularConstraintData,
  VerticalConstraintData,
} from '@/lib/entity/constraints';
import { type Filter } from '@/lib/entity/filters';
import { ChamferFilterData } from '@/lib/entity/filters/chamfer';
import { FilletFilterData } from '@/lib/entity/filters/fillet';
import { MirrorFilterData } from '@/lib/entity/filters/mirror';
import { PatternGridFilterData, PatternRadialFilterData } from '@/lib/entity/filters/pattern';
import { EllipseData } from '@/lib/entity/geometry/ellipse';
import { PolygonData } from '@/lib/entity/geometry/polygon';
import { RectangleData } from '@/lib/entity/geometry/rectangle';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { UndoEntry } from '@/lib/history/types';
import { BoundingBox } from '@/lib/math';
import {
  type Field,
  FieldLabel,
  FieldRow,
  SelectionInspectorField,
  type WorkingFieldData,
} from '@/lib/selection/SelectionInspectorManager';
import { Sheet } from '@/lib/sheet/Sheet';
import { SelectionManager } from '@/lib/tools/SelectionManager';
import { Length, type UnitType } from '@/lib/units/length';
import { cn } from '@/lib/utils';
import { SheetPosition } from '@/lib/viewport/types';
import type { Rect } from '@/lib/viewport/types';
import AngleInput from './AngleInput';
import ColorInput from './ColorInput';
import {
  ColinearConstraintInspector,
  HorizontalConstraintInspector,
  LinearConstraintInspector,
  ParallelConstraintInspector,
  PerpendicularConstraintInspector,
  VerticalConstraintInspector,
} from './ConstraintInspectors';
import {
  ChamferFilterInspector,
  FilletFilterInspector,
  MirrorFilterInspector,
} from './FilterInspectors';
import FloatingPanel from './FloatingPanel';
import LabeledRow from './LabeledRow';
import LengthInput, { type LengthInputHandle } from './LengthInput';
import PolygonPointsInspector, {
  POINT_ROW_HEIGHT_PX_BY_TYPE,
  type PointRowRefs,
} from './PolygonPointsInspector';
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
        'w-6 h-6 grow-0 shrink-0 flex items-center justify-center rounded-[4px] transition-colors border',
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

/** Returns a list of filters which are associated with the given geometry id. */
function useGeometryFilters(geometryStore: GeometryStore, geometryId?: Entity['id'] | null) {
  const [filters, setFilters] = useState<Array<Filter>>(() => {
    return geometryId ? geometryStore.findFiltersByGeometryId(geometryId) : [];
  });

  useEffect(() => {
    const update = (entity: Entity) => {
      if (!Entity.hasComponent(entity, FilterComponent)) {
        return;
      }
      const data = FilterComponent.get(entity);
      if (data.geometryId !== geometryId) {
        return;
      }
      setFilters(geometryStore.findFiltersByGeometryId(geometryId));
    };
    geometryStore.on('geometryUpdated', update);
    return () => {
      geometryStore.off('geometryUpdated', update);
    };
  }, [geometryStore, geometryId]);

  return filters;
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
    GeometryComponent<RectangleData> & LinkDimensionsComponent
  > | null>(() => {
    const geometry = geometryStore.getByIdWithComponents(
      rectangleId,
      GeometryComponent,
      LinkDimensionsComponent,
    );
    if (!geometry) {
      return null;
    }
    if (!GeometryComponent.isRectangle(geometry)) {
      return null;
    }
    return geometry;
  });

  const filters = useGeometryFilters(geometryStore, geometry?.id);

  const rectangle = useMemo(() => (geometry ? GeometryComponent.get(geometry) : null), [geometry]);
  const linkDimensions = useMemo(
    () => (geometry ? LinkDimensionsComponent.get(geometry) : null),
    [geometry],
  );
  useEffect(() => {
    const geom = geometryStore.getByIdWithComponents(
      rectangleId,
      GeometryComponent,
      LinkDimensionsComponent,
    );
    if (geom && GeometryComponent.isRectangle(geom)) {
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
      if (
        geometry.id !== rectangleId ||
        !Entity.hasComponent(geometry, GeometryComponent) ||
        !GeometryComponent.isRectangle(geometry)
      ) {
        return;
      }
      const updated = GeometryComponent.get(geometry);

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
        !Entity.hasComponent(geometry, GeometryComponent) ||
        !Entity.hasComponent(geometry, LinkDimensionsComponent) ||
        !GeometryComponent.isRectangle(geometry)
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
      geometryStore.updateByIdWithComponent(rectangleId, GeometryComponent, (old) =>
        GeometryComponent.update(old, { upperLeft, lowerRight }),
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
      geometryStore.updateByIdWithComponent(rectangleId, GeometryComponent, (old) =>
        GeometryComponent.update(old, { upperLeft, lowerRight }),
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

      geometryStore.updateByIdWithComponent(rectangleId, GeometryComponent, (old) =>
        GeometryComponent.update(old, { lowerRight: newLowerRight }),
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

      geometryStore.updateByIdWithComponent(rectangleId, GeometryComponent, (old) =>
        GeometryComponent.update(old, { lowerRight: newLowerRight }),
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
          {geometry ? (
            <ShapePreview
              geometry={geometry}
              sheetDefaultUnit={sheetDefaultUnit}
              filters={filters}
              editingDimension={editingDimension}
            />
          ) : null}
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
    GeometryComponent<EllipseData> & LinkDimensionsComponent
  > | null>(() => {
    const geometry = geometryStore.getByIdWithComponents(
      ellipseId,
      GeometryComponent,
      LinkDimensionsComponent,
    );
    if (!geometry) {
      return null;
    }
    if (!GeometryComponent.isEllipse(geometry)) {
      return null;
    }
    return geometry;
  });

  const filters = useGeometryFilters(geometryStore, geometry?.id);

  const ellipse = useMemo(() => (geometry ? GeometryComponent.get(geometry) : null), [geometry]);
  const linkDimensions = useMemo(
    () => (geometry ? LinkDimensionsComponent.get(geometry) : null),
    [geometry],
  );
  useEffect(() => {
    const geom = geometryStore.getByIdWithComponents(
      ellipseId,
      GeometryComponent,
      LinkDimensionsComponent,
    );
    if (geom && GeometryComponent.isEllipse(geom)) {
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
      if (
        geometry.id !== ellipseId ||
        !Entity.hasComponent(geometry, GeometryComponent) ||
        !GeometryComponent.isEllipse(geometry)
      ) {
        return;
      }
      const updated = GeometryComponent.get(geometry);

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
        !Entity.hasComponent(geometry, GeometryComponent) ||
        !Entity.hasComponent(geometry, LinkDimensionsComponent) ||
        !GeometryComponent.isEllipse(geometry)
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
      geometryStore.updateByIdWithComponent(ellipseId, GeometryComponent, (old) =>
        GeometryComponent.update(old, {
          center: new SheetPosition(newCX, GeometryComponent.get(old).center.y),
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
      geometryStore.updateByIdWithComponent(ellipseId, GeometryComponent, (old) =>
        GeometryComponent.update(old, {
          center: new SheetPosition(GeometryComponent.get(old).center.x, newCY),
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
        geometryStore.updateByIdWithComponent(ellipseId, GeometryComponent, (old) =>
          GeometryComponent.update(old, { radiusX: rx, radiusY: rx }),
        );
      } else {
        geometryStore.updateByIdWithComponent(ellipseId, GeometryComponent, (old) =>
          GeometryComponent.update(old, { radiusX: rx }),
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
        geometryStore.updateByIdWithComponent(ellipseId, GeometryComponent, (old) =>
          GeometryComponent.update(old, { radiusX: ry, radiusY: ry }),
        );
      } else {
        geometryStore.updateByIdWithComponent(ellipseId, GeometryComponent, (old) =>
          GeometryComponent.update(old, { radiusY: ry }),
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
          {geometry ? (
            <ShapePreview
              geometry={geometry}
              sheetDefaultUnit={sheetDefaultUnit}
              filters={filters}
              editingDimension={editingDimension}
            />
          ) : null}
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
  const [polygon, setPolygon] = useState<Entity<GeometryComponent<PolygonData>> | null>(() => {
    const geometry = geometryStore.getByIdWithComponent(polygonId, GeometryComponent);
    if (!geometry) {
      return null;
    }
    if (!GeometryComponent.isPolygon(geometry)) {
      return null;
    }
    return geometry;
  });

  const filters = useGeometryFilters(geometryStore, polygon?.id);

  const [shapePreviewHighlight, setShapePreviewHighlight] = useState<ShapePreviewHighlight | null>(
    null,
  );
  const [editingDimension, setEditingDimension] = useState<ShapePreviewEditingDimension | null>(
    null,
  );
  const [openAtIndexDragging, setOpenAtIndexDragging] = useState(false);

  const pointInputRefs = useRef<Map<number, PointRowRefs>>(new Map());

  useEffect(() => {
    const geometry = geometryStore.getByIdWithComponent(polygonId, GeometryComponent);
    if (!geometry) {
      return;
    }
    const data = GeometryComponent.get(geometry);
    if (data.type !== 'polygon') {
      return;
    }
    setPolygon(geometry as Entity<GeometryComponent<PolygonData>>);
  }, [geometryStore, polygonId]);

  useEffect(() => {
    const handler = (updated: Entity) => {
      if (
        updated.id !== polygonId ||
        !Entity.hasComponent(updated, GeometryComponent) ||
        !GeometryComponent.isPolygon(updated)
      ) {
        return;
      }
      const updatedData = GeometryComponent.get(updated);
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

        const oldData = GeometryComponent.get(oldPolygon);
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
          newPolygon = GeometryComponent.update<
            PolygonData,
            Entity<GeometryComponent<PolygonData>>
          >(newPolygon, updatedData);
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
      if (
        geometry.id !== polygonId ||
        !Entity.hasComponent(geometry, GeometryComponent) ||
        !GeometryComponent.isPolygon(geometry)
      ) {
        return;
      }
      setPolygon(geometry);
    }, GEOMETRY_UPDATE_DEBOUNCE_MS);

    geometryStore.on('geometryUpdated', debouncedHandler);
    return () => {
      geometryStore.off('geometryUpdated', debouncedHandler);
    };
  }, [geometryStore, polygonId]);

  const bounds = useMemo(
    () =>
      polygon
        ? BoundingBox.fromPoints(GeometryComponent.get(polygon).points.map((s) => s.point))
        : null,
    [polygon],
  );

  // Some filters (ie, MirrorFilter) can fill a polygon automatically even if it isn't itself closed
  // (ie, a non closed polygon attached to a mirror filter could have both mirrored sides combined
  // into a fully closed shape). When this occurs, render the close / open polygon button in a
  // special state.
  const isPolygonFilledDueToFilter = useMemo(() => {
    if (!polygon) {
      return false;
    }

    const data = GeometryComponent.get(polygon);
    if (data.closed) {
      return false;
    }

    const fillColor = FillColorComponent.getOptional(polygon);
    return typeof fillColor !== 'undefined';
  }, [polygon]);

  const handlePointXChange = useCallback(
    (index: number, len: Length) => {
      if (!polygon) {
        return;
      }
      const newX = len.toSheetUnits(sheetDefaultUnit).magnitude;
      geometryStore.updateByIdWithComponent(polygon.id, GeometryComponent, (prev) => {
        if (!GeometryComponent.isPolygon(prev)) {
          return prev;
        }
        const prevData = GeometryComponent.get(prev);
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
        return GeometryComponent.update(prev, {
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
      geometryStore.updateByIdWithComponent(polygon.id, GeometryComponent, (prev) => {
        if (!GeometryComponent.isPolygon(prev)) {
          return prev;
        }
        const prevData = GeometryComponent.get(prev);
        const segments = prevData.points.map((s, i) => {
          if (i !== index) {
            return s;
          }
          return { ...s, point: new SheetPosition(s.point.x, newY) };
        });
        return GeometryComponent.update(prev, {
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
        geometryStore.updateByIdWithComponent(prev.id, GeometryComponent, (old) => {
          if (!GeometryComponent.isPolygon(old)) {
            return prev;
          }
          const oldData = GeometryComponent.get(old);
          return GeometryComponent.update(old, {
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
        const prevData = GeometryComponent.get(prev);
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
      const polygonData = GeometryComponent.get(polygon);
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
      const polygonData = GeometryComponent.get(polygon);
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
      const polygonData = GeometryComponent.get(polygon);
      const afterSegments = BoundingBox.interpolatePoints(polygonData.points, bounds, newBounds);

      historyManager.apply(
        UndoEntry.polygonBoundingBoxResize(polygon.id, polygonData.points, afterSegments),
      );
    },
    [polygon, bounds, sheetDefaultUnit],
  );

  const handleCloseOpen = useCallback(() => {
    if (!polygon) return;
    const polygonData = GeometryComponent.get(polygon);
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

    const polygonData = GeometryComponent.get(polygon);
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
      geometryStore.updateByIdWithComponentDirect(polygon.id, GeometryComponent, (old) =>
        GeometryComponent.update(old, {
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

  const polygonData = GeometryComponent.get(polygon);

  return (
    <div className={cn('flex flex-col gap-3', { 'select-none': openAtIndexDragging })}>
      <div className="flex flex-row justify-center w-full py-2">
        <div className="w-20 shrink-0 aspect-square overflow-hidden">
          <ShapePreview
            geometry={polygon}
            sheetDefaultUnit={sheetDefaultUnit}
            filters={filters}
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
                  onFocus={() => setEditingDimension('height')}
                  onBlur={() => setEditingDimension(null)}
                  roundPlaces={sheetUnitPlaces}
                  readOnlyUnit
                />
              </LabeledRow>
            </div>
          </div>
        ) : null}
      </div>

      <PolygonPointsInspector
        data={polygonData}
        sheetUnitPlaces={sheetUnitPlaces}
        sheetDefaultUnit={sheetDefaultUnit}
        pointInputRefs={pointInputRefs.current}
        highlight={shapePreviewHighlight}
        openAtIndexDragging={openAtIndexDragging}
        onPointXChange={handlePointXChange}
        onPointYChange={handlePointYChange}
        onControlPointChange={handleControlPointChange}
        onDeletePoint={handleDeletePoint}
        onInsertPoint={handleInsertPoint}
        onPointMouseEnter={(index) => {
          if (openAtIndexDragging) {
            return;
          }
          setShapePreviewHighlight({ type: 'point', index });
        }}
        onPointMouseLeave={() => {
          if (openAtIndexDragging) {
            return;
          }
          setShapePreviewHighlight(null);
        }}
        onOpenAtIndexMouseEnter={() =>
          setShapePreviewHighlight({
            type: 'segment',
            index: polygonData.openAtIndex,
            color: POLYGON_OPEN_SEGMENT_HIGHLIGHT_COLOR,
          })
        }
        onOpenAtIndexMouseLeave={() => setShapePreviewHighlight(null)}
        onOpenAtIndexMouseDown={handleOpenAtIndexDragStart}
      />
      {isPolygonFilledDueToFilter ? (
        <div className="flex items-center justify-center px-3 h-9 bg-[var(--slate-4)] border-[var(--slate-6)] border-1">
          <span className="text-xs font-medium select-none text-[var(--slate-9)]">
            Auto closed by filter
          </span>
        </div>
      ) : (
        <Button
          type="button"
          variant="secondary"
          disabled={isPolygonFilledDueToFilter}
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
      )}
    </div>
  );
};

const PatternGridFilterInspector: React.FunctionComponent<{
  filterId: Id;
  geometryStore: GeometryStore;
}> = ({ filterId, geometryStore }) => {
  const [filterEntity, setFilterEntity] = useState<Entity<
    FilterComponent<PatternGridFilterData>
  > | null>(() => {
    const entity = geometryStore.getById(filterId);
    if (!entity || !Entity.hasComponent(entity, FilterComponent)) {
      return null;
    }
    const data = FilterComponent.get(entity);
    if (data.type !== 'pattern' || data.mode !== 'grid') {
      return null;
    }
    return entity;
  });

  const filterData = useMemo(
    () => (filterEntity ? FilterComponent.get(filterEntity) : null),
    [filterEntity],
  );

  useEffect(() => {
    // NOTE: the "repeats" values don't change often, so a debounce isn't required here.
    const handler = (entity: Entity) => {
      if (entity.id !== filterId || !Entity.hasComponent(entity, FilterComponent)) {
        return;
      }
      const data = FilterComponent.get(entity);
      if (data.type !== 'pattern' || data.mode !== 'grid') {
        return;
      }
      setFilterEntity(entity as Entity<FilterComponent<PatternGridFilterData>>);
    };

    geometryStore.on('geometryUpdated', handler);
    return () => {
      geometryStore.off('geometryUpdated', handler);
    };
  }, [geometryStore, filterId]);

  if (!filterData) {
    return null;
  }

  const handleXRepeatsChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = parseInt(e.target.value, 10);
      if (isNaN(val) || val < 1) {
        return;
      }
      geometryStore.updateByIdWithComponent(filterId, FilterComponent, (g) =>
        FilterComponent.update(g, { xRepeats: val }),
      );
    },
    [geometryStore, filterId],
  );

  const handleYRepeatsChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = parseInt(e.target.value, 10);
      if (isNaN(val) || val < 1) {
        return;
      }
      geometryStore.updateByIdWithComponent(filterId, FilterComponent, (g) =>
        FilterComponent.update(g, { yRepeats: val }),
      );
    },
    [geometryStore, filterId],
  );

  return (
    <div className="flex flex-col gap-3">
      <LabeledRow label="Repeats:" fullWidth>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 items-center grow shrink min-w-0">
            <ListChevronsUpDownIcon size={16} className="shrink-0 rotate-90" />
            <Input
              type="number"
              min={1}
              value={filterData.xRepeats}
              onChange={handleXRepeatsChange}
              onKeyDown={(e) => e.stopPropagation()}
              className="grow shrink min-w-0"
            />
          </div>
          <div className="flex gap-1 items-center grow shrink min-w-0">
            <ListChevronsUpDownIcon size={16} className="shrink-0" />
            <Input
              type="number"
              min={1}
              value={filterData.yRepeats}
              onChange={handleYRepeatsChange}
              onKeyDown={(e) => e.stopPropagation()}
              className="grow shrink min-w-0"
            />
          </div>
        </div>
      </LabeledRow>
    </div>
  );
};

const PatternRadialFilterInspector: React.FunctionComponent<{
  filterId: Id;
  geometryStore: GeometryStore;
  sheetUnitPlaces: Sheet['unitPlaces'];
  sheetDefaultUnit: UnitType;
}> = ({ filterId, geometryStore, sheetUnitPlaces, sheetDefaultUnit }) => {
  const [filterEntity, setFilterEntity] = useState<Entity<
    FilterComponent<PatternRadialFilterData>
  > | null>(() => {
    const entity = geometryStore.getByIdWithComponent(filterId, FilterComponent);
    if (!entity) {
      return null;
    }
    const data = FilterComponent.get(entity);
    if (data.type !== 'pattern' || data.mode !== 'radial') {
      return null;
    }
    return entity as Entity<FilterComponent<PatternRadialFilterData>>;
  });

  const filterData = useMemo(
    () => (filterEntity ? FilterComponent.get(filterEntity) : null),
    [filterEntity],
  );

  useEffect(() => {
    // NOTE: the "repeats" values don't change often, so a debounce isn't required here.
    const handler = (entity: Entity) => {
      if (entity.id !== filterId || !Entity.hasComponent(entity, FilterComponent)) {
        return;
      }
      const data = FilterComponent.get(entity);
      if (data.type !== 'pattern' || data.mode !== 'radial') {
        return;
      }
      setFilterEntity(entity as Entity<FilterComponent<PatternRadialFilterData>>);
    };

    geometryStore.on('geometryUpdated', handler);
    return () => {
      geometryStore.off('geometryUpdated', handler);
    };
  }, [geometryStore, filterId]);

  // Low-latency direct DOM updates during drag via refs
  const cxInputRef = useRef<LengthInputHandle>(null);
  const cyInputRef = useRef<LengthInputHandle>(null);
  useEffect(() => {
    const handler = (entity: Entity) => {
      if (entity.id !== filterId || !Entity.hasComponent(entity, FilterComponent)) {
        return;
      }
      const data = FilterComponent.get(entity);
      if (data.type !== 'pattern' || data.mode !== 'radial') {
        return;
      }
      cxInputRef.current?.setDisplayValue(Length.fromSheetUnits(sheetDefaultUnit, data.center.x));
      cyInputRef.current?.setDisplayValue(Length.fromSheetUnits(sheetDefaultUnit, data.center.y));
    };
    geometryStore.on('geometryUpdated', handler);
    return () => {
      geometryStore.off('geometryUpdated', handler);
    };
  }, [geometryStore, filterId]);

  if (!filterData) {
    return null;
  }

  const handleCXChange = useCallback(
    (len: Length) => {
      if (!filterData) {
        return;
      }
      const newX = len.toSheetUnits(sheetDefaultUnit).magnitude;
      geometryStore.updateByIdWithComponent(filterId, FilterComponent, (g) =>
        FilterComponent.update(g, {
          center: new SheetPosition(newX, filterData.center.y),
        }),
      );
    },
    [geometryStore, filterId, filterData, sheetDefaultUnit],
  );

  const handleCYChange = useCallback(
    (len: Length) => {
      if (!filterData) {
        return;
      }
      const newY = len.toSheetUnits(sheetDefaultUnit).magnitude;
      geometryStore.updateByIdWithComponent(filterId, FilterComponent, (g) =>
        FilterComponent.update(g, {
          center: new SheetPosition(filterData.center.x, newY),
        }),
      );
    },
    [geometryStore, filterId, filterData, sheetDefaultUnit],
  );

  const handleRepeatsChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = parseInt(e.target.value, 10);
      if (isNaN(val) || val < 2) {
        return;
      }
      geometryStore.updateByIdWithComponent(filterId, FilterComponent, (g) =>
        FilterComponent.update(g, {
          repeats: { type: 'count' as const, count: val },
        }),
      );
    },
    [geometryStore, filterId],
  );

  const handleRadiusChange = useCallback(
    (len: Length) => {
      if (!filterData) {
        return;
      }
      const radius = len.toSheetUnits(sheetDefaultUnit).magnitude;
      geometryStore.updateByIdWithComponent(filterId, FilterComponent, (g) =>
        FilterComponent.update(g, { radius }),
      );
    },
    [geometryStore, filterId, sheetDefaultUnit],
  );

  const count = filterData.repeats?.count ?? 4;
  const radius = filterData.radius ?? 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0 pr-8">
          <LabeledRow label="X:">
            <LengthInput
              ref={cxInputRef}
              value={Length.fromSheetUnits(sheetDefaultUnit, filterData.center.x)}
              onChange={handleCXChange}
              roundPlaces={sheetUnitPlaces}
              readOnlyUnit
            />
          </LabeledRow>
        </div>
        <div className="flex-1 min-w-0">
          <LabeledRow label="Y:">
            <LengthInput
              ref={cyInputRef}
              value={Length.fromSheetUnits(sheetDefaultUnit, filterData.center.y)}
              onChange={handleCYChange}
              roundPlaces={sheetUnitPlaces}
              readOnlyUnit
            />
          </LabeledRow>
        </div>
      </div>
      <LabeledRow label="Repeats:">
        <Input
          type="number"
          min={3}
          value={count}
          onChange={handleRepeatsChange}
          onKeyDown={(e) => e.stopPropagation()}
        />
      </LabeledRow>
      <LabeledRow label="Radius:">
        <LengthInput
          value={Length.fromSheetUnits(sheetDefaultUnit, radius)}
          onChange={handleRadiusChange}
          roundPlaces={sheetUnitPlaces}
          readOnlyUnit
        />
      </LabeledRow>
    </div>
  );
};

const FrameInspector: React.FunctionComponent<{
  frameId: Id;
  geometryStore: GeometryStore;
  sheetUnitPlaces: Sheet['unitPlaces'];
  sheetDefaultUnit: UnitType;
}> = ({ frameId, geometryStore, sheetUnitPlaces, sheetDefaultUnit }) => {
  const [frameEntity, setFrameEntity] = useState<Entity<FrameComponent> | null>(() => {
    return geometryStore.getByIdWithComponent(frameId, FrameComponent);
  });

  const frameData = useMemo(
    () => (frameEntity ? FrameComponent.get(frameEntity) : null),
    [frameEntity],
  );

  useEffect(() => {
    const debouncedHandler = debounce((entity: Entity) => {
      if (entity.id !== frameId || !Entity.hasComponent(entity, FrameComponent)) {
        return;
      }
      setFrameEntity(entity as Entity<FrameComponent>);
    }, GEOMETRY_UPDATE_DEBOUNCE_MS);

    geometryStore.on('geometryUpdated', debouncedHandler);
    return () => {
      geometryStore.off('geometryUpdated', debouncedHandler);
    };
  }, [geometryStore, frameId]);

  // Low-latency direct DOM updates during drag via refs
  const xInputRef = useRef<LengthInputHandle>(null);
  const yInputRef = useRef<LengthInputHandle>(null);
  const wInputRef = useRef<LengthInputHandle>(null);
  const hInputRef = useRef<LengthInputHandle>(null);
  useEffect(() => {
    const handler = (entity: Entity) => {
      if (entity.id !== frameId || !Entity.hasComponent(entity, FrameComponent)) {
        return;
      }
      const frame = FrameComponent.get(entity);
      xInputRef.current?.setDisplayValue(
        Length.fromSheetUnits(sheetDefaultUnit, frame.upperLeft.x),
      );
      yInputRef.current?.setDisplayValue(
        Length.fromSheetUnits(sheetDefaultUnit, frame.upperLeft.y),
      );
      const w = frame.lowerRight.x - frame.upperLeft.x;
      wInputRef.current?.setDisplayValue(Length.fromSheetUnits(sheetDefaultUnit, w));
      const h = frame.lowerRight.y - frame.upperLeft.y;
      hInputRef.current?.setDisplayValue(Length.fromSheetUnits(sheetDefaultUnit, h));
    };
    geometryStore.on('geometryUpdated', handler);
    return () => {
      geometryStore.off('geometryUpdated', handler);
    };
  }, [geometryStore, frameId]);

  if (!frameData) {
    return null;
  }

  const width = frameData.lowerRight.x - frameData.upperLeft.x;
  const height = frameData.lowerRight.y - frameData.upperLeft.y;

  const handleXChange = useCallback(
    (len: Length) => {
      if (!frameData) {
        return;
      }
      const newX = len.toSheetUnits(sheetDefaultUnit).magnitude;
      const deltaX = newX - frameData.upperLeft.x;
      geometryStore.updateById(frameId, (g) => {
        if (!Entity.hasComponent(g, FrameComponent)) {
          return g;
        }
        return FrameComponent.update(g, {
          upperLeft: new SheetPosition(newX, frameData.upperLeft.y),
          lowerRight: new SheetPosition(frameData.lowerRight.x + deltaX, frameData.lowerRight.y),
        });
      });
    },
    [geometryStore, frameId, frameData, sheetDefaultUnit],
  );

  const handleYChange = useCallback(
    (len: Length) => {
      if (!frameData) {
        return;
      }
      const newY = len.toSheetUnits(sheetDefaultUnit).magnitude;
      const deltaY = newY - frameData.upperLeft.y;
      geometryStore.updateById(frameId, (g) => {
        if (!Entity.hasComponent(g, FrameComponent)) {
          return g;
        }
        return FrameComponent.update(g, {
          upperLeft: new SheetPosition(frameData.upperLeft.x, newY),
          lowerRight: new SheetPosition(frameData.lowerRight.x, frameData.lowerRight.y + deltaY),
        });
      });
    },
    [geometryStore, frameId, frameData, sheetDefaultUnit],
  );

  const handleWChange = useCallback(
    (len: Length) => {
      if (!frameData) {
        return;
      }
      const w = len.toSheetUnits(sheetDefaultUnit).magnitude;
      geometryStore.updateById(frameId, (g) => {
        if (!Entity.hasComponent(g, FrameComponent)) {
          return g;
        }
        return FrameComponent.update(g, {
          lowerRight: new SheetPosition(frameData.upperLeft.x + w, frameData.lowerRight.y),
        });
      });
    },
    [geometryStore, frameId, frameData, sheetDefaultUnit],
  );

  const handleHChange = useCallback(
    (len: Length) => {
      if (!frameData) {
        return;
      }
      const h = len.toSheetUnits(sheetDefaultUnit).magnitude;
      geometryStore.updateById(frameId, (g) => {
        if (!Entity.hasComponent(g, FrameComponent)) {
          return g;
        }
        return FrameComponent.update(g, {
          lowerRight: new SheetPosition(frameData.lowerRight.x, frameData.upperLeft.y + h),
        });
      });
    },
    [geometryStore, frameId, frameData, sheetDefaultUnit],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0 pr-8">
          <LabeledRow label="X:">
            <LengthInput
              ref={xInputRef}
              value={Length.fromSheetUnits(sheetDefaultUnit, frameData.upperLeft.x)}
              onChange={handleXChange}
              roundPlaces={sheetUnitPlaces}
              readOnlyUnit
            />
          </LabeledRow>
        </div>
        <div className="flex-1 min-w-0">
          <LabeledRow label="Y:">
            <LengthInput
              ref={yInputRef}
              value={Length.fromSheetUnits(sheetDefaultUnit, frameData.upperLeft.y)}
              onChange={handleYChange}
              roundPlaces={sheetUnitPlaces}
              readOnlyUnit
            />
          </LabeledRow>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0 pr-8">
          <LabeledRow label="W:">
            <LengthInput
              ref={wInputRef}
              value={Length.fromSheetUnits(sheetDefaultUnit, width)}
              onChange={handleWChange}
              roundPlaces={sheetUnitPlaces}
              readOnlyUnit
            />
          </LabeledRow>
        </div>
        <div className="flex-1 min-w-0">
          <LabeledRow label="H:">
            <LengthInput
              ref={hInputRef}
              value={Length.fromSheetUnits(sheetDefaultUnit, height)}
              onChange={handleHChange}
              roundPlaces={sheetUnitPlaces}
              readOnlyUnit
            />
          </LabeledRow>
        </div>
      </div>
    </div>
  );
};

const FieldLeafRenderer: React.FunctionComponent<{
  geometryStore: GeometryStore;
  field: SelectionInspectorField;
  sheetDefaultUnit: Sheet['defaultUnit'];
  sheetUnitPlaces: Sheet['unitPlaces'];
  openAtIndexDragging?: boolean;
}> = ({ geometryStore, field, sheetDefaultUnit, sheetUnitPlaces, openAtIndexDragging = false }) => {
  switch (field.type) {
    case 'number':
      return (
        <Input
          type="number"
          value={field.value}
          onChange={(e) => field.handlers.onChange?.(e.currentTarget.value)}
          onFocus={field.handlers.onFocus}
          onBlur={field.handlers.onBlur}
          onKeyDown={(e) => field.handlers.onKeyDown?.(e.key)}
        />
      );
    case 'length':
      return (
        <span
          onKeyDownCapture={(e) => {
            if (e.key === 'Escape' && field.handlers.onKeyDown) {
              e.stopPropagation();
              field.handlers.onKeyDown(e.key);
            }
          }}
        >
          <LengthInput
            value={field.value}
            readOnlyUnit={field.readOnlyUnit}
            onChange={field.handlers.onChange ?? (() => {})}
            onFocus={field.handlers.onFocus}
            onBlur={field.handlers.onBlur}
          />
        </span>
      );
    case 'render-order':
      return (
        <span
          onKeyDownCapture={(e) => {
            if (e.key === 'Escape' && field.handlers.onKeyDown) {
              e.stopPropagation();
              field.handlers.onKeyDown(e.key);
            }
          }}
        >
          <RenderOrderInput
            // FIXME: add geometryId?
            value={field.value}
            geometryStore={geometryStore}
            onChange={field.handlers.onChange ?? (() => {})}
            onFocus={field.handlers.onFocus}
            onBlur={field.handlers.onBlur}
          />
        </span>
      );
    case 'angle':
      return (
        <span
          onKeyDownCapture={(e) => {
            if (e.key === 'Escape' && field.handlers.onKeyDown) {
              e.stopPropagation();
              field.handlers.onKeyDown(e.key);
            }
          }}
        >
          <AngleInput
            value={field.value}
            onChange={field.handlers.onChange ?? (() => {})}
            onFocus={field.handlers.onFocus}
            onBlur={field.handlers.onBlur}
          />
        </span>
      );
    case 'color':
      return (
        <span
          onKeyDownCapture={(e) => {
            if (e.key === 'Escape' && field.handlers.onKeyDown) {
              e.stopPropagation();
              field.handlers.onKeyDown(e.key);
            }
          }}
        >
          <ColorInput
            value={field.value}
            onChange={field.handlers.onChange ?? (() => {})}
            onFocus={field.handlers.onFocus}
            onBlur={field.handlers.onBlur}
          />
        </span>
      );
    case 'read-only':
      return <span>{field.value[0]}</span>;
    case 'link-dimensions-button':
      return <LinkButton linked={field.value} onToggle={field.handlers.onClick ?? (() => {})} />;
    case 'button':
      return (
        <button
          type="button"
          onClick={field.handlers.onClick}
          onFocus={field.handlers.onFocus}
          onBlur={field.handlers.onBlur}
          onKeyDown={(e) => field.handlers.onKeyDown?.(e.key)}
          className="px-3 py-1.5 bg-[var(--slate-5)] text-[var(--slate-12)] text-sm rounded-[4px] border border-[var(--slate-5)] hover:border-[var(--slate-8)] transition-colors"
          style={{ fontFamily: 'var(--font-roboto-mono), monospace' }}
        >
          {typeof field.label === 'string' ? field.label : field.label.icon}
        </button>
      );
    case 'polygon-points':
      return (
        <>
          <PolygonPointsInspector
            data={field.value}
            sheetUnitPlaces={sheetUnitPlaces}
            sheetDefaultUnit={sheetDefaultUnit}
            openAtIndexDragging={openAtIndexDragging}
            onPointXChange={field.handlers.onPointXChange}
            onPointYChange={field.handlers.onPointYChange}
            onPointXBlur={field.handlers.onPointXBlur}
            onPointYBlur={field.handlers.onPointYBlur}
            onControlPointChange={field.handlers.onControlPointChange}
            onDeletePoint={field.handlers.onDeletePoint}
            onInsertPoint={field.handlers.onInsertPoint}
            onPointTypeChange={field.handlers.onPointTypeChange}
            onPointMouseEnter={field.handlers.onPointMouseEnter}
            onPointMouseLeave={field.handlers.onPointMouseLeave}
            onOpenAtIndexMouseEnter={field.handlers.onOpenAtIndexMouseEnter}
            onOpenAtIndexMouseLeave={field.handlers.onOpenAtIndexMouseLeave}
            onOpenAtIndexMouseDown={field.handlers.onOpenAtIndexMouseDown}
          />
          {field.isPolygonFilledDueToFilter ? (
            <div className="flex items-center justify-center px-3 h-9 bg-[var(--slate-4)] border-[var(--slate-6)] border-1">
              <span className="text-xs font-medium select-none text-[var(--slate-9)]">
                Auto closed by filter
              </span>
            </div>
          ) : (
            <Button
              type="button"
              variant="secondary"
              disabled={field.isPolygonFilledDueToFilter}
              onClick={field.handlers.onCloseOpen}
              className={cn('w-full border border-2 border-transparent', {
                'hover:border-[var(--teal-5)]': field.value.closed,
              })}
              style={{ fontFamily: 'var(--font-roboto-mono), monospace' }}
            >
              {field.value.closed ? 'Open polygon' : 'Close polygon'}
            </Button>
          )}
        </>
      );
    default:
      field satisfies never;
      return null;
  }
};

const FieldLabelRenderer: React.FunctionComponent<{
  label: string;
  fields: FieldLabel['fields'];
  geometryStore: GeometryStore;
  sheetDefaultUnit: Sheet['defaultUnit'];
  sheetUnitPlaces: Sheet['unitPlaces'];
}> = ({ label, fields, geometryStore, sheetDefaultUnit, sheetUnitPlaces }) => {
  return (
    <LabeledRow label={label}>
      {fields.map((field) => {
        if (field.type === 'heterogeneous') {
          return <Input key={field.key} type="text" placeholder="Many values" disabled />;
        } else {
          return (
            <FieldLeafRenderer
              key={field.key}
              field={field}
              geometryStore={geometryStore}
              sheetDefaultUnit={sheetDefaultUnit}
              sheetUnitPlaces={sheetUnitPlaces}
            />
          );
        }
      })}
    </LabeledRow>
  );
};

const FieldRowRenderer: React.FunctionComponent<{
  fields: FieldRow['fields'];
  geometryStore: GeometryStore;
  sheetDefaultUnit: Sheet['defaultUnit'];
  sheetUnitPlaces: Sheet['unitPlaces'];
}> = ({ fields, geometryStore, sheetDefaultUnit, sheetUnitPlaces }) => {
  return (
    <div className="flex gap-2 items-center">
      {fields.map((field) => {
        if (field.type === 'label') {
          return (
            <FieldLabelRenderer
              key={field.key}
              label={field.label}
              fields={field.fields}
              geometryStore={geometryStore}
              sheetDefaultUnit={sheetDefaultUnit}
              sheetUnitPlaces={sheetUnitPlaces}
            />
          );
        } else if (field.type === 'heterogeneous') {
          return <Input key={field.key} type="text" placeholder="Many values" disabled />;
        } else {
          return (
            <FieldLeafRenderer
              key={field.key}
              field={field}
              geometryStore={geometryStore}
              sheetDefaultUnit={sheetDefaultUnit}
              sheetUnitPlaces={sheetUnitPlaces}
            />
          );
        }
      })}
    </div>
  );
};

/**
 * Patches the field tree in-place with values from {@link WorkingFieldData}.
 * Walks rows, labels, and leaf fields recursively. For each leaf field,
 * if the workingFieldData Map has a matching key AND type, the field's value
 * is replaced with the working value. Otherwise the field passes through.
 */
function applyWorkingFieldData(fields: Array<Field>, wfd: WorkingFieldData): Array<Field> {
  return fields.map((field) => {
    if (field.type === 'heterogeneous') {
      return field;
    }

    if (field.type === 'row' || field.type === 'label') {
      return {
        ...field,
        fields: applyWorkingFieldData(field.fields as Array<Field>, wfd),
      } as any as typeof field;
    }

    const wdEntry = wfd.get(field.key);
    if (wdEntry && wdEntry.type === field.type) {
      return { ...field, value: wdEntry.value as any } as typeof field;
    }

    return field;
  });
}

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

  const [sheetDefaultUnit, setSheetDefaultUnit] = useState(sheet.defaultUnit);
  const [sheetUnitPlaces, setSheetUnitPlaces] = useState(sheet.unitPlaces);
  useEffect(() => {
    sheet.on('defaultUnitChange', setSheetDefaultUnit);
    sheet.on('unitPlacesChanged', setSheetUnitPlaces);
    return () => {
      sheet.off('unitPlacesChanged', setSheetUnitPlaces);
      sheet.off('defaultUnitChange', setSheetDefaultUnit);
    };
  }, [sheet]);

  const [
    singleRectangle,
    singleEllipse,
    singlePolygon,
    singlePatternGrid,
    singlePatternRadial,
    singleMirror,
    singleFillet,
    singleChamfer,
    singleFrame,
    singleLinear,
    singlePerpendicular,
    singleParallel,
    singleHorizontal,
    singleVertical,
    singleColinear,
  ] = useMemo(() => {
    const rectangles = Array.from(selectedGeometries.values()).filter(
      (g): g is Entity<GeometryComponent<RectangleData>> =>
        Entity.hasComponent(g, GeometryComponent) && GeometryComponent.isRectangle(g),
    );
    const ellipses = Array.from(selectedGeometries.values()).filter(
      (g): g is Entity<GeometryComponent<EllipseData>> =>
        Entity.hasComponent(g, GeometryComponent) && GeometryComponent.isEllipse(g),
    );
    const polygons = Array.from(selectedGeometries.values()).filter(
      (g): g is Entity<GeometryComponent<PolygonData>> =>
        Entity.hasComponent(g, GeometryComponent) && GeometryComponent.isPolygon(g),
    );
    const patternGridFilters = Array.from(selectedGeometries.values()).filter(
      (g): g is Entity<FilterComponent<PatternGridFilterData>> => {
        if (!Entity.hasComponent(g, FilterComponent)) {
          return false;
        }
        const data = FilterComponent.get(g);
        return data.type === 'pattern' && data.mode === 'grid';
      },
    );
    const patternRadialFilters = Array.from(selectedGeometries.values()).filter(
      (g): g is Entity<FilterComponent<PatternRadialFilterData>> => {
        if (!Entity.hasComponent(g, FilterComponent)) {
          return false;
        }
        const data = FilterComponent.get(g);
        return data.type === 'pattern' && data.mode === 'radial';
      },
    );
    const mirrorFilters = Array.from(selectedGeometries.values()).filter(
      (g): g is Entity<FilterComponent<MirrorFilterData>> => {
        if (!Entity.hasComponent(g, FilterComponent)) {
          return false;
        }
        return FilterComponent.get(g).type === 'mirror';
      },
    );
    const filletFilters = Array.from(selectedGeometries.values()).filter(
      (g): g is Entity<FilterComponent<FilletFilterData>> => {
        if (!Entity.hasComponent(g, FilterComponent)) {
          return false;
        }
        return FilterComponent.get(g).type === 'fillet';
      },
    );
    const chamferFilters = Array.from(selectedGeometries.values()).filter(
      (g): g is Entity<FilterComponent<ChamferFilterData>> => {
        if (!Entity.hasComponent(g, FilterComponent)) {
          return false;
        }
        return FilterComponent.get(g).type === 'chamfer';
      },
    );
    const frames = Array.from(selectedGeometries.values()).filter(
      (g): g is Entity<FrameComponent> => {
        return Entity.hasComponent(g, FrameComponent);
      },
    );
    const linearConstraints = Array.from(selectedGeometries.values()).filter(
      (g): g is Entity<ConstraintComponent<LinearConstraintData>> =>
        Entity.hasComponent(g, ConstraintComponent) && ConstraintComponent.get(g).type === 'linear',
    );
    const perpendicularConstraints = Array.from(selectedGeometries.values()).filter(
      (g): g is Entity<ConstraintComponent<PerpendicularConstraintData>> =>
        Entity.hasComponent(g, ConstraintComponent) &&
        ConstraintComponent.get(g).type === 'perpendicular',
    );
    const parallelConstraints = Array.from(selectedGeometries.values()).filter(
      (g): g is Entity<ConstraintComponent<ParallelConstraintData>> =>
        Entity.hasComponent(g, ConstraintComponent) &&
        ConstraintComponent.get(g).type === 'parallel',
    );
    const horizontalConstraints = Array.from(selectedGeometries.values()).filter(
      (g): g is Entity<ConstraintComponent<HorizontalConstraintData>> =>
        Entity.hasComponent(g, ConstraintComponent) &&
        ConstraintComponent.get(g).type === 'horizontal',
    );
    const verticalConstraints = Array.from(selectedGeometries.values()).filter(
      (g): g is Entity<ConstraintComponent<VerticalConstraintData>> =>
        Entity.hasComponent(g, ConstraintComponent) &&
        ConstraintComponent.get(g).type === 'vertical',
    );
    const colinearConstraints = Array.from(selectedGeometries.values()).filter(
      (g): g is Entity<ConstraintComponent<ColinearConstraintData>> =>
        Entity.hasComponent(g, ConstraintComponent) &&
        ConstraintComponent.get(g).type === 'colinear',
    );

    const singleRectangle = rectangles.length === 1 ? rectangles[0] : null;
    const singleEllipse = ellipses.length === 1 ? ellipses[0] : null;
    const singlePolygon = polygons.length === 1 ? polygons[0] : null;
    const singlePatternGrid = patternGridFilters.length === 1 ? patternGridFilters[0] : null;
    const singlePatternRadial = patternRadialFilters.length === 1 ? patternRadialFilters[0] : null;
    const singleMirror = mirrorFilters.length === 1 ? mirrorFilters[0] : null;
    const singleFillet = filletFilters.length === 1 ? filletFilters[0] : null;
    const singleChamfer = chamferFilters.length === 1 ? chamferFilters[0] : null;
    const singleFrame = frames.length === 1 ? frames[0] : null;
    const singleLinear = linearConstraints.length === 1 ? linearConstraints[0] : null;
    const singlePerpendicular =
      perpendicularConstraints.length === 1 ? perpendicularConstraints[0] : null;
    const singleParallel = parallelConstraints.length === 1 ? parallelConstraints[0] : null;
    const singleHorizontal = horizontalConstraints.length === 1 ? horizontalConstraints[0] : null;
    const singleVertical = verticalConstraints.length === 1 ? verticalConstraints[0] : null;
    const singleColinear = colinearConstraints.length === 1 ? colinearConstraints[0] : null;
    return [
      singleRectangle,
      singleEllipse,
      singlePolygon,
      singlePatternGrid,
      singlePatternRadial,
      singleMirror,
      singleFillet,
      singleChamfer,
      singleFrame,
      singleLinear,
      singlePerpendicular,
      singleParallel,
      singleHorizontal,
      singleVertical,
      singleColinear,
    ];
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

  const [fields, setFields] = useState(sheet.selectionInspectorManager.fields);
  useEffect(() => {
    sheet.selectionInspectorManager.on('fieldsChange', setFields);
    return () => {
      sheet.selectionInspectorManager.off('fieldsChange', setFields);
    };
  }, [sheet.selectionInspectorManager]);

  const [openAtIndexDragging, setOpenAtIndexDragging] = useState(false);
  useEffect(() => {
    sheet.selectionInspectorManager.on('openAtIndexDragChange', setOpenAtIndexDragging);
    return () => {
      sheet.selectionInspectorManager.off('openAtIndexDragChange', setOpenAtIndexDragging);
    };
  }, [sheet.selectionInspectorManager]);

  useEffect(() => {
    const handler = (wfd: WorkingFieldData) => {
      setFields((prev) => applyWorkingFieldData(prev, wfd));
    };
    sheet.selectionInspectorManager.on('workingFieldDataChange', handler);
    return () => {
      sheet.selectionInspectorManager.off('workingFieldDataChange', handler);
    };
  }, [sheet.selectionInspectorManager]);

  if (selectedIds.length === 0) {
    return null;
  }

  return (
    <div className="absolute right-4 bottom-4 z-30 w-[320px]">
      <FloatingPanel>
        <div className="flex flex-col gap-3 overflow-y-auto max-h-[calc(100vh-64px)]">
          {/* <AngleInput value={Angle.degrees(0)} onChange={(ang) => console.log(ang)} /> */}

          <br />

          {fields.map((field) => {
            if (field.type === 'row') {
              return (
                <FieldRowRenderer
                  key={field.key}
                  fields={field.fields}
                  geometryStore={geometryStore}
                  sheetDefaultUnit={sheetDefaultUnit}
                  sheetUnitPlaces={sheetUnitPlaces}
                />
              );
            } else if (field.type === 'label') {
              return (
                <FieldLabelRenderer
                  key={field.key}
                  label={field.label}
                  fields={field.fields}
                  geometryStore={geometryStore}
                  sheetDefaultUnit={sheetDefaultUnit}
                  sheetUnitPlaces={sheetUnitPlaces}
                />
              );
            } else if (field.type === 'heterogeneous') {
              return <Input key={field.key} type="text" placeholder="Many values" disabled />;
            } else {
              return (
                <FieldLeafRenderer
                  key={field.key}
                  field={field}
                  geometryStore={geometryStore}
                  sheetDefaultUnit={sheetDefaultUnit}
                  sheetUnitPlaces={sheetUnitPlaces}
                  openAtIndexDragging={openAtIndexDragging}
                />
              );
            }
          })}

          <br />

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
          {singleFrame && (
            <FrameInspector
              frameId={singleFrame.id}
              geometryStore={geometryStore}
              sheetUnitPlaces={sheetUnitPlaces}
              sheetDefaultUnit={sheetDefaultUnit}
            />
          )}
          {singlePatternGrid && (
            <PatternGridFilterInspector
              filterId={singlePatternGrid.id}
              geometryStore={geometryStore}
            />
          )}
          {singlePatternRadial && (
            <PatternRadialFilterInspector
              filterId={singlePatternRadial.id}
              geometryStore={geometryStore}
              sheetUnitPlaces={sheetUnitPlaces}
              sheetDefaultUnit={sheetDefaultUnit}
            />
          )}
          {singleMirror && (
            <MirrorFilterInspector
              filterId={singleMirror.id}
              geometryStore={geometryStore}
              historyManager={historyManager}
              sheetUnitPlaces={sheetUnitPlaces}
              sheetDefaultUnit={sheetDefaultUnit}
            />
          )}
          {singleFillet && (
            <FilletFilterInspector
              filterId={singleFillet.id}
              geometryStore={geometryStore}
              historyManager={historyManager}
              sheetUnitPlaces={sheetUnitPlaces}
              sheetDefaultUnit={sheetDefaultUnit}
            />
          )}
          {singleChamfer && (
            <ChamferFilterInspector
              filterId={singleChamfer.id}
              geometryStore={geometryStore}
              historyManager={historyManager}
              sheetUnitPlaces={sheetUnitPlaces}
              sheetDefaultUnit={sheetDefaultUnit}
            />
          )}
          {singleLinear && (
            <LinearConstraintInspector
              constraintId={singleLinear.id}
              geometryStore={geometryStore}
              historyManager={historyManager}
              sheetUnitPlaces={sheetUnitPlaces}
              sheetDefaultUnit={sheetDefaultUnit}
            />
          )}
          {singlePerpendicular && (
            <PerpendicularConstraintInspector
              constraintId={singlePerpendicular.id}
              geometryStore={geometryStore}
              historyManager={historyManager}
              sheetUnitPlaces={sheetUnitPlaces}
              sheetDefaultUnit={sheetDefaultUnit}
            />
          )}
          {singleParallel && (
            <ParallelConstraintInspector
              constraintId={singleParallel.id}
              geometryStore={geometryStore}
              historyManager={historyManager}
              sheetUnitPlaces={sheetUnitPlaces}
              sheetDefaultUnit={sheetDefaultUnit}
            />
          )}
          {singleHorizontal && (
            <HorizontalConstraintInspector
              constraintId={singleHorizontal.id}
              geometryStore={geometryStore}
              historyManager={historyManager}
              sheetUnitPlaces={sheetUnitPlaces}
              sheetDefaultUnit={sheetDefaultUnit}
            />
          )}
          {singleVertical && (
            <VerticalConstraintInspector
              constraintId={singleVertical.id}
              geometryStore={geometryStore}
              historyManager={historyManager}
              sheetUnitPlaces={sheetUnitPlaces}
              sheetDefaultUnit={sheetDefaultUnit}
            />
          )}
          {singleColinear && (
            <ColinearConstraintInspector
              constraintId={singleColinear.id}
              geometryStore={geometryStore}
              historyManager={historyManager}
              sheetUnitPlaces={sheetUnitPlaces}
              sheetDefaultUnit={sheetDefaultUnit}
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
