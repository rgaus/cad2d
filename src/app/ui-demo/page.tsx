'use client';

import {
  ActivityIcon,
  BoxIcon,
  ChevronDownIcon,
  ChevronsLeftRightIcon,
  DownloadIcon,
  SearchIcon,
  SquareDashedMousePointerIcon,
} from 'lucide-react';
import * as React from 'react';
import { useRef, useState } from 'react';
import RenderOrderInput from '@/components/RenderOrderInput';
import {
  AnchorDotGrid,
  ELLIPSE_ANCHOR_DOTS,
  RECTANGLE_ANCHOR_DOTS,
} from '@/components/ui/AnchorDotGrid';
import AngleInput from '@/components/ui/AngleInput';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Chip } from '@/components/ui/Chip';
import ColorInput from '@/components/ui/ColorInput';
import ConstraintEndpointInput from '@/components/ui/ConstraintEndpointInput';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/Dialog';
import EntitySelectionInput from '@/components/ui/EntitySelectionInput';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { Input } from '@/components/ui/Input';
import { JumpTo, JumpToController, JumpToItem } from '@/components/ui/JumpTo';
import { KeyboardShortcut } from '@/components/ui/KeyboardShortcut';
import LabeledRow from '@/components/ui/LabeledRow';
import LengthInput from '@/components/ui/LengthInput';
import { LinkButton } from '@/components/ui/LinkButton';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select';
import {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/Sheet';
import { Statistics, StatisticsItem } from '@/components/ui/Statistics';
import { Switch } from '@/components/ui/Switch';
import {
  Table,
  TableBody,
  TableCell,
  TableEmptyState,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/ToggleGroup';
import { type Id, Rectangle, RenderOrderComponent } from '@/lib/entity';
import { GeometryStore } from '@/lib/entity/GeometryStore';
import { PRESET_COLORS_BY_LABEL } from '@/lib/entity/colors';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { Angle } from '@/lib/units/angle';
import { Length } from '@/lib/units/length';
import { cn } from '@/lib/utils';
import { SheetPosition } from '@/lib/viewport/types';

const FRUITS = ['apple', 'banana', 'blueberry', 'grapes', 'pineapple'];

function FigmaGroup({
  name,
  children,
  width,
}: {
  name: string;
  children: React.ReactNode;
  width?: number;
}) {
  const wrapped = React.Children.toArray(children).map((child, index) => (
    <div className="w-full" key={index}>
      {child}
    </div>
  ));

  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-[var(--violet-11)]">{name}</span>
      <div>
        {React.Children.count(children) === 1 ? (
          wrapped
        ) : (
          <div
            className="inline-flex flex-col gap-2 rounded-sm border border-dashed border-[var(--violet-9)] p-2"
            style={width ? { width } : undefined}
          >
            {wrapped}
          </div>
        )}
      </div>
    </div>
  );
}

function FigmaGroupVariant({
  name,
  children,
  width,
  alignItems,
  background,
}: {
  name: string;
  children: React.ReactNode;
  width?: number;
  alignItems?: 'start' | 'end';
  background?: 'dark' | 'light';
}) {
  const wrapped = React.Children.toArray(children).map((child, index) => (
    <div style={{ width }} key={index}>
      {child}
    </div>
  ));

  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-[var(--violet-12)]">{name}</span>
      <div>
        {React.Children.count(children) === 1 ? (
          wrapped
        ) : (
          <div
            className={cn(
              'inline-flex gap-2 flex-wrap rounded-sm border border-dashed border-[var(--violet-12)] p-2',
              { 'bg-[#fff]': background === 'light' },
            )}
            style={{ alignItems }}
          >
            {wrapped}
          </div>
        )}
      </div>
    </div>
  );
}

const SIZES = ['xs', 'sm', 'default', 'lg'] as const;

const DEMO_ENTITIES: Array<{ id: Id }> = [
  { id: 'ply_9f3a1c2e9f3a1c2e9f3a1c2e9f3a1c2e' },
  { id: 'rct_1e4b7d921e4b7d921e4b7d921e4b7d92' },
  { id: 'elp_a03f51c8a03f51c8a03f51c8a03f51c8' },
  { id: 'dtm_77d2e9b477d2e9b477d2e9b477d2e9b4' },
];

const RENDER_ORDER_DEMO_GEOMETRY_ID = 'rct_00000000000000000000000000000001';

