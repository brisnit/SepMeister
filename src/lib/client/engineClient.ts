/**
 * Typed client for the separation worker.
 *
 * Wraps postMessage in promises and routes progress events, so React code can
 * `await client.separate(...)` without dealing with message correlation.
 */

import type { WorkerRequest, WorkerResponse } from "@/worker/protocol";

/**
 * Omit that distributes over a union. The plain `Omit` collapses
 * `WorkerRequest` into the intersection of its members' keys, which would make
 * every message-specific field unassignable.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

type WorkerRequestBody = DistributiveOmit<WorkerRequest, "requestId">;

type Pending = {
  resolve: (value: WorkerResponse) => void;
  reject: (err: Error) => void;
  onProgress?: (message: string, done?: number, total?: number) => void;
};

export class EngineError extends Error {
  constructor(message: string, readonly recoverable: boolean) {
    super(message);
    this.name = "EngineError";
  }
}

export class EngineClient {
  private worker: Worker | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;

  private ensure(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL("../../worker/separation.worker.ts", import.meta.url), {
      type: "module",
      name: "sep-ai-engine",
    });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      const entry = this.pending.get(msg.requestId);
      if (!entry) return;
      if (msg.type === "progress") {
        entry.onProgress?.(msg.message, msg.done, msg.total);
        return;
      }
      this.pending.delete(msg.requestId);
      if (msg.type === "error") entry.reject(new EngineError(msg.message, msg.recoverable));
      else entry.resolve(msg);
    };
    worker.onerror = (event) => {
      const err = new Error(event.message || "The separation engine failed to start.");
      for (const [, entry] of this.pending) entry.reject(err);
      this.pending.clear();
    };
    this.worker = worker;
    return worker;
  }

  private send<T extends WorkerResponse>(
    req: WorkerRequestBody,
    transfer: Transferable[],
    onProgress?: Pending["onProgress"],
  ): Promise<T> {
    const worker = this.ensure();
    const requestId = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(requestId, { resolve: resolve as Pending["resolve"], reject, onProgress });
      worker.postMessage({ ...req, requestId } as WorkerRequest, transfer);
    });
  }

  decode(bytes: ArrayBuffer, fileName: string) {
    return this.send<Extract<WorkerResponse, { type: "decoded" }>>(
      { type: "decode", bytes, fileName }, [bytes],
    );
  }

  upscale(req: Omit<Extract<WorkerRequest, { type: "upscale" }>, "type" | "requestId">) {
    return this.send<Extract<WorkerResponse, { type: "upscaled" }>>(
      { type: "upscale", ...req }, [req.pixels],
    );
  }

  separate(
    req: Omit<Extract<WorkerRequest, { type: "separate" }>, "type" | "requestId">,
    onProgress?: (message: string) => void,
  ) {
    return this.send<Extract<WorkerResponse, { type: "separated" }>>(
      { type: "separate", ...req }, [req.pixels], onProgress,
    );
  }

  composite(req: Omit<Extract<WorkerRequest, { type: "composite" }>, "type" | "requestId">) {
    return this.send<Extract<WorkerResponse, { type: "composited" }>>({ type: "composite", ...req }, []);
  }

  adjustInk(req: Omit<Extract<WorkerRequest, { type: "adjustInk" }>, "type" | "requestId">) {
    return this.send<Extract<WorkerResponse, { type: "inkAdjusted" }>>({ type: "adjustInk", ...req }, []);
  }

  filmPreview(req: Omit<Extract<WorkerRequest, { type: "filmPreview" }>, "type" | "requestId">) {
    return this.send<Extract<WorkerResponse, { type: "filmPreviewed" }>>({ type: "filmPreview", ...req }, []);
  }

  export(
    req: Omit<Extract<WorkerRequest, { type: "export" }>, "type" | "requestId">,
    onProgress?: (message: string, done?: number, total?: number) => void,
  ) {
    return this.send<Extract<WorkerResponse, { type: "exported" }>>(
      { type: "export", ...req }, [], onProgress,
    );
  }

  filmQa(req: Omit<Extract<WorkerRequest, { type: "filmQa" }>, "type" | "requestId">) {
    return this.send<Extract<WorkerResponse, { type: "filmQaReport" }>>({ type: "filmQa", ...req }, []);
  }

  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
  }
}
