import { WorkerActionHost } from '@/lib/actions/WorkerActionHost';
import { type WorkerRequest, type WorkerResponse } from '@/lib/actions/types';

/** Creates a mock Worker that responds with the given data after a delay. */
function createMockWorker(
  options: {
    response?: WorkerResponse;
    error?: string;
    delay?: number;
    neverRespond?: boolean;
  } = {},
): Worker {
  const { response, error, delay = 0, neverRespond = false } = options;

  const mockWorker = {
    postMessage: jest.fn(() => {
      if (neverRespond) {
        return;
      }

      setTimeout(() => {
        if (error) {
          if (mockWorker.onerror) {
            mockWorker.onerror(new ErrorEvent('error', { message: error }));
          }
        } else if (response) {
          if (mockWorker.onmessage) {
            mockWorker.onmessage(new MessageEvent('message', { data: response }));
          }
        }
      }, delay);
    }),
    terminate: jest.fn(),
    onmessage: null as ((event: MessageEvent) => void) | null,
    onerror: null as ((event: ErrorEvent) => void) | null,
  } as unknown as Worker;

  return mockWorker;
}

describe('WorkerActionHost', () => {
  let factory: jest.Mock<Worker>;
  let host: WorkerActionHost;

  afterEach(() => {
    if (host) {
      host.terminate();
    }
  });

  describe('run', () => {
    it('resolves with the worker response on success', async () => {
      const testResponse: WorkerResponse = {
        type: 'boolean-operation',
        result: [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
      };
      factory = jest.fn(() => createMockWorker({ response: testResponse }));
      host = new WorkerActionHost(() => factory());

      const request: WorkerRequest = {
        type: 'boolean-operation',
        operation: 'union',
        polygons: [
          [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
          ],
        ],
      };

      const result = await host.run(request, 5000);
      expect(result).toEqual(testResponse);
      expect(factory).toHaveBeenCalledTimes(1);
    });

    it('rejects when the worker posts an error response', async () => {
      const testResponse: WorkerResponse = {
        type: 'boolean-operation',
        result: null,
        error: 'Computation failed',
      };
      factory = jest.fn(() => createMockWorker({ response: testResponse }));
      host = new WorkerActionHost(() => factory());

      const request: WorkerRequest = {
        type: 'boolean-operation',
        operation: 'union',
        polygons: [
          [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
          ],
        ],
      };

      await expect(host.run(request, 5000)).rejects.toThrow('Computation failed');
    });

    it('rejects on worker error event', async () => {
      factory = jest.fn(() => createMockWorker({ error: 'Worker crashed' }));
      host = new WorkerActionHost(() => factory());

      const request: WorkerRequest = {
        type: 'boolean-operation',
        operation: 'union',
        polygons: [
          [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
          ],
        ],
      };

      await expect(host.run(request, 5000)).rejects.toThrow('Worker crashed');
    });

    it('rejects with timeout error when worker does not respond', async () => {
      factory = jest.fn(() => createMockWorker({ neverRespond: true }));
      host = new WorkerActionHost(() => factory());

      const request: WorkerRequest = {
        type: 'boolean-operation',
        operation: 'union',
        polygons: [
          [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
          ],
        ],
      };

      await expect(host.run(request, 50)).rejects.toThrow('timed out');
    });

    it('terminates the worker on timeout', async () => {
      const mockWorker = createMockWorker({ neverRespond: true });
      const terminateSpy = jest.spyOn(mockWorker, 'terminate');
      factory = jest.fn(() => mockWorker);
      host = new WorkerActionHost(() => factory());

      const request: WorkerRequest = {
        type: 'boolean-operation',
        operation: 'union',
        polygons: [
          [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
          ],
        ],
      };

      await expect(host.run(request, 50)).rejects.toThrow('timed out');
      expect(terminateSpy).toHaveBeenCalled();
    });
  });

  describe('terminate', () => {
    it('terminates the active worker', () => {
      const mockWorker = createMockWorker({ neverRespond: true });
      const terminateSpy = jest.spyOn(mockWorker, 'terminate');
      factory = jest.fn(() => mockWorker);
      host = new WorkerActionHost(() => factory());

      host.run({ type: 'boolean-operation', operation: 'union', polygons: [] }, 5000);

      host.terminate();
      expect(terminateSpy).toHaveBeenCalled();
    });

    it('is safe to call multiple times', () => {
      host = new WorkerActionHost(() => createMockWorker({ neverRespond: true }));
      expect(() => {
        host.terminate();
        host.terminate();
      }).not.toThrow();
    });
  });
});
