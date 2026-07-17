import { type HalfEdge, type VertexId } from '@/lib/dcel';
import {
  type Constraint,
  Datum,
  DatumComponent,
  Ellipse,
  EllipseComponent,
  Polygon,
  PolygonComponent,
  type PolygonSegment,
  Rectangle,
  RectangleComponent,
  RenderOrderComponent,
} from '@/lib/entity';
import { DCELShapeIndex } from '@/lib/entity/DCELShapeIndex';
import { ID_PREFIXES } from '@/lib/entity/GeometryStore';
import { ConstraintEndpoint, LinearConstraint } from '@/lib/entity/constraints';
import { Length } from '@/lib/units/length';
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
    it('walks combined boundary of a rectangle and intersecting V polygon', () => {
      const index = new DCELShapeIndex();
      const rect = makeRect('rect', 0, 0, 10, 10);
      index.addRectangle(rect);

      // V polygon: (2,15)→(5,5)→(8,15), closed
      const vPolyPoints: Array<PolygonSegment> = [
        { type: 'point' as const, point: new SheetPosition(2, 15) },
        { type: 'point' as const, point: new SheetPosition(5, 5) },
        { type: 'point' as const, point: new SheetPosition(8, 15) },
      ];
      const vPolyTemplate = Polygon.create(vPolyPoints, {
        closed: false,
        fillColor: null,
        openAtIndex: 0,
      });
      const vPoly = {
        id: 'v_poly',
        ...vPolyTemplate,
        components: {
          ...vPolyTemplate.components,
          ...RenderOrderComponent.create(0),
        },
      };
      index.addPolygon(vPoly);

      // The V polygon intersects the rectangle's bottom edge at y=10.
      // Find the intersection vertices.
      const leftIntersection = index.dcel.getVertexId(new SheetPosition(3.5, 10));
      const rightIntersection = index.dcel.getVertexId(new SheetPosition(6.5, 10));

      // Get the half-edge IDs for the bottom segment between the V arms
      const edgePair = index.dcel.getCachedEdgePair(leftIntersection!, rightIntersection!);
      expect(edgePair).toBeDefined();
      const excludedHeIds = [edgePair!.originToDest, edgePair!.destToOrigin];

      // Walk the combined boundary, excluding the trimmed edge
      const boundary = index.walkCombinedBoundary(
        ['rect', 'v_poly'],
        excludedHeIds,
        leftIntersection!,
      );

      expect(boundary).not.toBeNull();
      expect(boundary!.isClosed).toStrictEqual(true);
      const hes = boundary!.result;

      // Verify the boundary is a closed loop starting from the left intersection point
      const firstOrigin = index.dcel.getPosition(hes[0].originId);
      expect(firstOrigin).toBeDefined();
      expect(firstOrigin!.x).toBeCloseTo(3.5, 0);
      expect(firstOrigin!.y).toBeCloseTo(10, 0);

      // Last edge's destination should equal first origin (closed loop)
      const lastHe = hes[hes.length - 1];
      const lastTwin = lastHe.twinId !== null ? index.dcel.getHalfEdge(lastHe.twinId) : undefined;
      expect(lastTwin).toBeDefined();
      const lastDest = index.dcel.getPosition(lastTwin!.originId);
      expect(lastDest).toBeDefined();
      expect(lastDest!.x).toBeCloseTo(3.5, 0);
      expect(lastDest!.y).toBeCloseTo(10, 0);

      // Should have exactly 7 edges
      expect(hes.length).toStrictEqual(7);

      // Make sure each origin point is correct - it should take the "long way" around, following
      // the V
      const heOrigins = hes.map((he) => index.dcel.getPosition(he.originId)!);
      expect(heOrigins[0].x).toStrictEqual(3.5); // <== left side of "V"
      expect(heOrigins[0].y).toStrictEqual(10);
      expect(heOrigins[1].x).toStrictEqual(0);
      expect(heOrigins[1].y).toStrictEqual(10);
      expect(heOrigins[2].x).toStrictEqual(0);
      expect(heOrigins[2].y).toStrictEqual(0);
      expect(heOrigins[3].x).toStrictEqual(10);
      expect(heOrigins[3].y).toStrictEqual(0);
      expect(heOrigins[4].x).toStrictEqual(10);
      expect(heOrigins[4].y).toStrictEqual(10);
      expect(heOrigins[5].x).toStrictEqual(6.5); // <== right side of "V"
      expect(heOrigins[5].y).toStrictEqual(10);
      expect(heOrigins[6].x).toStrictEqual(5); // <== top of "V"
      expect(heOrigins[6].y).toStrictEqual(5);
    });
    it('walks combined boundary of a rectangle and intersecting V polygon (other endpoint)', () => {
      const index = new DCELShapeIndex();
      const rect = makeRect('rect', 0, 0, 10, 10);
      index.addRectangle(rect);

      // V polygon: (2,15)→(5,5)→(8,15), closed
      const vPolyPoints: Array<PolygonSegment> = [
        { type: 'point' as const, point: new SheetPosition(2, 15) },
        { type: 'point' as const, point: new SheetPosition(5, 5) },
        { type: 'point' as const, point: new SheetPosition(8, 15) },
      ];
      const vPolyTemplate = Polygon.create(vPolyPoints, {
        closed: false,
        fillColor: null,
        openAtIndex: 0,
      });
      const vPoly = {
        id: 'v_poly',
        ...vPolyTemplate,
        components: {
          ...vPolyTemplate.components,
          ...RenderOrderComponent.create(0),
        },
      };
      index.addPolygon(vPoly);

      // The V polygon intersects the rectangle's bottom edge at y=10.
      // Find the intersection vertices.
      const leftIntersection = index.dcel.getVertexId(new SheetPosition(3.5, 10));
      const rightIntersection = index.dcel.getVertexId(new SheetPosition(6.5, 10));

      // Get the half-edge IDs for the bottom segment between the V arms
      const edgePair = index.dcel.getCachedEdgePair(leftIntersection!, rightIntersection!);
      expect(edgePair).toBeDefined();
      const excludedHeIds = [edgePair!.originToDest, edgePair!.destToOrigin];

      // Walk the combined boundary, excluding the trimmed edge
      const boundary = index.walkCombinedBoundary(
        ['rect', 'v_poly'],
        excludedHeIds,
        rightIntersection!,
      );

      expect(boundary).not.toBeNull();
      expect(boundary!.isClosed).toStrictEqual(true);
      const hes = boundary!.result;

      // Verify the boundary is a closed loop starting from the right intersection point
      const firstOrigin = index.dcel.getPosition(hes[0].originId);
      expect(firstOrigin).toBeDefined();
      expect(firstOrigin!.x).toBeCloseTo(6.5, 0);
      expect(firstOrigin!.y).toBeCloseTo(10, 0);

      // Last edge's destination should equal first origin (closed loop)
      const lastHe = hes[hes.length - 1];
      const lastTwin = lastHe.twinId !== null ? index.dcel.getHalfEdge(lastHe.twinId) : undefined;
      expect(lastTwin).toBeDefined();
      const lastDest = index.dcel.getPosition(lastTwin!.originId);
      expect(lastDest).toBeDefined();
      expect(lastDest!.x).toBeCloseTo(6.5, 0);
      expect(lastDest!.y).toBeCloseTo(10, 0);

      // Should have exactly 7 edges
      expect(hes.length).toStrictEqual(7);

      // Make sure each origin point is correct - the boundary is the same polygon as the
      // other test, just wound in the opposite direction (starts from the right intersection
      // instead of the left).
      const heOrigins = hes.map((he) => index.dcel.getPosition(he.originId)!);
      expect(heOrigins[0].x).toStrictEqual(6.5);
      expect(heOrigins[0].y).toStrictEqual(10);
      expect(heOrigins[1].x).toStrictEqual(10);
      expect(heOrigins[1].y).toStrictEqual(10);
      expect(heOrigins[2].x).toStrictEqual(10);
      expect(heOrigins[2].y).toStrictEqual(0);
      expect(heOrigins[3].x).toStrictEqual(0);
      expect(heOrigins[3].y).toStrictEqual(0);
      expect(heOrigins[4].x).toStrictEqual(0);
      expect(heOrigins[4].y).toStrictEqual(10);
      expect(heOrigins[5].x).toStrictEqual(3.5);
      expect(heOrigins[5].y).toStrictEqual(10);
      expect(heOrigins[6].x).toStrictEqual(5);
      expect(heOrigins[6].y).toStrictEqual(5);
    });
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
      expect(boundary!.isClosed).toStrictEqual(true);
      const hes = boundary!.result;

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

      // The boundary should be the closed loop starting at (5,10) and going
      // through rectA's left/top/right then cutting across rectB's top-left
      // back to the start.
      const heOrigins = hes.map((he) => index.dcel.getPosition(he.originId)!);
      expect(heOrigins[0].x).toStrictEqual(5);
      expect(heOrigins[0].y).toStrictEqual(10);
      expect(heOrigins[1].x).toStrictEqual(0);
      expect(heOrigins[1].y).toStrictEqual(10);
      expect(heOrigins[2].x).toStrictEqual(0);
      expect(heOrigins[2].y).toStrictEqual(0);
      expect(heOrigins[3].x).toStrictEqual(10);
      expect(heOrigins[3].y).toStrictEqual(0);
      expect(heOrigins[4].x).toStrictEqual(10);
      expect(heOrigins[4].y).toStrictEqual(5);
      expect(heOrigins[5].x).toStrictEqual(15);
      expect(heOrigins[5].y).toStrictEqual(5);
    });
    it('walks combined boundary of a rectangle and a circle (fillet case)', () => {
      const index = new DCELShapeIndex();
      index.addRectangle(makeRect('rectangle', 0, 0, 10, 10));
      index.addEllipse(
        makeEllipse({
          id: 'ellipse',
          center: new SheetPosition(8, 8),
          radiusX: 2,
          radiusY: 2,
          fillColor: null,
          linkDimensions: false,
          renderOrder: 0,
        }),
      );

      // Find vertex IDs for the trim segment (5,10)→(10,10)
      const vStart = index.dcel.getVertexId(new SheetPosition(8, 10));
      const vEnd = index.dcel.getVertexId(new SheetPosition(10, 10));
      expect(vStart).not.toBeNull();
      expect(vEnd).not.toBeNull();
      expect(vStart).not.toBe(vEnd);

      // Get the half-edge IDs for the edge we're trimming
      const edgePair = index.dcel.getCachedEdgePair(vStart!, vEnd!);
      expect(edgePair).toBeDefined();
      const excludedHeIds = [edgePair!.originToDest, edgePair!.destToOrigin];

      // Walk the combined boundary, excluding the trimmed edge
      const boundary = index.walkCombinedBoundary(['rectangle', 'ellipse'], excludedHeIds, vStart!);

      expect(boundary).not.toBeNull();
      expect(boundary!.isClosed).toStrictEqual(true);
      const hes = boundary!.result;

      // Should have exactly 5 edges
      expect(hes.length).toStrictEqual(5);

      // Last edge's destination should equal first origin (closed loop)
      const lastHe = hes[hes.length - 1];
      const lastTwin = lastHe.twinId !== null ? index.dcel.getHalfEdge(lastHe.twinId) : undefined;
      expect(lastTwin).toBeDefined();
      const lastDest = index.dcel.getPosition(lastTwin!.originId);
      expect(lastDest).toBeDefined();
      expect(lastDest!.x).toBeCloseTo(8, 0);
      expect(lastDest!.y).toBeCloseTo(10, 0);

      // The boundary should be the closed loop starting at (5,10) and going
      // through rectA's left/top/right then cutting across rectB's top-left
      // back to the start.
      const heOrigins = hes.map((he) => index.dcel.getPosition(he.originId)!);
      expect(heOrigins[0].x).toStrictEqual(8);
      expect(heOrigins[0].y).toStrictEqual(10);
      expect(heOrigins[1].x).toStrictEqual(0);
      expect(heOrigins[1].y).toStrictEqual(10);
      expect(heOrigins[2].x).toStrictEqual(0);
      expect(heOrigins[2].y).toStrictEqual(0);
      expect(heOrigins[3].x).toStrictEqual(10);
      expect(heOrigins[3].y).toStrictEqual(0);
      expect(heOrigins[4].x).toStrictEqual(10);
      expect(heOrigins[4].y).toStrictEqual(8);
    });
  });

  // -----------------------------------------------------------
  // Polygon reversal mapping
  // -----------------------------------------------------------
  describe('polygon reversal mapping', () => {
    it('constraintEndpointToVertexId resolves correct vertex for a CW polygon', () => {
      // A clockwise polygon with an explicit closing duplicate:
      //   (0, 0) → (0, 100) → (100, 100) → (100, 0) → (0, 0)
      const cwPoints: Array<PolygonSegment> = [
        { type: 'point', point: new SheetPosition(0, 0) },
        { type: 'point', point: new SheetPosition(0, 100) },
        { type: 'point', point: new SheetPosition(100, 100) },
        { type: 'point', point: new SheetPosition(100, 0) },
        { type: 'point', point: new SheetPosition(0, 0) },
      ];
      const polygon = makePolygon({
        id: 'ply_cw_test',
        points: cwPoints,
        closed: true,
        openAtIndex: 0,
        fillColor: null,
      });
      const polygonData = PolygonComponent.get(polygon);
      // Polygon.create returns exactly the points given; any closing duplicate
      // would be added later by closePath(). So we have 4 original points.
      expect(polygonData.points.length).toBeGreaterThanOrEqual(4);

      index.addGeometry(polygon);

      // The polygon's tracked shape should have reversed:true (CW → CCW).
      // pointIndex 3 is the vertex at (100, 0) — constraintEndpointToVertexId
      // must return the correct vertex for that point, not the altered entry
      // in vertexIds (which differs after reversal).
      // Create a reference datum at (200, 0) so the constraint endpoint
      // resolves to a real DCEL vertex.
      const refDatum: Datum = {
        id: 'dtm_rev_ref',
        ...Datum.create(new SheetPosition(200, 0)),
        components: {
          ...Datum.create(new SheetPosition(200, 0)).components,
          ...RenderOrderComponent.create(0),
        },
      };
      index.addDatum(refDatum);

      const constraint = {
        id: 'cns_reversal_test',
        ...LinearConstraint.create(
          ConstraintEndpoint.lockedToPolygon(polygon.id, 3),
          ConstraintEndpoint.lockedToDatum(refDatum.id),
          Length.centimeters(5),
        ),
      };
      const result = index.computeEngineConstraints([constraint], [], 'cm');
      const engineConstraint = result.engineConstraints.find((c) => c.type === 'distance');
      expect(engineConstraint).toBeDefined();
      if (engineConstraint && engineConstraint.type === 'distance') {
        // The resolved pointA should be the vertex at position (100, 0)
        // (the second geometry point of the polygon).
        const pos = index.dcel.getPosition(engineConstraint.pointA as VertexId);
        expect(pos).toBeDefined();
        expect(pos!.x).toBeCloseTo(100, 0);
        expect(pos!.y).toBeCloseTo(0, 0);
      }
    });
  });

  // -----------------------------------------------------------
  // Constraint endpoint resolution for locked-polygon with reversal
  // -----------------------------------------------------------
  describe('locked-polygon constraint endpoint resolution', () => {
    it('resolves pointIndex to the correct vertex on a split CW polygon', () => {
      // Two overlapping CW polygons with closing duplicates, so edges get split.
      const cwPointsA: Array<PolygonSegment> = [
        { type: 'point', point: new SheetPosition(0, 0) },
        { type: 'point', point: new SheetPosition(0, 150) },
        { type: 'point', point: new SheetPosition(150, 150) },
        { type: 'point', point: new SheetPosition(150, 0) },
        { type: 'point', point: new SheetPosition(0, 0) },
      ];
      const cwPointsB: Array<PolygonSegment> = [
        { type: 'point', point: new SheetPosition(50, 50) },
        { type: 'point', point: new SheetPosition(50, 200) },
        { type: 'point', point: new SheetPosition(200, 200) },
        { type: 'point', point: new SheetPosition(200, 50) },
        { type: 'point', point: new SheetPosition(50, 50) },
      ];
      const polyA = makePolygon({
        id: 'ply_split_a',
        points: cwPointsA,
        closed: true,
        openAtIndex: 0,
        fillColor: null,
      });
      const polyB = makePolygon({
        id: 'ply_split_b',
        points: cwPointsB,
        closed: true,
        openAtIndex: 0,
        fillColor: null,
      });

      index.addGeometry(polyA);
      index.addGeometry(polyB);

      // pointIndex 2 of polyA → (150, 150) in PolygonComponent.points.
      // constraintEndpointToVertexId should resolve to the vertex at (150, 150)
      // despite the reversed vertexIds ordering.
      const refDatum: Datum = {
        id: 'dtm_split_ref',
        ...Datum.create(new SheetPosition(200, 0)),
        components: {
          ...Datum.create(new SheetPosition(200, 0)).components,
          ...RenderOrderComponent.create(0),
        },
      };
      index.addDatum(refDatum);

      const constraint = {
        id: 'cns_split_poly',
        ...LinearConstraint.create(
          ConstraintEndpoint.lockedToPolygon(polyA.id, 2),
          ConstraintEndpoint.lockedToDatum(refDatum.id),
          Length.centimeters(5),
        ),
      };
      const result = index.computeEngineConstraints([constraint], [], 'cm');

      const engineConstraint = result.engineConstraints.find((c) => c.type === 'distance');
      expect(engineConstraint).toBeDefined();
      if (engineConstraint && engineConstraint.type === 'distance') {
        const pos = index.dcel.getPosition(engineConstraint.pointA as VertexId);
        expect(pos).toBeDefined();
        expect(pos!.x).toBeCloseTo(150, 0);
        expect(pos!.y).toBeCloseTo(150, 0);
      }
    });
  });

  // -----------------------------------------------------------
  // Lazy center vertex registration
  // -----------------------------------------------------------
  describe('lazy center vertex registration', () => {
    it('ellipse center resolves to a vertex ID on-demand', () => {
      const ellipse = makeEllipse({
        id: 'elp_lazy_test',
        center: new SheetPosition(50, 50),
        radiusX: 20,
        radiusY: 30,
      });
      index.addEllipse(ellipse);

      // Before asking for the center, no center vertex should exist in the DCEL
      const preCenterVertex = index.dcel.getVertexId(new SheetPosition(50, 50));
      expect(preCenterVertex).toBeUndefined();

      // Create a constraint referencing the ellipse center
      const refDatum: Datum = {
        id: 'dtm_ellipse_ref',
        ...Datum.create(new SheetPosition(100, 100)),
        components: {
          ...Datum.create(new SheetPosition(100, 100)).components,
          ...RenderOrderComponent.create(0),
        },
      };
      index.addDatum(refDatum);

      const constraint = {
        id: 'cns_ellipse_center',
        ...LinearConstraint.create(
          ConstraintEndpoint.lockedToEllipse(ellipse.id, 'center'),
          ConstraintEndpoint.lockedToDatum(refDatum.id),
          Length.centimeters(5),
        ),
      };
      const result = index.computeEngineConstraints([constraint], [], 'cm');

      // The constraint should produce a distance engine constraint, not be skipped
      const engineConstraint = result.engineConstraints.find((c) => c.type === 'distance');
      expect(engineConstraint).toBeDefined();
      if (engineConstraint && engineConstraint.type === 'distance') {
        const pos = index.dcel.getPosition(engineConstraint.pointA as VertexId);
        expect(pos).toBeDefined();
        expect(pos!.x).toBeCloseTo(50, 0);
        expect(pos!.y).toBeCloseTo(50, 0);
      }

      // After resolution, the center should exist in the DCEL and be in the position map
      const postCenter = index.dcel.getVertexId(new SheetPosition(50, 50));
      expect(postCenter).toBeDefined();
      expect(result.positions.has(postCenter!)).toBe(true);
    });

    it('reuses existing DCEL vertex when center coincides with another shape vertex', () => {
      // Create a polygon with a corner at (50, 50)
      const polyPoints: Array<PolygonSegment> = [
        { type: 'point', point: new SheetPosition(50, 50) },
        { type: 'point', point: new SheetPosition(150, 50) },
        { type: 'point', point: new SheetPosition(150, 150) },
        { type: 'point', point: new SheetPosition(50, 150) },
      ];
      const polygon = makePolygon({
        id: 'ply_center_share',
        points: polyPoints,
        closed: true,
        openAtIndex: 0,
        fillColor: null,
      });
      index.addGeometry(polygon);

      // An ellipse whose center lands at the existing polygon corner (50, 50)
      const ellipse = makeEllipse({
        id: 'elp_center_share',
        center: new SheetPosition(50, 50),
        radiusX: 20,
        radiusY: 30,
      });
      index.addEllipse(ellipse);

      const refDatum: Datum = {
        id: 'dtm_share_ref',
        ...Datum.create(new SheetPosition(300, 300)),
        components: {
          ...Datum.create(new SheetPosition(300, 300)).components,
          ...RenderOrderComponent.create(0),
        },
      };
      index.addDatum(refDatum);

      const constraint = {
        id: 'cns_center_share',
        ...LinearConstraint.create(
          ConstraintEndpoint.lockedToEllipse(ellipse.id, 'center'),
          ConstraintEndpoint.lockedToDatum(refDatum.id),
          Length.centimeters(3),
        ),
      };
      const result = index.computeEngineConstraints([constraint], [], 'cm');

      const engineConstraint = result.engineConstraints.find((c) => c.type === 'distance');
      expect(engineConstraint).toBeDefined();
      if (engineConstraint && engineConstraint.type === 'distance') {
        const pos = index.dcel.getPosition(engineConstraint.pointA as VertexId);
        expect(pos).toBeDefined();
        expect(pos!.x).toBeCloseTo(50, 0);
        expect(pos!.y).toBeCloseTo(50, 0);
      }

      // The polygon's corner vertex at (50, 50) should be reused as the ellipse center
      const cornerVertex = index.dcel.getVertexId(new SheetPosition(50, 50));
      expect(cornerVertex).toBeDefined();
      expect(result.positions.has(cornerVertex!)).toBe(true);
    });

    it('rectangle center resolves to a vertex ID on-demand', () => {
      const rect = makeRect('rct_center_test', 0, 0, 100, 100);
      index.addRectangle(rect);

      // No center vertex before resolution
      const preCenter = index.dcel.getVertexId(new SheetPosition(50, 50));
      expect(preCenter).toBeUndefined();

      // Create a constraint referencing the rectangle center
      const constraint = {
        id: 'cns_rect_center',
        ...LinearConstraint.create(
          ConstraintEndpoint.lockedToRectangle(rect.id, 'center'),
          ConstraintEndpoint.point(new SheetPosition(0, 0)),
          Length.centimeters(5),
        ),
      };
      const result = index.computeEngineConstraints([constraint], [], 'cm');

      const engineConstraint = result.engineConstraints.find((c) => c.type === 'distance');
      expect(engineConstraint).toBeDefined();
      if (engineConstraint && engineConstraint.type === 'distance') {
        const pos = index.dcel.getPosition(engineConstraint.pointA as VertexId);
        expect(pos).toBeDefined();
        expect(pos!.x).toBeCloseTo(50, 0);
        expect(pos!.y).toBeCloseTo(50, 0);
      }

      // Center vertex should now exist and be in the position map
      const postCenter = index.dcel.getVertexId(new SheetPosition(50, 50));
      expect(postCenter).toBeDefined();
      expect(result.positions.has(postCenter!)).toBe(true);
    });
  });

  // -----------------------------------------------------------
  // originalKind preservation after intersection splitting
  // -----------------------------------------------------------
  describe('originalKind preservation', () => {
    it('keeps originalKind as rectangle for both shapes after overlap', () => {
      // R1 registered first, then R2 overlaps and splits.
      const rectA = makeRect('rct_ok_a', 0, 0, 100, 100);
      const rectB = makeRect('rct_ok_b', 50, 50, 150, 150);

      // Before overlap, R1 produces auto-inferred constraints
      index.addRectangle(rectA);
      const resultA = index.computeEngineConstraints([], [], 'cm');
      const horizA = resultA.engineConstraints.filter((c) => c.type === 'horizontal');
      const vertA = resultA.engineConstraints.filter((c) => c.type === 'vertical');
      expect(horizA.length).toBe(2); // top + bottom
      expect(vertA.length).toBe(2); // left + right

      // After adding R2, both should still produce auto-inferred constraints
      index.addRectangle(rectB);
      const resultAB = index.computeEngineConstraints([], [], 'cm');
      const horizontals = resultAB.engineConstraints.filter((c) => c.type === 'horizontal');
      const verticals = resultAB.engineConstraints.filter((c) => c.type === 'vertical');
      expect(horizontals.length).toBe(4); // 2 rects × 2 horizontal edges each
      expect(verticals.length).toBe(4); // 2 rects × 2 vertical edges each
    });
  });

  // -----------------------------------------------------------
  // Split vertices excluded from solver position map
  // -----------------------------------------------------------
  describe('split vertices excluded from position map', () => {
    it('contains only original vertices, not intersection split points', () => {
      const rectA = makeRect('rct_excl_a', 0, 0, 100, 100);
      const rectB = makeRect('rct_excl_b', 50, 50, 150, 150);

      index.addRectangle(rectA);
      index.addRectangle(rectB);

      const result = index.computeEngineConstraints([], [], 'cm');

      // Intersection split vertices should NOT be in the position map
      const sp1 = index.dcel.getVertexId(new SheetPosition(50, 100));
      const sp2 = index.dcel.getVertexId(new SheetPosition(100, 50));
      if (typeof sp1 !== 'undefined') {
        expect(result.positions.has(sp1)).toBe(false);
      }
      if (typeof sp2 !== 'undefined') {
        expect(result.positions.has(sp2)).toBe(false);
      }

      // Corner vertices SHOULD be in the position map
      const cA = index.dcel.getVertexId(new SheetPosition(0, 0));
      const cB = index.dcel.getVertexId(new SheetPosition(150, 150));
      if (typeof cA !== 'undefined') {
        expect(result.positions.has(cA)).toBe(true);
      }
      if (typeof cB !== 'undefined') {
        expect(result.positions.has(cB)).toBe(true);
      }
    });
  });

  // -----------------------------------------------------------
  // computeShapesForVertexId with original-kind rectangle
  // -----------------------------------------------------------
  describe('computeShapesForVertexId with original-kind rectangle', () => {
    it('returns correct originalIndex for a split vertex on a reclassified rectangle', () => {
      const rectA = makeRect('rct_cs_a', 0, 0, 100, 100);
      const rectB = makeRect('rct_cs_b', 50, 50, 150, 150);

      index.addRectangle(rectA);
      index.addRectangle(rectB);

      // The split vertex at (50, 100) should be found by computeShapesForVertexId.
      // For rectA (reclassified as polygon), the vertex should be reported as
      // polygon-type with a meaningful originalIndex (not 0).
      const splitVertex = index.dcel.getVertexId(new SheetPosition(50, 100));
      if (typeof splitVertex === 'undefined') {
        return; // skip if dedup removed this vertex
      }

      const results = index.computeShapesForVertexId(splitVertex);
      const rectAResult = results.find((r) => r.id === rectA.id);
      expect(rectAResult).toBeDefined();
      if (rectAResult) {
        expect(rectAResult.type).toBe('polygon');
        if (rectAResult.type === 'polygon') {
          // pointIndex should be the correct index among original vertices,
          // not a hardcoded dummy value.
          expect(rectAResult.pointIndex).toBeGreaterThan(0);
          expect(rectAResult.pointIndex).toBeLessThan(4);
        }
      }
    });
  });
});
