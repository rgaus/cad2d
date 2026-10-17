/* eslint-disable react-hooks/set-state-in-effect */
import * as SliderPrimitive from '@radix-ui/react-slider';
import debounce from 'lodash.debounce';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { Input } from '@/components/ui/Input';
import { KeyboardShortcut } from '@/components/ui/KeyboardShortcut';
import { Entity, FillColorComponent, Id, Polygon, RenderOrderComponent } from '@/lib/entity';
import { GeometryStore } from '@/lib/entity/GeometryStore';
import { BoundingBox } from '@/lib/math';
import { cn } from '@/lib/utils';

type InputSize = 'xs' | 'sm' | 'default' | 'lg';

const SLIDER_SIZE_CLASSES: Record<
  InputSize,
  { container: string; thumb: string; thumbHint: string; track: string }
> = {
  xs: { container: 'h-3 w-3', thumb: 'h-px w-2', thumbHint: 'h-px w-3', track: 'w-px' },
  sm: { container: 'h-4 w-4', thumb: 'h-px w-4', thumbHint: 'h-px w-6', track: 'w-px' },
  default: { container: 'h-6 w-5', thumb: 'h-0.5 w-5', thumbHint: 'h-0.5 w-7', track: 'w-0.5' },
  lg: { container: 'h-8 w-6', thumb: 'h-0.5 w-6', thumbHint: 'h-0.5 w-8', track: 'w-0.5' },
};

/* A slider which can be dragged to adjust a render order value. */
const RenderOrderSlider: React.FunctionComponent<{
  value: number;
  onChange: (newValue: number) => void;
  geometryStore: GeometryStore;
  geometryId?: Id;
  size?: InputSize;
  onFocus?: () => void;
  onBlur?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}> = ({
  value,
  onChange,
  geometryStore,
  geometryId,
  size = 'default',
  onFocus,
  onBlur,
  onMouseEnter,
  onMouseLeave,
}) => {
  const [dragging, setDragging] = useState(false);
  const sizeClasses = SLIDER_SIZE_CLASSES[size];

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
    const bounds = Entity.boundingBox(geometry);
    if (!bounds) {
      return [];
    }

    // Step 2: Get all geometries which intersect bounding box
    const results: Array<{
      id: Polygon['id'];
      renderOrder: RenderOrderComponent['renderOrder'];
      color: string;
    }> = [];
    for (const other of geometryStore.listRenderableGeometries()) {
      if (other.id === geometry.id) {
        continue;
      }
      const otherBounds = Entity.boundingBox(other);
      if (!otherBounds) {
        continue;
      }

      const otherRenderOrder = Entity.hasComponent(other, RenderOrderComponent)
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
    <div className={cn('relative shrink-0 select-none', sizeClasses.container)}>
      {/* A fake slider is rendered behind to show hints of render order of surrounding geometry */}
      {intersectingGeometries.length > 0 ? (
        <SliderPrimitive.Root
          aria-hidden="true"
          disabled
          value={intersectingGeometries.map((i) => i.renderOrder)}
          min={0}
          max={max}
          orientation="vertical"
          className="pointer-events-none absolute inset-0 flex flex-col items-center opacity-50"
        >
          {intersectingGeometries.map((inters, index) => (
            <SliderPrimitive.Thumb
              key={index}
              className={cn(
                'relative block shrink-0 opacity-50 rounded-full',
                sizeClasses.thumbHint,
              )}
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
        orientation="vertical"
        onValueChange={(values) => onChange(values[0])}
        onPointerDown={() => setDragging(true)}
        onPointerUp={() => setDragging(false)}
        onFocus={onFocus}
        onBlur={onBlur}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        className="absolute inset-0 flex touch-none cursor-ns-resize flex-col items-center select-none data-disabled:opacity-50"
      >
        <SliderPrimitive.Track
          data-slot="slider-track"
          className={cn(
            'relative h-full overflow-hidden rounded-full bg-transparent',
            sizeClasses.track,
          )}
        >
          <SliderPrimitive.Range data-slot="slider-range" className="absolute w-full select-none" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          key={0}
          className={cn(
            'relative block shrink-0 rounded-full border border-[var(--slate-8)] bg-[var(--slate-12)]',
            'transition-[color,box-shadow] select-none after:absolute after:-inset-1',
            'hover:ring-2 hover:ring-[var(--slate-8)] focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden',
            'active:ring-2 active:ring-[var(--slate-8)]',
            sizeClasses.thumb,
          )}
        />
      </SliderPrimitive.Root>
    </div>
  );
};

const RenderOrderInput: React.FunctionComponent<{
  value: number;
  onChange: (newValue: number) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  geometryStore: GeometryStore;
  geometryId?: Id;
  size?: InputSize;
}> = ({ value, onChange, onFocus, onBlur, geometryStore, geometryId, size = 'default' }) => {
  const [focused, setFocused] = useState<'slider' | 'input' | null>(null);
  const [sliderFocused, setSliderFocused] = useState(false);

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
    <div className="relative w-full" onKeyDown={(e) => e.stopPropagation()}>
      <Input
        type="text"
        size={size}
        className={cn({
          'ring-primary outline-none ring-2 ring-offset-2': sliderFocused,
        })}
        leading={
          <RenderOrderSlider
            value={workingValue}
            onChange={(value) => {
              setWorkingValue(value);
              syncWorkingValue(value);
            }}
            geometryStore={geometryStore}
            geometryId={geometryId}
            size={size}
            onFocus={() => {
              setSliderFocused(true);
              setFocused((old) => old || 'slider');
              onFocus?.();
            }}
            onBlur={() => {
              setSliderFocused(false);
              setFocused((old) => (old === 'slider' ? null : old));
              onBlur?.();
            }}
            onMouseEnter={() => setFocused((old) => old || 'slider')}
            onMouseLeave={() => setFocused((old) => (old === 'slider' ? null : old))}
          />
        }
        value={workingTextValue}
        onChange={handleWorkingValueChange}
        onFocus={() => {
          setFocused((old) => old || 'input');
          onFocus?.();
        }}
        onKeyDown={(e) => {
          switch (e.key) {
            case 'Enter':
              e.currentTarget.blur();
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
            onBlur?.();
            return;
          }
          setWorkingValue(parsed);
          onChange(parsed);
          onBlur?.();
        }}
      />

      {focused === 'input' ? (
        <div className="absolute right-0 -bottom-7 z-30">
          <HoverTooltip size={size}>
            <div className="flex items-center gap-2">
              <KeyboardShortcut label="Move up">&#9650;</KeyboardShortcut>
              <KeyboardShortcut label="Move down">&#9660;</KeyboardShortcut>
            </div>
          </HoverTooltip>
        </div>
      ) : null}
      {focused === 'slider' ? (
        <div className="absolute left-0 -bottom-7 z-30">
          <HoverTooltip size={size}>Drag to reorder</HoverTooltip>
        </div>
      ) : null}
    </div>
  );
};

export default RenderOrderInput;