function makeRenderOrderDemoStore() {
  const store = new GeometryStore(new HistoryManager());

  const addRectangle = (
    id: string,
    upperLeft: [number, number],
    lowerRight: [number, number],
    fillColor: number,
    renderOrder: number,
  ) => {
    const template = Rectangle.create(
      new SheetPosition(...upperLeft),
      new SheetPosition(...lowerRight),
      { fillColor },
    );
    store.addDirect({
      id,
      components: {
        ...template.components,
        ...RenderOrderComponent.create(renderOrder),
      },
    });
  };

  addRectangle(
    RENDER_ORDER_DEMO_GEOMETRY_ID,
    [0, 0],
    [10, 10],
    PRESET_COLORS_BY_LABEL['blue-mid'],
    2,
  );
  addRectangle(
    'rct_00000000000000000000000000000002',
    [2, 2],
    [8, 8],
    PRESET_COLORS_BY_LABEL['red-mid'],
    5,
  );
  addRectangle(
    'rct_00000000000000000000000000000003',
    [-1, 3],
    [6, 7],
    PRESET_COLORS_BY_LABEL['green-mid'],
    0,
  );
  addRectangle(
    'rct_00000000000000000000000000000004',
    [3, -1],
    [7, 6],
    PRESET_COLORS_BY_LABEL['purple-mid'],
    7,
  );

  return store;
}

function RenderOrderDemo({ size }: { size: (typeof SIZES)[number] }) {
  const [store] = useState(makeRenderOrderDemoStore);
  const [value, setValue] = useState(2);

  return (
    <RenderOrderInput
      size={size}
      value={value}
      onChange={setValue}
      geometryStore={store}
      geometryId={RENDER_ORDER_DEMO_GEOMETRY_ID}
    />
  );
}

function JumpToDemo() {
  const sectionToWrapperMapping = useRef(new Map<string, HTMLElement>());
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className="flex h-[300px] w-full">
      <JumpTo>
        <JumpToItem
          selected={selected === 'a'}
          onClick={() => {
            sectionToWrapperMapping.current.get('a')?.scrollIntoView();
            setSelected('a');
          }}
        >
          A
        </JumpToItem>
        <JumpToItem
          selected={selected === 'b'}
          onClick={() => {
            sectionToWrapperMapping.current.get('b')?.scrollIntoView();
            setSelected('b');
          }}
        >
          B
        </JumpToItem>
        <JumpToItem
          selected={selected === 'c'}
          onClick={() => {
            sectionToWrapperMapping.current.get('c')?.scrollIntoView();
            setSelected('c');
          }}
        >
          C
        </JumpToItem>
      </JumpTo>
      <JumpToController
        sectionToWrapperMapping={sectionToWrapperMapping}
        onChangeVisibleSection={setSelected}
      >
        <div
          className="h-[500px] text-white"
          style={{ background: 'red' }}
          ref={(node) => {
            if (node) sectionToWrapperMapping.current.set('a', node);
            else sectionToWrapperMapping.current.delete('a');
          }}
        >
          A
        </div>
        <div
          className="h-[500px] text-white"
          style={{ background: 'green' }}
          ref={(node) => {
            if (node) sectionToWrapperMapping.current.set('b', node);
            else sectionToWrapperMapping.current.delete('b');
          }}
        >
          B
        </div>
        <div
          className="h-[500px] text-white"
          style={{ background: 'blue' }}
          ref={(node) => {
            if (node) sectionToWrapperMapping.current.set('c', node);
            else sectionToWrapperMapping.current.delete('c');
          }}
        >
          C
        </div>
      </JumpToController>
    </div>
  );
}

