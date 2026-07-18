import { useEffect, useState } from 'react';
import { useViewportContext } from '@/contexts/viewport-context';
import { useWorkingPolygon } from '@/hooks/useWorkingPolygon';
import { KeyCombo } from '@/lib/index-mapper';
import { RendererLayers, SingleLayers } from '@/lib/renderer';
import {
  IntersectionVertexHandleTexture,
  VertexHandleTexture,
} from '@/lib/textures';
import { PreviewSegmentIntersection } from '@/lib/tools/PolygonTool';
import { SheetPosition } from '@/lib/viewport/types';
import { HandleSprites } from './HandleSprites';
import { GeometryShapeRenderer, PolygonDecorationsRenderer } from './GeometryRenderer';

export const WorkingPolygonRenderer: React.FunctionComponent = () => {
  const { viewportScale, activeTool } = useViewportContext();
  const workingPolygon = useWorkingPolygon();

  const [previewSegmentIntersections, setPreviewSegmentIntersections] = useState<
    Array<PreviewSegmentIntersection>
  >([]);
  const [previewSegmentIntersectionsEnabled, setPreviewSegmentIntersectionsEnabled] = useState(
    new Set<KeyCombo>(),
  );
  const [committedIntersectionPoints, setCommittedIntersectionPoints] = useState<
    Array<SheetPosition>
  >([]);
  useEffect(() => {
    if (activeTool.type !== 'polygon') {
      return;
    }

    activeTool.on('previewSegmentIntersections', setPreviewSegmentIntersections);
    activeTool.on('previewSegmentIntersectionsEnabled', setPreviewSegmentIntersectionsEnabled);
    activeTool.on('committedIntersectionsChanged', setCommittedIntersectionPoints);
    return () => {
      activeTool.off('previewSegmentIntersections', setPreviewSegmentIntersections);
      activeTool.off('previewSegmentIntersectionsEnabled', setPreviewSegmentIntersectionsEnabled);
      activeTool.off('committedIntersectionsChanged', setCommittedIntersectionPoints);
    };
  }, [activeTool]);

  if (!workingPolygon || activeTool.type !== 'polygon') {
    return null;
  }

  return (
    <>
      <GeometryShapeRenderer type="polygon" segments={workingPolygon.points} viewportScale={viewportScale} />

      <PolygonDecorationsRenderer
        segments={workingPolygon.points}
        closed={false}
        viewportScale={viewportScale}
        onVertexEnter={(_e, index) => {
          if (
            workingPolygon.source.type === 'existing-polygon' &&
            workingPolygon.source.isStartPoint
          ) {
            if (index === workingPolygon.points.length - 1) {
              activeTool.setHoveringFirstHandle(true);
            }
          } else {
            if (index === 0) {
              activeTool.setHoveringFirstHandle(true);
            }
          }
        }}
        onVertexLeave={(_e, index) => {
          if (
            workingPolygon.source.type === 'existing-polygon' &&
            workingPolygon.source.isStartPoint
          ) {
            if (index === workingPolygon.points.length - 1) {
              activeTool.setHoveringFirstHandle(false);
            }
          } else {
            if (index === 0) {
              activeTool.setHoveringFirstHandle(false);
            }
          }
        }}
        // IMPORTANT: Make sure this is set so that clicks don't get "trapped" by the final
        // handle since it is always under the cursor.
        firstHandleEventMode={
          workingPolygon.source.type === 'existing-polygon' && workingPolygon.source.isStartPoint
            ? 'none'
            : undefined
        }
        lastHandleEventMode={
          workingPolygon.source.type === 'existing-polygon' && workingPolygon.source.isStartPoint
            ? undefined
            : 'none'
        }
      />

      {/* Render any intersection points. */}
      <HandleSprites
        points={[
          ...previewSegmentIntersections
            .filter((inters) => previewSegmentIntersectionsEnabled.has(inters.keyCombo))
            .map((inters) => inters.point),
          ...committedIntersectionPoints,
        ]}
        handleTexture={VertexHandleTexture.get()}
        viewportScale={viewportScale}
      />
      <HandleSprites
        points={previewSegmentIntersections
          .filter((inters) => !previewSegmentIntersectionsEnabled.has(inters.keyCombo))
          .map((inters) => inters.point)}
        handleTexture={IntersectionVertexHandleTexture.get()}
        viewportScale={viewportScale}
      />
    </>
  );
};

/** Renders the "working polygon" - the polygon currently being created by the user when using the
 * polygon tool. */
export const WorkingPolygonLayers: SingleLayers<React.ReactNode> = {
  [RendererLayers.Overlays]: <WorkingPolygonRenderer />,
};
