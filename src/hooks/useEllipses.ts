import { useEffect, useState } from 'react';
import {
  type Ellipse,
  EllipseComponent,
  FillColorComponent,
  LinkDimensionsComponent,
  RenderOrderComponent,
} from '@/lib/entity';
import { GeometryStore } from '@/lib/entity/GeometryStore';

export const useEllipses = (geometryStore: GeometryStore) => {
  const [ellipses, setEllipses] = useState<Array<Ellipse>>([]);
  useEffect(() => {
    const refresh = () => {
      setEllipses(
        geometryStore.listWithComponents(
          EllipseComponent,
          FillColorComponent,
          LinkDimensionsComponent,
          RenderOrderComponent,
        ),
      );
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
  return ellipses;
};
