import { computeBooleanOperation } from './boolean-compute';
import { type BooleanOperationRequest, type BooleanOperationResponse } from './types';

/**
 * Worker entry point for action computations.
 * This module is bundled separately by webpack and runs in a dedicated
 * worker thread. It must not import React, DOM APIs, or main-thread state.
 */
self.onmessage = (event: MessageEvent<BooleanOperationRequest>) => {
  const request = event.data;

  switch (request.type) {
    case 'boolean-operation': {
      const response = handleBooleanOperation(request);
      self.postMessage(response);
      break;
    }
    default: {
      self.postMessage({
        type: request.type,
        result: null,
        error: `Unknown operation type: ${request.type}`,
      } satisfies BooleanOperationResponse);
      break;
    }
  }
};

function handleBooleanOperation(request: BooleanOperationRequest): BooleanOperationResponse {
  try {
    const result = computeBooleanOperation(request.operation, request.polygons);
    return { type: 'boolean-operation', result };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error in boolean operation';
    return { type: 'boolean-operation', result: null, error: message };
  }
}
