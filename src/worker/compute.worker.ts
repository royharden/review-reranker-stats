// Module Web Worker entry (CL §2.8). Type-checked by tsconfig.worker.json (lib: ES2022 + WebWorker), and excluded
// from tsconfig.json (DOM lib), because the DOM and WebWorker libs conflict when combined in one program; see
// docs/DEFERRED-VALIDATION.md D22/D23. All logic lives in handler.ts so it can be tested in Node.

import { createComputeHandler } from './handler';
import type { WorkerResponse } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

const handler = createComputeHandler((message: WorkerResponse) => {
  self.postMessage(message);
});

self.onmessage = (event: MessageEvent<unknown>) => {
  void handler.handle(event.data);
};
