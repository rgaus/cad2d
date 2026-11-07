'use client';

import { useEffect, useState } from 'react';
import RenderOrderInput from '@/components/RenderOrderInput';
import AngleInput from '@/components/ui/AngleInput';
import { Button } from '@/components/ui/Button';
import ColorInput from '@/components/ui/ColorInput';
import EntitySelectionInput from '@/components/ui/EntitySelectionInput';
import FloatingPanel from '@/components/ui/FloatingPanel';
import { Input } from '@/components/ui/Input';
import LabeledRow from '@/components/ui/LabeledRow';
import LengthInput from '@/components/ui/LengthInput';
import { LinkButton } from '@/components/ui/LinkButton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select';
import { type Id } from '@/lib/entity';
import { GeometryStore } from '@/lib/entity/GeometryStore';
import {
  type Field,
  FieldLabel,
  FieldLeaf,
  FieldRow,
  OpenAtIndexState,
  type WorkingFieldData,
} from '@/lib/selection/SelectionInspectorManager';
import { Sheet } from '@/lib/sheet/Sheet';
import { SelectionManager } from '@/lib/tools/SelectionManager';
import { cn } from '@/lib/utils';
import ConstraintEndpointField from './ConstraintEndpointField';
import PolygonPointsInspector from './PolygonPointsInspector';
import ShapePreview from './ShapePreview';

type SelectionInspectorProps = {
  sheet: Sheet;
  geometryStore: GeometryStore;
  selectionManager: SelectionManager;
};

const FieldLeafRenderer: React.FunctionComponent<{
  geometryStore: GeometryStore;
  field: FieldLeaf;
  sheetDefaultUnit: Sheet['defaultUnit'];
  sheetUnitPlaces: Sheet['unitPlaces'];
  openAtIndexState?: OpenAtIndexState;
}> = ({ geometryStore, field, sheetDefaultUnit, sheetUnitPlaces, openAtIndexState = 'idle' }) => {
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
          className="w-full"
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
            roundPlaces={sheetUnitPlaces}
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
            value={field.value}
            geometryId={field.geometryId}
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
    case 'spacing':
      return (
        <div
          className={cn('grow-0 shrink-0', {
            'w-5 h-5': field.width === 'xs',
            'w-6 h-6': field.width === 'sm',
            'w-8 h-8': field.width === 'default',
            'w-10 h-10': field.width === 'lg',
          })}
        />
      );
    case 'link-dimensions-button':
      return <LinkButton linked={field.value} onClick={field.handlers.onClick} size="sm" />;
    case 'button':
      return (
        <Button
          type="button"
          variant="secondary"
          onClick={field.handlers.onClick}
          onFocus={field.handlers.onFocus}
          onBlur={field.handlers.onBlur}
          onKeyDown={(e) => field.handlers.onKeyDown?.(e.key)}
        >
          {typeof field.label === 'string' ? field.label : field.label.icon}
        </Button>
      );
    case 'polygon-points':
      return (
        <>
          <PolygonPointsInspector
            data={field.value}
            sheetUnitPlaces={sheetUnitPlaces}
            sheetDefaultUnit={sheetDefaultUnit}
            openAtIndexState={openAtIndexState}
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
              onMouseEnter={field.handlers.onCloseOpenMouseEnter}
              onMouseLeave={field.handlers.onCloseOpenMouseLeave}
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
    case 'constraint-endpoint':
      return (
        <ConstraintEndpointField
          label={field.label}
          endpoint={field.value}
          onChange={field.handlers.onChange ?? (() => {})}
          geometryStore={geometryStore}
          sheetUnitPlaces={sheetUnitPlaces}
          sheetDefaultUnit={sheetDefaultUnit}
        />
      );
    case 'choices':
      return (
        <Select
          value={field.value}
          onValueChange={(next) => {
            if (next) {
              field.handlers.onChange?.(next);
            }
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case 'entity-selector':
      return (
        <EntitySelectionInput
          value={field.value}
          isPicking={field.isPicking}
          clearable={field.clearable}
          onActivatePick={() => field.handlers.onClick?.()}
          onCancel={() => field.handlers.onCancel?.()}
          onClear={() => field.handlers.onClear?.()}
        />
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

  const [fields, setFields] = useState(sheet.selectionInspectorManager.fields);
  useEffect(() => {
    sheet.selectionInspectorManager.on('fieldsChange', setFields);
    return () => {
      sheet.selectionInspectorManager.off('fieldsChange', setFields);
    };
  }, [sheet.selectionInspectorManager]);

  const [openAtIndexState, setOpenAtIndexState] = useState<OpenAtIndexState>('idle');
  useEffect(() => {
    sheet.selectionInspectorManager.on('openAtIndexStateChange', setOpenAtIndexState);
    return () => {
      sheet.selectionInspectorManager.off('openAtIndexStateChange', setOpenAtIndexState);
    };
  }, [sheet.selectionInspectorManager]);

  const [shapePreview, setShapePreview] = useState(sheet.selectionInspectorManager.shapePreview);
  useEffect(() => {
    sheet.selectionInspectorManager.on('shapePreviewChange', setShapePreview);
    return () => {
      sheet.selectionInspectorManager.off('shapePreviewChange', setShapePreview);
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
      <FloatingPanel noPadding>
        <div className="flex flex-col gap-3 p-3 overflow-y-auto w-full max-h-[calc(100vh-64px)]">
          {shapePreview ? (
            <div className="flex flex-row justify-center w-full py-2">
              <div className="w-20 shrink-0 aspect-square overflow-hidden">
                <ShapePreview
                  geometry={shapePreview.geometry}
                  sheetDefaultUnit={shapePreview.sheetDefaultUnit}
                  filters={shapePreview.filters}
                  highlight={shapePreview.highlight}
                  editingDimension={shapePreview.editingDimension}
                />
              </div>
            </div>
          ) : null}

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
                  openAtIndexState={openAtIndexState}
                />
              );
            }
          })}

          <LabeledRow label="Id:">
            <span className="text-xs text-[var(--slate-8)] font-mono truncate">
              {selectedIds.length === 1
                ? selectedIds[0].slice(0, 8)
                : `${selectedIds.length} selected`}
            </span>
          </LabeledRow>
        </div>
      </FloatingPanel>
    </div>
  );
};

export default SelectionInspector;
