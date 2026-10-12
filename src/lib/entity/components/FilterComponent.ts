import { Filter, type FilterData } from '@/lib/entity/filters';
import { ChamferFilter, ChamferFilterData } from '@/lib/entity/filters/chamfer';
import { FilletFilter, FilletFilterData } from '@/lib/entity/filters/fillet';
import { MirrorFilter, MirrorFilterData } from '@/lib/entity/filters/mirror';
import { UndoEntry } from '@/lib/history/types';
import { type FieldOptionsList, Fields } from '@/lib/selection/fields';
import type { SelectionInspectorContext } from '@/lib/selection/selection-inspector-context';
import { Length } from '@/lib/units/length';
import { SheetPosition } from '@/lib/viewport/types';
import { DEFAULT_COLOR } from '../colors';
import { PatternFilter, PatternFilterData } from '../filters/pattern';
import { RectangleEndpoint } from '../rectangle';
import { type Entity, type EntityComponent } from '../types';
import { FillColorComponent } from './FillColorComponent';
import { GeometryComponent } from './GeometryComponent';

/**
 * Geometry component for a filter.
 */
export type FilterComponent<C extends FilterData = FilterData> = EntityComponent<
  'filter',
  { data: C; order: number }
>;

export namespace FilterComponent {
  export const key: keyof FilterComponent = 'filter';

  export function create<C extends FilterData>(data: C, order: number = 0): FilterComponent<C> {
    return { filter: { data, order } };
  }

  export function get<C extends FilterData>(geometry: Entity<FilterComponent<C>>): C;
  export function get(geometry: Filter): FilterData;
  export function get<C extends FilterData>(geometry: Entity<FilterComponent<C>>): C {
    return geometry.components.filter.data;
  }

  export function update<E extends Entity<FilterComponent>>(
    geometry: E,
    partial: Partial<FilterData>,
  ): E {
    const merged = { ...geometry.components.filter.data, ...partial } as FilterData;
    return {
      ...geometry,
      components: {
        ...geometry.components,
        filter: { ...geometry.components.filter, data: merged },
      },
    };
  }

  export function updateOrder(
    geometry: Entity<FilterComponent>,
    order: number,
  ): Entity<FilterComponent> {
    const merged = { ...geometry.components.filter, order };
    return {
      ...geometry,
      components: {
        ...geometry.components,
        filter: merged,
      },
    };
  }

  export function isLockedToRectangle(
    geometry: Entity<FilterComponent>,
    rectangleId: Entity['id'],
    rectanglePoint: RectangleEndpoint,
  ) {
    const filter = FilterComponent.get(geometry);
    switch (filter.type) {
      case 'fillet':
      case 'chamfer':
        return (
          filter.geometryType === 'rectangle' &&
          filter.geometryId === rectangleId &&
          filter.pointCenterKeyPoint === rectanglePoint
        );
      case 'mirror':
      case 'pattern':
        return false;
      default:
        filter satisfies never;
        return false;
    }
  }

  export function isLockedToPolygon(
    geometry: Entity<FilterComponent>,
    polygonId: Entity['id'],
    pointIndex: number,
  ) {
    const filter = FilterComponent.get(geometry);
    switch (filter.type) {
      case 'fillet':
      case 'chamfer':
        return (
          filter.geometryType === 'polygon' &&
          filter.geometryId === polygonId &&
          filter.pointCenterIndex === pointIndex
        );
      case 'mirror':
      case 'pattern':
        return false;
      default:
        filter satisfies never;
        return false;
    }
  }

  /** Takes a filter and translates all points according to {@link transform}. */
  export function translate(
    filter: Entity<FilterComponent>,
    transform: (point: SheetPosition) => SheetPosition,
  ) {
    const filterData = FilterComponent.get(filter);
    switch (filterData.type) {
      case 'fillet':
      case 'chamfer':
        // These filters are locked to a geometry implicitly, there's no point stored in them
        return filter;
      case 'mirror':
        return MirrorFilter.translate(
          filter as Entity<FilterComponent<MirrorFilterData>>,
          transform,
        );
      case 'pattern':
        return PatternFilter.translate(
          filter as Entity<FilterComponent<PatternFilterData>>,
          transform,
        );
      default:
        filterData satisfies never;
        throw new Error(`Filter.translate: Unknown filter type ${(filterData as any).type}`);
    }
  }

