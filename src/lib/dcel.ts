// ============================================================
// Doubly-Connected Edge List (DCEL)
// ============================================================
// A planar subdivision data structure used in computational
// geometry. Supports generic position types, a deduplicated
// vertex store, and efficient lookup in both directions:
//   id -> Position
//   Position -> id
//   Position -> outgoing half-edges
// ============================================================

import { Position } from "@/lib/viewport/types";

// --- ID types (branded strings for type safety) ---

export type VertexId = string & { readonly __brand: "VertexId" };
export type HalfEdgeId = string & { readonly __brand: "HalfEdgeId" };
export type FaceId = string & { readonly __brand: "FaceId" };

// --- Core record types ---

// A half-edge points from its origin vertex toward its destination.
// The destination is implicitly the origin of its twin.
type HalfEdge = {
  id: HalfEdgeId;
  // The vertex this half-edge originates from
  originId: VertexId;
  // The opposite-direction half-edge on the same undirected edge
  twinId: HalfEdgeId | null;
  // Next half-edge when traversing this face's boundary CCW
  nextId: HalfEdgeId | null;
  // Previous half-edge in the same face loop
  prevId: HalfEdgeId | null;
  // The face to the left of this half-edge (null = exterior face)
  faceId: FaceId | null;
};

// A face is a bounded or unbounded region, anchored by one of
// its boundary half-edges.
type Face = {
  id: FaceId;
  // An arbitrary half-edge on this face's outer boundary.
  // null is used for the unbounded exterior face.
  outerComponentId: HalfEdgeId | null;
};

// --- ID generation ---

// Simple monotonic counter; no external dependencies needed.
let _nextId = 0;
function makeId<T extends string>(prefix: string): T {
  _nextId += 1;
  return `${prefix}_${_nextId}` as T;
}

// --- Position key ---

// Used as a map key for the reverse-lookup index.
// Assumes exact floating-point equality; callers should snap
// positions to a grid if fuzzy matching is needed.
function positionKey(x: number, y: number): string {
  return `${x},${y}`;
}

// ============================================================
// DCEL class
// ============================================================

export default class DCEL<P extends Position> {
  // Primary vertex store: VertexId -> Position
  private _vertices = new Map<VertexId, P>();

  // Reverse lookup: "x,y" key -> VertexId
  private _positionIndex = new Map<string, VertexId>();

  // How many shapes currently hold a reference to each vertex.
  // When this reaches zero the vertex is culled automatically.
  private _vertexRefCount = new Map<VertexId, number>();

  // Outgoing half-edges per vertex: VertexId -> Set<HalfEdgeId>
  private _outgoing = new Map<VertexId, Set<HalfEdgeId>>();

  // Half-edge store: HalfEdgeId -> HalfEdge
  private _halfEdges = new Map<HalfEdgeId, HalfEdge>();

  // Face store: FaceId -> Face
  private _faces = new Map<FaceId, Face>();

  // ----------------------------------------------------------
  // Vertex operations
  // ----------------------------------------------------------

  /**
   * Add a vertex at the given position. If a vertex already exists at
   * this exact (x, y) coordinate, its existing ID is returned and its
   * reference count is incremented. New vertices start with a ref count of 1.
   *
   * Prefer releaseVertex() over removeVertex() when decrementing ownership,
   * so that shared vertices are only culled once all shapes release them.
   */
  addVertex(position: P): VertexId {
    const key = positionKey(position.x, position.y);
    const existing = this._positionIndex.get(key);

    if (typeof existing !== "undefined") {
      // Vertex is shared -- bump the reference count
      const count = this._vertexRefCount.get(existing) ?? 0;
      this._vertexRefCount.set(existing, count + 1);
      return existing;
    }

    const id = makeId<VertexId>("v");
    this._vertices.set(id, position);
    this._positionIndex.set(key, id);
    this._outgoing.set(id, new Set());
    this._vertexRefCount.set(id, 1);
    return id;
  }

  /**
   * Look up a position by its vertex ID.
   * Returns undefined if no vertex with that ID exists.
   */
  getPosition(id: VertexId): P | undefined {
    return this._vertices.get(id);
  }

  /**
   * Look up a vertex ID by its position.
   * Returns undefined if no vertex exists at that coordinate.
   */
  getVertexId(position: { x: number; y: number }): VertexId | undefined {
    return this._positionIndex.get(positionKey(position.x, position.y));
  }

  /**
   * Returns true if a vertex exists at the given position.
   */
  hasVertex(position: { x: number; y: number }): boolean {
    return this._positionIndex.has(positionKey(position.x, position.y));
  }

