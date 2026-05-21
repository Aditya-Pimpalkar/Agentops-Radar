// Package server implements the gRPC IngestionServiceServer.
// It validates incoming requests, assigns IDs, and publishes
// structured envelopes to Kafka for downstream async processing.
package server

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	ingestionv1 "github.com/agentops-radar/ingestion/gen/ingestion/v1"
	kafkapkg "github.com/agentops-radar/ingestion/internal/kafka"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

// IngestionServer implements ingestionv1.IngestionServiceServer.
type IngestionServer struct {
	ingestionv1.UnimplementedIngestionServiceServer
	producer  *kafkapkg.Producer
	apiKey    string
	log       *zap.Logger
}

// New creates a new IngestionServer.
func New(producer *kafkapkg.Producer, apiKey string, log *zap.Logger) *IngestionServer {
	return &IngestionServer{
		producer: producer,
		apiKey:   apiKey,
		log:      log,
	}
}

// StartRun validates the request, assigns a run_id, and publishes to Kafka.
func (s *IngestionServer) StartRun(ctx context.Context, req *ingestionv1.StartRunRequest) (*ingestionv1.StartRunResponse, error) {
	if err := s.authenticate(ctx, req.APIKey); err != nil {
		return nil, err
	}
	if req.ProjectID == "" {
		return nil, status.Error(codes.InvalidArgument, "project_id is required")
	}

	runID := uuid.New().String()
	apiKey := s.resolveAPIKey(ctx, req.APIKey)

	if err := s.producer.PublishStartRun(ctx, apiKey, req, runID); err != nil {
		s.log.Error("failed to publish StartRun", zap.String("run_id", runID), zap.Error(err))
		return nil, status.Errorf(codes.Internal, "ingestion failed: %v", err)
	}

	s.log.Info("run started", zap.String("run_id", runID), zap.String("project_id", req.ProjectID))
	return &ingestionv1.StartRunResponse{
		RunID:      runID,
		Status:     "accepted",
		IngestedAt: time.Now().UTC().Format(time.RFC3339Nano),
	}, nil
}

// AddEvent validates the event, assigns an event_id, and publishes to Kafka.
func (s *IngestionServer) AddEvent(ctx context.Context, req *ingestionv1.AddEventRequest) (*ingestionv1.AddEventResponse, error) {
	if err := s.authenticate(ctx, ""); err != nil {
		return nil, err
	}
	if req.RunID == "" {
		return nil, status.Error(codes.InvalidArgument, "run_id is required")
	}
	if req.EventType == "" {
		return nil, status.Error(codes.InvalidArgument, "event_type is required")
	}
	if req.Status == "" {
		req.Status = "success"
	}

	eventID := uuid.New().String()
	apiKey := s.resolveAPIKey(ctx, "")

	if err := s.producer.PublishAddEvent(ctx, apiKey, req, eventID); err != nil {
		s.log.Error("failed to publish AddEvent", zap.String("run_id", req.RunID), zap.Error(err))
		return nil, status.Errorf(codes.Internal, "ingestion failed: %v", err)
	}

	return &ingestionv1.AddEventResponse{
		EventID:    eventID,
		RunID:      req.RunID,
		IngestedAt: time.Now().UTC().Format(time.RFC3339Nano),
	}, nil
}

// EndRun validates the request and publishes a run-end envelope to Kafka.
func (s *IngestionServer) EndRun(ctx context.Context, req *ingestionv1.EndRunRequest) (*ingestionv1.EndRunResponse, error) {
	if err := s.authenticate(ctx, ""); err != nil {
		return nil, err
	}
	if req.RunID == "" {
		return nil, status.Error(codes.InvalidArgument, "run_id is required")
	}
	if req.Status == "" {
		req.Status = "success"
	}

	apiKey := s.resolveAPIKey(ctx, "")

	if err := s.producer.PublishEndRun(ctx, apiKey, req); err != nil {
		s.log.Error("failed to publish EndRun", zap.String("run_id", req.RunID), zap.Error(err))
		return nil, status.Errorf(codes.Internal, "ingestion failed: %v", err)
	}

	s.log.Info("run ended",
		zap.String("run_id", req.RunID),
		zap.String("status", req.Status),
	)
	return &ingestionv1.EndRunResponse{
		RunID:  req.RunID,
		Status: "accepted",
	}, nil
}

// authenticate checks the X-API-Key in gRPC metadata or the request field.
func (s *IngestionServer) authenticate(ctx context.Context, reqAPIKey string) error {
	key := reqAPIKey
	if key == "" {
		key = s.resolveAPIKey(ctx, "")
	}
	if s.apiKey != "" && key != s.apiKey {
		return status.Error(codes.Unauthenticated, "invalid API key")
	}
	return nil
}

// resolveAPIKey reads from gRPC metadata, falling back to the provided value.
func (s *IngestionServer) resolveAPIKey(ctx context.Context, fallback string) string {
	if md, ok := metadata.FromIncomingContext(ctx); ok {
		if vals := md.Get("x-api-key"); len(vals) > 0 {
			return vals[0]
		}
	}
	if fallback != "" {
		return fallback
	}
	return ""
}

// Validate checks required fields for an AddEventRequest.
func validateAddEvent(req *ingestionv1.AddEventRequest) error {
	validTypes := map[string]bool{
		"agent_start": true, "agent_end": true, "model_call": true,
		"tool_call": true, "retrieval": true, "guardrail_check": true,
		"planner_decision": true, "retry": true, "custom": true,
	}
	if !validTypes[req.EventType] {
		return fmt.Errorf("unknown event_type %q", req.EventType)
	}
	return nil
}
