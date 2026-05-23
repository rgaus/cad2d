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

import EventEmitter from "eventemitter3";
import { Position } from "@/lib/viewport/types";

// --- ID types (branded strings for type safety) ---

export type VertexId = string & { readonly __brand: "VertexId" };
export type HalfEdgeId = string & { readonly __brand: "HalfEdgeId" };
export type FaceId = string & { readonly __brand: "FaceId" };

// --- Core record types ---

// A half-edge points from its origin vertex toward its destination.
// The destination is implicitly the origin of its twin.
export type HalfEdge = {
  id: HalfEdgeId;
  // The vertex this half-edge originates from
  originId: VertexId;
  // The opposite-direction half-edge on the same undirected edge
  twinId: HalfEdgeId | null;
  // Next half-edge when traversing this face's boundary CCW
  nextId: HalfEdgeId | null;
  // Previous half-edge in the same face loop
  prevId: HalfEdgeId | null;
  // The faces to the left of this half-edge, ordered by registration.
  // When multiple shapes share the same directed half-edge, each adds its
  // face ID to this array. Readers should treat faceIds[0] as the active
  // face (the first to register on this half-edge).
  faceIds: Array<FaceId>;
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

type DCELEvents = {
  handleHalfEdgesChange: (data: Array<HalfEdge>) => void;
};

export default class DCEL<P extends Position> extends EventEmitter<DCELEvents> {
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

  // How many shapes currently hold a reference to each undirected edge.
  // Key is the canonical edge key: sorted(originId, destId).join('|').
  private _edgeRefCount = new Map<string, number>();

  // Cache of half-edge pair IDs for each undirected edge key.
  // Allows returning the same half-edge pair when the same geometric
  // edge is added by a different shape (possibly in reversed direction).
  private _edgeCache = new Map<string, { originToDest: HalfEdgeId; destToOrigin: HalfEdgeId }>();

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
    // Release any remaining outgoing edges first so the edge cache
    // stays consistent.  Iterate a snapshot of the outgoing set since
    // releaseEdge() will mutate it when the edge ref count also hits zero.
    const outgoing = this._outgoing.get(id);
    if (typeof outgoing !== "undefined" && outgoing.size > 0) {
      for (const heId of [...outgoing]) {
        const he = this._halfEdges.get(heId);
        if (typeof he !== "undefined" && he.twinId !== null) {
          const twin = this._halfEdges.get(he.twinId);
          if (typeof twin !== "undefined") {
            this.releaseEdge(he.originId, twin.originId);
          }
        }
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
  private removeVertex(id: VertexId): void {
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
      this.emit('handleHalfEdgesChange', Array.from(this._halfEdges.values()));
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
   * Canonical key for an undirected edge between two vertices.
   * The key is symmetric: _edgeKey(a, b) === _edgeKey(b, a).
   */
  private _edgeKey(a: VertexId, b: VertexId): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  /**
   * Public accessor for _edgeKey — useful for callers that need to
   * identify or group edges by their canonical key from outside the DCEL.
   */
  getEdgeKey(a: VertexId, b: VertexId): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

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
      faceIds: [],
    };

    this._halfEdges.set(id, halfEdge);
    this.emit('handleHalfEdgesChange', Array.from(this._halfEdges.values()));
    // Register as an outgoing edge from the origin vertex
    this._outgoing.get(originId)!.add(id);
    return id;
  }

  /**
   * Add a full undirected edge between two vertices, creating both directed
   * half-edges and linking them as twins.
   *
   * When a coincident edge already exists (same two vertices in any direction),
   * the existing half-edge pair is returned and the internal reference count
   * is incremented. This mirrors how addVertex() handles shared vertices.
   *
   * Returns [a->b, b->a] in the caller's direction order.
   */
  addEdge(originId: VertexId, destinationId: VertexId): [HalfEdgeId, HalfEdgeId] {
    const key = this._edgeKey(originId, destinationId);
    const cached = this._edgeCache.get(key);

    if (typeof cached !== "undefined") {
      // Edge already exists -- bump reference count
      const count = this._edgeRefCount.get(key) ?? 0;
      this._edgeRefCount.set(key, count + 1);

      // Return in caller's direction order
      const heAb = this._halfEdges.get(cached.originToDest)!;
      if (heAb.originId === originId) {
        return [cached.originToDest, cached.destToOrigin];
      } else {
        return [cached.destToOrigin, cached.originToDest];
      }
    }

    // New edge -- create half-edge pair
    const abId = this.addHalfEdge(originId, destinationId);
    const baId = this.addHalfEdge(destinationId, originId);

    this._halfEdges.get(abId)!.twinId = baId;
    this._halfEdges.get(baId)!.twinId = abId;
    this.emit('handleHalfEdgesChange', Array.from(this._halfEdges.values()));

    this._edgeCache.set(key, { originToDest: abId, destToOrigin: baId });
    this._edgeRefCount.set(key, 1);

    return [abId, baId];
  }

  /**
   * Decrement the reference count for an undirected edge. When the count
   * reaches zero the half-edge pair is removed from the DCEL.
   *
   * This is the ref-counted counterpart of addEdge() and the preferred
   * way to remove an edge. Shapes that own a shared edge should each call
   * releaseEdge() once; the edge is only culled after the last release.
   *
   * @param faceId - When provided and the edge stays alive, this specific
   *   face ID is removed from the releasing shape's directed half-edge's
   *   faceIds array. When omitted, the entire array is cleared.
   */
  releaseEdge(originId: VertexId, destinationId: VertexId, faceId?: FaceId): void {
    const key = this._edgeKey(originId, destinationId);
    const count = this._edgeRefCount.get(key);

    if (typeof count === "undefined") {
      return;
    }

    if (count > 1) {
      // Edge stays alive (another shape still references it).
      // Remove the releasing shape's faceId from its directed half-edge
      // so a stale face reference does not linger. If no faceId is given,
      // clear the entire array.
      const cached = this._edgeCache.get(key);
      if (typeof cached !== "undefined") {
        const heAb = this._halfEdges.get(cached.originToDest);
        if (typeof heAb !== "undefined") {
          const targetHeId = heAb.originId === originId
            ? cached.originToDest
            : cached.destToOrigin;
          const targetHe = this._halfEdges.get(targetHeId);
          if (typeof targetHe !== "undefined") {
            if (typeof faceId !== "undefined") {
              targetHe.faceIds = targetHe.faceIds.filter(fid => fid !== faceId);
            } else {
              targetHe.faceIds = [];
            }
          }
        }
      }

      this._edgeRefCount.set(key, count - 1);
      return;
    }

    // Last reference -- remove the half-edge pair
    const cached = this._edgeCache.get(key);
    if (typeof cached !== "undefined") {
      this._removeHalfEdgePair(cached.originToDest, cached.destToOrigin);
      this._edgeCache.delete(key);
    }
    this._edgeRefCount.delete(key);
  }

  /**
   * Remove both half-edges of a pair, cleaning up outgoing sets and twin
   * back-references. Called internally when an edge's reference count hits zero.
   */
  private _removeHalfEdgePair(abId: HalfEdgeId, baId: HalfEdgeId): void {
    this.removeHalfEdge(abId);
    this.removeHalfEdge(baId);
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
   *
   * Prefer releaseEdge() for ref-counted removal in all external callers.
   */
  private removeHalfEdge(id: HalfEdgeId): void {
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
    this.emit('handleHalfEdgesChange', Array.from(this._halfEdges.values()));
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
        he.faceIds.push(faceId);
      }
      return;
    }

    // Walk the loop and stamp every half-edge with this face ID
    for (const he of this.walkFaceLoop(startId)) {
      he.faceIds.push(faceId);
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
  // Vertex enumeration
  // ----------------------------------------------------------

  /**
   * Returns all vertex entries as [id, position] pairs.
   * Useful for iterating the full vertex set (e.g. to build a
   * solver position map).
   */
  allVertexEntries(): Array<[VertexId, P]> {
    return [...this._vertices.entries()];
  }

  // ----------------------------------------------------------
  // Edge enumeration
  // ----------------------------------------------------------

  /**
   * Enumerate every undirected edge in the DCEL with its endpoint
   * positions.  Each edge is returned exactly once (the edge key is
   * deduplicated internally).  Useful for intersection detection.
   */
  allEdgeSegments(): Array<{ originId: VertexId; destId: VertexId; originPos: P; destPos: P }> {
    const result: Array<{ originId: VertexId; destId: VertexId; originPos: P; destPos: P }> = [];
    const seen = new Set<string>();

    for (const [, he] of this._halfEdges) {
      if (he.twinId === null) {
        continue;
      }
      const twin = this._halfEdges.get(he.twinId);
      if (typeof twin === "undefined") {
        continue;
      }

      const key = this._edgeKey(he.originId, twin.originId);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      const originPos = this._vertices.get(he.originId);
      const destPos = this._vertices.get(twin.originId);
      if (typeof originPos === "undefined" || typeof destPos === "undefined") {
        continue;
      }

      result.push({ originId: he.originId, destId: twin.originId, originPos, destPos });
    }

    return result;
  }

  // ----------------------------------------------------------
  // Edge splitting
  // ----------------------------------------------------------

  /**
   * Replace the undirected edge (originId, destId) with two edges
   * (originId, splitVertexId) and (splitVertexId, destId) in-place.
   *
   * The split vertex must already exist (via addVertex()).
   * FaceIds from the original directed half-edges are distributed to
   * the corresponding new directed half-edges.  The edge ref count
   * from the original edge is transferred to both new edges.
   *
   * Returns the four new half-edge IDs in order:
   *   [origin→split, split→origin, split→dest, dest→split]
   *
   * NOTE: This method does NOT update any tracked shapes or relink
   * face loops — the caller is responsible for that.
   */
  splitEdge(
    originId: VertexId,
    destId: VertexId,
    splitVertexId: VertexId,
  ): [HalfEdgeId, HalfEdgeId, HalfEdgeId, HalfEdgeId] {
    const key = this._edgeKey(originId, destId);
    const cached = this._edgeCache.get(key);

    if (typeof cached === "undefined") {
      throw new Error(`splitEdge: edge "${key}" not found`);
    }

    // Save faceIds from both directed half-edges
    const heOd = this._halfEdges.get(cached.originToDest);
    const heDo = this._halfEdges.get(cached.destToOrigin);
    if (typeof heOd === "undefined" || typeof heDo === "undefined") {
      throw new Error(`splitEdge: half-edges for "${key}" missing`);
    }

    const originToDestFaceIds = [...heOd.faceIds];
    const destToOriginFaceIds = [...heDo.faceIds];

    const refCount = this._edgeRefCount.get(key) ?? 1;

    // Remove old edge from internal maps
    this._removeHalfEdgePair(cached.originToDest, cached.destToOrigin);
    this._edgeCache.delete(key);
    this._edgeRefCount.delete(key);

    // Create new edge pairs (using addHalfEdge directly to bypass ref counting)
    const osId = this.addHalfEdge(originId, splitVertexId);
    const soId = this.addHalfEdge(splitVertexId, originId);
    this._halfEdges.get(osId)!.twinId = soId;
    this._halfEdges.get(soId)!.twinId = osId;

    const sdId = this.addHalfEdge(splitVertexId, destId);
    const dsId = this.addHalfEdge(destId, splitVertexId);
    this._halfEdges.get(sdId)!.twinId = dsId;
    this._halfEdges.get(dsId)!.twinId = sdId;

    // Transfer faceIds
    for (const fid of originToDestFaceIds) {
      this._halfEdges.get(osId)!.faceIds.push(fid);
      this._halfEdges.get(sdId)!.faceIds.push(fid);
    }
    for (const fid of destToOriginFaceIds) {
      this._halfEdges.get(dsId)!.faceIds.push(fid);
      this._halfEdges.get(soId)!.faceIds.push(fid);
    }

    // Register new edges in cache with the old ref count
    const keyOS = this._edgeKey(originId, splitVertexId);
    this._edgeCache.set(keyOS, { originToDest: osId, destToOrigin: soId });
    this._edgeRefCount.set(keyOS, refCount);

    const keySD = this._edgeKey(splitVertexId, destId);
    this._edgeCache.set(keySD, { originToDest: sdId, destToOrigin: dsId });
    this._edgeRefCount.set(keySD, refCount);

    return [osId, soId, sdId, dsId];
  }

  /**
   * Merge two adjacent colinear edges (originId→middleId) and
   * (middleId→destId) into a single edge (originId→destId).
   *
   * This is the inverse of splitEdge.  The merged edge inherits the
   * ref count and combined faceIds from both input edges.
   *
   * Returns the new half-edge IDs: [originToDest, destToOrigin].
   *
   * NOTE: This method does NOT update any tracked shapes or relink
   * face loops — the caller is responsible for that.  The middle
   * vertex is NOT removed — the caller should call releaseVertex()
   * on it when appropriate.
   */
  mergeEdges(
    originId: VertexId,
    middleId: VertexId,
    destId: VertexId,
  ): [HalfEdgeId, HalfEdgeId] {
    const keyAB = this._edgeKey(originId, middleId);
    const keyBC = this._edgeKey(middleId, destId);
    const cachedAB = this._edgeCache.get(keyAB);
    const cachedBC = this._edgeCache.get(keyBC);

    if (typeof cachedAB === "undefined" || typeof cachedBC === "undefined") {
      throw new Error(
        `mergeEdges: one of edges "${keyAB}" or "${keyBC}" not found`,
      );
    }

    // Save faceIds from all four half-edges
    const heAB_od = this._halfEdges.get(cachedAB.originToDest);
    const heAB_do = this._halfEdges.get(cachedAB.destToOrigin);
    const heBC_od = this._halfEdges.get(cachedBC.originToDest);
    const heBC_do = this._halfEdges.get(cachedBC.destToOrigin);
    if (
      typeof heAB_od === "undefined" || typeof heAB_do === "undefined" ||
      typeof heBC_od === "undefined" || typeof heBC_do === "undefined"
    ) {
      throw new Error("mergeEdges: half-edges for one of the edges missing");
    }

    const abOdFaceIds = [...heAB_od.faceIds];
    const abDoFaceIds = [...heAB_do.faceIds];
    const bcOdFaceIds = [...heBC_od.faceIds];
    const bcDoFaceIds = [...heBC_do.faceIds];

    const refCount = this._edgeRefCount.get(keyAB) ?? 1;

    // Remove both edges from internal maps
    this._removeHalfEdgePair(cachedAB.originToDest, cachedAB.destToOrigin);
    this._removeHalfEdgePair(cachedBC.originToDest, cachedBC.destToOrigin);
    this._edgeCache.delete(keyAB);
    this._edgeCache.delete(keyBC);
    this._edgeRefCount.delete(keyAB);
    this._edgeRefCount.delete(keyBC);

    // Create new edge pair for (originId, destId)
    const odId = this.addHalfEdge(originId, destId);
    const doId = this.addHalfEdge(destId, originId);
    this._halfEdges.get(odId)!.twinId = doId;
    this._halfEdges.get(doId)!.twinId = odId;

    // Transfer faceIds (both edges' loop faceIds go to the new loop
    // half-edge; both edges' twin faceIds go to the new twin).
    for (const fid of abOdFaceIds) { this._halfEdges.get(odId)!.faceIds.push(fid); }
    for (const fid of bcOdFaceIds) { this._halfEdges.get(odId)!.faceIds.push(fid); }
    for (const fid of abDoFaceIds) { this._halfEdges.get(doId)!.faceIds.push(fid); }
    for (const fid of bcDoFaceIds) { this._halfEdges.get(doId)!.faceIds.push(fid); }

    // Register new edge in cache with the old ref count
    const keyAD = this._edgeKey(originId, destId);
    this._edgeCache.set(keyAD, { originToDest: odId, destToOrigin: doId });
    this._edgeRefCount.set(keyAD, refCount);

    return [odId, doId];
  }

  /**
   * Returns a plain-object snapshot of the full DCEL for debugging or
   * serialization. Not intended for hot-path use.
   */
  toJSON(): object {
    const vertices: Record<string, P> = {};
    const halfEdges: Record<string, HalfEdge> = {};
    const faces: Record<string, Face> = {};
    const edgeRefCounts: Record<string, number> = {};

    for (const [id, pos] of this._vertices) {
      vertices[id] = pos;
    }
    for (const [id, he] of this._halfEdges) {
      halfEdges[id] = he;
    }
    for (const [id, face] of this._faces) {
      faces[id] = face;
    }
    for (const [key, count] of this._edgeRefCount) {
      edgeRefCounts[key] = count;
    }

    return { vertices, halfEdges, faces, edgeRefCounts };
  }
}
