# AgentOps Radar

**Production-grade AI agent observability, evaluation, and debugging platform.**

AgentOps Radar gives engineering teams full visibility into every model call, tool call, retrieval step, guardrail check, retry, and failure across AI agent workflows — with structured replay, automated scoring, and semantic failure search.

---

## Architecture

```
Python SDK / REST clients
        │
        ▼
┌──────────────────────────────────────────────────────────────────┐
│  Go Ingestion Service  (gRPC :9090  ·  HTTP gateway :8080)       │
│  franz-go producer → Kafka (KRaft, no Zookeeper)                 │
│                                                                  │
│   topic: trace.run.start ──▶ store_consumer ──▶ PostgreSQL       │
│   topic: trace.event.add ──▶ eval_consumer  ──▶ evaluations      │
│   topic: trace.run.end   ──▶ embed_consumer ──▶ pgvector         │
└──────────────────────────────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────────────────────────────┐
│  FastAPI  — query / replay / similarity / alerts                  │
│  Celery + Redis  — async evaluation, LLM judge                   │
│  PostgreSQL + pgvector  — traces, evals, embeddings              │
└──────────────────────────────────────────────────────────────────┘
        │
        ▼
  Next.js Dashboard  (traces · evals · replay · similarity search)
```

---

## Stack

| Layer | Technology |
|---|---|
| Trace ingestion | **Go** — gRPC + HTTP/JSON gateway, franz-go, uber/zap |
| Event streaming | **Kafka** — KRaft mode (no Zookeeper), 3 consumer groups |
| Vector search | **pgvector** — OpenAI `text-embedding-3-small`, IVFFlat cosine index |
| Query / replay API | **FastAPI** + SQLAlchemy 2.0, PostgreSQL JSONB |
| Async evaluation | **Celery** + Redis, rule-based + LLM-as-judge |
| Frontend | **Next.js 14** + TypeScript + Tailwind + Recharts |
| Python SDK | `packages/python-sdk/` — context manager, decorators |
| Kubernetes | **Helm** chart + **KEDA** Kafka-lag HPA, kind deploy script |
| Containerisation | Docker Compose (10 services) |

---

## Quick Start

```bash
# 1. Copy env and fill in OPENAI_API_KEY if you want embeddings / LLM judge
cp .env.example .env

# 2. Start all 10 services
docker compose up --build

# 3. Open the dashboard
open http://localhost:3000

# 4. Run the demo agent (seeds realistic incident-investigation traces)
cd apps/demo-agent
pip install -r requirements.txt
python main.py --seed        # 3 successful + 1 failed run
python main.py --fail        # single failing run (weak evidence)
python main.py --replay <id> # replay with stricter guardrails
```

**Service ports (host):**

| Service | Host port |
|---|---|
| Next.js dashboard | 3000 |
| FastAPI | 8000 |
| Go HTTP gateway | 8080 |
| Go gRPC | 9091 |
| Kafka broker | 9095 |
| PostgreSQL | 5433 |
| Redis | 6380 |

---

## Go Ingestion Service

High-throughput trace ingestion in Go — decouples write path from the Python query API.

```
apps/ingestion/
├── cmd/server/main.go          # entry point — gRPC + HTTP gateway
├── internal/
│   ├── server/server.go        # IngestionServiceServer implementation
│   ├── gateway/gateway.go      # HTTP/JSON → in-process gRPC bridge
│   └── kafka/producer.go       # franz-go AllISRAcks idempotent producer
├── gen/ingestion/v1/           # hand-written gRPC stubs (no protoc dep)
└── proto/ingestion/v1/         # .proto contract
```

**API (both gRPC and HTTP/JSON):**

```bash
# Start a run
POST /v1/ingest/runs/start
{"project_id": "...", "input": "Investigate checkout latency"}

# Add a trace event
POST /v1/ingest/runs/{run_id}/events
{"event_type": "retrieval", "name": "search_logs", "output": {"hits": 8}, "latency_ms": 320}

# End a run
POST /v1/ingest/runs/{run_id}/end
{"status": "success", "confidence_score": 0.87, "final_output": "DB pool exhaustion"}
```

Also accepts the legacy Python API paths (`/api/runs/...`) for backward compatibility.

---

## Kafka Consumers

Three independent consumers fan out from Kafka — each concern is isolated:

| Consumer | Topics | Responsibility |
|---|---|---|
| `store_consumer` | run.start, event.add, run.end | Write runs + events to PostgreSQL |
| `eval_consumer` | run.end | Trigger rule-based evaluation after run completes |
| `embed_consumer` | run.end | Generate OpenAI embeddings for failed/low-confidence runs |

---

## Semantic Similarity Search (pgvector)

Failed runs are embedded with `text-embedding-3-small` (1536 dims) and stored in PostgreSQL with an IVFFlat cosine index.

