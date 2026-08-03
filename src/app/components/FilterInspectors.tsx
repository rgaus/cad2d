'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Entity, type Id } from '@/lib/entity';
import { GeometryStore } from '@/lib/entity/GeometryStore';
import { FilterComponent } from '@/lib/entity/components/FilterComponent';
import { ChamferFilterData } from '@/lib/entity/filters/chamfer';
import { FilletFilterData } from '@/lib/entity/filters/fillet';
import { MirrorFilterData } from '@/lib/entity/filters/mirror';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { UndoEntry } from '@/lib/history/types';
import { Length, type UnitType } from '@/lib/units/length';
import { SheetPosition } from '@/lib/viewport/types';
import LabeledRow from './LabeledRow';
import LengthInput, { type LengthInputHandle } from './LengthInput';
import { useEntities } from '@/hooks/useEntities';

const RECTANGLE_KEYPOINTS = [
  'upperLeft',
  'upperRight',
  'lowerRight',
  'lowerLeft',
  'center',
] as const;

// ==================== MIRROR FILTER ====================

const MirrorFilterInspector: React.FunctionComponent<{
  filterId: Id;
  geometryStore: GeometryStore;
  historyManager: HistoryManager;
  sheetUnitPlaces: number;
  sheetDefaultUnit: UnitType;
}> = ({ filterId, geometryStore, historyManager, sheetUnitPlaces, sheetDefaultUnit }) => {
  const filterEntity = useEntities(geometryStore, (store) => {
    const entity = store.getByIdWithComponent(filterId, FilterComponent);
    if (!entity) {
      return null;
    }
    const data = FilterComponent.get(entity);
    if (data.type !== 'mirror') {
      return null;
    }
    return entity as Entity<FilterComponent<MirrorFilterData>>;
  });

  const filterData = useMemo(
    () => (filterEntity ? FilterComponent.get(filterEntity) : null),
    [filterEntity],
  );

  // Low-latency direct DOM updates during drag via refs
  const axInputRef = useRef<LengthInputHandle>(null);
  const ayInputRef = useRef<LengthInputHandle>(null);
  const bxInputRef = useRef<LengthInputHandle>(null);
  const byInputRef = useRef<LengthInputHandle>(null);
  useEffect(() => {
    const handler = (entity: Entity) => {
      if (entity.id !== filterId || !Entity.hasComponent(entity, FilterComponent)) {
        return;
      }
      const data = FilterComponent.get(entity);
      if (data.type !== 'mirror') {
        return;
      }
      axInputRef.current?.setDisplayValue(Length.fromSheetUnits(sheetDefaultUnit, data.pointA.x));
      ayInputRef.current?.setDisplayValue(Length.fromSheetUnits(sheetDefaultUnit, data.pointA.y));
      bxInputRef.current?.setDisplayValue(Length.fromSheetUnits(sheetDefaultUnit, data.pointB.x));
      byInputRef.current?.setDisplayValue(Length.fromSheetUnits(sheetDefaultUnit, data.pointB.y));
    };
    geometryStore.on('geometryUpdated', handler);
    return () => {
      geometryStore.off('geometryUpdated', handler);
    };
  }, [geometryStore, filterId, sheetDefaultUnit]);

  const handlePointAXChange = useCallback(
    (len: Length) => {
      if (!filterData) {
        return;
      }
      const newX = len.toSheetUnits(sheetDefaultUnit).magnitude;
      const afterPointA = new SheetPosition(newX, filterData.pointA.y);
      historyManager.apply(
        UndoEntry.mirrorFilterMoveEndpoints(
          filterId,
          filterData.pointA,
          filterData.pointB,
          afterPointA,
          filterData.pointB,
        ),
      );
    },
    [filterId, filterData, historyManager, sheetDefaultUnit],
  );

  const handlePointAYChange = useCallback(
    (len: Length) => {
      if (!filterData) {
        return;
      }
      const newY = len.toSheetUnits(sheetDefaultUnit).magnitude;
      const afterPointA = new SheetPosition(filterData.pointA.x, newY);
      historyManager.apply(
        UndoEntry.mirrorFilterMoveEndpoints(
          filterId,
          filterData.pointA,
          filterData.pointB,
          afterPointA,
          filterData.pointB,
        ),
      );
    },
    [filterId, filterData, historyManager, sheetDefaultUnit],
  );

  const handlePointBXChange = useCallback(
    (len: Length) => {
      if (!filterData) {
        return;
      }
      const newX = len.toSheetUnits(sheetDefaultUnit).magnitude;
      const afterPointB = new SheetPosition(newX, filterData.pointB.y);
      historyManager.apply(
        UndoEntry.mirrorFilterMoveEndpoints(
          filterId,
          filterData.pointA,
          filterData.pointB,
          filterData.pointA,
          afterPointB,
        ),
      );
    },
    [filterId, filterData, historyManager, sheetDefaultUnit],
  );

  const handlePointBYChange = useCallback(
    (len: Length) => {
      if (!filterData) {
        return;
      }
      const newY = len.toSheetUnits(sheetDefaultUnit).magnitude;
      const afterPointB = new SheetPosition(filterData.pointB.x, newY);
      historyManager.apply(
        UndoEntry.mirrorFilterMoveEndpoints(
          filterId,
          filterData.pointA,
          filterData.pointB,
          filterData.pointA,
          afterPointB,
        ),
      );
    },
    [filterId, filterData, historyManager, sheetDefaultUnit],
  );

  if (!filterData) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0 pr-8">
          <LabeledRow label="AX:">
            <LengthInput
              ref={axInputRef}
              value={Length.fromSheetUnits(sheetDefaultUnit, filterData.pointA.x)}
              onChange={handlePointAXChange}
              roundPlaces={sheetUnitPlaces}
              readOnlyUnit
            />
          </LabeledRow>
        </div>
        <div className="flex-1 min-w-0">
          <LabeledRow label="AY:">
            <LengthInput
              ref={ayInputRef}
              value={Length.fromSheetUnits(sheetDefaultUnit, filterData.pointA.y)}
              onChange={handlePointAYChange}
              roundPlaces={sheetUnitPlaces}
              readOnlyUnit
            />
          </LabeledRow>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0 pr-8">
          <LabeledRow label="BX:">
            <LengthInput
              ref={bxInputRef}
              value={Length.fromSheetUnits(sheetDefaultUnit, filterData.pointB.x)}
              onChange={handlePointBXChange}
              roundPlaces={sheetUnitPlaces}
              readOnlyUnit
            />
          </LabeledRow>
        </div>
        <div className="flex-1 min-w-0">
          <LabeledRow label="BY:">
            <LengthInput
              ref={byInputRef}
              value={Length.fromSheetUnits(sheetDefaultUnit, filterData.pointB.y)}
              onChange={handlePointBYChange}
              roundPlaces={sheetUnitPlaces}
              readOnlyUnit
            />
          </LabeledRow>
        </div>
      </div>
    </div>
  );
};

