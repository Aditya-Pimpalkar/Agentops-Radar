# AgentOps Radar

**AI Agent Observability, Evaluation, and Debugging Platform**

AgentOps Radar is a production-grade platform for tracing, evaluating, debugging, and replaying AI agent workflows. It gives engineering teams full visibility into every model call, tool call, retrieval step, guardrail check, retry, and failure in their agent systems.

---

## Architecture

```
Demo Agent App (Python SDK)
         │ traces, tool calls, eval events
         ▼
┌─────────────────────────────────────────────────────┐
│              AgentOps Radar API (FastAPI)            │
│                                                     │
│  Trace Ingestion ──▶ Validator ──▶ PostgreSQL       │
│       │                                │            │
│       ▼                                ▼            │
│  Redis Queue ──▶ Celery Worker ──▶ Eval Store       │
│                  (Evaluators +                      │
│                   Failure Detection)                │
└─────────────────────────────────────────────────────┘
         │
         ▼
  Dashboard UI (Next.js)
```

**Stack:**

| Layer       | Technology                        |
|-------------|-----------------------------------|
| Backend API | FastAPI + SQLAlchemy              |
| Worker      | Celery + Redis                    |
| Database    | PostgreSQL (JSONB trace events)   |
| Frontend    | Next.js 14 + TypeScript + Recharts|
| SDK         | Python package (httpx)            |
| Deployment  | Docker + Docker Compose           |

---

## Quick Start

### 1. Copy env file

```bash
cp .env.example .env
```

### 2. Start all services

```bash
docker compose up --build
```

This starts:
- **PostgreSQL** on port 5432
- **Redis** on port 6379
- **API** on http://localhost:8000
- **Worker** (Celery evaluator)
- **Dashboard** on http://localhost:3000

### 3. Open the dashboard

```
http://localhost:3000
```

### 4. Run the demo agent

```bash
cd apps/demo-agent
pip install -r requirements.txt
python main.py --seed        # Seed 3 successful + 1 failed run with replay
python main.py               # Single successful run
python main.py --fail        # Single failing run
python main.py --replay <id> # Replay a specific run
```

---

## API Reference

Interactive docs: http://localhost:8000/docs

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/projects` | Create project |
| GET | `/api/projects` | List projects |
| POST | `/api/agents` | Register agent |
| POST | `/api/runs/start` | Start a run |
| POST | `/api/runs/{id}/events` | Add trace event |
| POST | `/api/runs/{id}/end` | End a run |
| GET | `/api/runs` | List runs (filterable) |
| GET | `/api/runs/{id}` | Get run details |
| GET | `/api/runs/{id}/trace` | Get trace timeline |
| POST | `/api/runs/{id}/evaluate` | Trigger evaluation |
| GET | `/api/runs/{id}/evaluations` | Get evaluations |
| POST | `/api/runs/{id}/replay` | Replay a run |
| GET | `/api/runs/{id}/replay/comparison` | Replay comparison |
| GET | `/api/analytics/overview` | Dashboard metrics |
| GET | `/api/analytics/failures` | Failure breakdown |
| POST | `/api/alerts/rules` | Create alert rule |
| GET | `/api/alerts` | List alerts |

**Authentication:** All requests require `X-API-Key` header.

---

## Python SDK

```python
from agentops_radar import RadarClient

client = RadarClient(base_url="http://localhost:8000", api_key="dev-api-key-change-in-production")

# Create project + agent
proj = client.create_project(name="My Agent Project")
agent = client.register_agent(project_id=proj["id"], name="My Agent", framework="LangGraph")

# Instrument a run
with client.run(project_id=proj["id"], agent_id=agent["id"], input="Investigate checkout latency") as run_ctx:
    # Send trace events
    run_ctx.event("retrieval", name="search_logs", output={"hits": 8}, latency_ms=320)
    run_ctx.event("tool_call", name="check_metrics", output={"latency_ms": 2450}, latency_ms=150)

    # End the run
    run_ctx.end(
        final_output="Root cause: DB connection pool exhaustion",
        confidence_score=0.87,
    )

# Trigger evaluation
client.evaluate_run(run_ctx.run_id)

# Replay a failed run
client.replay_run(run_id, prompt_override="Use stricter evidence validation", guardrail_strictness="high")
```

---

## Evaluation Engine

**Rule-based evaluators** (always run):

| Evaluator | What it checks | Pass threshold |
|-----------|---------------|----------------|
| groundedness | Retrieval success rate + confidence | ≥ 0.70 |
| relevance | Output presence and length | ≥ 0.60 |
| safety | Guardrail violations | ≥ 0.80 |
| tool_call_correctness | Tool error rate | ≥ 0.70 |
| latency | Run latency vs thresholds | ≥ 0.60 |
| format_compliance | Output length and structure | ≥ 0.80 |
| retry_loop | Number of retries | ≥ 0.50 |
| evidence | Retrieval evidence quality | ≥ 0.60 |

**LLM judge** (optional, requires `OPENAI_API_KEY` and `LLM_JUDGE_ENABLED=true`):
Uses `gpt-4o-mini` to score output quality on a 0–1 scale.

---

## Failure Detection

The system automatically labels:

| Label | Trigger |
|-------|---------|
| `tool_error` | Tool call with status=error |
| `tool_timeout` | Tool error containing "timeout" |
| `excessive_retries` | ≥ 3 retry events |
| `high_latency` | Total latency > 15,000ms |
| `low_confidence` | Confidence score < 0.50 |
| `unsafe_output` | Guardrail violation |
| `format_violation` | Schema error in error events |

---

## Demo Scenario

**Incident:** Checkout latency spike after deployment v42.

The demo agent:
1. Planner chooses investigation path
2. Searches logs → finds DB connection pool errors
3. Checks metrics → latency spike from 220ms → 2450ms
4. Fetches deployment config → v42 reduced pool size from 50 → 10
5. Verifies hypothesis → 87% confidence
6. Produces recommendation: increase pool size, revert timeout

**Failure case** (`--fail`): Retrieval returns weak evidence → guardrail fails → low confidence (32%) → groundedness/evidence evaluators fail → failure labels created → ready for replay.

**Replay**: Apply stricter evidence validation → confidence improves → compare scores side by side.

---

## Project Structure

```
agentops-radar/
├── apps/
│   ├── api/           FastAPI backend
│   ├── worker/        Celery evaluation worker
│   ├── dashboard/     Next.js dashboard
│   └── demo-agent/    Incident investigation agent
├── packages/
│   └── python-sdk/    agentops-radar Python SDK
├── docker-compose.yml
└── .env.example
```

---

## Development (without Docker)

```bash
# Backend
cd apps/api
pip install -r requirements.txt
uvicorn app.main:app --reload

# Worker
cd apps/worker
celery -A worker worker --loglevel=info

# Dashboard
cd apps/dashboard
npm install && npm run dev

# Demo agent
cd apps/demo-agent
pip install -r requirements.txt
python main.py
```

---

## Resume Positioning

- Built production-grade observability platform for AI agents capturing traces across model calls, tool calls, retrieval steps, retries, guardrail checks, latency, token usage, and failures.
- Designed Python SDK and FastAPI ingestion service supporting agent run tracing, async evaluation, replay, and regression analysis across distributed LLM workflows.
- Implemented evaluation engine for groundedness, tool-call correctness, safety, latency, and format compliance, automatically flagging hallucination risk and failure modes.
- Built dashboard with trace timeline, evaluation scorecards, failure heatmaps, and replay comparison to debug agent behavior and reduce investigation time.