```bash
# Embed a run
POST /api/runs/{run_id}/embed

# Find similar failures
GET /api/runs/{run_id}/similar?limit=5
```

The dashboard shows a **Similar Failures** panel on each run detail page with similarity bars and status badges.

---

## Evaluation Engine

**Rule-based evaluators** (always run, no API key needed):

| Evaluator | What it checks | Pass threshold |
|---|---|---|
| `groundedness` | Retrieval evidence quality × confidence | ≥ 0.70 |
| `relevance` | Output completeness vs. inconclusive markers | ≥ 0.60 |
| `safety` | Guardrail violation count | ≥ 0.80 |
| `tool_call_correctness` | Tool error rate | ≥ 0.70 |
| `latency` | Run latency vs. thresholds | ≥ 0.60 |
| `format_compliance` | Output structure and actionability | ≥ 0.80 |
| `retry_loop` | Retry count | ≥ 0.50 |
| `evidence` | Retrieval hit count | ≥ 0.60 |

**LLM judge** (set `OPENAI_API_KEY` + `LLM_JUDGE_ENABLED=true`):
Scores output quality with `gpt-4o-mini` on a 0–1 scale.

---

## Replay & Regression

Replay a failed run with a modified prompt or stricter guardrails and compare evaluation scores side by side:

```python
client.replay_run(
    run_id,
    prompt_override="Require at least 3 evidence items before concluding",
    guardrail_strictness="high",
)
```

The dashboard **Replay** panel shows before/after score bars with coloured pass/fail badges and delta percentages.

---

## Python SDK

```python
from agentops_radar import RadarClient

client = RadarClient(base_url="http://localhost:8000", api_key="dev-api-key-change-in-production")

proj  = client.create_project(name="My Agent")
agent = client.register_agent(project_id=proj["id"], name="Incident Bot", framework="LangGraph")

with client.run(project_id=proj["id"], agent_id=agent["id"], input="Investigate latency spike") as run:
    run.event("retrieval", name="search_logs", output={"hits": 8}, latency_ms=320)
    run.event("tool_call",  name="check_metrics", output={"p99_ms": 2450}, latency_ms=150)
    run.end(final_output="DB pool exhaustion confirmed", confidence_score=0.87)

client.evaluate_run(run.run_id)
client.replay_run(run.run_id, prompt_override="Stricter evidence validation")
```

---

## Kubernetes (local kind cluster)

```bash
# Prerequisites: kind, kubectl, helm, docker
chmod +x infra/deploy-local.sh
./infra/deploy-local.sh
```

The script provisions a kind cluster, installs ingress-nginx and KEDA, builds Docker images, and deploys via Helm.

**KEDA autoscaling:** The Go ingestion service scales from 2 → 20 replicas based on Kafka consumer group lag (`lagThreshold: 100` messages per replica).

---

## Failure Detection

Automatic labels applied to runs:

| Label | Trigger |
|---|---|
| `tool_error` | Tool call with `status=error` |
| `tool_timeout` | Tool error containing "timeout" |
| `excessive_retries` | ≥ 3 retry events |
| `high_latency` | Total latency > 15 000 ms |
| `low_confidence` | Confidence score < 0.50 |
| `unsafe_output` | Guardrail violation |

---

## Project Structure

```
agentops-radar/
├── apps/
│   ├── api/            FastAPI query / replay / similarity API
│   ├── worker/         Celery evaluator + Kafka consumers
│   │   └── consumers/  store_consumer · eval_consumer · embed_consumer
│   ├── dashboard/      Next.js 14 dashboard
│   ├── ingestion/      Go ingestion service (gRPC + HTTP)
│   └── demo-agent/     Incident investigation demo agent
├── packages/
│   └── python-sdk/     agentops-radar Python SDK
├── infra/
│   ├── helm/           Helm chart (production + local values)
│   ├── k8s/            kind cluster config
│   └── deploy-local.sh kind/minikube deploy script
└── docker-compose.yml  10-service local stack
```

---

## Resume Bullet Points

- Designed and built a **Go gRPC + HTTP ingestion service** (franz-go, uber/zap) decoupling the write path from the Python API; fan-out to three independent Kafka consumers (store, evaluate, embed) for async processing.
- Implemented **Kafka KRaft-mode event streaming** (no Zookeeper) with KEDA-based autoscaling — ingestion pods scale 2 → 20 replicas on consumer group lag.
- Built **semantic failure search** using OpenAI `text-embedding-3-small` stored in **pgvector** with IVFFlat cosine index; surface similar past failures from a single API call.
- Wrote full **Helm chart** with production and local (kind) value overrides, ingress-nginx, KEDA `ScaledObject`, and a one-command kind deploy script.
- Implemented **8-evaluator scoring engine** (groundedness, safety, latency, evidence, format compliance, retry loop) with rule-based and LLM-judge modes; replay pipeline lets engineers iterate on prompt strategies and compare scores side by side.
