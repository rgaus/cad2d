'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useEntities } from '@/hooks/useEntities';
import { Entity, type Id } from '@/lib/entity';
import { GeometryStore } from '@/lib/entity/GeometryStore';
import { ConstraintComponent } from '@/lib/entity/components/ConstraintComponent';
import {
  ColinearConstraintData,
  ConstraintData,
  ConstraintEndpoint,
  HorizontalConstraintData,
  LinearConstraintData,
  ParallelConstraintData,
  PerpendicularConstraintData,
  VerticalConstraintData,
} from '@/lib/entity/constraints';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { UndoEntry } from '@/lib/history/types';
import { Length, type UnitType } from '@/lib/units/length';
import ConstraintEndpointField from './ConstraintEndpointField';
import LabeledRow from './LabeledRow';
import LengthInput from './LengthInput';

type ConstraintInspectorProps = {
  constraintId: Id;
  geometryStore: GeometryStore;
  historyManager: HistoryManager;
  sheetUnitPlaces: number;
  sheetDefaultUnit: UnitType;
};

/** Subscribes a constraint inspector to `geometryUpdated` events for a single constraint entity. */
function useConstraintEntity<C extends ConstraintData>(
  constraintId: Id,
  geometryStore: GeometryStore,
  constraintType: C['type'],
): Entity<ConstraintComponent<C>> | null {
  return useEntities(geometryStore, (store) => {
    const entity = store.getByIdWithComponent(constraintId, ConstraintComponent);
    if (!entity) {
      return null;
    }
    const data = ConstraintComponent.get<C>(entity);
    if (data.type !== constraintType) {
      return null;
    }
    return entity as Entity<ConstraintComponent<C>>;
  });
}

// ==================== LINEAR ====================

const LinearConstraintInspector: React.FunctionComponent<ConstraintInspectorProps> = ({
  constraintId,
  geometryStore,
  historyManager,
  sheetUnitPlaces,
  sheetDefaultUnit,
}) => {
  const constraintEntity = useConstraintEntity<LinearConstraintData>(
    constraintId,
    geometryStore,
    'linear',
  );
  const constraintData = useMemo(
    () => (constraintEntity ? ConstraintComponent.get(constraintEntity) : null),
    [constraintEntity],
  );

  const getBeforeEndpoints = useCallback((): Record<string, ConstraintEndpoint> => {
    if (!constraintData) {
      return {};
    }
    return { pointA: constraintData.pointA, pointB: constraintData.pointB };
  }, [constraintData]);

  const handleEndpointChange = useCallback(
    (key: string, next: ConstraintEndpoint) => {
      const before = getBeforeEndpoints();
      const after = { ...before, [key]: next };
      historyManager.apply(
        UndoEntry.linearConstraintMoveEndpoints(
          constraintId,
          before.pointA,
          before.pointB,
          after.pointA,
          after.pointB,
        ),
      );
    },
    [constraintId, historyManager, getBeforeEndpoints],
  );

  const handleLengthChange = useCallback(
    (len: Length) => {
      if (!constraintData) {
        return;
      }
      historyManager.apply(
        UndoEntry.linearConstraintChangeLength(constraintId, constraintData.constrainedLength, len),
      );
    },
    [constraintId, constraintData, historyManager],
  );

  const handleOffsetChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = parseFloat(e.target.value);
      if (isNaN(val)) {
        return;
      }
      historyManager.apply(
        UndoEntry.linearConstraintMoveLabel(
          constraintId,
          constraintData?.connectorLineOffsetPx ?? 0,
          val,
        ),
      );
    },
    [constraintId, constraintData, historyManager],
  );

  const handleAxisChange = useCallback(
    (next: string) => {
      if (next !== '' && next !== 'x' && next !== 'y') {
        return;
      }
      geometryStore.updateByIdWithComponentDirect(constraintId, ConstraintComponent, (g) =>
        ConstraintComponent.update(g, { axis: next === '' ? null : next }),
      );
    },
    [constraintId, geometryStore],
  );

  if (!constraintData) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3">
      <ConstraintEndpointField
        label="A"
        endpoint={constraintData.pointA}
        onChange={(next) => handleEndpointChange('pointA', next)}
        geometryStore={geometryStore}
        sheetUnitPlaces={sheetUnitPlaces}
        sheetDefaultUnit={sheetDefaultUnit}
      />
      <ConstraintEndpointField
        label="B"
        endpoint={constraintData.pointB}
        onChange={(next) => handleEndpointChange('pointB', next)}
        geometryStore={geometryStore}
        sheetUnitPlaces={sheetUnitPlaces}
        sheetDefaultUnit={sheetDefaultUnit}
      />
      <LabeledRow label="Length:">
        <LengthInput
          value={constraintData.constrainedLength}
          onChange={handleLengthChange}
          roundPlaces={sheetUnitPlaces}
          readOnlyUnit
        />
      </LabeledRow>
      <LabeledRow label="Label offset:">
        <Input
          type="number"
          value={constraintData.connectorLineOffsetPx}
          onChange={handleOffsetChange}
          onKeyDown={(e) => e.stopPropagation()}
        />
      </LabeledRow>
      <LabeledRow label="Axis:">
        <ToggleGroup
          type="single"
          value={constraintData.axis ?? ''}
          onValueChange={handleAxisChange}
        >
          <ToggleGroupItem value="" className="w-auto px-2 h-6 text-xs">
            Full
          </ToggleGroupItem>
          <ToggleGroupItem value="x" className="w-auto px-2 h-6 text-xs">
            X
          </ToggleGroupItem>
          <ToggleGroupItem value="y" className="w-auto px-2 h-6 text-xs">
            Y
          </ToggleGroupItem>
        </ToggleGroup>
      </LabeledRow>
    </div>
  );
};

