export interface PluginConfig {
  langsmithApiKey: string | undefined;
  langsmithEndpoint: string;
  projectName: string;
  traceAgentTurns: boolean;
  traceToolCalls: boolean;
  traceEngramLlm: boolean;
  batchIntervalMs: number;
  batchMaxSize: number;
  debug: boolean;
}

export interface LangSmithRun {
  id: string;
  trace_id: string; // Required by LangSmith API - the root run ID for this trace
  dotted_order: string; // Required - ordering key: <timestamp>Z<run_id> for root, parent_dotted_order.<timestamp>Z<run_id> for child
  name: string;
  run_type: "chain" | "tool" | "llm";
  inputs: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  parent_run_id?: string;
  start_time: string;
  end_time?: string;
  error?: string;
  extra?: Record<string, unknown>;
  session_name: string;
  // Token usage fields (may only work for llm run types)
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  // Tags for filtering in LangSmith UI
  tags?: string[];
}

export interface TokenUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  // Alternative field names that OpenClaw might use
  input_tokens?: number;
  output_tokens?: number;
}

export interface LlmTraceEvent {
  kind: "llm_start" | "llm_end" | "llm_error";
  traceId: string;
  model: string;
  operation: string;
  input?: string;
  output?: string;
  durationMs?: number;
  error?: string;
  tokenUsage?: { input?: number; output?: number; total?: number };
}
