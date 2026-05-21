package kafka

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	ingestionv1 "github.com/agentops-radar/ingestion/gen/ingestion/v1"
	"github.com/twmb/franz-go/pkg/kgo"
	"go.uber.org/zap"
)

const (
	TopicRunStart  = "trace.run.start"
	TopicEventAdd  = "trace.event.add"
	TopicRunEnd    = "trace.run.end"
)

// Producer wraps a franz-go Kafka client and publishes ingestion envelopes.
type Producer struct {
	client *kgo.Client
	log    *zap.Logger
}

// NewProducer creates a new Kafka producer connected to the given brokers.
func NewProducer(brokers []string, log *zap.Logger) (*Producer, error) {
	client, err := kgo.NewClient(
		kgo.SeedBrokers(brokers...),
		kgo.RecordPartitioner(kgo.StickyKeyPartitioner(nil)),
		kgo.ProducerBatchMaxBytes(1_000_000),
		kgo.ProducerLinger(5*time.Millisecond), // small linger for throughput
		kgo.RequiredAcks(kgo.AllISRAcks()), // idempotent producer requires acks=all
	)
	if err != nil {
		return nil, fmt.Errorf("kafka producer init: %w", err)
	}
	return &Producer{client: client, log: log}, nil
}

// Close flushes in-flight records and closes the underlying client.
func (p *Producer) Close() {
	if err := p.client.Flush(context.Background()); err != nil {
		p.log.Warn("kafka flush on close", zap.Error(err))
	}
	p.client.Close()
}

// PublishStartRun publishes a StartRunRequest payload to trace.run.start.
func (p *Producer) PublishStartRun(ctx context.Context, apiKey string, req *ingestionv1.StartRunRequest, runID string) error {
	return p.publish(ctx, TopicRunStart, runID, apiKey, map[string]interface{}{
		"run_id":     runID,
		"project_id": req.ProjectID,
		"agent_id":   req.AgentID,
		"input":      req.Input,
	})
}

// PublishAddEvent publishes an AddEventRequest payload to trace.event.add.
func (p *Producer) PublishAddEvent(ctx context.Context, apiKey string, req *ingestionv1.AddEventRequest, eventID string) error {
	return p.publish(ctx, TopicEventAdd, req.RunID, apiKey, map[string]interface{}{
		"event_id":       eventID,
		"run_id":         req.RunID,
		"event_type":     req.EventType,
		"name":           req.Name,
		"input":          req.Input,
		"output":         req.Output,
		"metadata":       req.Metadata,
		"latency_ms":     req.LatencyMs,
		"status":         req.Status,
		"error_message":  req.ErrorMessage,
		"parent_event_id": req.ParentEventID,
	})
}

// PublishEndRun publishes an EndRunRequest payload to trace.run.end.
func (p *Producer) PublishEndRun(ctx context.Context, apiKey string, req *ingestionv1.EndRunRequest) error {
	return p.publish(ctx, TopicRunEnd, req.RunID, apiKey, map[string]interface{}{
		"run_id":             req.RunID,
		"final_output":       req.FinalOutput,
		"status":             req.Status,
		"confidence_score":   req.ConfidenceScore,
		"total_tokens":       req.TotalTokens,
		"estimated_cost_usd": req.EstimatedCostUSD,
	})
}

func (p *Producer) publish(ctx context.Context, topic, key, apiKey string, payload interface{}) error {
	envelope := ingestionv1.KafkaEnvelope{
		MessageID: uuid.New().String(),
		Topic:     topic,
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		APIKey:    apiKey,
		Payload:   payload,
	}
	data, err := json.Marshal(envelope)
	if err != nil {
		return fmt.Errorf("marshal envelope: %w", err)
	}

	record := &kgo.Record{
		Topic: topic,
		Key:   []byte(key),
		Value: data,
	}

	// ProduceSync blocks until the record is acknowledged by Kafka.
	results := p.client.ProduceSync(ctx, record)
	if err := results.FirstErr(); err != nil {
		p.log.Error("kafka produce failed",
			zap.String("topic", topic),
			zap.String("key", key),
			zap.Error(err),
		)
		return fmt.Errorf("kafka produce: %w", err)
	}
	p.log.Debug("published to kafka",
		zap.String("topic", topic),
		zap.String("key", key),
	)
	return nil
}
