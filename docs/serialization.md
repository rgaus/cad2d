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

| Shape | SVG Element | Key Attributes |
|-------|-------------|----------------|
| Polygon (closed, linear) | `<polygon>` | `points`, `data-type="polygon"` |
| Polygon (open or arcs) | `<path>` | `d` (M/L/Q/C), `data-type="polygon"` |
| Rectangle | `<rect>` | `x`, `y`, `width`, `height`, `data-type="rectangle"` |
| Ellipse | `<ellipse>` | `cx`, `cy`, `rx`, `ry`, `data-type="ellipse"` |
| Linear Constraint | `<g>` | `data-type="linear-constraint"`, `data-endpoint-*` |

All coordinates stored in pixels (multiplied by `SHEET_UNITS_TO_PIXELS`), divided back on load.

### State Comment

The magic comment stores: sheet dimensions/defaultUnit, viewport pan/zoom, selection IDs, full history stacks (undo/redo + stableIdCounter), and active tool type.

### Not Saved

- Working/transient shapes (discarded on save)
- DCEL state (reconstructed from geometry on load)

## Versioning

Current version: `1`. The migration chain in `versions.ts` supports upgrading old files:

1. `extractStateComment()` finds and parses the magic comment
2. `migrateState()` runs through `MIGRATION_LOADERS` in order, each upgrading from version N to N+1
3. If no magic comment exists (plain SVG), a default state is constructed from parsed geometry

To add a new version: bump `CURRENT_VERSION`, add a migration loader for the previous version.

## Fallback Parsing

Files without the magic comment are treated as plain SVG. `<rect>`, `<ellipse>`, `<path>`, `<polygon>` elements are parsed as cad2d geometry. Arc paths (Q/C) are linearized with a warning. Paths with only M commands are silently ignored.

## Optional Integration

SerializationManager is set via `setSerializationManager()` on both ActionsManager and ToolManager. If not set, Save/Load actions no-op with a console warning. This allows the system to work fully in test contexts without file I/O.
