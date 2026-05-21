BINARY   := ingestion-server
CMD      := ./cmd/server
IMAGE    := agentops-radar/ingestion
TAG      := latest

.PHONY: generate build run test docker-build

# Regenerate gRPC + HTTP-gateway stubs from proto definitions.
# Requires: buf (https://buf.build/docs/installation)
generate:
	buf generate

# Build the binary
build:
	go build -ldflags "-X main.version=$(shell git describe --tags --always)" \
	  -o bin/$(BINARY) $(CMD)

# Run locally (requires Kafka at localhost:9092)
run: build
	KAFKA_BROKERS=localhost:9092 \
	GRPC_PORT=9090 \
	HTTP_PORT=8080 \
	API_KEY=dev-api-key-change-in-production \
	./bin/$(BINARY)

test:
	go test ./... -race -count=1

# Build Docker image
docker-build:
	docker build -t $(IMAGE):$(TAG) .

lint:
	golangci-lint run ./...

tidy:
	go mod tidy
