#!/usr/bin/env bash
# deploy-local.sh — provision a local kind cluster and deploy AgentOps Radar v2
#
# Prerequisites:
#   brew install kind kubectl helm docker
#   export OPENAI_API_KEY=sk-...   (optional; embedding + LLM judge)
#
# Usage:
#   chmod +x infra/deploy-local.sh
#   ./infra/deploy-local.sh

set -euo pipefail

CLUSTER_NAME="radar"
CHART_DIR="$(dirname "$0")/helm/agentops-radar"
RELEASE_NAME="radar"
NAMESPACE="agentops"

log() { echo -e "\033[1;34m▶ $*\033[0m"; }
ok()  { echo -e "\033[1;32m✓ $*\033[0m"; }

# ── 1. kind cluster ────────────────────────────────────────────────────────────
log "Creating kind cluster '$CLUSTER_NAME'..."
if kind get clusters 2>/dev/null | grep -q "^${CLUSTER_NAME}$"; then
  ok "Cluster '$CLUSTER_NAME' already exists"
else
  kind create cluster --name "$CLUSTER_NAME" \
    --config "$(dirname "$0")/k8s/kind-config.yaml"
  ok "Cluster created"
fi

kubectl config use-context "kind-${CLUSTER_NAME}"

# ── 2. Ingress-NGINX ───────────────────────────────────────────────────────────
log "Installing ingress-nginx..."
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml
kubectl wait --namespace ingress-nginx \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/component=controller \
  --timeout=120s
ok "ingress-nginx ready"

# ── 3. KEDA (Kafka-lag-based autoscaling) ─────────────────────────────────────
log "Installing KEDA..."
helm repo add kedacore https://kedacore.github.io/charts 2>/dev/null || true
helm repo update kedacore 2>/dev/null || true
helm upgrade --install keda kedacore/keda \
  --namespace keda --create-namespace \
  --wait --timeout 120s
ok "KEDA ready"

# ── 4. Add bitnami repo for postgres / redis / kafka subcharts ────────────────
log "Adding Helm repos..."
helm repo add bitnami https://charts.bitnami.com/bitnami 2>/dev/null || true
helm repo update bitnami 2>/dev/null || true

# ── 5. Build local Docker images and load into kind ───────────────────────────
log "Building Docker images..."
ROOT="$(dirname "$0")/.."
docker build -t agentops-radar/ingestion:2.0.0 "${ROOT}/apps/ingestion"
docker build -t agentops-radar/api:2.0.0         "${ROOT}/apps/api"
docker build -t agentops-radar/worker:2.0.0      "${ROOT}/apps/worker"
docker build -t agentops-radar/dashboard:2.0.0   "${ROOT}/apps/dashboard"

log "Loading images into kind cluster..."
for img in ingestion api worker dashboard; do
  kind load docker-image "agentops-radar/${img}:2.0.0" --name "$CLUSTER_NAME"
done
ok "Images loaded"

# ── 6. Deploy with Helm ────────────────────────────────────────────────────────
log "Creating namespace ${NAMESPACE}..."
kubectl create namespace "$NAMESPACE" 2>/dev/null || true

log "Deploying AgentOps Radar v2..."
helm upgrade --install "$RELEASE_NAME" "$CHART_DIR" \
  --namespace "$NAMESPACE" \
  --values "${CHART_DIR}/values.yaml" \
  --values "${CHART_DIR}/values-local.yaml" \
  --set "secrets.openaiApiKey=${OPENAI_API_KEY:-}" \
  --set "ingestion.image.pullPolicy=Never" \
  --set "api.image.pullPolicy=Never" \
  --set "worker.image.pullPolicy=Never" \
  --set "dashboard.image.pullPolicy=Never" \
  --set "consumers.store.image.pullPolicy=Never" \
  --set "consumers.eval.image.pullPolicy=Never" \
  --set "consumers.embed.image.pullPolicy=Never" \
  --wait --timeout 600s

ok "Deployment complete!"
echo ""
echo "  Dashboard : http://radar.local    (add '127.0.0.1 radar.local' to /etc/hosts)"
echo "  API       : http://radar.local/api"
echo "  gRPC      : grpc://radar.local/v1/ingest"
echo ""
echo "  Watch pods : kubectl get pods -n ${NAMESPACE} -w"
echo "  Helm status: helm status ${RELEASE_NAME} -n ${NAMESPACE}"
