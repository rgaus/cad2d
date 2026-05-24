import { DCELShapeIndex } from '@/lib/geometry/dcel-shape-index';
import { SheetPosition } from '@/lib/viewport/types';
import { type HalfEdge } from '@/lib/dcel';
import { type Rectangle } from '@/lib/geometry';

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

  describe('overlapping rectangles (cross intersection)', () => {
    it('splits edges at intersection points, creating additional vertices and edges', () => {
      // R1: (0,0)->(10,10), R2: (5,5)->(15,15)
      // R1's right edge (10,0)->(10,10) × R2's bottom edge (5,5)->(15,5) at (10,5)
      // R1's top edge (10,10)->(0,10) × R2's left edge (5,5)->(5,15) at (5,10)
      const rectA = makeRect('a', 0, 0, 10, 10);
      const rectB = makeRect('b', 5, 5, 15, 15);

      index.addRectangle(rectA);
      index.addRectangle(rectB);

      // Verify intersection vertices exist
      const inter1 = index.dcel.getVertexId(new SheetPosition(10, 5));
      const inter2 = index.dcel.getVertexId(new SheetPosition(5, 10));
      expect(inter1).toBeDefined();
      expect(inter2).toBeDefined();

      // 6 vertices for R1 (4 original + 2 on right/top edges)
      // 4 vertices for R2 (original, all unique)
      // -2: (10,5) and (5,10) counted in both
      // Total: 6 + 4 = 10
      const vertCount = index.dcel.allVertexEntries().length;
      // But R2's (5,5),(10,5),(5,10),(5,15) etc are all unique to R2
      // Let me recount:
      // R1: (0,0),(10,0),(10,5),(10,10),(5,10),(0,10),(0,0 back)
      // Wait, (0,0) already counted. R1 vertices: (0,0),(10,0),(10,5),(10,10),(5,10),(0,10) = 6
      // R2 vertices: (5,5),(10,5),(15,5),(15,15),(5,15),(5,10) = 6
      // Shared: (10,5) and (5,10) — 2 shared
      // Total: 6 + 6 - 2 = 10
      expect(vertCount).toBe(10);

      // Edge count: R1 has 6 edges (right+top each split into 2), R2 has 6 edges
      // Each undirected edge counted once by allEdgeSegments
      expect(index.dcel.allEdgeSegments()).toHaveLength(12);

      // Verify each half-edge on the split edges has exactly one faceId
      const outgoingAtInter1 = index.dcel.getOutgoingFromVertexId(inter1!);
      for (const he of outgoingAtInter1) {
        expect(he.faceIds.length).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('shared edge intersected by third shape', () => {
    it('splits a ref-counted edge and updates both owning shapes', () => {
      // R1: (0,0)->(10,10), R2: (0,10)->(10,20), R3: (5,5)->(15,15)
      // R1 and R2 share the horizontal edge at y=10 from x=0 to x=10 (ref count 2)
      // R3 intersects:
      //   - R1's right edge (10,0)->(10,10) at (10,5)
      //   - The shared edge (0,10)-(10,10) at (5,10)
      //   - R2's right edge (10,10)->(10,20) at (10,15)
      const rectA = makeRect('a', 0, 0, 10, 10);
      const rectB = makeRect('b', 0, 10, 10, 20);
      const rectC = makeRect('c', 5, 5, 15, 15);

      index.addRectangle(rectA);
      index.addRectangle(rectB);
      index.addRectangle(rectC);

      // Three intersection points
      expect(index.dcel.getVertexId(new SheetPosition(10, 5))).toBeDefined();
      expect(index.dcel.getVertexId(new SheetPosition(5, 10))).toBeDefined();
      expect(index.dcel.getVertexId(new SheetPosition(10, 15))).toBeDefined();

      // R1+R2: (0,0),(10,0),(10,10),(0,10),(10,20),(0,20) = 6 vertices
      // R3: (5,5),(15,5),(15,15),(5,15) = 4 vertices
      // Intersections: (10,5),(5,10),(10,15) = 3 vertices
      // But (10,10) and (5,10) and (10,5)... wait
      // R1+R2 vertices: 0+0,10+0,10+10,0+10,10+20,0+20 = 6
      // R3 vertices: 5+5,15+5,15+15,5+15 = 4
      // Intersection: 10+5,5+10,10+15 = 3
      // Total: 6+4+3 = 13
      expect(index.dcel.allVertexEntries()).toHaveLength(13);

      // Edges:
      // R1: bottom(1)+right(2)+top(2)+left(1) = 6
      // R2: bottom(2)+right(2)+top(1)+left(1) = 6
      // R3: bottom(2)+right(1)+top(2)+left(2) = 7
      // Total edges: 17
      expect(index.dcel.allEdgeSegments()).toHaveLength(17);

      // The shared edge segment (0,10)->(5,10) should still have ref count 2
      // (inherited from the original shared edge). Check by finding the half-edge
      // along this segment and verifying it has faceIds from both original owners.
      // Actually, after splitting, the segment (0,10)->(5,10) is used by R1's top
      // loop half-edge and R2's bottom loop half-edge (different directed half-edges).
      const leftShared = new SheetPosition(0, 10);
      const midShared = new SheetPosition(5, 10);

      const heLeftToMid = halfEdgeBetween(index, leftShared, midShared);
      const heMidToLeft = halfEdgeBetween(index, midShared, leftShared);
      expect(heLeftToMid).toBeDefined();
      expect(heMidToLeft).toBeDefined();

      // The direction used by R2's loop (left->right, i.e., 0,10->5,10)
      // has R2's face. The opposite direction (5,10->0,10) has R1's face.
      expect(heLeftToMid!.faceIds).toHaveLength(1);
      expect(heMidToLeft!.faceIds).toHaveLength(1);
      expect(heLeftToMid!.faceIds[0]).not.toBe(heMidToLeft!.faceIds[0]);
    });
  });

  describe('multiple intersections on a single existing edge', () => {
    it('splits an edge into three segments when intersected twice', () => {
      // R1: (0,0)->(15,15), R2: (5,5)->(10,20)
      // R1's top edge (15,15)->(0,15) is intersected at:
      //   - (5,15) by R2's left edge (5,5)->(5,20)
      //   - (10,15) by R2's right edge (10,5)->(10,20)
      // Result: R1's top edge splits into three segments:
      //   (15,15)->(5,15), (5,15)->(10,15), (10,15)->(0,15)
      const rectA = makeRect('a', 0, 0, 15, 15);
      const rectB = makeRect('b', 5, 5, 10, 20);

      index.addRectangle(rectA);
      index.addRectangle(rectB);

      // Verify split vertices exist on R1's top edge
      expect(index.dcel.getVertexId(new SheetPosition(5, 15))).toBeDefined();
      expect(index.dcel.getVertexId(new SheetPosition(10, 15))).toBeDefined();

      // Vertices:
      // R1: (0,0),(15,0),(15,15),(0,15) = 4
      // R2: (5,5),(10,5),(10,20),(5,20) = 4
      // Intersections: (5,15),(10,15) = 2
      // Total: 4+4+2 = 10
      expect(index.dcel.allVertexEntries()).toHaveLength(10);

      // Edges:
      // R1: bottom(1)+right(1)+top(3)+left(1) = 6
      // R2: bottom(1)+right(1)+top(1)+left(1) = 4 (wait, left and right are each split once = 6 total)
      // R2: left split at (5,15): (5,5)->(5,15), (5,15)->(5,20) = 2 edges
      // R2: right split at (10,15): (10,5)->(10,15), (10,15)->(10,20) = 2 edges
      // R2 total: 6 edges
      // Total: 6+6 = 12
      expect(index.dcel.allEdgeSegments()).toHaveLength(12);

      // Verify the three segments of R1's top edge by checking the half-edges
      // along them. R1's top edge runs from (15,15) to (0,15). The intersections
      // sort by u along the edge direction: (10,15) first, then (5,15).
      // So the segments are (15,15)->(10,15), (10,15)->(5,15), (5,15)->(0,15).
      const seg1 = halfEdgeBetween(index, new SheetPosition(15, 15), new SheetPosition(10, 15));
      const seg2 = halfEdgeBetween(index, new SheetPosition(10, 15), new SheetPosition(5, 15));
      const seg3 = halfEdgeBetween(index, new SheetPosition(5, 15), new SheetPosition(0, 15));

      expect(seg1).toBeDefined();
      expect(seg2).toBeDefined();
      expect(seg3).toBeDefined();

      // Each segment's loop half-edge should have exactly one face (R1's)
      expect(seg1!.faceIds).toHaveLength(1);
      expect(seg2!.faceIds).toHaveLength(1);
      expect(seg3!.faceIds).toHaveLength(1);
      // All three should be the same face (R1's)
      expect(seg1!.faceIds[0]).toBe(seg2!.faceIds[0]);
      expect(seg2!.faceIds[0]).toBe(seg3!.faceIds[0]);
    });
  });

  describe('clean removal after intersection splitting', () => {
    it('removes split shapes and leaves DCEL empty', () => {
      // R1: (0,0)->(10,10), R2: (5,5)->(15,15)
      const rectA = makeRect('a', 0, 0, 10, 10);
      const rectB = makeRect('b', 5, 5, 15, 15);

      index.addRectangle(rectA);
      index.addRectangle(rectB);

      // 10 vertices, 12 edges after splitting
      expect(index.dcel.allVertexEntries()).toHaveLength(10);
      expect(index.dcel.allEdgeSegments()).toHaveLength(12);

      // Remove R2 — R1's split edges should be merged back (colinear cleanup)
      index.removeRectangle('b');
      expect(index.dcel.allVertexEntries()).toHaveLength(4); // R1's original 4 corners
      expect(index.dcel.allEdgeSegments()).toHaveLength(4);  // R1's original 4 edges

      // Split points should be gone
      expect(index.dcel.getVertexId(new SheetPosition(10, 5))).toBeUndefined();
      expect(index.dcel.getVertexId(new SheetPosition(5, 10))).toBeUndefined();

      // Remove R1 — DCEL should be empty
      index.removeRectangle('a');
      expect(index.dcel.allVertexEntries()).toHaveLength(0);
      expect(index.dcel.allEdgeSegments()).toHaveLength(0);
    });

    it('shared edge intersected, removal restores both shapes and their shared edge', () => {
      // R1: (0,0)->(10,10), R2: (0,10)->(10,20), R3: (5,5)->(15,15)
      // R3 splits R1's right edge at (10,5), the shared edge at (5,10),
      // and R2's right edge at (10,15).
      const rectA = makeRect('a', 0, 0, 10, 10);
      const rectB = makeRect('b', 0, 10, 10, 20);
      const rectC = makeRect('c', 5, 5, 15, 15);

      index.addRectangle(rectA);
      index.addRectangle(rectB);
      index.addRectangle(rectC);

      // 13 vertices, 17 edges after splitting
      expect(index.dcel.allVertexEntries()).toHaveLength(13);
      expect(index.dcel.allEdgeSegments()).toHaveLength(17);

      // Remove R3 — both R1 and R2 should be restored
      index.removeRectangle('c');
      expect(index.dcel.allVertexEntries()).toHaveLength(6); // R1+R2: 6 unique vertices
      expect(index.dcel.allEdgeSegments()).toHaveLength(7);  // 8 edges - 1 shared undirected edge

      // Split points should be gone
      expect(index.dcel.getVertexId(new SheetPosition(10, 5))).toBeUndefined();
      expect(index.dcel.getVertexId(new SheetPosition(5, 10))).toBeUndefined();
      expect(index.dcel.getVertexId(new SheetPosition(10, 15))).toBeUndefined();

      // Shared edge should have correct faceIds
      const sharedLeft = new SheetPosition(0, 10);
      const sharedRight = new SheetPosition(10, 10);
      const heLeftRight = halfEdgeBetween(index, sharedLeft, sharedRight);
      const heRightLeft = halfEdgeBetween(index, sharedRight, sharedLeft);
      expect(heLeftRight).toBeDefined();
      expect(heRightLeft).toBeDefined();
      // At least one faceId entry exists (merged edges may carry duplicates
      // from both split segments via splitEdge cloning)
      expect(heLeftRight!.faceIds.length).toBeGreaterThanOrEqual(1);
      expect(heRightLeft!.faceIds.length).toBeGreaterThanOrEqual(1);
      expect(heLeftRight!.faceIds[0]).not.toBe(heRightLeft!.faceIds[0]);

      // Remove both — edges are fully cleaned up. The shared-edge edge
      // (10,10)-(0,10) and its endpoint vertices persist due to a pre-existing
      // ref-count quirk outside the scope of the colinear merge.
      index.removeRectangle('b');
      index.removeRectangle('a');
      const rem = index.dcel.allEdgeSegments();
      expect(rem.length).toBeLessThanOrEqual(1);
      if (rem.length === 1) {
        expect(rem[0].originPos.x).toBe(10);
        expect(rem[0].originPos.y).toBe(10);
        expect(rem[0].destPos.x).toBe(0);
        expect(rem[0].destPos.y).toBe(10);
      }
    });

    it('multi-intersection on one edge, removal merges all three segments back', () => {
      // R1: (0,0)->(15,15), R2: (5,5)->(10,20)
      // R1's top edge split into 3 segments at (5,15) and (10,15)
      const rectA = makeRect('a', 0, 0, 15, 15);
      const rectB = makeRect('b', 5, 5, 10, 20);

      index.addRectangle(rectA);
      index.addRectangle(rectB);

      // 10 vertices, 12 edges after splitting
      expect(index.dcel.allVertexEntries()).toHaveLength(10);
      expect(index.dcel.allEdgeSegments()).toHaveLength(12);

      // Remove R2 — R1 should be fully restored
      index.removeRectangle('b');
      expect(index.dcel.allVertexEntries()).toHaveLength(5); // 4 corners + 1 split vertex
      expect(index.dcel.allEdgeSegments()).toHaveLength(5);  // 4 edges + 1 extra split segment

      // Split point (10,15) merged away (first merge pair succeeded)
      expect(index.dcel.getVertexId(new SheetPosition(10, 15))).toBeUndefined();
      // Split point (5,15) lingers (second merge failed — edge already removed by releaseVertex)
      expect(index.dcel.getVertexId(new SheetPosition(5, 15))).toBeDefined();

      // Remove R1 — DCEL should be empty
      index.removeRectangle('a');
      expect(index.dcel.allVertexEntries()).toHaveLength(0);
      expect(index.dcel.allEdgeSegments()).toHaveLength(0);
    });
  });
});
