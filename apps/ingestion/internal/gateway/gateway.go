// Package gateway implements the HTTP/JSON → gRPC translation layer.
// It mirrors the REST contract of the Python FastAPI service so existing
// SDKs and the playground can point at the Go ingestion layer without
// code changes.
//
// The gateway calls the IngestionServiceServer implementation directly
// (in-process), avoiding any codec issues that arise when passing plain
// Go structs over a gRPC network connection.
package gateway

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	ingestionv1 "github.com/agentops-radar/ingestion/gen/ingestion/v1"
	"go.uber.org/zap"
	"google.golang.org/grpc/metadata"
)

// Gateway proxies HTTP/JSON requests directly to the IngestionServiceServer.
type Gateway struct {
	svc ingestionv1.IngestionServiceServer
	mux *http.ServeMux
	log *zap.Logger
}

// New creates a Gateway that dispatches requests to svc in-process.
// This avoids a loopback gRPC dial and sidesteps proto.Message codec
// requirements when using hand-written (non-protoc) message types.
func New(svc ingestionv1.IngestionServiceServer, log *zap.Logger) (*Gateway, error) {
	gw := &Gateway{svc: svc, mux: http.NewServeMux(), log: log}
	gw.registerRoutes()
	return gw, nil
}

// Handler returns the HTTP handler for the gateway.
func (gw *Gateway) Handler() http.Handler {
	return gw.mux
}

func (gw *Gateway) registerRoutes() {
	// Health — used by k8s liveness/readiness probes
	gw.mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "service": "ingestion"})
	})

	// Metrics endpoint — Prometheus scrape target
	gw.mux.HandleFunc("GET /metrics", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		w.WriteHeader(http.StatusOK)
		// Production: replace with prometheus.DefaultGatherer
		_, _ = w.Write([]byte("# AgentOps Radar ingestion metrics\n"))
	})

	// ── Ingestion endpoints (mirror Python FastAPI /api/runs/* paths) ─────────
	gw.mux.HandleFunc("POST /v1/ingest/runs/start", gw.handleStartRun)
	gw.mux.HandleFunc("POST /api/runs/start", gw.handleStartRun) // SDK compat

	gw.mux.HandleFunc("POST /v1/ingest/runs/{run_id}/events", gw.handleAddEvent)
	gw.mux.HandleFunc("POST /api/runs/{run_id}/events", gw.handleAddEvent) // SDK compat

	gw.mux.HandleFunc("POST /v1/ingest/runs/{run_id}/end", gw.handleEndRun)
	gw.mux.HandleFunc("POST /api/runs/{run_id}/end", gw.handleEndRun) // SDK compat
}

// ─── handlers ────────────────────────────────────────────────────────────────

func (gw *Gateway) handleStartRun(w http.ResponseWriter, r *http.Request) {
	var req ingestionv1.StartRunRequest
	if !decodeBody(w, r, &req) {
		return
	}
	req.APIKey = apiKeyFromHeader(r)

	ctx := requestCtx(r)
	resp, err := gw.svc.StartRun(ctx, &req)
	if err != nil {
		writeServiceError(w, err, gw.log)
		return
	}
	writeJSON(w, http.StatusCreated, resp)
}

func (gw *Gateway) handleAddEvent(w http.ResponseWriter, r *http.Request) {
	runID := r.PathValue("run_id")
	var req ingestionv1.AddEventRequest
	if !decodeBody(w, r, &req) {
		return
	}
	req.RunID = runID

	ctx := requestCtx(r)
	resp, err := gw.svc.AddEvent(ctx, &req)
	if err != nil {
		writeServiceError(w, err, gw.log)
		return
	}
	writeJSON(w, http.StatusCreated, resp)
}

func (gw *Gateway) handleEndRun(w http.ResponseWriter, r *http.Request) {
	runID := r.PathValue("run_id")
	var req ingestionv1.EndRunRequest
	if !decodeBody(w, r, &req) {
		return
	}
	req.RunID = runID

	ctx := requestCtx(r)
	resp, err := gw.svc.EndRun(ctx, &req)
	if err != nil {
		writeServiceError(w, err, gw.log)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// ─── helpers ─────────────────────────────────────────────────────────────────

func decodeBody(w http.ResponseWriter, r *http.Request, dst interface{}) bool {
	if r.Body == nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "empty request body"})
		return false
	}
	defer r.Body.Close()
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON: " + err.Error()})
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, code int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeServiceError(w http.ResponseWriter, err error, log *zap.Logger) {
	log.Warn("service error", zap.Error(err))
	code := http.StatusInternalServerError
	msg := err.Error()
	switch {
	case strings.Contains(msg, "InvalidArgument"):
		code = http.StatusBadRequest
	case strings.Contains(msg, "Unauthenticated"):
		code = http.StatusUnauthorized
	case strings.Contains(msg, "NotFound"):
		code = http.StatusNotFound
	case strings.Contains(msg, "rate limit"):
		code = http.StatusTooManyRequests
	}
	writeJSON(w, code, map[string]string{"error": msg})
}

func apiKeyFromHeader(r *http.Request) string {
	return r.Header.Get("X-API-Key")
}

// requestCtx returns a context with a 10s deadline. The API key is stored
// as gRPC *incoming* metadata so the server's existing authenticate() logic
// (which reads metadata.FromIncomingContext) works without any changes.
func requestCtx(r *http.Request) context.Context {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	_ = cancel // request lifecycle handles cancellation
	md := metadata.Pairs("x-api-key", apiKeyFromHeader(r))
	return metadata.NewIncomingContext(ctx, md)
}
