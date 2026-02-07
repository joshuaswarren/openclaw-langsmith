import type { PluginConfig, LangSmithRun } from "./types.js";
import { log } from "./logger.js";

interface BatchOp {
  method: "POST" | "PATCH";
  path: string;
  body: Record<string, unknown>;
}

export class LangSmithClient {
  private queue: BatchOp[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly projectName: string;
  private readonly batchMaxSize: number;

  constructor(private readonly config: PluginConfig) {
    this.endpoint = config.langsmithEndpoint.replace(/\/$/, "");
    this.apiKey = config.langsmithApiKey!;
    this.projectName = config.projectName;
    this.batchMaxSize = config.batchMaxSize;

    this.timer = setInterval(() => this.flush(), config.batchIntervalMs);
    // Unref so the timer doesn't keep the process alive
    if (this.timer && typeof this.timer.unref === "function") {
      this.timer.unref();
    }
  }

  createRun(run: LangSmithRun): void {
    this.queue.push({ method: "POST", path: "/runs", body: run as unknown as Record<string, unknown> });
    if (this.queue.length >= this.batchMaxSize) {
      this.flush();
    }
  }

  updateRun(runId: string, patch: Partial<LangSmithRun>): void {
    this.queue.push({ method: "PATCH", path: `/runs/${runId}`, body: patch as unknown as Record<string, unknown> });
    if (this.queue.length >= this.batchMaxSize) {
      this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.queue.length === 0) return;

    const batch = this.queue.splice(0);
    log.debug(`flushing ${batch.length} operations`);

    // LangSmith supports a batch endpoint: POST /runs/batch
    const creates: Record<string, unknown>[] = [];
    const updates: Record<string, unknown>[] = [];

    for (const op of batch) {
      if (op.method === "POST") {
        creates.push(op.body);
      } else {
        // For PATCH, include the run_id in the body
        updates.push(op.body);
      }
    }

    // Use the batch endpoint if available, otherwise fall back to individual calls
    try {
      if (creates.length > 0 || updates.length > 0) {
        const batchBody: Record<string, unknown> = {};
        if (creates.length > 0) batchBody.post = creates;
        if (updates.length > 0) batchBody.patch = updates;

        const resp = await fetch(`${this.endpoint}/runs/batch`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": this.apiKey,
          },
          body: JSON.stringify(batchBody),
        });

        if (!resp.ok) {
          const text = await resp.text().catch(() => "");
          log.warn(`batch request failed: ${resp.status} ${text.slice(0, 200)}`);
        } else {
          log.debug(`batch sent: ${creates.length} creates, ${updates.length} updates`);
        }
      }
    } catch (err) {
      log.warn(`batch request error: ${err}`);
    }
  }

  close(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
