'use client';

import { FederatedPointerEvent } from 'pixi.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import ConstraintLengthInput, {
  ConstraintLengthInputHandle,
} from '@/app/components/ConstraintLengthInput';
import FilletFilterIndicator from '@/app/components/FilletFilterIndicator';
import { useViewportContext } from '@/contexts/viewport-context';
import { useSelectionManagerSelectedIds } from '@/hooks/useSelectionManagerSelectedIds';
import { type Geometry } from '@/lib/geometry';
import { FilterComponent } from '@/lib/geometry/components/FilterComponent';
import { Vector2, round } from '@/lib/math';
import { RendererLayers, SingleLayers } from '@/lib/renderer';
import { SELECTION_COLOR } from '@/lib/textures';
import { WorkingFilter } from '@/lib/tools/types';
import { Length } from '@/lib/units/length';
import type { UnitType } from '@/lib/units/length';
import { ScreenPosition } from '@/lib/viewport/types';

const FilterOverlay: React.FunctionComponent = () => {
  const { geometryStore, viewportScale, sheet, toolManager, viewportControls } =
    useViewportContext();

  const selectedIds = useSelectionManagerSelectedIds();

  const [filters, setFilters] = useState<Array<Geometry<FilterComponent>>>([]);
  const [workingFilter, setWorkingFilter] = useState<WorkingFilter | null>(null);
  const rebuildFilters = useCallback(() => {
    setFilters(geometryStore.listWithComponent(FilterComponent));
  }, [geometryStore]);
  useEffect(() => {
    rebuildFilters();
    geometryStore.on('geometryAdded', rebuildFilters);
    geometryStore.on('geometryUpdated', rebuildFilters);
    geometryStore.on('geometryDeleted', rebuildFilters);
    geometryStore.on('workingFilterChanged', setWorkingFilter);
    return () => {
      geometryStore.off('geometryAdded', rebuildFilters);
      geometryStore.off('geometryUpdated', rebuildFilters);
      geometryStore.off('geometryDeleted', rebuildFilters);
      geometryStore.off('workingFilterChanged', setWorkingFilter);
    };
  }, [geometryStore, rebuildFilters]);

  // Track when a user hovers over a filter
  const [hoveringFilterLabelId, setHoveringFilterLabelId] = useState<string | null>(null);
  useEffect(() => {
    const activeTool = toolManager.getActiveTool();
    if (activeTool.type !== 'select') {
      return;
    }

    let cleanup: (() => void) | null = null;

    const changeActiveTool = () => {
      cleanup?.();
      cleanup = null;

      if (activeTool.type === 'select') {
        activeTool.on('hoveringFilterLabelChange', setHoveringFilterLabelId);
        cleanup = () => {
          activeTool.off('hoveringFilterLabelChange', setHoveringFilterLabelId);
        };
      }
    };

    toolManager.on('toolChange', changeActiveTool);
    return () => {
      toolManager.on('toolChange', changeActiveTool);
      cleanup?.();
    };
  }, [toolManager]);

  const handleFilterLabelPointerUp = useCallback(
    (e: FederatedPointerEvent, filterId: Geometry<FilterComponent>['id']) => {
      if (!viewportControls) {
        return;
      }
      const activeTool = toolManager.getActiveTool();
      if (activeTool.type !== 'select') {
        return;
      }

      activeTool.onFilterLabelPointerUp(
        new ScreenPosition(e.clientX, e.clientY),
        viewportControls,
        filterId,
        e.shiftKey,
      );
    },
    [toolManager],
  );

  const handleFilterLabelPointerEnter = useCallback(
    (filterId: Geometry<FilterComponent>['id']) => {
      const activeTool = toolManager.getActiveTool();
      if (activeTool.type !== 'select') {
        return;
      }

      activeTool.onFilterLabelPointerEnter(filterId);
    },
    [toolManager],
  );

  const handleFilterLabelPointerLeave = useCallback(() => {
    const activeTool = toolManager.getActiveTool();
    if (activeTool.type !== 'select') {
      return;
    }

    activeTool.onFilterLabelPointerLeave();
  }, [toolManager]);

  let workingFilterJsx: React.ReactNode | null = null;
  if (workingFilter) {
    switch (workingFilter.type) {
      case 'fillet': {
        const resolvedA =
          workingFilter.geometryType === 'polygon'
            ? geometryStore.resolvePolygonKeyPoint(
                workingFilter.geometryId,
                workingFilter.pointAIndex,
              )
            : geometryStore.resolveRectangleKeyPoint(
                workingFilter.geometryId,
                workingFilter.pointAKeyPoint,
              );
        const resolvedCenter =
          workingFilter.geometryType === 'polygon'
            ? geometryStore.resolvePolygonKeyPoint(
                workingFilter.geometryId,
                workingFilter.pointCenterIndex,
              )
            : geometryStore.resolveRectangleKeyPoint(
                workingFilter.geometryId,
                workingFilter.pointCenterKeyPoint,
              );
        const resolvedB =
          workingFilter.geometryType === 'polygon'
            ? geometryStore.resolvePolygonKeyPoint(
                workingFilter.geometryId,
                workingFilter.pointBIndex,
              )
            : geometryStore.resolveRectangleKeyPoint(
                workingFilter.geometryId,
                workingFilter.pointBKeyPoint,
              );

        if (!resolvedA || !resolvedCenter || !resolvedB) {
          return null;
        }

        workingFilterJsx = (
          <FilletFilterIndicator
            pointA={resolvedA}
            pointCenter={resolvedCenter}
            pointB={resolvedB}
            viewportScale={viewportScale}
            sheetDefaultUnit={sheet.defaultUnit}
            offset={workingFilter.offset}
          />
        );
        break;
      }
      case 'mirror':
        return null;
      default:
        workingFilter satisfies never;
        break;
    }
  }

  return (
    <>
      {filters.map((geometry) => {
        const filter = FilterComponent.get(geometry);
        if (workingFilter?.shadowsFilterId === geometry.id) {
          // A working filter shadows this filter, so skip rendering
          // This can happen when a user double clicks on a filter to edit it
          return null;
        }

        const isSelected = selectedIds.includes(geometry.id);
        switch (filter.type) {
          case 'fillet': {
            const resolvedA =
              filter.geometryType === 'polygon'
                ? geometryStore.resolvePolygonKeyPoint(filter.geometryId, filter.pointAIndex)
                : geometryStore.resolveRectangleKeyPoint(filter.geometryId, filter.pointAKeyPoint);
            const resolvedCenter =
              filter.geometryType === 'polygon'
                ? geometryStore.resolvePolygonKeyPoint(filter.geometryId, filter.pointCenterIndex)
                : geometryStore.resolveRectangleKeyPoint(
                    filter.geometryId,
                    filter.pointCenterKeyPoint,
                  );
            const resolvedB =
              filter.geometryType === 'polygon'
                ? geometryStore.resolvePolygonKeyPoint(filter.geometryId, filter.pointBIndex)
                : geometryStore.resolveRectangleKeyPoint(filter.geometryId, filter.pointBKeyPoint);
            if (!resolvedA || !resolvedCenter || !resolvedB) {
              // Referenced geometry no longer exists, skip rendering
              return null;
            }

            return (
              <FilletFilterIndicator
                key={geometry.id}
                pointA={resolvedA}
                pointCenter={resolvedCenter}
                pointB={resolvedB}
                viewportScale={viewportScale}
                offset={filter.offset}
                sheetDefaultUnit={sheet.defaultUnit}
                lineWidthPx={isSelected || hoveringFilterLabelId === geometry.id ? 2 : undefined}
                color={isSelected ? SELECTION_COLOR : undefined}
                onPointerUp={(e) => handleFilterLabelPointerUp(e, geometry.id)}
                onPointerEnter={() => handleFilterLabelPointerEnter(geometry.id)}
                onPointerLeave={handleFilterLabelPointerLeave}
              />
            );
          }
          case 'mirror':
            return null;
          default:
            filter satisfies never;
            break;
        }
      })}

      {workingFilterJsx}
    </>
  );
};

