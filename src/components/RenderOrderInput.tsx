import * as SliderPrimitive from '@radix-ui/react-slider';
import debounce from 'lodash.debounce';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { HoverTooltip } from '@/app/components/HoverTooltip';
import { KeyboardShortcut } from '@/app/components/KeyboardShortcut';
import { FillColorComponent, Geometry, Id, Polygon, RenderOrderComponent } from '@/lib/geometry';
import { GeometryStore } from '@/lib/geometry/GeometryStore';
import { BoundingBox } from '@/lib/math';
import { cn } from '@/lib/utils';

/* A slider which can be dragged to adjust a render order value. */
const RenderOrderSlider: React.FunctionComponent<{
  value: number;
  onChange: (newValue: number) => void;
  geometryStore: GeometryStore;
  geometryId?: Id;
  onFocus?: () => void;
  onBlur?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}> = ({
  value,
  onChange,
  geometryStore,
  geometryId,
  onFocus,
  onBlur,
  onMouseEnter,
  onMouseLeave,
}) => {
  const [focused, setFocused] = useState(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!focused) {
      return;
    }

    const onKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowUp':
          onChange(value + 1);
          break;
        case 'ArrowDown':
          onChange(Math.max(0, value - 1));
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [focused, value, onChange]);

  const [[maxRenderOrder, maxRenderOrderFreq], setMaxRenderOrderAndFreq] = useState(
    geometryStore.getMaxRenderOrder(),
  );
  useEffect(() => {
    setMaxRenderOrderAndFreq(geometryStore.getMaxRenderOrder());

    const check = () => {
      if (dragging) {
        return;
      }
      setMaxRenderOrderAndFreq(geometryStore.getMaxRenderOrder());
    };

    geometryStore.on('geometryAdded', check);
    geometryStore.on('geometryUpdated', check);
    geometryStore.on('geometryDeleted', check);
    return () => {
      geometryStore.off('geometryAdded', check);
      geometryStore.off('geometryUpdated', check);
      geometryStore.off('geometryDeleted', check);
    };
  }, [dragging, geometryStore]);

  const [max, setMax] = useState(() => {
    if (maxRenderOrder === value && maxRenderOrder !== 0 && maxRenderOrderFreq === 1) {
      return maxRenderOrder;
    } else {
      // This is NOT a topmost geometry, so add an extra space above so it can be put at the very
      // top
      return maxRenderOrder + 1;
    }
  });
  useEffect(() => {
    // Only ever reset the max if it gets larger. Otherwise there can be weird rendering situations
    // where the slider thumb seems to move out from under the user.
    setMax((oldMax) => Math.max(oldMax, maxRenderOrder));
  }, [maxRenderOrder, maxRenderOrderFreq, value]);

  const intersectingGeometries = useMemo(() => {
    if (!geometryId) {
      return [];
    }

    // Step 1: Compute bounding box
    const geometry = geometryStore.getRenderableGeometryById(geometryId);
    if (!geometry) {
      return [];
    }
    const bounds = Geometry.boundingBox(geometry);
    if (!bounds) {
      return [];
    }

    // Step 2: Get all geometries which intersect bounding box
    let results: Array<{
      id: Polygon['id'];
      renderOrder: RenderOrderComponent['renderOrder'];
      color: string;
    }> = [];
    for (const other of geometryStore.listRenderableGeometries()) {
      if (other.id === geometry.id) {
        continue;
      }
      const otherBounds = Geometry.boundingBox(other);
      if (!otherBounds) {
        continue;
      }

      const otherRenderOrder = Geometry.hasComponent(other, RenderOrderComponent)
        ? RenderOrderComponent.get(other)
        : null;
      const otherFillColor = FillColorComponent.getOptional(other);
      if (
        BoundingBox.intersects(bounds, otherBounds) &&
        otherFillColor !== null &&
        otherRenderOrder !== null
      ) {
        results.push({
          id: other.id,
          renderOrder: otherRenderOrder,
          color: `#${otherFillColor?.toString(16)}`,
        });
      }
    }

    return results;
  }, [geometryStore, geometryId]);

  return (
    <div className="relative w-8">
      {/* A fake slider is rendered behind to show hints of render order of surrounding geometry */}
      {intersectingGeometries.length > 0 ? (
        <SliderPrimitive.Root
          aria-hidden="false"
          disabled
          value={intersectingGeometries.map((i) => i.renderOrder)}
          min={0}
          max={max}
          className={cn(
            'absolute flex flex-col inset-0 touch-none items-center select-none h-full w-auto',
          )}
          orientation="vertical"
        >
          {intersectingGeometries.map((inters, index) => (
            <SliderPrimitive.Thumb
              key={index}
              className="relative block h-0.5 w-8 shrink-0 select-none after:absolute pointer-events-none opacity-50"
              style={{ backgroundColor: inters.color }}
            />
          ))}
        </SliderPrimitive.Root>
      ) : null}

      {/* The actual slider with the actual geometry shown. */}
      <SliderPrimitive.Root
        value={[value]}
        min={0}
        max={max}
        step={1}
        onValueChange={(values) => onChange(values[0])}
        onPointerDown={() => setDragging(true)}
        onPointerUp={() => setDragging(false)}
        onFocus={() => {
          setFocused(true);
          onFocus?.();
        }}
        onBlur={() => {
          setFocused(false);
          onBlur?.();
        }}
        onMouseEnter={() => {
          setFocused(true);
          onMouseEnter?.();
        }}
        onMouseLeave={() => {
          setFocused(false);
          onMouseLeave?.();
        }}
        className={cn(
          'absolute flex inset-0 touch-none items-center select-none data-disabled:opacity-50',
          'data-vertical:h-full data-vertical:min-h-40 data-vertical:w-auto data-vertical:flex-col',
          'border border-[var(--slate-5)] border-r-0 rounded-l-[4px]',
        )}
        orientation="vertical"
      >
        <SliderPrimitive.Track
          data-slot="slider-track"
          className="relative grow overflow-hidden rounded-full bg-muted data-horizontal:h-1 data-horizontal:w-full data-vertical:h-full data-vertical:w-1"
        >
          <SliderPrimitive.Range
            data-slot="slider-range"
            className="absolute bg-primary select-none data-horizontal:h-full data-vertical:w-full"
          />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          key={0}
          className="relative block h-0.5 mx-1.5 w-5 shrink-0 border border-ring bg-white ring-ring/50 transition-[color,box-shadow] select-none after:absolute after:-inset-2 hover:ring-3 focus-visible:ring-3 focus-visible:outline-hidden active:ring-3 disabled:pointer-events-none disabled:opacity-50"
        />
      </SliderPrimitive.Root>
    </div>
  );
};

