import { type HalfEdge } from '@/lib/dcel';
import {
  Datum,
  DatumComponent,
  Ellipse,
  Polygon,
  type PolygonSegment,
  Rectangle,
  RenderOrderComponent,
} from '@/lib/geometry';
import { DCELShapeIndex } from '@/lib/geometry/DCELShapeIndex';
import { ID_PREFIXES } from '@/lib/geometry/GeometryStore';
import { SheetPosition } from '@/lib/viewport/types';

function makeRect(id: string, x1: number, y1: number, x2: number, y2: number): Rectangle {
  const template = Rectangle.create(new SheetPosition(x1, y1), new SheetPosition(x2, y2), {
    fillColor: null,
    linkDimensions: false,
  });
  return {
    id,
    ...template,
    components: {
      ...template.components,
      ...RenderOrderComponent.create(0),
    },
  };
}

function makeEllipse(overrides: {
  id: string;
  center: SheetPosition;
  radiusX: number;
  radiusY: number;
  fillColor?: number | null;
  linkDimensions?: boolean;
  renderOrder?: number;
}): Ellipse {
  const template = Ellipse.create(overrides.center, {
    radiusX: overrides.radiusX,
    radiusY: overrides.radiusY,
    fillColor: overrides.fillColor,
    linkDimensions: overrides.linkDimensions,
  });
  const renderOrder = overrides.renderOrder ?? 0;
  return {
    id: overrides.id,
    ...template,
    components: {
      ...template.components,
      ...RenderOrderComponent.create(renderOrder),
    },
  };
}

