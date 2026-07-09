import { useEffect, useState } from 'react';
import { type Polygon, PolygonComponent, RenderOrderComponent } from '@/lib/geometry';
import { GeometryStore } from '@/lib/geometry/GeometryStore';

export const usePolygons = (geometryStore: GeometryStore) => {
  const [polygons, setPolygons] = useState<Array<Polygon>>([]);
  useEffect(() => {
    const refresh = () => {
      setPolygons(geometryStore.listWithComponents(PolygonComponent, RenderOrderComponent));
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
  return polygons;
};