// ==================== FILLET / CHAMFER FILTERS ====================

type CornerFilterData = FilletFilterData | ChamferFilterData;

const CornerFilterInspector: React.FunctionComponent<{
  filterId: Id;
  filterType: 'fillet' | 'chamfer';
  geometryStore: GeometryStore;
  historyManager: HistoryManager;
  sheetUnitPlaces: number;
  sheetDefaultUnit: UnitType;
}> = ({ filterId, filterType, geometryStore, historyManager, sheetUnitPlaces }) => {
  const filterEntity = useEntities(geometryStore, (store) => {
    const entity = store.getByIdWithComponent(filterId, FilterComponent);
    if (!entity) {
      return null;
    }
    const data = FilterComponent.get(entity);
    if (data.type !== filterType) {
      return null;
    }
    return entity as Entity<FilterComponent<CornerFilterData>>;
  });

  const filterData = useMemo(
    () => (filterEntity ? FilterComponent.get(filterEntity) : null),
    [filterEntity],
  );

  const handleOffsetChange = useCallback(
    (len: Length) => {
      if (!filterData) {
        return;
      }
      historyManager.apply(UndoEntry.filterChangeOffset(filterId, filterData.offset, len));
    },
    [filterId, filterData, historyManager],
  );

  const updateData = useCallback(
    (updates: Partial<CornerFilterData>) => {
      geometryStore.updateByIdWithComponentDirect(filterId, FilterComponent, (g) =>
        FilterComponent.update(g, updates),
      );
    },
    [geometryStore, filterId],
  );

  const handlePointIndexChange = useCallback(
    (key: 'pointAIndex' | 'pointCenterIndex' | 'pointBIndex', value: number) => {
      if (!filterData || filterData.geometryType !== 'polygon') {
        return;
      }
      updateData({ [key]: value } as Partial<CornerFilterData>);
    },
    [filterData, updateData],
  );

  const handleKeyPointChange = useCallback(
    (key: 'pointAKeyPoint' | 'pointCenterKeyPoint' | 'pointBKeyPoint', value: string) => {
      if (!filterData || filterData.geometryType !== 'rectangle') {
        return;
      }
      updateData({ [key]: value } as Partial<CornerFilterData>);
    },
    [filterData, updateData],
  );

  if (!filterData) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3">
      <LabeledRow label="Offset:">
        <LengthInput
          value={filterData.offset}
          onChange={handleOffsetChange}
          roundPlaces={sheetUnitPlaces}
          readOnlyUnit
        />
      </LabeledRow>

      {filterData.geometryType === 'polygon' ? (
        <LabeledRow label="Points:" fullWidth>
          <div className="flex items-center gap-2">
            <div className="flex gap-1 items-center grow shrink min-w-0">
              <span className="text-xs text-[var(--slate-8)] font-mono shrink-0">A</span>
              <Input
                type="number"
                min={0}
                value={filterData.pointAIndex}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!isNaN(val) && val >= 0) {
                    handlePointIndexChange('pointAIndex', val);
                  }
                }}
                onKeyDown={(e) => e.stopPropagation()}
                className="grow shrink min-w-0"
              />
            </div>
            <div className="flex gap-1 items-center grow shrink min-w-0">
              <span className="text-xs text-[var(--slate-8)] font-mono shrink-0">C</span>
              <Input
                type="number"
                min={0}
                value={filterData.pointCenterIndex}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!isNaN(val) && val >= 0) {
                    handlePointIndexChange('pointCenterIndex', val);
                  }
                }}
                onKeyDown={(e) => e.stopPropagation()}
                className="grow shrink min-w-0"
              />
            </div>
            <div className="flex gap-1 items-center grow shrink min-w-0">
              <span className="text-xs text-[var(--slate-8)] font-mono shrink-0">B</span>
              <Input
                type="number"
                min={0}
                value={filterData.pointBIndex}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!isNaN(val) && val >= 0) {
                    handlePointIndexChange('pointBIndex', val);
                  }
                }}
                onKeyDown={(e) => e.stopPropagation()}
                className="grow shrink min-w-0"
              />
            </div>
          </div>
        </LabeledRow>
      ) : (
        <LabeledRow label="Keypoints:" fullWidth>
          <div className="flex flex-col gap-1.5">
            {(
              [
                ['A', 'pointAKeyPoint'],
                ['C', 'pointCenterKeyPoint'],
                ['B', 'pointBKeyPoint'],
              ] as const
            ).map(([letter, key]) => (
              <div key={key} className="flex items-center gap-2">
                <span className="text-xs text-[var(--slate-8)] font-mono shrink-0 w-3">
                  {letter}
                </span>
                <ToggleGroup
                  type="single"
                  value={filterData[key]}
                  onValueChange={(next) => {
                    if (next) {
                      handleKeyPointChange(key, next);
                    }
                  }}
                  className="flex-wrap"
                >
                  {RECTANGLE_KEYPOINTS.map((kp) => (
                    <ToggleGroupItem key={kp} value={kp} className="w-auto px-2 h-6 text-xs">
                      {kp}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
            ))}
          </div>
        </LabeledRow>
      )}
    </div>
  );
};

const FilletFilterInspector: React.FunctionComponent<{
  filterId: Id;
  geometryStore: GeometryStore;
  historyManager: HistoryManager;
  sheetUnitPlaces: number;
  sheetDefaultUnit: UnitType;
}> = (props) => <CornerFilterInspector {...props} filterType="fillet" />;

const ChamferFilterInspector: React.FunctionComponent<{
  filterId: Id;
  geometryStore: GeometryStore;
  historyManager: HistoryManager;
  sheetUnitPlaces: number;
  sheetDefaultUnit: UnitType;
}> = (props) => <CornerFilterInspector {...props} filterType="chamfer" />;

export { MirrorFilterInspector, FilletFilterInspector, ChamferFilterInspector };