// ==================== PERPENDICULAR ====================

const PerpendicularConstraintInspector: React.FunctionComponent<ConstraintInspectorProps> = (
  props,
) => {
  const { constraintId, geometryStore, historyManager, sheetUnitPlaces, sheetDefaultUnit } = props;
  const constraintEntity = useConstraintEntity<PerpendicularConstraintData>(
    constraintId,
    geometryStore,
    'perpendicular',
  );
  const constraintData = useMemo(
    () => (constraintEntity ? ConstraintComponent.get(constraintEntity) : null),
    [constraintEntity],
  );

  const getBeforeEndpoints = useCallback((): Record<string, ConstraintEndpoint> => {
    if (!constraintData) {
      return {};
    }
    return {
      pointA: constraintData.pointA,
      pointCenter: constraintData.pointCenter,
      pointB: constraintData.pointB,
    };
  }, [constraintData]);

  const handleEndpointChange = useCallback(
    (key: string, next: ConstraintEndpoint) => {
      const before = getBeforeEndpoints();
      const after = { ...before, [key]: next };
      historyManager.apply(
        UndoEntry.perpendicularConstraintMoveEndpoints(
          constraintId,
          before.pointA,
          before.pointCenter,
          before.pointB,
          after.pointA,
          after.pointCenter,
          after.pointB,
        ),
      );
    },
    [constraintId, historyManager, getBeforeEndpoints],
  );

  if (!constraintData) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3">
      {(
        [
          ['A', 'pointA'],
          ['Center', 'pointCenter'],
          ['B', 'pointB'],
        ] as const
      ).map(([label, key]) => (
        <ConstraintEndpointField
          key={key}
          label={label}
          endpoint={constraintData[key]}
          onChange={(next) => handleEndpointChange(key, next)}
          geometryStore={geometryStore}
          sheetUnitPlaces={sheetUnitPlaces}
          sheetDefaultUnit={sheetDefaultUnit}
        />
      ))}
    </div>
  );
};