  /**
   * Decrement the reference count for a vertex. When the count reaches zero
   * the vertex is automatically culled: it is removed from all internal maps
   * and any outgoing half-edges that still exist are deleted (with their
   * twins' twinId pointer cleared).
   *
   * Prefer this over removeVertex() whenever shapes are releasing ownership,
   * so that vertices shared between shapes survive until the last owner is gone.
   */
  releaseVertex(id: VertexId): void {
    const count = this._vertexRefCount.get(id);

    if (typeof count === "undefined") {
      return;
    }

    if (count > 1) {
      // Other shapes still hold a reference -- just decrement
      this._vertexRefCount.set(id, count - 1);
      return;
    }

    // Reference count hit zero -- cull the vertex entirely.
    // Remove each outgoing half-edge, clearing twin back-references first.
    const outgoing = this._outgoing.get(id);
    if (typeof outgoing !== "undefined") {
      for (const heId of outgoing) {
        const he = this._halfEdges.get(heId);
        if (typeof he !== "undefined" && he.twinId !== null) {
          const twin = this._halfEdges.get(he.twinId);
          if (typeof twin !== "undefined") {
            twin.twinId = null;
          }
        }
        this._halfEdges.delete(heId);
      }
    }

    const position = this._vertices.get(id);
    if (typeof position !== "undefined") {
      this._positionIndex.delete(positionKey(position.x, position.y));
    }

    this._outgoing.delete(id);
    this._vertices.delete(id);
    this._vertexRefCount.delete(id);
  }

  /**
   * Returns the current reference count for a vertex, or 0 if the vertex
   * does not exist. Useful for debugging shared-vertex behaviour.
   */
  getVertexRefCount(id: VertexId): number {
    return this._vertexRefCount.get(id) ?? 0;
  }

  /**
   * Forcibly remove a vertex regardless of its reference count, also removing
   * all of its outgoing half-edges. Bypasses ref counting entirely -- prefer
   * releaseVertex() in almost all cases.
   */
  removeVertex(id: VertexId): void {
    const position = this._vertices.get(id);

    if (typeof position === "undefined") {
      return;
    }

    // Remove all outgoing half-edges from this vertex
    const outgoing = this._outgoing.get(id);
    if (typeof outgoing !== "undefined") {
      for (const heId of outgoing) {
        this._halfEdges.delete(heId);
      }
    }

    this._outgoing.delete(id);
    this._positionIndex.delete(positionKey(position.x, position.y));
    this._vertices.delete(id);
    this._vertexRefCount.delete(id);
  }

  // ----------------------------------------------------------
  // Half-edge operations
  // ----------------------------------------------------------

  /**
   * Add a single directed half-edge from originId toward destinationId.
   * The destination vertex must already exist; this half-edge's twin,
   * next, prev, and face are left null until explicitly linked.
   *
   * Prefer addEdge() to create a full undirected edge with twins in one call.
   */
  addHalfEdge(originId: VertexId, destinationId: VertexId): HalfEdgeId {
    if (!this._vertices.has(originId)) {
      throw new Error(`addHalfEdge: origin vertex "${originId}" does not exist.`);
    }
    if (!this._vertices.has(destinationId)) {
      throw new Error(`addHalfEdge: destination vertex "${destinationId}" does not exist.`);
    }

    const id = makeId<HalfEdgeId>("he");
    const halfEdge: HalfEdge = {
      id,
      originId,
      twinId: null,
      nextId: null,
      prevId: null,
      faceId: null,
    };

    this._halfEdges.set(id, halfEdge);
    // Register as an outgoing edge from the origin vertex
    this._outgoing.get(originId)!.add(id);
    return id;
  }

  /**
   * Add a full undirected edge between two vertices, creating both directed
   * half-edges and linking them as twins. Returns [a->b, b->a].
   */
  addEdge(originId: VertexId, destinationId: VertexId): [HalfEdgeId, HalfEdgeId] {
    const abId = this.addHalfEdge(originId, destinationId);
    const baId = this.addHalfEdge(destinationId, originId);

    // Link the two half-edges as each other's twin
    this._halfEdges.get(abId)!.twinId = baId;
    this._halfEdges.get(baId)!.twinId = abId;

    return [abId, baId];
  }

  /**
   * Retrieve a half-edge by its ID.
   */
  getHalfEdge(id: HalfEdgeId): HalfEdge | undefined {
    return this._halfEdges.get(id);
  }

  /**
   * Link halfEdgeId -> nextId in the face loop, and set the reciprocal
   * prevId on nextId. Both half-edges must already exist.
   */
  linkNext(halfEdgeId: HalfEdgeId, nextId: HalfEdgeId): void {
    const he = this._halfEdges.get(halfEdgeId);
    const next = this._halfEdges.get(nextId);

    if (typeof he === "undefined") {
      throw new Error(`linkNext: half-edge "${halfEdgeId}" does not exist.`);
    }
    if (typeof next === "undefined") {
      throw new Error(`linkNext: next half-edge "${nextId}" does not exist.`);
    }

    he.nextId = nextId;
    next.prevId = halfEdgeId;
  }