const FilterTooltips: React.FunctionComponent = () => {
  const { sheet, geometryStore, viewportControls, activeTool } = useViewportContext();

  const [workingFilter, setWorkingFilter] = useState<WorkingFilter | null>(null);
  useEffect(() => {
    geometryStore.on('workingFilterChanged', setWorkingFilter);
    return () => {
      geometryStore.off('workingFilterChanged', setWorkingFilter);
    };
  }, [geometryStore]);

  const [sheetDefaultUnit, setSheetDefaultUnit] = useState<UnitType>(sheet.defaultUnit);
  useEffect(() => {
    const handler = (unit: UnitType) => setSheetDefaultUnit(unit);
    sheet.on('defaultUnitChange', handler);
    return () => {
      sheet.off('defaultUnitChange', handler);
    };
  }, [sheet]);

  // Keep the textbox positioned at the midpoint of the working linear filter
  const filterDivRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!workingFilter) {
      return;
    }
    if (!viewportControls) {
      return;
    }

    let frameId: ReturnType<typeof window.requestAnimationFrame> | null = null;
    const runFrame = () => {
      frameId = null;

      // If nothing is focused, then automatically focus the first non disabled filter
      // This works around a user accidentally defocusing the text box somehow
      if (document.activeElement === document.body) {
        filterLengthInputsRef.current?.focus();
      }

      // Update all working filter text boxes to be at the right spots
      const ref = filterDivRef.current;
      if (!ref) {
        return;
      }

      switch (workingFilter.type) {
        case 'fillet':
          const resolvedCenter =
            workingFilter.geometryType === 'polygon'
              ? geometryStore.resolvePolygonKeyPoint(
                  workingFilter.geometryId,
                  workingFilter.pointCenterIndex,
                )
              : geometryStore.resolveRectangleKeyPoint(
                  workingFilter.geometryId,
                  workingFilter.pointCenterKeyPoint,
                );
          if (!resolvedCenter) {
            break;
          }
          const pos = resolvedCenter; // FIXME: add slight offset away from angle opening direction
          const screenPos = pos.toWorld().toScreen(viewportControls.getState().viewport);
          ref.style.left = `${screenPos.x}px`;
          ref.style.top = `${screenPos.y}px`;
          break;
      }
      frameId = window.requestAnimationFrame(runFrame);
    };
    frameId = window.requestAnimationFrame(runFrame);

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [workingFilter, viewportControls]);

  // When the workingFilters goes from 0 -> n, focus the first filter
  const filterLengthInputsRef = useRef<ConstraintLengthInputHandle | null>(null);
  const workingFilterUnset = workingFilter === null;
  useEffect(() => {
    if (!workingFilter) {
      return;
    }
    const input = filterLengthInputsRef.current;
    if (!input) {
      return;
    }

    setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  }, [workingFilterUnset]);

  if (!viewportControls || !workingFilter) {
    return null;
  }

  switch (workingFilter.type) {
    case 'fillet': {
      const wcResolvedA =
        workingFilter.geometryType === 'polygon'
          ? geometryStore.resolvePolygonKeyPoint(
              workingFilter.geometryId,
              workingFilter.pointAIndex,
            )
          : geometryStore.resolveRectangleKeyPoint(
              workingFilter.geometryId,
              workingFilter.pointAKeyPoint,
            );
      const wcResolvedCenter =
        workingFilter.geometryType === 'polygon'
          ? geometryStore.resolvePolygonKeyPoint(
              workingFilter.geometryId,
              workingFilter.pointCenterIndex,
            )
          : geometryStore.resolveRectangleKeyPoint(
              workingFilter.geometryId,
              workingFilter.pointCenterKeyPoint,
            );
      const wcResolvedB =
        workingFilter.geometryType === 'polygon'
          ? geometryStore.resolvePolygonKeyPoint(
              workingFilter.geometryId,
              workingFilter.pointBIndex,
            )
          : geometryStore.resolveRectangleKeyPoint(
              workingFilter.geometryId,
              workingFilter.pointBKeyPoint,
            );
      if (!wcResolvedA || !wcResolvedCenter || !wcResolvedB) {
        return null;
      }
      const distanceBetweenPoints = Length.fromSheetUnits(
        sheetDefaultUnit,
        Vector2.distance(wcResolvedA, wcResolvedB),
      ).magnitude;

      return (
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -14px)`, // 14px = height of ConstraintLengthInput / 2
          }}
          ref={filterDivRef}
        >
          <ConstraintLengthInput
            ref={filterLengthInputsRef}
            value={workingFilter.offset}
            onChange={(value) => {
              const workingFilter = geometryStore.workingFilter;
              if (workingFilter && workingFilter.type === 'fillet') {
                geometryStore.setWorkingFilter({ ...workingFilter, offset: value });
              }
            }}
            placeholder={`${round(distanceBetweenPoints, 2)}`}
            defaultUnit={sheetDefaultUnit}
            onAcceptButtonClick={() => {
              if (activeTool.type !== 'select') {
                return;
              }
              activeTool.onFilterLabelLengthInputAccept();
            }}
            onDismissButtonClick={() => {
              if (activeTool.type !== 'select') {
                return;
              }
              activeTool.onFilterLabelLengthInputDismiss();
            }}
          />
        </div>
      );
    }
    case 'mirror':
      return null;
    default:
      workingFilter satisfies never;
      break;
  }
};

/** Renders all filters currently on the sheet. */
export const FilterLayers: SingleLayers<React.ReactNode> = {
  [RendererLayers.Overlays]: <FilterOverlay />,
  [RendererLayers.Tooltips]: <FilterTooltips />,
};