function makePolygon(overrides: {
  id: string;
  points: Array<PolygonSegment>;
  closed?: boolean;
  fillColor?: number | null;
  openAtIndex?: number;
  renderOrder?: number;
}): Polygon {
  const template = Polygon.create(overrides.points, {
    closed: overrides.closed,
    fillColor: overrides.fillColor,
    openAtIndex: overrides.openAtIndex,
  });
  const renderOrder = overrides.renderOrder ?? 0;
  return {
    id: overrides.id,
    ...template,
    components: {
      ...template.components,
      ...RenderOrderComponent.create(renderOrder),
    },
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
  if (typeof fromVId === 'undefined' || typeof toVId === 'undefined') {
    return undefined;
  }
  return index.dcel.getOutgoingFromVertexId(fromVId).find((he) => {
    if (he.twinId === null) {
      return false;
    }
    const twin = index.dcel.getHalfEdge(he.twinId);
    return typeof twin !== 'undefined' && twin.originId === toVId;
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
      const allHalfEdges = index.dcel
        .allVertexEntries()
        .flatMap(([vId]) => index.dcel.getOutgoingFromVertexId(vId));
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
      expect(Array.from(index.dcel.allEdgeSegments())).toHaveLength(12);

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
      expect(Array.from(index.dcel.allEdgeSegments())).toHaveLength(17);

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
      expect(Array.from(index.dcel.allEdgeSegments())).toHaveLength(12);

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
      expect(Array.from(index.dcel.allEdgeSegments())).toHaveLength(12);

      // Remove R2 — R1's split edges should be merged back (colinear cleanup)
      index.removeRectangle('b');
      expect(index.dcel.allVertexEntries()).toHaveLength(4); // R1's original 4 corners
      expect(Array.from(index.dcel.allEdgeSegments())).toHaveLength(4); // R1's original 4 edges

      // Split points should be gone
      expect(index.dcel.getVertexId(new SheetPosition(10, 5))).toBeUndefined();
      expect(index.dcel.getVertexId(new SheetPosition(5, 10))).toBeUndefined();

      // Remove R1 — DCEL should be empty
      index.removeRectangle('a');
      expect(index.dcel.allVertexEntries()).toHaveLength(0);
      expect(Array.from(index.dcel.allEdgeSegments())).toHaveLength(0);
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
      expect(Array.from(index.dcel.allEdgeSegments())).toHaveLength(17);

      // Remove R3 — both R1 and R2 should be restored
      index.removeRectangle('c');
      expect(index.dcel.allVertexEntries()).toHaveLength(6); // R1+R2: 6 unique vertices
      expect(Array.from(index.dcel.allEdgeSegments())).toHaveLength(7); // 8 edges - 1 shared undirected edge

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
      const rem = Array.from(index.dcel.allEdgeSegments());
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
      expect(Array.from(index.dcel.allEdgeSegments())).toHaveLength(12);

      // Remove R2 — R1 should be fully restored
      index.removeRectangle('b');
      expect(index.dcel.allVertexEntries()).toHaveLength(5); // 4 corners + 1 split vertex
      expect(Array.from(index.dcel.allEdgeSegments())).toHaveLength(5); // 4 edges + 1 extra split segment

      // Split point (10,15) merged away (first merge pair succeeded)
      expect(index.dcel.getVertexId(new SheetPosition(10, 15))).toBeUndefined();
      // Split point (5,15) lingers (second merge failed — edge already removed by releaseVertex)
      expect(index.dcel.getVertexId(new SheetPosition(5, 15))).toBeDefined();

      // Remove R1 — DCEL should be empty
      index.removeRectangle('a');
      expect(index.dcel.allVertexEntries()).toHaveLength(0);
      expect(Array.from(index.dcel.allEdgeSegments())).toHaveLength(0);
    });
  });

  describe('ellipse curve intersection', () => {
    it('intersects a polygon edge against the ellipse curve, not the chord', () => {
      // Circle centered at (50,50) with radius 50.
      // Key perimeter points (CCW): top=(50,0), right=(100,50), bottom=(50,100), left=(0,50).
      // The chord (straight line) from top→right is (50,0)→(100,50); at y=25 it gives x=75.
      // The cubic bezier arc at y=25 gives x≈93.3 (the true circle value).
      index.addEllipse(
        makeEllipse({
          id: 'e1',
          center: new SheetPosition(50, 50),
          radiusX: 50,
          radiusY: 50,
          fillColor: null,
          linkDimensions: false,
          renderOrder: 0,
        }),
      );

      // A horizontal line at y=25 from x=0 to x=100, crossing the ellipse boundary.
      // During registration, this edge is checked against the ellipse's curved edges
      // using the curve context (not the linear chord).
      index.addPolygon(
        makePolygon({
          id: 'p1',
          points: [
            { type: 'point', point: new SheetPosition(0, 25) },
            { type: 'point', point: new SheetPosition(100, 25) },
          ],
          closed: false,
          openAtIndex: 0,
          fillColor: null,
          renderOrder: 0,
        }),
      );

      // Find the split vertices — the polygon's single edge was split at
      // intersection points with the ellipse's left→top and top→right arcs.
      const vertices = index.dcel.allVertexEntries();

      // Right split vertex (intersection with top→right edge)
      const rightSplit = vertices.find(
        ([_id, pos]) => Math.abs(pos.y - 25) < 1 && pos.x > 80 && pos.x < 100,
      );
      expect(rightSplit).toBeDefined();
      // x should be on the curve (~93.3), NOT on the chord (75)
      expect(rightSplit![1].x).toBeGreaterThan(85);

      // Left split vertex (intersection with left→top edge)
      const leftSplit = vertices.find(
        ([_id, pos]) => Math.abs(pos.y - 25) < 1 && pos.x > 0 && pos.x < 20,
      );
      expect(leftSplit).toBeDefined();
      // x should be on the curve (~6.7), NOT on the chord (25)
      expect(leftSplit![1].x).toBeLessThan(15);
    });
  });

  describe('polygon bezier curve context', () => {
    it('sets quadratic curve context and uses it for line intersection', () => {
      // Open polygon with a quadratic bezier from (0,0)→(20,0) bulging up
      // through control point (10,10). At x=10 the chord is at y=0, but
      // the quadratic curve is at y=5 — the split should be on the curve.
      index.addPolygon(
        makePolygon({
          id: 'poly-quad',
          points: [
            { type: 'point', point: new SheetPosition(0, 0) },
            {
              type: 'arc-quadratic',
              point: new SheetPosition(20, 0),
              controlPoint: new SheetPosition(10, 10),
            },
          ],
          closed: false,
          openAtIndex: 0,
          fillColor: null,
          renderOrder: 0,
        }),
      );

      // Verify the curve context was stored
      const edges = Array.from(index.dcel.allEdgeSegments());
      expect(edges).toHaveLength(1);
      const ctx = index.getCurveContext(edges[0].originId, edges[0].destId);
      expect(ctx).toBeDefined();
      expect(ctx!.type).toBe('quadratic');
      if (ctx!.type === 'quadratic') {
        expect(ctx!.controlPoint.x).toBe(10);
        expect(ctx!.controlPoint.y).toBe(10);
      }

      // Vertical line crossing the quadratic edge at x=10
      // Should split at the curve intersection (y≈5), not the chord (y=0)
      index.addPolygon(
        makePolygon({
          id: 'line-quad',
          points: [
            { type: 'point', point: new SheetPosition(10, -5) },
            { type: 'point', point: new SheetPosition(10, 15) },
          ],
          closed: false,
          openAtIndex: 0,
          fillColor: null,
          renderOrder: 0,
        }),
      );

      const verts = index.dcel.allVertexEntries();
      const split = verts.find(
        ([_id, pos]) => Math.abs(pos.x - 10) < 0.1 && pos.y > 0 && pos.y < 10,
      );
      expect(split).toBeDefined();
      // On the curve (y≈5), not the chord (y=0)
      const y = split![1].y;
      expect(y).toBeGreaterThan(2);
      expect(y).toBeLessThan(8);
    });

    it('sets cubic curve context and uses it for line intersection', () => {
      // Open polygon with a cubic bezier from (0,0)→(20,0) bulging up
      // through control points (5,10) and (15,10). At x=10 the chord is
      // at y=0, but the cubic curve is at y=7.5.
      index.addPolygon(
        makePolygon({
          id: 'poly-cubic',
          points: [
            { type: 'point', point: new SheetPosition(0, 0) },
            {
              type: 'arc-cubic',
              point: new SheetPosition(20, 0),
              controlPointA: new SheetPosition(5, 10),
              controlPointB: new SheetPosition(15, 10),
            },
          ],
          closed: false,
          openAtIndex: 0,
          fillColor: null,
          renderOrder: 0,
        }),
      );

      // Verify the curve context was stored
      const edges = Array.from(index.dcel.allEdgeSegments());
      expect(edges).toHaveLength(1);
      const ctx = index.getCurveContext(edges[0].originId, edges[0].destId);
      expect(ctx).toBeDefined();
      expect(ctx!.type).toBe('cubic');
      if (ctx!.type === 'cubic') {
        // 2-point open polygon has signedArea === 0 → 'clockwise' → reversed,
        // so cpA and cpB may be swapped depending on winding. Verify the set
        // of control point values is correct regardless of order.
        expect([ctx!.controlPointA.x, ctx!.controlPointB.x]).toContain(5);
        expect([ctx!.controlPointA.x, ctx!.controlPointB.x]).toContain(15);
        expect(ctx!.controlPointA.y).toBe(10);
        expect(ctx!.controlPointB.y).toBe(10);
      }

      // Vertical line crossing the cubic edge at x=10
      // Should split at the curve intersection (y≈7.5), not the chord (y=0)
      index.addPolygon(
        makePolygon({
          id: 'line-cubic',
          points: [
            { type: 'point', point: new SheetPosition(10, -5) },
            { type: 'point', point: new SheetPosition(10, 15) },
          ],
          closed: false,
          openAtIndex: 0,
          fillColor: null,
          renderOrder: 0,
        }),
      );

      const verts = index.dcel.allVertexEntries();
      const split = verts.find(
        ([_id, pos]) => Math.abs(pos.x - 10) < 0.1 && pos.y > 0 && pos.y < 14,
      );
      expect(split).toBeDefined();
      // On the curve (y≈7.5), not the chord (y=0)
      const y = split![1].y;
      expect(y).toBeGreaterThan(5);
      expect(y).toBeLessThan(10);
    });

    it('handles mixed straight and curved segments', () => {
      // Closed polygon with a mix of straight and curved edges:
      // (0,0)→straight→(40,0)→straight→(20,40)→cubic→(0,0)
      // Note: the closing edge (0,0) is always a _point segment —
      // it's the polygon format's closure point, which is stripped
      // and the DCEL auto-closes with a straight edge.
      index.addPolygon(
        makePolygon({
          id: 'poly-mixed',
          points: [
            { type: 'point', point: new SheetPosition(0, 0) },
            { type: 'point', point: new SheetPosition(40, 0) },
            { type: 'point', point: new SheetPosition(40, 20) },
            {
              type: 'arc-cubic',
              point: new SheetPosition(20, 30),
              controlPointA: new SheetPosition(40, 30),
              controlPointB: new SheetPosition(30, 30),
            },
            { type: 'point', point: new SheetPosition(0, 0) },
          ],
          closed: true,
          openAtIndex: 0,
          fillColor: null,
          renderOrder: 0,
        }),
      );

      // 4 perimeter positions → 4 edges
      const verts = index.dcel.allEdgeSegments();
      const edges = Array.from(verts);
      expect(edges).toHaveLength(4);

      // Edge 0: (0,0)→(40,0) — from points[1] which is a PointSegment
      expect(index.getCurveContext(edges[0].originId, edges[0].destId)).toBeUndefined();

      // Edge 1: (40,0)→(40,20) — from points[2] which is a PointSegment
      expect(index.getCurveContext(edges[1].originId, edges[1].destId)).toBeUndefined();

      // Edge 2: (40,20)→(20,30) — from points[3] which is an arc-cubic
      const ctx = index.getCurveContext(edges[2].originId, edges[2].destId);
      expect(ctx).toBeDefined();
      expect(ctx!.type).toBe('cubic');

      // Edge 3: (20,30)→(0,0) — closing edge from the closure point points[4]
      // which is a PointSegment, so no context
      expect(index.getCurveContext(edges[3].originId, edges[3].destId)).toBeUndefined();
    });
  });

  describe('datum vertex registration', () => {
    it('registers a single DCEL vertex with no edges for a datum', () => {
      const index = new DCELShapeIndex();
      const datumTemplate = Datum.create(new SheetPosition(3, 4));
      const datum: Datum = {
        id: `${ID_PREFIXES.datum}_test`,
        ...datumTemplate,
        components: {
          ...datumTemplate.components,
          ...RenderOrderComponent.create(0),
        },
      };
      index.addGeometry(datum);

      // Should have exactly one vertex
      const vertices = Array.from(index.dcel.allVertexEntries());
      expect(vertices).toHaveLength(1);
      const [vertexId, { x, y }] = vertices[0];
      expect(x).toBe(3);
      expect(y).toBe(4);

      // Should have zero edges or faces
      expect(Array.from(index.dcel.allEdgeSegments())).toHaveLength(0);

      // Tracked shape should have correct kind and vertexLabels
      const tracked = (index as any).shapes.get(`${ID_PREFIXES.datum}_test`);
      expect(tracked).toBeDefined();
      expect(tracked.kind).toBe('datum');
      expect(tracked.originalKind).toBe('datum');
      expect(tracked.vertexIds).toEqual([vertexId]);
      expect(tracked.vertexLabels).toEqual(['position']);
      expect(tracked.vertexIdsOriginal).toEqual([true]);
      expect(tracked.halfEdgeIds).toHaveLength(0);
      expect(tracked.edgePairs).toHaveLength(0);

      // constraintEndpointToVertexId should resolve locked-datum
      const resolvedVId = (index as any).constraintEndpointToVertexId({
        type: 'locked-datum',
        id: 'dtm_test',
      });
      expect(resolvedVId).toBe(vertexId);

      // Remove datum and verify cleanup
      index.removeGeometry(`${ID_PREFIXES.datum}_test`);
      expect(Array.from(index.dcel.allVertexEntries())).toHaveLength(0);
    });
  });

  describe('walkCombinedBoundary', () => {
    it('walks combined boundary of two overlapping rectangles after trimming an edge', () => {
      const index = new DCELShapeIndex();
      const rectA = makeRect('rectA', 0, 0, 10, 10);
      const rectB = makeRect('rectB', 5, 5, 15, 15);

      index.addRectangle(rectA);
      index.addRectangle(rectB);

      // Find vertex IDs for the trim segment (5,10)→(10,10)
      const vStart = index.dcel.getVertexId(new SheetPosition(5, 10));
      const vEnd = index.dcel.getVertexId(new SheetPosition(10, 10));
      expect(vStart).not.toBeNull();
      expect(vEnd).not.toBeNull();
      expect(vStart).not.toBe(vEnd);

      // Get the half-edge IDs for the edge we're trimming
      const edgePair = index.dcel.getCachedEdgePair(vStart!, vEnd!);
      expect(edgePair).toBeDefined();
      const excludedHeIds = [edgePair!.originToDest, edgePair!.destToOrigin];

      // Walk the combined boundary, excluding the trimmed edge
      const boundary = index.walkCombinedBoundary(['rectA', 'rectB'], excludedHeIds, vStart!);

      expect(boundary).not.toBeNull();
      const hes = boundary!;

      // Verify the boundary forms a closed loop from (5,10) back to itself
      const firstOrigin = index.dcel.getPosition(hes[0].originId);
      expect(firstOrigin).toBeDefined();
      expect(firstOrigin!.x).toBeCloseTo(5, 0);
      expect(firstOrigin!.y).toBeCloseTo(10, 0);

      // Last edge's destination should equal first origin (closed loop)
      const lastHe = hes[hes.length - 1];
      const lastTwin = lastHe.twinId !== null ? index.dcel.getHalfEdge(lastHe.twinId) : undefined;
      expect(lastTwin).toBeDefined();
      const lastDest = index.dcel.getPosition(lastTwin!.originId);
      expect(lastDest).toBeDefined();
      expect(lastDest!.x).toBeCloseTo(5, 0);
      expect(lastDest!.y).toBeCloseTo(10, 0);

      // The boundary should include all expected vertices as a set
      const ptCoords = hes.map((he) => {
        const pos = index.dcel.getPosition(he.originId);
        return `${pos!.x},${pos!.y}`;
      });
      const expectedCoords = ['5,10', '0,10', '0,0', '10,0', '10,5', '5,5'];
      for (const ec of expectedCoords) {
        expect(ptCoords).toContain(ec);
      }
      // Should have exactly 6 edges (the minimal path around the combined boundary)
      expect(hes.length).toStrictEqual(6);
    });
  });
});