  /**
   * Remove a half-edge. Also removes it from the origin vertex's outgoing
   * set, and clears the twin pointer on its former twin (if any).
   */
  removeHalfEdge(id: HalfEdgeId): void {
    const he = this._halfEdges.get(id);

    if (typeof he === "undefined") {
      return;
    }

    // Clear twin's back-reference
    if (he.twinId !== null) {
      const twin = this._halfEdges.get(he.twinId);
      if (typeof twin !== "undefined") {
        twin.twinId = null;
      }
    }

    // Remove from origin's outgoing set
    const outgoing = this._outgoing.get(he.originId);
    if (typeof outgoing !== "undefined") {
      outgoing.delete(id);
    }

    this._halfEdges.delete(id);
  }

  // ----------------------------------------------------------
  // Face operations
  // ----------------------------------------------------------

  /**
   * Add a face record, optionally anchored to one of its boundary
   * half-edges. Returns the new face ID.
   */
  addFace(outerComponentId: HalfEdgeId | null = null): FaceId {
    const id = makeId<FaceId>("f");
    this._faces.set(id, { id, outerComponentId });
    return id;
  }

  /**
   * Retrieve a face by its ID.
   */
  getFace(id: FaceId): Face | undefined {
    return this._faces.get(id);
  }

  /**
   * Assign a face to a half-edge. When walkLoop is true (the default),
   * the assignment propagates to every half-edge in the same face loop.
   */
  assignFace(startId: HalfEdgeId, faceId: FaceId, walkLoop: boolean = true): void {
    if (!walkLoop) {
      const he = this._halfEdges.get(startId);
      if (typeof he !== "undefined") {
        he.faceId = faceId;
      }
      return;
    }

    // Walk the loop and stamp every half-edge with this face ID
    for (const he of this.walkFaceLoop(startId)) {
      he.faceId = faceId;
    }
  }

  /**
   * Remove a face record. Half-edges that referenced this face are
   * NOT updated automatically; call assignFace() to re-assign them first
   * if that matters for your use case.
   */
  removeFace(id: FaceId): void {
    this._faces.delete(id);
  }

  // ----------------------------------------------------------
  // Positional queries
  // ----------------------------------------------------------

  /**
   * Return all outgoing half-edges from the vertex at the given position.
   * Returns an empty array if no vertex exists at that coordinate.
   */
  getOutgoingFromPosition(position: { x: number; y: number }): Array<HalfEdge> {
    const vertexId = this.getVertexId(position);

    if (typeof vertexId === "undefined") {
      return [];
    }

    return this.getOutgoingFromVertexId(vertexId);
  }

  /**
   * Return all outgoing half-edges from the vertex with the given ID.
   * Returns an empty array if the vertex does not exist.
   */
  getOutgoingFromVertexId(vertexId: VertexId): Array<HalfEdge> {
    const edgeIds = this._outgoing.get(vertexId);

    if (typeof edgeIds === "undefined") {
      return [];
    }

    const result: Array<HalfEdge> = [];
    for (const edgeId of edgeIds) {
      const edge = this._halfEdges.get(edgeId);
      if (typeof edge !== "undefined") {
        result.push(edge);
      }
    }
    return result;
  }

  // ----------------------------------------------------------
  // Traversal
  // ----------------------------------------------------------

  /**
   * Walk a face loop starting at the given half-edge, following nextId
   * pointers until the loop closes back to the start. Returns all
   * half-edges in order. Guards against infinite loops on malformed input.
   */
  walkFaceLoop(startId: HalfEdgeId): Array<HalfEdge> {
    const result: Array<HalfEdge> = [];
    const visited: Set<HalfEdgeId> = new Set();
    let currentId: HalfEdgeId | null = startId;

    while (currentId !== null && !visited.has(currentId)) {
      visited.add(currentId);

      const current = this._halfEdges.get(currentId);
      if (typeof current === "undefined") {
        break;
      }

      result.push(current);
      currentId = current.nextId;
    }

    return result;
  }

  /**
   * Walk all face loops in the DCEL and return them as separate arrays.
   * Each loop is a connected face boundary. Half-edges that are not part
   * of any fully-linked loop (nextId = null) are returned as singleton arrays.
   */
  allFaceLoops(): Array<Array<HalfEdge>> {
    const visited: Set<HalfEdgeId> = new Set();
    const loops: Array<Array<HalfEdge>> = [];

    for (const [id] of this._halfEdges) {
      if (visited.has(id)) {
        continue;
      }

      const loop = this.walkFaceLoop(id);
      for (const he of loop) {
        visited.add(he.id);
      }
      loops.push(loop);
    }

    return loops;
  }

  // ----------------------------------------------------------
  // Debug / inspection
  // ----------------------------------------------------------

  /**
   * Returns a plain-object snapshot of the full DCEL for debugging or
   * serialization. Not intended for hot-path use.
   */
  toJSON(): object {
    const vertices: Record<string, P> = {};
    const halfEdges: Record<string, HalfEdge> = {};
    const faces: Record<string, Face> = {};

    for (const [id, pos] of this._vertices) {
      vertices[id] = pos;
    }
    for (const [id, he] of this._halfEdges) {
      halfEdges[id] = he;
    }
    for (const [id, face] of this._faces) {
      faces[id] = face;
    }

    return { vertices, halfEdges, faces };
  }
}
