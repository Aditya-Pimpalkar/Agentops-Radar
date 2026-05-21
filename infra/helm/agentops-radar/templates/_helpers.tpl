{{/*
Expand the name of the chart.
*/}}
{{- define "agentops-radar.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "agentops-radar.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Chart label
*/}}
{{- define "agentops-radar.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "agentops-radar.labels" -}}
helm.sh/chart: {{ include "agentops-radar.chart" . }}
{{ include "agentops-radar.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "agentops-radar.selectorLabels" -}}
app.kubernetes.io/name: {{ include "agentops-radar.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Database URL helper
*/}}
{{- define "agentops-radar.databaseUrl" -}}
postgresql://radar:$(POSTGRES_PASSWORD)@{{ .Release.Name }}-postgresql:5432/agentops_radar
{{- end }}

{{/*
Redis URL helper
*/}}
{{- define "agentops-radar.redisUrl" -}}
redis://{{ .Release.Name }}-redis-master:6379/0
{{- end }}

{{/*
Kafka brokers helper — 3-broker cluster
*/}}
{{- define "agentops-radar.kafkaBrokers" -}}
{{- $release := .Release.Name -}}
{{- printf "%s-kafka-0.%s-kafka-headless:9092,%s-kafka-1.%s-kafka-headless:9092,%s-kafka-2.%s-kafka-headless:9092" $release $release $release $release $release $release }}
{{- end }}