// ==================== PARALLEL ====================

const ParallelConstraintInspector: React.FunctionComponent<ConstraintInspectorProps> = (props) => {
  const { constraintId, geometryStore, historyManager, sheetUnitPlaces, sheetDefaultUnit } = props;
  const constraintEntity = useConstraintEntity<ParallelConstraintData>(
    constraintId,
    geometryStore,
    'parallel',
  );
  const constraintData = useMemo(
    () => (constraintEntity ? ConstraintComponent.get(constraintEntity) : null),
    [constraintEntity],
  );

  const getBeforeEndpoints = useCallback((): Record<string, ConstraintEndpoint> => {
    if (!constraintData) {
      return {};
    }
    return {
      pointA: constraintData.pointA,
      pointB: constraintData.pointB,
      pointC: constraintData.pointC,
      pointD: constraintData.pointD,
    };
  }, [constraintData]);

  const handleEndpointChange = useCallback(
    (key: string, next: ConstraintEndpoint) => {
      const before = getBeforeEndpoints();
      const after = { ...before, [key]: next };
      historyManager.apply(
        UndoEntry.parallelConstraintMoveEndpoints(
          constraintId,
          before.pointA,
          before.pointB,
          before.pointC,
          before.pointD,
          after.pointA,
          after.pointB,
          after.pointC,
          after.pointD,
        ),
      );
    },
    [constraintId, historyManager, getBeforeEndpoints],
  );

  if (!constraintData) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3">
      {(
        [
          ['A', 'pointA'],
          ['B', 'pointB'],
          ['C', 'pointC'],
          ['D', 'pointD'],
        ] as const
      ).map(([label, key]) => (
        <ConstraintEndpointField
          key={key}
          label={label}
          endpoint={constraintData[key]}
          onChange={(next) => handleEndpointChange(key, next)}
          geometryStore={geometryStore}
          sheetUnitPlaces={sheetUnitPlaces}
          sheetDefaultUnit={sheetDefaultUnit}
        />
      ))}
    </div>
  );
};

// ==================== HORIZONTAL / VERTICAL ====================

const HorizontalConstraintInspector: React.FunctionComponent<ConstraintInspectorProps> = (
  props,
) => {
  const { constraintId, geometryStore, historyManager, sheetUnitPlaces, sheetDefaultUnit } = props;
  const constraintEntity = useConstraintEntity<HorizontalConstraintData>(
    constraintId,
    geometryStore,
    'horizontal',
  );
  const constraintData = useMemo(
    () => (constraintEntity ? ConstraintComponent.get(constraintEntity) : null),
    [constraintEntity],
  );

  const getBeforeEndpoints = useCallback((): Record<string, ConstraintEndpoint> => {
    if (!constraintData) {
      return {};
    }
    return { pointA: constraintData.pointA, pointB: constraintData.pointB };
  }, [constraintData]);

  const handleEndpointChange = useCallback(
    (key: string, next: ConstraintEndpoint) => {
      const before = getBeforeEndpoints();
      const after = { ...before, [key]: next };
      historyManager.apply(
        UndoEntry.horizontalConstraintMoveEndpoints(
          constraintId,
          before.pointA,
          before.pointB,
          after.pointA,
          after.pointB,
        ),
      );
    },
    [constraintId, historyManager, getBeforeEndpoints],
  );

  if (!constraintData) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3">
      {(
        [
          ['A', 'pointA'],
          ['B', 'pointB'],
        ] as const
      ).map(([label, key]) => (
        <ConstraintEndpointField
          key={key}
          label={label}
          endpoint={constraintData[key]}
          onChange={(next) => handleEndpointChange(key, next)}
          geometryStore={geometryStore}
          sheetUnitPlaces={sheetUnitPlaces}
          sheetDefaultUnit={sheetDefaultUnit}
        />
      ))}
    </div>
  );
};