const RenderOrderInput: React.FunctionComponent<{
  value: number;
  onChange: (newValue: number) => void;
  geometryStore: GeometryStore;
  geometryId?: Id;
}> = ({ value, onChange, geometryStore, geometryId }) => {
  const [focused, setFocused] = useState<'slider' | 'input' | null>(null);

  useEffect(() => {
    if (!focused) {
      return;
    }

    const onKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowUp':
          onChange(value + 1);
          break;
        case 'ArrowDown':
          onChange(Math.max(0, value - 1));
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [focused, value, onChange]);

  const [workingTextValue, setWorkingTextValue] = useState('');
  useEffect(() => setWorkingTextValue(`${value}`), [value]);

  const handleWorkingValueChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setWorkingTextValue(e.currentTarget.value);
  }, []);

  const [workingValue, setWorkingValue] = useState(value);
  useEffect(() => setWorkingValue(value), [value]);
  const syncWorkingValue = useMemo(
    () => debounce((newValue: number) => onChange(newValue), 25),
    [onChange],
  );

  return (
    <div
      className={cn(
        'relative flex h-8 w-full bg-[var(--slate-3)] hover:bg-[var(--slate-4)] text-sm text-[var(--slate-12)] font-mono outline-none transition-colors placeholder:text-[var(--slate-7)] disabled:cursor-not-allowed disabled:opacity-50',
      )}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <RenderOrderSlider
        value={workingValue}
        onChange={(value) => {
          setWorkingValue(value);
          syncWorkingValue(value);
        }}
        geometryStore={geometryStore}
        geometryId={geometryId}
        onFocus={() => setFocused((old) => old || 'slider')}
        onBlur={() => setFocused((old) => (old === 'slider' ? null : old))}
        onMouseEnter={() => setFocused((old) => old || 'slider')}
        onMouseLeave={() => setFocused((old) => (old === 'slider' ? null : old))}
      />

      <input
        type="text"
        className={cn(
          'grow shrink w-20 h-8 px-2 py-1 text-sm bg-transparent text-[var(--slate-12)] font-mono',
          'rounded-r-[4px] border border-[var(--slate-5)] bg-transparent',
          'focus:bg-[var(--slate-4)] px-2 py-1 text-sm text-[var(--slate-12)] font-mono outline-none',
          'transition-colors placeholder:text-[var(--slate-7)] focus:border-[var(--slate-8)]',
        )}
        value={workingTextValue}
        onChange={handleWorkingValueChange}
        onFocus={() => setFocused((old) => old || 'input')}
        onKeyDown={(e) => {
          switch (e.key) {
            case 'Enter':
              setFocused((old) => (old === 'input' ? null : old));

              const parsed = parseFloat(workingTextValue);
              if (isNaN(parsed)) {
                return;
              }
              setWorkingValue(parsed);
              onChange(parsed);
              break;
            case 'Escape':
              setWorkingTextValue(`${value}`);
              e.currentTarget.blur();
              break;
            case 'ArrowUp':
              setWorkingTextValue(`${value + 1}`);
              setWorkingValue(value + 1);
              onChange(value + 1);
              break;
            case 'ArrowDown':
              const newValue = Math.max(0, value - 1);
              setWorkingTextValue(`${newValue}`);
              setWorkingValue(newValue);
              onChange(newValue);
              break;
          }
        }}
        onBlur={() => {
          setFocused((old) => (old === 'input' ? null : old));

          const parsed = parseFloat(workingTextValue);
          if (isNaN(parsed)) {
            return;
          }
          setWorkingValue(parsed);
          onChange(parsed);
        }}
      />

      {focused === 'input' ? (
        <div className="absolute right-0 -bottom-7 z-30">
          <HoverTooltip>
            <div className="flex items-center gap-2">
              <KeyboardShortcut label="Move up">&#9650;</KeyboardShortcut>
              <KeyboardShortcut label="Move down">&#9660;</KeyboardShortcut>
            </div>
          </HoverTooltip>
        </div>
      ) : null}
      {focused === 'slider' ? (
        <div className="absolute left-0 -bottom-7 z-30">
          <HoverTooltip>
            <div className="flex items-center gap-2">
              <span style={{ fontSize: 10 }}>Drag to reorder</span>
            </div>
          </HoverTooltip>
        </div>
      ) : null}
    </div>
  );
};

export default RenderOrderInput;