  export function equals(a: Entity<FilterComponent>, b: Entity<FilterComponent>): boolean {
    const filterData = FilterComponent.get(a);
    switch (filterData.type) {
      case 'fillet':
        return FilletFilter.equals(a as Entity<FilterComponent<FilletFilterData>>, b);
      case 'chamfer':
        return ChamferFilter.equals(a as Entity<FilterComponent<ChamferFilterData>>, b);
      case 'mirror':
        return MirrorFilter.equals(a as Entity<FilterComponent<MirrorFilterData>>, b);
      case 'pattern':
        return PatternFilter.equals(a as Entity<FilterComponent<PatternFilterData>>, b);
      default:
        filterData satisfies never;
        throw new Error(
          `FilterComponent.equals: Unknown filter data type ${(filterData as any).type}`,
        );
    }
  }

  /** Given a geometry which has been recently moved and all filters associated with that geometry,
   * returns the geometry updated with a FillColorComponent based on whether it should be filled
   * or not.
   *
   * If `originalGeometry` is passed, use this as the "before" geometry state when determining if
   * the geometry needs to be filled. This is useful in contexts like dragging a polygon vertex
   * where a bunch of *Direct updates are made to the geometry state with a final onCommit update
   * which actually emits history events. Without this, the "before" state would be dirty state
   * from the middle of the move, not the actual before state. */
  export function syncFillColor<G extends Entity<GeometryComponent & Partial<FillColorComponent>>>(
    geometry: G,
    filters: Array<Filter>,
    originalGeometry?: G,
  ): [G, Array<UndoEntry>] {
    // Aggregate: determine if ANY mirror filter qualifies for fill, then
    // make a single add/remove decision.  Processing filters one at a time
    // would cause the second filter to undo the first filter's fill change.
    const polyData = GeometryComponent.get(geometry);
    if (polyData.type !== 'polygon' || polyData.closed) {
      return [geometry, []];
    }

    const prev = originalGeometry ?? geometry;
    const hasFill = FillColorComponent.has(prev);

    let shouldFill = false;
    for (const filter of filters) {
      const fd = FilterComponent.get(filter);
      switch (fd.type) {
        case 'fillet':
        case 'chamfer':
          break;
        case 'mirror': {
          const output = MirrorFilter.computeDynamicFillState(geometry, fd);
          if (output === 'filled') {
            shouldFill = true;
          }
          break;
        }
        case 'pattern': {
          const output = PatternFilter.computeDynamicFillState(geometry, fd);
          if (output === 'filled') {
            shouldFill = true;
          }
          break;
        }
        default:
          fd satisfies never;
          break;
      }
    }

    if (shouldFill && !hasFill) {
      const color =
        polyData.type === 'polygon' && typeof polyData.lastFillColor !== 'undefined'
          ? polyData.lastFillColor
          : DEFAULT_COLOR;
      return [
        FillColorComponent.update(geometry, color),
        [UndoEntry.fillColorAdd(geometry.id, color)],
      ];
    } else if (!shouldFill && hasFill) {
      const currentColor = FillColorComponent.get(prev);
      const withLastFill =
        polyData.type === 'polygon'
          ? GeometryComponent.update(geometry, { lastFillColor: currentColor })
          : geometry;
      return [
        FillColorComponent.remove(withLastFill) as G,
        [UndoEntry.fillColorRemove(geometry.id, currentColor)],
      ];
    } else {
      return [geometry, []];
    }
  }