const VerticalConstraintInspector: React.FunctionComponent<ConstraintInspectorProps> = (props) => {
  const { constraintId, geometryStore, historyManager, sheetUnitPlaces, sheetDefaultUnit } = props;
  const constraintEntity = useConstraintEntity<VerticalConstraintData>(
    constraintId,
    geometryStore,
    'vertical',
  );
  const constraintData = useMemo(
    () => (constraintEntity ? ConstraintComponent.get(constraintEntity) : null),
    [constraintEntity],
  );

  const getBeforeEndpoints = useCallback((): Record<string, ConstraintEndpoint> => {
    if (!constraintData) {
      return {};
    }
    return { pointA: constraintData.pointA, pointB: constraintData.pointB };
  }, [constraintData]);

  const handleEndpointChange = useCallback(
    (key: string, next: ConstraintEndpoint) => {
      const before = getBeforeEndpoints();
      const after = { ...before, [key]: next };
      historyManager.apply(
        UndoEntry.verticalConstraintMoveEndpoints(
          constraintId,
          before.pointA,
          before.pointB,
          after.pointA,
          after.pointB,
        ),
      );
    },
    [constraintId, historyManager, getBeforeEndpoints],
  );

  if (!constraintData) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3">
      {(
        [
          ['A', 'pointA'],
          ['B', 'pointB'],
        ] as const
      ).map(([label, key]) => (
        <ConstraintEndpointField
          key={key}
          label={label}
          endpoint={constraintData[key]}
          onChange={(next) => handleEndpointChange(key, next)}
          geometryStore={geometryStore}
          sheetUnitPlaces={sheetUnitPlaces}
          sheetDefaultUnit={sheetDefaultUnit}
        />
      ))}
    </div>
  );
};

// ==================== COLINEAR ====================

const ColinearConstraintInspector: React.FunctionComponent<ConstraintInspectorProps> = (props) => {
  const { constraintId, geometryStore, historyManager, sheetUnitPlaces, sheetDefaultUnit } = props;
  const constraintEntity = useConstraintEntity<ColinearConstraintData>(
    constraintId,
    geometryStore,
    'colinear',
  );
  const constraintData = useMemo(
    () => (constraintEntity ? ConstraintComponent.get(constraintEntity) : null),
    [constraintEntity],
  );

  const getBeforeEndpoints = useCallback((): Record<string, ConstraintEndpoint> => {
    if (!constraintData) {
      return {};
    }
    return {
      pointTarget: constraintData.pointTarget,
      pointA: constraintData.pointA,
      pointB: constraintData.pointB,
    };
  }, [constraintData]);

  const handleEndpointChange = useCallback(
    (key: string, next: ConstraintEndpoint) => {
      const before = getBeforeEndpoints();
      const after = { ...before, [key]: next };
      historyManager.apply(
        UndoEntry.colinearConstraintMoveEndpoints(
          constraintId,
          before.pointTarget,
          before.pointA,
          before.pointB,
          after.pointTarget,
          after.pointA,
          after.pointB,
        ),
      );
    },
    [constraintId, historyManager, getBeforeEndpoints],
  );

  if (!constraintData) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3">
      {(
        [
          ['Target', 'pointTarget'],
          ['A', 'pointA'],
          ['B', 'pointB'],
        ] as const
      ).map(([label, key]) => (
        <ConstraintEndpointField
          key={key}
          label={label}
          endpoint={constraintData[key]}
          onChange={(next) => handleEndpointChange(key, next)}
          geometryStore={geometryStore}
          sheetUnitPlaces={sheetUnitPlaces}
          sheetDefaultUnit={sheetDefaultUnit}
        />
      ))}
    </div>
  );
};

export {
  LinearConstraintInspector,
  PerpendicularConstraintInspector,
  ParallelConstraintInspector,
  HorizontalConstraintInspector,
  VerticalConstraintInspector,
  ColinearConstraintInspector,
};
