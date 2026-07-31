import { useEffect, useState } from 'react';
import { Entity, GeometryComponent, RenderOrderComponent } from '@/lib/entity';
import { GeometryStore } from '@/lib/entity/GeometryStore';

export const useEntities = <E extends Entity>(geometryStore: GeometryStore, getter: (geometryStore: GeometryStore) => Array<E>): Array<E> => {
  const [entity, setEntities] = useState<Array<E>>([]);
  useEffect(() => {
    const refresh = () => {
      setEntities(getter(geometryStore));
    };
    geometryStore.on('geometryAdded', refresh);
    geometryStore.on('geometryUpdated', refresh);
    geometryStore.on('geometryDeleted', refresh);
    return () => {
      geometryStore.off('geometryAdded', refresh);
      geometryStore.off('geometryUpdated', refresh);
      geometryStore.off('geometryDeleted', refresh);
    };
  }, [geometryStore]);
  return entity;
};

export const useGeometries = (geometryStore: GeometryStore) => {
  return useEntities(geometryStore, (g) => g.listWithComponents(GeometryComponent, RenderOrderComponent));
};

/** Returns a renderable geometry if one exists for the given it.
 * FIXME: this is TEMPORARY, get rid of this when all renderable geometries are unified into a
 * single component like constraints... */
export const useRenderableGeometries = (geometryStore: GeometryStore) => {
  return useEntities(geometryStore, (g) => g.listRenderableGeometries());
};
