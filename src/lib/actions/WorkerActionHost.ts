import { type WorkerRequest, type WorkerResponse } from './types';

/**
 * Manages a dedicated Web Worker per action execution, enforcing a timeout
 * and handling serialization of requests/responses.
 *
 * The worker factory can be configured via `setWorkerFactory` for testing.
 */
export class WorkerActionHost {
  /** Default worker factory: creates a Worker from the bundled action-worker module. */
  private static defaultWorkerFactory: () => Worker = () => {
    throw new Error(
      'WorkerActionHost: no worker factory configured. ' +
        'Call WorkerActionHost.setWorkerFactory() or configure for your bundler.',
    );
  };

  /**
   * Overrides the default worker factory. Use this in tests to provide a mock
   * Worker, or in production to configure the bundler-specific worker URL.
   */
  static setWorkerFactory(factory: () => Worker): void {
    WorkerActionHost.defaultWorkerFactory = factory;
  }

  private worker: Worker | null = null;

  /** Creates a WorkerActionHost using the default worker factory. */
  constructor();

  /**
   * Creates a WorkerActionHost with a custom worker factory.
   * @param createWorker - A factory function that creates a Worker instance.
   */
  constructor(createWorker?: () => Worker) {
    if (createWorker) {
      this.createWorker = createWorker;
    }
  }

  private createWorker: () => Worker = () => WorkerActionHost.defaultWorkerFactory();

  /**
   * Sends a request to the worker and waits for a response.
   * If the worker does not respond within `timeout` milliseconds, it is
   * terminated and the promise rejects with a timeout error.
   */
  run(request: WorkerRequest, timeout: number): Promise<WorkerResponse> {
    this.cleanup();

    return new Promise<WorkerResponse>((resolve, reject) => {
      const worker = this.createWorker();
      this.worker = worker;

      const timer = setTimeout(() => {
        worker.terminate();
        this.worker = null;
        reject(new Error(`Worker timed out after ${timeout}ms`));
      }, timeout);

      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        clearTimeout(timer);
        this.worker = null;
        const response = event.data;
        if (response.error) {
          reject(new Error(response.error));
        } else {
          resolve(response);
        }
      };

      worker.onerror = (event: ErrorEvent) => {
        clearTimeout(timer);
        this.worker = null;
        reject(new Error(event.message || 'Unknown worker error'));
      };

      worker.postMessage(request);
    });
  }

  /** Terminates the current worker if one is running. */
  terminate(): void {
    this.cleanup();
  }

  private cleanup(): void {
    if (this.worker !== null) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}