export default function UiDemo() {
  const [colorValue, setColorValue] = useState<number | null | 'non-homogeneous'>(0x3e63dd);
  const [colorEmpty, setColorEmpty] = useState<number | null>(null);

  const [angleValue, setAngleValue] = useState<Angle>(Angle.degrees(45));
  const [angleReadOnly, setAngleReadOnly] = useState<Angle>(Angle.radians(1.25));

  const [lengthValue, setLengthValue] = useState<Length>(Length.centimeters(8.5));
  const [lengthReadOnly, setLengthReadOnly] = useState<Length>(Length.inches(12));

  const [entityId, setEntityId] = useState<Id | null>(DEMO_ENTITIES[0].id);
  const [picking, setPicking] = useState(false);
  const [emptyPicking, setEmptyPicking] = useState(false);

  const [rectAnchor, setRectAnchor] = useState('center');
  const [ellipseAnchor, setEllipseAnchor] = useState('top');
  const [linked, setLinked] = useState(false);

  return (
    <div className="flex flex-col gap-8 overflow-auto bg-[var(--slate-2)] p-8">
      <FigmaGroup name="Button">
        {SIZES.map((size) => (
          <FigmaGroupVariant key={size} name={size}>
            <Button size={size} variant="primary">
              Download JSON
            </Button>
            <Button
              size={size}
              variant="primary"
              leadingIcon={<DownloadIcon size={size === 'xs' ? 12 : 16} />}
            >
              Download JSON
            </Button>
            <Button size={size} variant="primary" disabled>
              Download JSON
            </Button>
            <Button
              size={size}
              variant="primary"
              leadingIcon={<DownloadIcon size={size === 'xs' ? 12 : 16} />}
            />

            <Button size={size} variant="secondary">
              Download JSON
            </Button>
            <Button
              size={size}
              variant="secondary"
              leadingIcon={<DownloadIcon size={size === 'xs' ? 12 : 16} />}
            >
              Download JSON
            </Button>
            <Button size={size} variant="secondary" disabled>
              Download JSON
            </Button>
            <Button
              size={size}
              variant="secondary"
              leadingIcon={<DownloadIcon size={size === 'xs' ? 12 : 16} />}
            />
            <Button
              size={size}
              variant="secondary"
              trailingIcon={<ChevronDownIcon size={size === 'xs' ? 12 : 16} />}
            >
              Download JSON
            </Button>
            <Button size={size} variant="ghost">
              Download JSON
            </Button>
            <Button
              size={size}
              variant="ghost"
              leadingIcon={<DownloadIcon size={size === 'xs' ? 12 : 16} />}
            >
              Download JSON
            </Button>
            <Button size={size} variant="ghost" disabled>
              Download JSON
            </Button>
            <Button
              size={size}
              variant="ghost"
              leadingIcon={<DownloadIcon size={size === 'xs' ? 12 : 16} />}
            />
          </FigmaGroupVariant>
        ))}
      </FigmaGroup>

      <FigmaGroup name="Input">
        {SIZES.map((size) => (
          <FigmaGroupVariant key={size} name={size} width={250} alignItems="end">
            <Input size={size} />
            <Input size={size} placeholder="eg: hello world!" />
            <Input size={size} defaultValue="example text" />
            <Input size={size} defaultValue="Enter a name here..." label="Name" />
            <Input size={size} placeholder="Search layers..." leading={<SearchIcon size={16} />} />
            <Input size={size} type="number" placeholder="eg: 5" leading="$" trailing=".00" />
            <Input size={size} placeholder="eg: invalid" invalid />
          </FigmaGroupVariant>
        ))}
      </FigmaGroup>

      <FigmaGroup name="Select">
        {SIZES.map((size) => (
          <FigmaGroupVariant key={size} name={size} width={250}>
            <Select>
              <SelectTrigger size={size} className="w-[180px]">
                <SelectValue placeholder="Select a fruit" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <>
                    <SelectLabel>Fruits</SelectLabel>
                    {FRUITS.map((fruit) => (
                      <SelectItem key={fruit} value={fruit}>
                        {fruit.charAt(0).toUpperCase() + fruit.slice(1)}
                      </SelectItem>
                    ))}
                  </>
                </SelectGroup>
              </SelectContent>
            </Select>
            <Select>
              <SelectTrigger size={size} className="w-[180px]">
                <SelectValue placeholder="Select a fruit" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {FRUITS.map((fruit) => (
                    <SelectItem key={fruit} value={fruit}>
                      {fruit.charAt(0).toUpperCase() + fruit.slice(1)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Select>
              <SelectTrigger size={size} leadingIcon={<DownloadIcon size={16} />}>
                <SelectValue placeholder="Select a fruit" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {FRUITS.map((fruit) => (
                    <SelectItem key={fruit} value={fruit}>
                      {fruit.charAt(0).toUpperCase() + fruit.slice(1)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Select>
              <SelectTrigger size={size} trailingIcon={<DownloadIcon size={16} />}>
                <SelectValue placeholder="Select a fruit" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {FRUITS.map((fruit) => (
                    <SelectItem key={fruit} value={fruit}>
                      {fruit.charAt(0).toUpperCase() + fruit.slice(1)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Select disabled>
              <SelectTrigger size={size} className="w-[180px]">
                <SelectValue placeholder="Select a fruit" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <>
                    <SelectLabel>Fruits</SelectLabel>
                    {FRUITS.map((fruit) => (
                      <SelectItem key={fruit} value={fruit}>
                        {fruit.charAt(0).toUpperCase() + fruit.slice(1)}
                      </SelectItem>
                    ))}
                  </>
                </SelectGroup>
              </SelectContent>
            </Select>
          </FigmaGroupVariant>
        ))}
      </FigmaGroup>

      <FigmaGroup name="Chip">
        {SIZES.map((size) => (
          <FigmaGroupVariant key={size} name={size}>
            <Chip size={size}>1</Chip>
            <Chip size={size} variant="secondary">
              7h ago
            </Chip>
            <Chip size={size} variant="tertiary">
              7h ago
            </Chip>
          </FigmaGroupVariant>
        ))}
      </FigmaGroup>

      <FigmaGroup name="Tooltip">
        {SIZES.map((size) => (
          <FigmaGroupVariant key={size} name={size} background="light">
            <HoverTooltip size={size}>Drag to reorder</HoverTooltip>
            <HoverTooltip size={size}>
              <div className="flex items-center gap-2">
                <KeyboardShortcut>ctrl</KeyboardShortcut>
                <span>Drag to reorder</span>
              </div>
            </HoverTooltip>
            <HoverTooltip size={size} variant="secondary">
              <div className="flex items-center gap-1">
                <KeyboardShortcut>a</KeyboardShortcut>
                <span>Split here?</span>
              </div>
            </HoverTooltip>
            <HoverTooltip size={size}>
              <div className="flex flex-col gap-1">
                <span>Place first point</span>
                <div className="flex items-center gap-2">
                  <div className="flex gap-1 items-center">
                    <KeyboardShortcut>option</KeyboardShortcut>
                    <span>Arc</span>
                  </div>
                  <div className="flex gap-1 items-center">
                    <KeyboardShortcut>ctrl</KeyboardShortcut>
                    <span>No snap</span>
                  </div>
                  <div className="flex gap-1 items-center">
                    <KeyboardShortcut>cmd</KeyboardShortcut>
                    <span>Snap 15&deg;</span>
                  </div>
                </div>
              </div>
            </HoverTooltip>
            <HoverTooltip size={size} variant="secondary">
              8.5cm
            </HoverTooltip>
          </FigmaGroupVariant>
        ))}
      </FigmaGroup>

      <FigmaGroup name="Color Picker">
        {SIZES.map((size) => (
          <FigmaGroupVariant key={size} name={size} width={240}>
            <ColorInput size={size} value={colorValue} onChange={setColorValue} />
            <ColorInput size={size} value={colorEmpty} onChange={setColorEmpty} />
            <ColorInput size={size} value="non-homogeneous" onChange={setColorValue} />
          </FigmaGroupVariant>
        ))}
      </FigmaGroup>

      <FigmaGroup name="Angle">
        {SIZES.map((size) => (
          <FigmaGroupVariant key={size} name={size} width={280}>
            <AngleInput size={size} value={angleValue} onChange={setAngleValue} />
            <AngleInput
              size={size}
              value={angleReadOnly}
              onChange={setAngleReadOnly}
              readOnlyUnit
            />
          </FigmaGroupVariant>
        ))}
      </FigmaGroup>

      <FigmaGroup name="Length">
        {SIZES.map((size) => (
          <FigmaGroupVariant key={size} name={size} width={280}>
            <LengthInput size={size} value={lengthValue} onChange={setLengthValue} />
            <LengthInput
              size={size}
              value={lengthReadOnly}
              onChange={setLengthReadOnly}
              readOnlyUnit
            />
          </FigmaGroupVariant>
        ))}
      </FigmaGroup>

      <FigmaGroup name="Render Order">
        {SIZES.map((size) => (
          <FigmaGroupVariant key={size} name={size} width={280}>
            <RenderOrderDemo size={size} />
          </FigmaGroupVariant>
        ))}
      </FigmaGroup>

      <FigmaGroup name="Entity Selection">
        {SIZES.map((size) => (
          <FigmaGroupVariant key={size} name={size} width={240}>
            <EntitySelectionInput
              size={size}
              value={entityId}
              clearable
              isPicking={picking}
              onActivatePick={() => setPicking(true)}
              onCancel={() => setPicking(false)}
              onClear={() => setEntityId(null)}
            />
            <EntitySelectionInput
              size={size}
              value={null}
              clearable
              isPicking={emptyPicking}
              onActivatePick={() => setEmptyPicking(true)}
              onCancel={() => setEmptyPicking(false)}
            />
          </FigmaGroupVariant>
        ))}
      </FigmaGroup>

      <FigmaGroup name="Anchor Dot Grid">
        <div className="flex w-[120px] flex-col gap-3">
          <div className="flex items-center gap-3">
            <span className="w-12 text-xs text-[var(--slate-11)] select-none">rect</span>
            <AnchorDotGrid
              value={rectAnchor}
              dots={RECTANGLE_ANCHOR_DOTS}
              onChange={setRectAnchor}
            />
          </div>
          <div className="flex items-center gap-3">
            <span className="w-12 text-xs text-[var(--slate-11)] select-none">ellipse</span>
            <AnchorDotGrid
              value={ellipseAnchor}
              dots={ELLIPSE_ANCHOR_DOTS}
              onChange={setEllipseAnchor}
            />
          </div>
        </div>
      </FigmaGroup>

      <FigmaGroup name="Constraint Endpoint">
        <div className="w-[280px]">
          <ConstraintEndpointInput label="Start" />
        </div>
        <div className="w-[280px]">
          <ConstraintEndpointInput label="End" />
        </div>
      </FigmaGroup>

      <FigmaGroup name="Labeled Row">
        <div className="flex w-[280px] flex-col gap-2">
          <LabeledRow label="Name:">
            <Input defaultValue="Enter a name..." />
          </LabeledRow>
          <LabeledRow label="Unit:">
            <Select defaultValue="cm">
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {['in', 'ft', 'mm', 'cm', 'm'].map((u) => (
                  <SelectItem key={u} value={u}>
                    {u}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </LabeledRow>
          <LabeledRow label="Locked:" fullWidth={false}>
            <Switch checked defaultChecked />
          </LabeledRow>
          <LabeledRow label="Id:">
            <span className="text-xs text-[var(--slate-8)] font-mono truncate">rct_9f3a1c</span>
          </LabeledRow>
        </div>
      </FigmaGroup>

      <FigmaGroup name="Switch">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <Switch checked defaultChecked />
            <span className="text-xs text-[var(--slate-11)] select-none">On</span>
          </div>
          <div className="flex items-center gap-3">
            <Switch />
            <span className="text-xs text-[var(--slate-11)] select-none">Off</span>
          </div>
          <div className="flex items-center gap-3">
            <Switch disabled />
            <span className="text-xs text-[var(--slate-11)] select-none">Disabled</span>
          </div>
        </div>
      </FigmaGroup>

      <FigmaGroup name="Toggle Group">
        <ToggleGroup type="single" defaultValue="fill">
          <ToggleGroupItem value="wire" className="w-auto px-2 h-6 text-xs">
            Wire
          </ToggleGroupItem>
          <ToggleGroupItem value="fill" className="w-auto px-2 h-6 text-xs">
            Fill
          </ToggleGroupItem>
          <ToggleGroupItem value="both" className="w-auto px-2 h-6 text-xs">
            Both
          </ToggleGroupItem>
        </ToggleGroup>
        <ToggleGroup type="single" defaultValue="b">
          <ToggleGroupItem value="a">A</ToggleGroupItem>
          <ToggleGroupItem value="b">B</ToggleGroupItem>
          <ToggleGroupItem value="c">C</ToggleGroupItem>
        </ToggleGroup>
      </FigmaGroup>

      <FigmaGroup name="Link Button">
        <div className="flex items-center gap-2">
          <LinkButton linked={linked} onClick={() => setLinked(!linked)} />
          <LinkButton linked />
        </div>
      </FigmaGroup>

      <FigmaGroup name="Tabs">
        <Tabs defaultValue="one">
          <TabsList>
            <TabsTrigger value="one">
              <div className="flex w-[200px] items-center justify-center gap-2">
                <Chip>1</Chip>
                Geometry
              </div>
            </TabsTrigger>
            <TabsTrigger value="two">
              <div className="flex w-[200px] items-center justify-center gap-2">
                <Chip>2</Chip>
                Dimensions
              </div>
            </TabsTrigger>
            <TabsTrigger value="three">
              <div className="flex w-[200px] items-center justify-center gap-2">
                <Chip>3</Chip>
                Constraints
              </div>
            </TabsTrigger>
            <TabsTrigger value="four">
              <div className="flex w-[200px] items-center justify-center gap-2">
                <Chip>4</Chip>
                Annotations
              </div>
            </TabsTrigger>
            <TabsTrigger value="five">
              <div className="flex w-[200px] items-center justify-center gap-2">
                <Chip>5</Chip>
                Layers
              </div>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="one">Edit the geometry here.</TabsContent>
          <TabsContent value="two">Edit the dimensions here.</TabsContent>
          <TabsContent value="three">Edit the constraints here.</TabsContent>
          <TabsContent value="four">Edit the annotations here.</TabsContent>
          <TabsContent value="five">Edit the layers here.</TabsContent>
        </Tabs>

        <Tabs defaultValue="model">
          <TabsList>
            <TabsTrigger value="model">Model</TabsTrigger>
            <TabsTrigger value="paper">Paper</TabsTrigger>
          </TabsList>
          <TabsContent value="model">Model space shows the drawing at 1:1.</TabsContent>
          <TabsContent value="paper">Paper space holds the title block and viewports.</TabsContent>
        </Tabs>

        <Tabs defaultValue="geometry">
          <TabsList>
            <TabsTrigger value="geometry">
              <BoxIcon size={18} />
              Geometry
            </TabsTrigger>
            <TabsTrigger value="constraints">
              <ChevronsLeftRightIcon size={18} />
              Constraints
            </TabsTrigger>
            <TabsTrigger value="selection">
              <SquareDashedMousePointerIcon size={18} />
              Selection
            </TabsTrigger>
            <TabsTrigger value="history">
              <ActivityIcon size={18} />
              History
            </TabsTrigger>
          </TabsList>
          <TabsContent value="geometry">Edit the geometry here.</TabsContent>
          <TabsContent value="constraints">Edit the constraints here.</TabsContent>
          <TabsContent value="selection">Edit the selection here.</TabsContent>
          <TabsContent value="history">Review the edit history here.</TabsContent>
        </Tabs>
      </FigmaGroup>

      <FigmaGroup name="Statistics">
        <Statistics>
          <StatisticsItem label="Status">Modified</StatisticsItem>
          <StatisticsItem label="Units">
            <span className="whitespace-nowrap">Millimeters</span>
          </StatisticsItem>
          <StatisticsItem label="Modified">
            <div className="flex gap-2">
              2m ago
              <Chip variant="secondary">Unsaved</Chip>
            </div>
          </StatisticsItem>
        </Statistics>
      </FigmaGroup>

      <FigmaGroup name="Table" width={1200}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[100px]">Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Layer</TableHead>
              <TableHead>Material</TableHead>
              <TableHead>Sheet</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 5 }, (_, i) => ({
              key: i,
              name: (
                <div className="flex flex-col">
                  <span className="whitespace-nowrap font-normal">Wall-01</span>
                  <span className="text-[var(--slate-11)]">2m ago</span>
                </div>
              ),
              type: (
                <div className="flex flex-col">
                  <code className="font-mono">RECT</code>
                  <span className="text-[var(--slate-11)]">Rectangle</span>
                </div>
              ),
              layer: (
                <div className="flex flex-col">
                  <code className="font-mono">A-WALL</code>
                  <span className="text-[var(--slate-11)]">Walls</span>
                </div>
              ),
              material: (
                <div className="flex flex-col">
                  <code className="font-mono">CONC-30</code>
                  <span className="text-[var(--slate-11)]">Concrete 30 MPa</span>
                </div>
              ),
              sheet: (
                <div className="flex flex-col">
                  <code className="font-mono">SHT-01</code>
                  <span className="text-[var(--slate-11)]">Ground floor</span>
                </div>
              ),
            })).map((e) => (
              <TableRow key={e.key}>
                <TableCell>{e.name}</TableCell>
                <TableCell>{e.type}</TableCell>
                <TableCell>{e.layer}</TableCell>
                <TableCell>{e.material}</TableCell>
                <TableCell>{e.sheet}</TableCell>
                <TableCell className="text-right">
                  <div className="-mr-3">
                    <Button variant="ghost" className="text-primary">
                      Show
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <div className="h-[300px]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[100px]">Part</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Finish</TableHead>
                <TableHead className="text-right">Length</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                { part: 'P-001', qty: '1', finish: 'Anodized', length: '120 mm' },
                { part: 'P-002', qty: '2', finish: 'Powder coat', length: '80 mm' },
                { part: 'P-003', qty: '4', finish: 'Raw', length: '45 mm' },
                { part: 'P-004', qty: '1', finish: 'Anodized', length: '200 mm' },
                { part: 'P-005', qty: '6', finish: 'Powder coat', length: '60 mm' },
                { part: 'P-006', qty: '2', finish: 'Raw', length: '90 mm' },
                { part: 'P-007', qty: '8', finish: 'Anodized', length: '30 mm' },
              ].map((e) => (
                <TableRow key={e.part}>
                  <TableCell className="font-medium">{e.part}</TableCell>
                  <TableCell>{e.qty}</TableCell>
                  <TableCell>{e.finish}</TableCell>
                  <TableCell className="text-right">{e.length}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={3}>Total</TableCell>
                <TableCell className="text-right">24</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[100px]">Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Layer</TableHead>
              <TableHead>Material</TableHead>
              <TableHead>Sheet</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableEmptyState>
            <span>No entities to show.</span>
          </TableEmptyState>
        </Table>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <Checkbox checked="indeterminate" />
              </TableHead>
              <TableHead>Constraint</TableHead>
              <TableHead>Expression</TableHead>
              <TableHead className="text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {[
              { key: 0, name: 'Coincident', expression: 'P1 = P2' },
              { key: 1, name: 'Parallel', expression: 'L1 // L2' },
              { key: 2, name: 'Perpendicular', expression: 'L1 |_ L2' },
              { key: 3, name: 'Horizontal', expression: 'dy = 0' },
              { key: 4, name: 'Equal', expression: 'd1 = d2' },
            ].map((e) => (
              <TableRow key={e.key}>
                <TableCell>
                  <Checkbox checked={e.key < 3} />
                </TableCell>
                <TableCell>{e.name}</TableCell>
                <TableCell>
                  <code className="font-mono">{e.expression}</code>
                </TableCell>
                <TableCell className="text-right">
                  <div className="-mr-3">
                    <Button variant="ghost" className="text-primary">
                      Show
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </FigmaGroup>

      <FigmaGroup name="Jump To" width={800}>
        <JumpTo>
          <JumpToItem selected>Trim</JumpToItem>
          <JumpToItem>Extend</JumpToItem>
          <JumpToItem>Offset</JumpToItem>
          <JumpToItem>Fillet</JumpToItem>
          <JumpToItem>Chamfer</JumpToItem>
          <JumpToItem>Mirror</JumpToItem>
        </JumpTo>
        <JumpToDemo />
      </FigmaGroup>

      <FigmaGroup name="Modal">
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="secondary">Show Create Layer</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Create layer</DialogTitle>
            </DialogHeader>
            <DialogBody>
              <Input label="Name" defaultValue="Layer 01" />
            </DialogBody>
            <DialogFooter>
              <Button variant="secondary">Cancel</Button>
              <Button>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </FigmaGroup>

      <FigmaGroup name="Sheet">
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="secondary">Show layer sheet</Button>
          </SheetTrigger>
          <SheetContent className="min-w-[512px]">
            <SheetHeader className="pt-2">
              <SheetTitle>
                <span className="text-[var(--slate-11)] text-xs font-normal">Showing layer</span>
              </SheetTitle>
              <SheetDescription>
                <code className="font-mono text-base">A-WALL-01</code>
              </SheetDescription>
            </SheetHeader>
            <SheetBody>
              {['Outline', 'Pattern', 'Dimension'].map((method) => (
                <div key={method} className="flex flex-col gap-3 pb-5">
                  <span className="font-sans text-base font-medium">{method}</span>
                </div>
              ))}
            </SheetBody>
            <SheetFooter>
              <SheetClose asChild>
                <Button type="submit">Save changes</Button>
              </SheetClose>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </FigmaGroup>
    </div>
  );
}