  /** Builds the selection inspector fields for a filter entity, dispatching on the filter type. */
  export function computeSelectionInspectorFields(
    entity: Entity<FilterComponent>,
    ctx: SelectionInspectorContext,
  ): FieldOptionsList {
    const filterData = FilterComponent.get(entity);
    switch (filterData.type) {
      case 'mirror': {
        const filterId = entity.id;

        /** Commits a change of the geometry a mirror filter is attached to. */
        const changeGeometryId = (afterGeometryId: Entity['id']) => {
          const current = ctx.geometryStore.getByIdWithComponent(filterId, FilterComponent);
          if (!current) {
            return;
          }
          const currentFilter = FilterComponent.get(current);
          if (currentFilter.type !== 'mirror') {
            return;
          }
          ctx.historyManager.apply(
            UndoEntry.filterChangeGeometryId(filterId, currentFilter.geometryId, afterGeometryId),
          );
          ctx.finishEdit(filterId);
        };

        const pointField = (
          fieldKey: string,
          label: string,
          currentValue: SheetPosition,
          buildAfter: (value: Length, current: MirrorFilterData) => SheetPosition,
          buildEntry: (
            current: MirrorFilterData,
            afterPointA: SheetPosition,
            afterPointB: SheetPosition,
          ) => UndoEntry,
        ) =>
          Fields.labelled(
            fieldKey,
            label,
            Fields.length(
              fieldKey,
              Length.fromSheetUnits(
                ctx.sheetDefaultUnit,
                fieldKey.endsWith('x') ? currentValue.x : currentValue.y,
              ),
              { readOnlyUnit: true },
              {
                onChange: (value) => {
                  ctx.captureDragOriginal(filterId);
                  ctx.setWorkingFieldData(fieldKey, { type: 'length', value });
                },
                onKeyDown: (k) => {
                  if (k === 'Escape' && ctx.hasDragOriginal(filterId)) {
                    ctx.restoreDragOriginal(filterId);
                    ctx.clearWorkingFieldData();
                    ctx.recomputeFields();
                  }
                },
                onBlur: () => {
                  const fieldData = ctx.getWorkingFieldData(fieldKey);
                  if (!fieldData || fieldData.type !== 'length') {
                    return;
                  }
                  const current = ctx.geometryStore.getByIdWithComponent(filterId, FilterComponent);
                  if (!current) {
                    return;
                  }
                  const currentFilter = FilterComponent.get(current);
                  if (currentFilter.type !== 'mirror') {
                    return;
                  }
                  const afterPoint = buildAfter(fieldData.value, currentFilter);
                  const afterPointA = fieldKey.startsWith('a') ? afterPoint : currentFilter.pointA;
                  const afterPointB = fieldKey.startsWith('b') ? afterPoint : currentFilter.pointB;
                  ctx.historyManager.apply(buildEntry(currentFilter, afterPointA, afterPointB));
                  ctx.finishEdit(filterId);
                },
              },
            ),
          );

        return [
          Fields.row('point-a', [
            pointField(
              'ax',
              'AX:',
              filterData.pointA,
              (value, current) =>
                new SheetPosition(
                  value.toSheetUnits(ctx.sheetDefaultUnit).magnitude,
                  current.pointA.y,
                ),
              (current, afterPointA, afterPointB) =>
                UndoEntry.mirrorFilterMoveEndpoints(
                  filterId,
                  current.pointA,
                  current.pointB,
                  afterPointA,
                  afterPointB,
                ),
            ),
            pointField(
              'ay',
              'AY:',
              filterData.pointA,
              (value, current) =>
                new SheetPosition(
                  current.pointA.x,
                  value.toSheetUnits(ctx.sheetDefaultUnit).magnitude,
                ),
              (current, afterPointA, afterPointB) =>
                UndoEntry.mirrorFilterMoveEndpoints(
                  filterId,
                  current.pointA,
                  current.pointB,
                  afterPointA,
                  afterPointB,
                ),
            ),
          ]),
          Fields.row('point-b', [
            pointField(
              'bx',
              'BX:',
              filterData.pointB,
              (value, current) =>
                new SheetPosition(
                  value.toSheetUnits(ctx.sheetDefaultUnit).magnitude,
                  current.pointB.y,
                ),
              (current, afterPointA, afterPointB) =>
                UndoEntry.mirrorFilterMoveEndpoints(
                  filterId,
                  current.pointA,
                  current.pointB,
                  afterPointA,
                  afterPointB,
                ),
            ),
            pointField(
              'by',
              'BY:',
              filterData.pointB,
              (value, current) =>
                new SheetPosition(
                  current.pointB.x,
                  value.toSheetUnits(ctx.sheetDefaultUnit).magnitude,
                ),
              (current, afterPointA, afterPointB) =>
                UndoEntry.mirrorFilterMoveEndpoints(
                  filterId,
                  current.pointA,
                  current.pointB,
                  afterPointA,
                  afterPointB,
                ),
            ),
          ]),
          Fields.row('geometry', [
            Fields.labelled(
              'geometry',
              'Geometry',
              Fields.entity(
                'geometry-id',
                filterData.geometryId,
                { clearable: false },
                {
                  onClick: () => {
                    ctx.beginEntityPick('geometry-id', (geometryId) =>
                      changeGeometryId(geometryId),
                    );
                  },
                  onCancel: () => {
                    ctx.endEntityPick();
                  },
                },
              ),
            ),
          ]),
          Fields.button('apply-filter', 'Apply filter...', {
            onClick: () => {
              ctx.actionsManager?.execute('apply-filter-to-geometry');
            },
          }),
        ];
      }
      case 'fillet':
      case 'chamfer': {
        const filterId = entity.id;
        const offsetField = () =>
          Fields.row('offset', [
            Fields.labelled(
              'offset',
              'Offset:',
              Fields.length(
                'offset',
                filterData.offset,
                { readOnlyUnit: true },
                {
                  onChange: (value) => {
                    ctx.captureDragOriginal(filterId);
                    ctx.setWorkingFieldData('offset', { type: 'length', value });
                  },
                  onKeyDown: (k) => {
                    if (k === 'Escape' && ctx.hasDragOriginal(filterId)) {
                      ctx.restoreDragOriginal(filterId);
                      ctx.clearWorkingFieldData();
                      ctx.recomputeFields();
                    }
                  },
                  onBlur: () => {
                    const fieldData = ctx.getWorkingFieldData('offset');
                    if (!fieldData || fieldData.type !== 'length') {
                      return;
                    }
                    const current = ctx.geometryStore.getByIdWithComponent(
                      filterId,
                      FilterComponent,
                    );
                    if (!current) {
                      return;
                    }
                    const currentFilter = FilterComponent.get(current);
                    if (currentFilter.type !== 'fillet' && currentFilter.type !== 'chamfer') {
                      return;
                    }
                    ctx.historyManager.apply(
                      UndoEntry.filterChangeOffset(filterId, currentFilter.offset, fieldData.value),
                    );
                    ctx.finishEdit(filterId);
                  },
                },
              ),
            ),
          ]);

        if (filterData.geometryType === 'polygon') {
          const numberField = (
            fieldKey: string,
            label: string,
            dataKey: 'pointAIndex' | 'pointCenterIndex' | 'pointBIndex',
          ) =>
            Fields.labelled(
              fieldKey,
              label,
              Fields.number(dataKey, filterData[dataKey], {
                onChange: (value) => {
                  ctx.captureDragOriginal(filterId);
                  ctx.setWorkingFieldData(dataKey, { type: 'number', value });
                },
                onKeyDown: (k) => {
                  if (k === 'Escape' && ctx.hasDragOriginal(filterId)) {
                    ctx.restoreDragOriginal(filterId);
                    ctx.clearWorkingFieldData();
                    ctx.recomputeFields();
                  }
                },
                onBlur: () => {
                  const fieldData = ctx.getWorkingFieldData(dataKey);
                  if (!fieldData || fieldData.type !== 'number') {
                    return;
                  }
                  const val = parseInt(fieldData.value, 10);
                  if (isNaN(val) || val < 0) {
                    return;
                  }
                  ctx.geometryStore.updateByIdWithComponentDirect(filterId, FilterComponent, (g) =>
                    FilterComponent.update(g, { [dataKey]: val } as Partial<FilterData>),
                  );
                  ctx.finishEdit(filterId);
                },
              }),
            );

          return [
            offsetField(),
            Fields.row('points', [
              numberField('a', 'A:', 'pointAIndex'),
              numberField('c', 'C:', 'pointCenterIndex'),
              numberField('b', 'B:', 'pointBIndex'),
            ]),
            Fields.button('apply-filter', 'Apply filter...', {
              onClick: () => {
                ctx.actionsManager?.execute('apply-filter-to-geometry');
              },
            }),
          ];
        } else {
          // geometryType === 'rectangle' -- render the corner key points as choice toggle
          // groups so the user can switch which rectangle key point each corner targets.
          const keypointChoices = (
            fieldKey: string,
            label: string,
            dataKey: 'pointAKeyPoint' | 'pointCenterKeyPoint' | 'pointBKeyPoint',
            current: string,
          ) =>
            Fields.labelled(
              fieldKey,
              label,
              Fields.choices(
                fieldKey,
                current,
                RectangleEndpoint.LIST.map((kp) => ({ value: kp, label: kp })),
                {
                  onChange: (value) => {
                    ctx.geometryStore.updateByIdWithComponentDirect(
                      filterId,
                      FilterComponent,
                      (g) => FilterComponent.update(g, { [dataKey]: value } as Partial<FilterData>),
                    );
                    ctx.finishEdit(filterId);
                  },
                },
              ),
            );

          return [
            offsetField(),
            Fields.row('keypoints', [
              keypointChoices('a', 'A:', 'pointAKeyPoint', filterData.pointAKeyPoint),
              keypointChoices('c', 'C:', 'pointCenterKeyPoint', filterData.pointCenterKeyPoint),
              keypointChoices('b', 'B:', 'pointBKeyPoint', filterData.pointBKeyPoint),
            ]),
            Fields.button('apply-filter', 'Apply filter...', {
              onClick: () => {
                ctx.actionsManager?.execute('apply-filter-to-geometry');
              },
            }),
          ];
        }
      }
      case 'pattern': {
        const filterId = entity.id;
        switch (filterData.mode) {
          case 'grid':
            return [
              Fields.row('repeats', [
                Fields.labelled('repeats', 'Repeats:', [
                  Fields.number('xRepeats', filterData.xRepeats, {
                    onChange: (value) => {
                      ctx.captureDragOriginal(filterId);
                      ctx.setWorkingFieldData('xRepeats', { type: 'number', value });
                    },
                    onKeyDown: (k) => {
                      if (k === 'Escape' && ctx.hasDragOriginal(filterId)) {
                        ctx.restoreDragOriginal(filterId);
                        ctx.clearWorkingFieldData();
                        ctx.recomputeFields();
                      }
                    },
                    onBlur: () => {
                      const fieldData = ctx.getWorkingFieldData('xRepeats');
                      if (!fieldData || fieldData.type !== 'number') {
                        return;
                      }
                      const val = parseInt(fieldData.value, 10);
                      if (isNaN(val) || val < 1) {
                        return;
                      }
                      ctx.geometryStore.updateByIdWithComponent(filterId, FilterComponent, (g) =>
                        FilterComponent.update(g, { xRepeats: val }),
                      );
                      ctx.finishEdit(filterId);
                    },
                  }),
                  Fields.number('yRepeats', filterData.yRepeats, {
                    onChange: (value) => {
                      ctx.captureDragOriginal(filterId);
                      ctx.setWorkingFieldData('yRepeats', { type: 'number', value });
                    },
                    onKeyDown: (k) => {
                      if (k === 'Escape' && ctx.hasDragOriginal(filterId)) {
                        ctx.restoreDragOriginal(filterId);
                        ctx.clearWorkingFieldData();
                        ctx.recomputeFields();
                      }
                    },
                    onBlur: () => {
                      const fieldData = ctx.getWorkingFieldData('yRepeats');
                      if (!fieldData || fieldData.type !== 'number') {
                        return;
                      }
                      const val = parseInt(fieldData.value, 10);
                      if (isNaN(val) || val < 1) {
                        return;
                      }
                      ctx.geometryStore.updateByIdWithComponent(filterId, FilterComponent, (g) =>
                        FilterComponent.update(g, { yRepeats: val }),
                      );
                      ctx.finishEdit(filterId);
                    },
                  }),
                ]),
              ]),
              Fields.button('apply-filter', 'Apply filter...', {
                onClick: () => {
                  ctx.actionsManager?.execute('apply-filter-to-geometry');
                },
              }),
            ];
          case 'radial':
            const centerField = (fieldKey: 'x' | 'y', label: string, currentValue: number) =>
              Fields.labelled(
                fieldKey,
                label,
                Fields.length(
                  fieldKey,
                  Length.fromSheetUnits(ctx.sheetDefaultUnit, currentValue),
                  { readOnlyUnit: true },
                  {
                    onChange: (value) => {
                      ctx.captureDragOriginal(filterId);
                      ctx.setWorkingFieldData(fieldKey, { type: 'length', value });
                    },
                    onKeyDown: (k) => {
                      if (k === 'Escape' && ctx.hasDragOriginal(filterId)) {
                        ctx.restoreDragOriginal(filterId);
                        ctx.clearWorkingFieldData();
                        ctx.recomputeFields();
                      }
                    },
                    onBlur: () => {
                      const fieldData = ctx.getWorkingFieldData(fieldKey);
                      if (!fieldData || fieldData.type !== 'length') {
                        return;
                      }
                      const current = ctx.geometryStore.getByIdWithComponent(
                        filterId,
                        FilterComponent,
                      );
                      if (!current) {
                        return;
                      }
                      const currentFilter = FilterComponent.get(current);
                      if (currentFilter.type !== 'pattern' || currentFilter.mode !== 'radial') {
                        return;
                      }
                      const newValue = fieldData.value.toSheetUnits(ctx.sheetDefaultUnit).magnitude;
                      ctx.geometryStore.updateByIdWithComponent(filterId, FilterComponent, (g) =>
                        FilterComponent.update(g, {
                          center:
                            fieldKey === 'x'
                              ? new SheetPosition(newValue, currentFilter.center.y)
                              : new SheetPosition(currentFilter.center.x, newValue),
                        }),
                      );
                      ctx.finishEdit(filterId);
                    },
                  },
                ),
              );

            return [
              Fields.row('position', [
                centerField('x', 'X:', filterData.center.x),
                centerField('y', 'Y:', filterData.center.y),
              ]),
              Fields.row('repeats', [
                Fields.labelled(
                  'repeats',
                  'Repeats:',
                  Fields.number('repeats', filterData.repeats.count, {
                    onChange: (value) => {
                      ctx.captureDragOriginal(filterId);
                      ctx.setWorkingFieldData('repeats', { type: 'number', value });
                    },
                    onKeyDown: (k) => {
                      if (k === 'Escape' && ctx.hasDragOriginal(filterId)) {
                        ctx.restoreDragOriginal(filterId);
                        ctx.clearWorkingFieldData();
                        ctx.recomputeFields();
                      }
                    },
                    onBlur: () => {
                      const fieldData = ctx.getWorkingFieldData('repeats');
                      if (!fieldData || fieldData.type !== 'number') {
                        return;
                      }
                      const val = parseInt(fieldData.value, 10);
                      if (isNaN(val) || val < 2) {
                        return;
                      }
                      ctx.geometryStore.updateByIdWithComponent(filterId, FilterComponent, (g) =>
                        FilterComponent.update(g, {
                          repeats: { type: 'count' as const, count: val },
                        }),
                      );
                      ctx.finishEdit(filterId);
                    },
                  }),
                ),
              ]),
              Fields.row('radius', [
                Fields.labelled(
                  'radius',
                  'Radius:',
                  Fields.length(
                    'radius',
                    Length.fromSheetUnits(ctx.sheetDefaultUnit, filterData.radius),
                    { readOnlyUnit: true },
                    {
                      onChange: (value) => {
                        ctx.captureDragOriginal(filterId);
                        ctx.setWorkingFieldData('radius', { type: 'length', value });
                      },
                      onKeyDown: (k) => {
                        if (k === 'Escape' && ctx.hasDragOriginal(filterId)) {
                          ctx.restoreDragOriginal(filterId);
                          ctx.clearWorkingFieldData();
                          ctx.recomputeFields();
                        }
                      },
                      onBlur: () => {
                        const fieldData = ctx.getWorkingFieldData('radius');
                        if (!fieldData || fieldData.type !== 'length') {
                          return;
                        }
                        const radius = fieldData.value.toSheetUnits(ctx.sheetDefaultUnit).magnitude;
                        ctx.geometryStore.updateByIdWithComponent(filterId, FilterComponent, (g) =>
                          FilterComponent.update(g, { radius }),
                        );
                        ctx.finishEdit(filterId);
                      },
                    },
                  ),
                ),
              ]),
              Fields.button('apply-filter', 'Apply filter...', {
                onClick: () => {
                  ctx.actionsManager?.execute('apply-filter-to-geometry');
                },
              }),
            ];
          default:
            return [];
        }
      }
      default:
        filterData satisfies never;
        return [];
    }
  }
}
