import { useEffect, useState } from 'react';
import {
  FillColorComponent,
  LinkDimensionsComponent,
  type Rectangle,
  RectangleComponent,
  RenderOrderComponent,
} from '@/lib/geometry';
import { GeometryStore } from '@/lib/geometry/GeometryStore';

export const useRectangles = (geometryStore: GeometryStore) => {
  const [rectangles, setRectangles] = useState<Array<Rectangle>>([]);
  useEffect(() => {
    const refresh = () => {
      setRectangles(
        geometryStore.listWithComponents(
          RectangleComponent,
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
  return rectangles;
};
