export interface Project {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
}

export interface Agent {
  id: string;
  project_id: string;
  name: string;
  framework: string | null;
  model_provider: string | null;
  model_name: string | null;
  created_at: string;
}

export interface Run {
  id: string;
  project_id: string;
  agent_id: string | null;
  input: string | null;
  final_output: string | null;
  status: string;
  confidence_score: number | null;
  total_latency_ms: number | null;
  total_tokens: number | null;
  estimated_cost_usd: number | null;
  failure_count: number;
  started_at: string;
  ended_at: string | null;
}

export interface TraceEvent {
  id: string;
  run_id: string;
  parent_event_id: string | null;
  event_type: string;
  name: string | null;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  latency_ms: number | null;
  status: string;
  error_message: string | null;
  created_at: string;
}

export interface Evaluation {
  id: string;
  run_id: string;
  evaluator_name: string;
  score: number | null;
  passed: boolean | null;
  reason: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface Alert {
  id: string;
  run_id: string | null;
  severity: string;
  alert_type: string;
  message: string;
  resolved: boolean;
  created_at: string;
}

export interface AlertRule {
  id: string;
  project_id: string;
  name: string;
  condition: Record<string, unknown>;
  severity: string;
  enabled: boolean;
  created_at: string;
}

export interface AnalyticsOverview {
  total_runs: number;
  failed_runs: number;
  failure_rate: number;
  avg_latency_ms: number;
  avg_quality_score: number;
  estimated_cost_usd: number;
}

export interface ReplayResponse {
  replay_run_id: string;
  original_run_id: string;
  status: string;
  created_at: string;
}

export interface ReplayComparison {
  original_run_id: string;
  replay_run_id: string;
  original_scores: Record<string, number>;
  replay_scores: Record<string, number>;
  score_delta: Record<string, number>;
  original_latency_ms: number | null;
  replay_latency_ms: number | null;
  latency_delta_ms: number | null;
  original_status: string;
  replay_status: string;
  change_details: Record<string, unknown> | null;
}
