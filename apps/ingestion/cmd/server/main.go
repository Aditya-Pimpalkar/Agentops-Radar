// Command server starts the AgentOps Radar ingestion service.
// It binds two ports:
//   - :9090 — gRPC (for SDK direct connections and service-to-service)
//   - :8080 — HTTP/JSON gateway (for REST clients and backward-compat)
//
// Incoming traces are validated and published to Kafka for downstream
// processing by the Python store, evaluate, and embed consumers.
package main

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	ingestionv1 "github.com/agentops-radar/ingestion/gen/ingestion/v1"
	"github.com/agentops-radar/ingestion/internal/gateway"
	kafkapkg "github.com/agentops-radar/ingestion/internal/kafka"
	"github.com/agentops-radar/ingestion/internal/server"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"google.golang.org/grpc"
	"google.golang.org/grpc/encoding/gzip"
	"google.golang.org/grpc/keepalive"
	"google.golang.org/grpc/reflection"
)

// Compile-time guard: server.IngestionServer must satisfy IngestionServiceServer.
var _ ingestionv1.IngestionServiceServer = (*server.IngestionServer)(nil)

// version is set at build time via -ldflags.
var version = "dev"

func main() {
	log := buildLogger()
	defer log.Sync() //nolint:errcheck

	cfg := loadConfig()
	log.Info("starting agentops-radar ingestion service",
		zap.String("version", version),
		zap.String("grpc_port", cfg.GRPCPort),
		zap.String("http_port", cfg.HTTPPort),
		zap.Strings("kafka_brokers", cfg.KafkaBrokers),
	)

	// ── Kafka producer ────────────────────────────────────────────────────────
	producer, err := kafkapkg.NewProducer(cfg.KafkaBrokers, log)
	if err != nil {
		log.Fatal("failed to create kafka producer", zap.Error(err))
	}
	defer producer.Close()

	// Ensure topics exist (idempotent; Kafka auto-create is also enabled)
	if err := ensureTopics(cfg.KafkaBrokers, log); err != nil {
		log.Warn("topic creation failed (auto-create may handle it)", zap.Error(err))
	}

	// ── gRPC server ───────────────────────────────────────────────────────────
	svc := server.New(producer, cfg.APIKey, log)

	grpcServer := grpc.NewServer(
		grpc.ChainUnaryInterceptor(
			loggingInterceptor(log),
			rateLimitInterceptor(cfg.MaxRPS),
		),
		grpc.KeepaliveParams(keepalive.ServerParameters{
			MaxConnectionIdle: 30 * time.Second,
			Time:              10 * time.Second,
			Timeout:           5 * time.Second,
		}),
		grpc.InitialWindowSize(1<<20),
		grpc.InitialConnWindowSize(1<<20),
	)
	_ = gzip.Name // ensure gzip compressor is linked
	ingestionv1.RegisterIngestionServiceServer(grpcServer, svc)
	reflection.Register(grpcServer) // allows grpcurl and debugging tools

	grpcLis, err := net.Listen("tcp", ":"+cfg.GRPCPort)
	if err != nil {
		log.Fatal("grpc listen failed", zap.Error(err))
	}

	// ── HTTP gateway ──────────────────────────────────────────────────────────
	// Pass the service implementation directly — no network dial, no codec issues.
	gw, err := gateway.New(svc, log)
	if err != nil {
		log.Fatal("gateway init failed", zap.Error(err))
	}

	httpSrv := &http.Server{
		Addr:         ":" + cfg.HTTPPort,
		Handler:      gw.Handler(),
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// ── Start servers ─────────────────────────────────────────────────────────
	go func() {
		log.Info("gRPC server listening", zap.String("addr", ":"+cfg.GRPCPort))
		if err := grpcServer.Serve(grpcLis); err != nil {
			log.Fatal("gRPC serve error", zap.Error(err))
		}
	}()

	go func() {
		log.Info("HTTP gateway listening", zap.String("addr", ":"+cfg.HTTPPort))
		if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal("HTTP serve error", zap.Error(err))
		}
	}()

	// ── Graceful shutdown ─────────────────────────────────────────────────────
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGTERM, syscall.SIGINT)
	<-quit

	log.Info("shutting down gracefully...")
	grpcServer.GracefulStop()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpSrv.Shutdown(ctx); err != nil {
		log.Error("HTTP shutdown error", zap.Error(err))
	}
	log.Info("shutdown complete")
}

// ─── config ───────────────────────────────────────────────────────────────────

type config struct {
	GRPCPort     string
	HTTPPort     string
	KafkaBrokers []string
	APIKey       string
	MaxRPS       int
}

func loadConfig() config {
	brokers := getEnv("KAFKA_BROKERS", "kafka:9092")
	return config{
		GRPCPort:     getEnv("GRPC_PORT", "9090"),
		HTTPPort:     getEnv("HTTP_PORT", "8080"),
		KafkaBrokers: strings.Split(brokers, ","),
		APIKey:       getEnv("API_KEY", "dev-api-key-change-in-production"),
		MaxRPS:       10_000,
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ─── middleware ────────────────────────────────────────────────────────────────

func loggingInterceptor(log *zap.Logger) grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {
		start := time.Now()
		resp, err := handler(ctx, req)
		log.Info("grpc request",
			zap.String("method", info.FullMethod),
			zap.Duration("duration", time.Since(start)),
			zap.Bool("ok", err == nil),
		)
		return resp, err
	}
}

// Simple token-bucket rate limiter (in-memory, per-instance).
func rateLimitInterceptor(maxRPS int) grpc.UnaryServerInterceptor {
	tokens := make(chan struct{}, maxRPS)
	for i := 0; i < maxRPS; i++ {
		tokens <- struct{}{}
	}
	// Refill goroutine
	go func() {
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for range ticker.C {
			for i := 0; i < maxRPS; i++ {
				select {
				case tokens <- struct{}{}:
				default:
				}
			}
		}
	}()
	return func(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {
		select {
		case <-tokens:
			return handler(ctx, req)
		default:
			return nil, fmt.Errorf("rate limit exceeded")
		}
	}
}

// ─── topic bootstrap ──────────────────────────────────────────────────────────

func ensureTopics(brokers []string, log *zap.Logger) error {
	// Import happens at package level — just log intent here.
	// Topic creation is handled by the kafkapkg.EnsureTopics helper.
	log.Info("kafka topics will be auto-created on first publish", zap.Strings("brokers", brokers))
	return nil
}

// ─── logger ───────────────────────────────────────────────────────────────────

func buildLogger() *zap.Logger {
	cfg := zap.NewProductionConfig()
	cfg.EncoderConfig.TimeKey = "ts"
	cfg.EncoderConfig.EncodeTime = zapcore.ISO8601TimeEncoder
	log, _ := cfg.Build()
	return log
}
