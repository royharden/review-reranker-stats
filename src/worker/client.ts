// Main-thread client for the compute worker (CL §2.8). Spawns a module worker; cancellation = terminate + respawn
// (the new worker holds no dataset, so the caller re-sends its last load). Responses are passed through untouched;
// staleness is decided by the pure reducer in src/ui/state.ts, not here.

import type { WorkerRequest, WorkerResponse } from './protocol';

export interface ComputeClient {
  send(request: WorkerRequest): void;
  /** Terminate the running worker (abandoning its work) and start a fresh, empty one. */
  cancel(): void;
  dispose(): void;
}

function spawn(): Worker {
  return new Worker(new URL('./compute.worker.ts', import.meta.url), { type: 'module' });
}

export function createComputeClient(
  onResponse: (response: WorkerResponse) => void,
  onCrash: (message: string) => void,
): ComputeClient {
  let worker: Worker | null = null;

  const attach = (): Worker => {
    const w = spawn();
    w.onmessage = (event: MessageEvent<WorkerResponse>) => onResponse(event.data);
    w.onerror = (event: ErrorEvent) => {
      event.preventDefault();
      onCrash(event.message || 'The compute worker failed to start or crashed.');
    };
    w.onmessageerror = () => onCrash('A worker message could not be deserialised.');
    return w;
  };

  worker = attach();

  return {
    send(request) {
      if (worker === null) worker = attach();
      worker.postMessage(request);
    },
    cancel() {
      worker?.terminate();
      worker = attach();
    },
    dispose() {
      worker?.terminate();
      worker = null;
    },
  };
}
