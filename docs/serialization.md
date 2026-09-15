# Serialization

Cad2d saves and loads drawings as SVG superset files -- valid SVG that can be opened in any SVG viewer, with extra data for full round-trip fidelity.

## File Format

Valid SVG with:

1. Native SVG elements for geometry (visible in any SVG viewer)
2. `data-*` attributes on elements for cad2d-specific data (shape type, render order, etc.)
3. A magic HTML comment at the end with full application state

```
<svg xmlns="..." viewBox="0 0 W H" data-cad2d-version="1">
  <rect data-type="rectangle" x="..." y="..." width="..." height="..." />
  <polygon data-type="polygon" points="..." />
  <g data-type="linear-constraint" data-endpoint-a-type="..." ...>
    <path d="..." />
    <text>5 cms</text>
  </g>
  <!-- cad2d-state:{"version":1, "sheet":{...}, "viewport":{...}, ...} -->
</svg>
```

### Geometry Encoding

| Shape                    | SVG Element | Key Attributes                                       |
| ------------------------ | ----------- | ---------------------------------------------------- |
| Polygon (closed, linear) | `<polygon>` | `points`, `data-type="polygon"`                      |
| Polygon (open or arcs)   | `<path>`    | `d` (M/L/Q/C), `data-type="polygon"`                 |
| Rectangle                | `<rect>`    | `x`, `y`, `width`, `height`, `data-type="rectangle"` |
| Ellipse                  | `<ellipse>` | `cx`, `cy`, `rx`, `ry`, `data-type="ellipse"`        |
| Linear Constraint        | `<g>`       | `data-type="linear-constraint"`, `data-endpoint-*`   |

All coordinates stored in pixels (multiplied by `SHEET_UNITS_TO_PIXELS`), divided back on load. Geometry elements also carry `id`, `data-render-order`, and shape-specific metadata (`data-open-at-index`, deprecated `data-closed`, `data-link-dimensions`, etc.). Datums are serialized as `<g data-type="datum" data-x="..." data-y="...">` elements.

### Filters

Filters (mirror, pattern grid/radial, fillet, chamfer) are serialized as `<g>` elements:

```
<g data-id="ftr_..." data-type="mirror-filter" data-geometry-id="..." data-point-a-x="..." ... ></g>
<g data-id="ftr_..." data-type="fillet-filter" data-geometry-id="..." data-offset-magnitude="..." ...></g>
```

with filter-specific `data-*` attributes (endpoints / point indices / key points, offset magnitude + unit, pattern bounds and repeats, etc.).

When a geometry has filters applied, its native SVG element (the one carrying the geometry metadata) is emitted with `display="none"`, and the computed render shapes are serialized immediately after it as plain `<rect>`/`<ellipse>`/`<path>` elements (no `data-type`). This way external SVG viewers see the visually-correct filtered output instead of the unfiltered metadata shape. On load, these render shapes are discarded (no `data-type`), and the filters are reconstructed from their `<g>` elements and re-attached to the geometry via `data-geometry-id`.

### State Comment

The magic comment stores: sheet dimensions/defaultUnit, viewport pan/zoom, selection IDs, full history stacks (undo/redo + stableIdCounter), and active tool type.

### Not Saved

- Working/transient shapes (discarded on save)
- DCEL state (reconstructed from geometry on load)
- Filter render shapes (recomputed on save from the attached filters)

## Versioning

Current version: `1`. The migration chain in `versions.ts` supports upgrading old files:

1. `extractStateComment()` finds and parses the magic comment
2. `migrateState()` runs through `MIGRATION_LOADERS` in order, each upgrading from version N to N+1
3. If no magic comment exists (plain SVG), a default state is constructed from parsed geometry

To add a new version: bump `CURRENT_VERSION`, add a migration loader for the previous version.

## Parse Warnings

Malformed elements do not abort a load. A `ParseSvgWarningError` is thrown at the parse site for anything that fails to parse (non-numeric coordinates or radii, zero-sized shapes, invalid enum values such as rectangle key points or unit types, missing/invalid required `data-*` attributes, paths with too few commands, unknown constraint/filter/pattern types, etc.). These are caught in `parseSvg` and collected into `ParseResult.warnings` (`Array<ParseSvgWarningError>`), and a load surfaces them via `LoadResult.warnings`. A single failed element is skipped while its siblings continue to be parsed.

## Fallback Parsing

Files without the magic comment are treated as plain SVG. `<rect>`, `<ellipse>`, `<path>`, `<polygon>` elements are parsed as cad2d geometry. Any file that contains at least one `data-type` element is treated as a native cad2d file; in that case plain (non-`data-type`) shapes such as filter render shapes are discarded, and only files with no `data-type` elements have their plain shapes promoted to geometry. Arc paths (Q/C) are preserved as curve polygon segments (`arc-quadratic` / `arc-cubic`). Elements that fail to parse (e.g. paths with only M commands or fewer than two commands) are skipped and reported via `ParseSvgWarningError` entries in `parseResult.warnings`.

## Optional Integration

SerializationManager is set via `setSerializationManager()` on both ActionsManager and ToolManager. If not set, Save/Load actions no-op with a console warning. This allows the system to work fully in test contexts without file I/O.
