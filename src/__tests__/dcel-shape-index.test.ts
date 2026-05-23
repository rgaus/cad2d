import { DCELShapeIndex } from '@/lib/geometry/dcel-shape-index';
import { SheetPosition } from '@/lib/viewport/types';
import { type HalfEdge } from '@/lib/dcel';
import { type Rectangle } from '@/lib/geometry/types';

function makeRect(id: string, x1: number, y1: number, x2: number, y2: number): Rectangle {
  return {
    id,
    upperLeft: new SheetPosition(x1, y1),
    lowerRight: new SheetPosition(x2, y2),
    fillColor: null,
    linkDimensions: false,
    renderOrder: 0,
  };
}

/**
 * Find the directed half-edge originating from `from` that goes toward `to`.
 */
function halfEdgeBetween(
  index: DCELShapeIndex,
  from: SheetPosition,
  to: SheetPosition,
): HalfEdge | undefined {
  const fromVId = index.dcel.getVertexId(from);
  const toVId = index.dcel.getVertexId(to);
  if (typeof fromVId === "undefined" || typeof toVId === "undefined") {
    return undefined;
  }
  return index.dcel.getOutgoingFromVertexId(fromVId).find(he => {
    if (he.twinId === null) {
      return false;
    }
    const twin = index.dcel.getHalfEdge(he.twinId);
    return typeof twin !== "undefined" && twin.originId === toVId;
  });
}

describe('DCELShapeIndex', () => {
  let index: DCELShapeIndex;

  beforeEach(() => {
    index = new DCELShapeIndex();
  });

  describe('non-overlapping rectangles', () => {
    it('each half-edge has at most one face, and deletion cleans up fully', () => {
      const rectA = makeRect('a', 0, 0, 10, 10);
      const rectB = makeRect('b', 20, 20, 30, 30);

      index.addRectangle(rectA);
      index.addRectangle(rectB);

      // 8 unique vertices (4 per rect, no sharing)
      expect(index.dcel.allVertexEntries()).toHaveLength(8);

      // Every half-edge should have 0 or 1 faceIds
      const allHalfEdges = index.dcel.allVertexEntries().flatMap(
        ([vId]) => index.dcel.getOutgoingFromVertexId(vId),
      );
      expect(allHalfEdges).toHaveLength(16); // 8 vertices x 2 outgoing each

      let withFace = 0;
      let withoutFace = 0;
      for (const he of allHalfEdges) {
        expect(he.faceIds.length).toBeLessThanOrEqual(1);
        if (he.faceIds.length === 1) {
          withFace += 1;
        } else {
          withoutFace += 1;
        }
      }

      // 8 loop half-edges (4 per rect) have a face, 8 twins have none
      expect(withFace).toBe(8);
      expect(withoutFace).toBe(8);

      // Remove A — B's vertices should remain
      index.removeRectangle('a');
      expect(index.dcel.allVertexEntries()).toHaveLength(4);

      // Remove B — empty
      index.removeRectangle('b');
      expect(index.dcel.allVertexEntries()).toHaveLength(0);
    });
  });

  describe('two rectangles sharing an edge', () => {
    it('shared edge has opposite half-edges with different single faces', () => {
      // A: (0,0)->(10,10), B: (0,10)->(10,20)
      // Shared edge: horizontal at y=10 from x=0 to x=10
      const rectA = makeRect('a', 0, 0, 10, 10);
      const rectB = makeRect('b', 0, 10, 10, 20);

      index.addRectangle(rectA);
      index.addRectangle(rectB);

      // 6 unique vertices (4 per rect minus 2 shared corners)
      expect(index.dcel.allVertexEntries()).toHaveLength(6);

      // Find the shared edge's two directed half-edges
      const sharedLeft = new SheetPosition(0, 10);
      const sharedRight = new SheetPosition(10, 10);

      // he_left_right: originates at (0,10), dest = (10,10) — used by B
      const heLeftRight = halfEdgeBetween(index, sharedLeft, sharedRight);
      // he_right_left: originates at (10,10), dest = (0,10) — used by A
      const heRightLeft = halfEdgeBetween(index, sharedRight, sharedLeft);

      expect(heLeftRight).toBeDefined();
      expect(heRightLeft).toBeDefined();

      // Each has exactly one face — different faces (A's vs B's)
      expect(heLeftRight!.faceIds).toHaveLength(1);
      expect(heRightLeft!.faceIds).toHaveLength(1);
      expect(heLeftRight!.faceIds[0]).not.toBe(heRightLeft!.faceIds[0]);
    });
  });

  describe('three rectangles with a shared directed half-edge', () => {
    it('one half-edge accumulates two faceIds, the twin has one', () => {
      // A: (0,0)->(10,10), B: (0,10)->(10,20), C: (0,10)->(10,15)
      // A's top edge and B/C's bottom edge share vertices (0,10)-(10,10)
      const rectA = makeRect('a', 0, 0, 10, 10);
      const rectB = makeRect('b', 0, 10, 10, 20);
      const rectC = makeRect('c', 0, 10, 10, 15);

      index.addRectangle(rectA);
      index.addRectangle(rectB);
      index.addRectangle(rectC);

      // 8 unique vertices:
      // A: (0,0),(10,0),(10,10),(0,10)
      // B: (0,10),(10,10),(10,20),(0,20)  — shares (0,10),(10,10) with A
      // C: (0,10),(10,10),(10,15),(0,15)  — shares (0,10),(10,10) with A/B,
      //    introduces (10,15),(0,15) as unique
      expect(index.dcel.allVertexEntries()).toHaveLength(8);

      const sharedLeft = new SheetPosition(0, 10);
      const sharedRight = new SheetPosition(10, 10);

      const heLeftRight = halfEdgeBetween(index, sharedLeft, sharedRight);
      const heRightLeft = halfEdgeBetween(index, sharedRight, sharedLeft);

      expect(heLeftRight).toBeDefined();
      expect(heRightLeft).toBeDefined();

      // he_left_right is used by B and C in their CCW loops
      expect(heLeftRight!.faceIds).toHaveLength(2);
      // he_right_left is used only by A
      expect(heRightLeft!.faceIds).toHaveLength(1);

      // All face IDs should be distinct
      const allFaceIds = [...heLeftRight!.faceIds, heRightLeft!.faceIds[0]];
      expect(new Set(allFaceIds).size).toBe(3);
    });
  });
});
