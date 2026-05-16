/**
 * The layers which all rendering should break down into.
 *
 * Breaking rendering down into layers ensures that elements are ordered properly when drawn. For
 * example - overlays like vertex handles should always render above all polygons, etc.
 */
export enum RendererLayers {
  /** Solids are the main fill and stroke of geometries. */
  Solids = 'Solids',
  /** Overlays are decorations on top of solids, like handles, the offset border around selections, etc*/
  Overlays = 'Overlays',
  /** Tooltips are REACT DOM rendered ui elements usually bound to the mouse cursor that provide
   * instructions relating to what the user is currently working on. */
  Tooltips = 'Tooltips',
}

/** Layers that pixi will render, in order from furthest back to forthest forward. */
export const RENDERER_PIXI_LAYER_ORDER = [
  RendererLayers.Solids,
  RendererLayers.Overlays,
];

/** Layers that react dom will render, in order from furthest back to forthest forward. */
export const RENDERER_DOM_LAYER_ORDER = [
  RendererLayers.Tooltips,
];

export type SingleLayers<ReactNodeLike> = { [key in RendererLayers]?: ReactNodeLike };

/** Renders a given list of entity across multiple layers. Each layer can either render one global
  * entry, OR render an entry per entity. */
export type ListLayers<Item, ReactNodeLike> = {
  [k in RendererLayers]?: ReactNodeLike | ((item: Item) => ReactNodeLike);
};
