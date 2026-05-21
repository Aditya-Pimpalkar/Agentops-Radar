# Kafka consumer modules for the AgentOps Radar worker.
#
# Three independent consumers pull from Kafka topics published by the
# Go ingestion service and handle different concerns:
#
#   store_consumer  — trace.run.start / trace.event.add / trace.run.end
#                     → writes raw runs and events to PostgreSQL
#
#   eval_consumer   — trace.run.end
#                     → triggers the rule-based + LLM-judge evaluation pipeline
#
#   embed_consumer  — trace.run.end (failed runs only)
#                     → generates OpenAI embeddings and stores in pgvector
#                        for semantic "similar failures" search
