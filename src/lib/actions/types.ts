/** A serializable point used for worker communication. */
export type SerializedPoint = {
  x: number;
  y: number;
};

/** A serializable polygon contour as an array of [x, y] pairs. */
export type SerializedPolygonContour = Array<[number, number]>;

/** Supported boolean polygon operations. */
export type BooleanOperation = 'union' | 'difference' | 'intersection';

/** Request sent to the action worker for boolean operations. */
export type BooleanOperationRequest = {
  type: 'boolean-operation';
  operation: BooleanOperation;
  polygons: Array<SerializedPolygonContour>;
};

/** Response from the action worker for boolean operations. */
export type BooleanOperationResponse = {
  type: 'boolean-operation';
  result: SerializedPolygonContour | null;
  error?: string;
};

/** Union type of all worker requests. */
export type WorkerRequest = BooleanOperationRequest;

/** Union type of all worker responses. */
export type WorkerResponse = BooleanOperationResponse;
