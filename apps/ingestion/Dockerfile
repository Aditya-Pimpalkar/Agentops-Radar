# ── Build stage ───────────────────────────────────────────────────────────────
FROM golang:1.22-alpine AS builder

RUN apk add --no-cache git ca-certificates

WORKDIR /src

# Cache module downloads
COPY go.mod go.sum ./
RUN go mod download

# Build
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -ldflags "-s -w -X main.version=$(git describe --tags --always 2>/dev/null || echo dev)" \
    -o /bin/ingestion-server ./cmd/server

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM scratch

COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=builder /bin/ingestion-server /ingestion-server

EXPOSE 8080 9090

ENTRYPOINT ["/ingestion-server"]
