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
  /** Tooltips are ui elements usually bound to the mouse cursor that provide instructions relating
   * to what the user is currently working on. */
  Tooltips = 'Tooltips',
}

export const RENDERER_LAYER_ORDER = [RendererLayers.Solids, RendererLayers.Overlays, RendererLayers.Tooltips];

export type LayerSingleRenderer<ReactNodeLike> = { [key in RendererLayers]?: ReactNodeLike };

/** Renders a given list of entity across multiple layers. Each layer can either render one global
  * entry, OR render an entry per entity. */
export type LayerListRenderer<Item, ReactNodeLike> = {
  [k in RendererLayers]?: ReactNodeLike | ((item: Item) => ReactNodeLike);
};
