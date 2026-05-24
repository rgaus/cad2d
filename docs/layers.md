# Layers / Render Order

Cad2d does NOT have traditional CAD layers (named groups with visibility toggles, locking, color overrides). Instead, it uses a simple compositing layer system for rendering plus per-shape z-ordering.

## Compositing Layers

The `RendererLayers` enum defines three rendering passes:

```
Solids (back)     -- Pixi canvas: fills and strokes of all geometries
Overlays (middle) -- Pixi canvas: selection handles, constraint lines, DCEL debug view
Tooltips (front)  -- React DOM overlay: inline editors, hover tooltips
```

Pixi layers (`Solids`, `Overlays`) render inside the viewport-transformable Pixi container. `Tooltips` render outside the Pixi canvas as a DOM overlay positioned via `requestAnimationFrame`.

## Per-Shape Z-Ordering

Within each layer, shapes are sorted ascending by `renderOrder: number`. New shapes default to `maxRenderOrder + 1`.

**Render order actions** (in Actions):
| Action | Effect |
|--------|--------|
| Raise | `renderOrder += 1` |
| Lower | `renderOrder -= 1` |
| Raise to Top | `renderOrder = 0` |
| Lower to Bottom | `renderOrder = getMaxRenderOrder()` |

## Per-Shape-Type Rendering

Each renderer file exports `ListLayers` or `SingleLayers` maps from `RendererLayers` to rendering components. For example, `PolygonLayers[Solids]` renders `<PolygonSolid>`, `PolygonLayers[Overlays]` renders `<PolygonOverlay>`.

The `ViewportRenderer2D` composes all layers by iterating the layer order and for each layer, rendering:
1. `ListLayersRenderer` -- iterates completed shapes (polygons, rectangles, ellipses) sorted by renderOrder
2. `SingleLayerRenderer`s -- global overlays (constraints, working shapes, DCEL debug)

## State Not Serialized

There is no traditional layer state to serialize. Only `renderOrder` is saved per shape as a `data-render-order` attribute.
