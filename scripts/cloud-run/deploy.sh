#!/bin/bash
# Deploy toki_server to Cloud Run in project menudesigner.
# Usage: from this directory, after `gcloud auth login`:
#   ./deploy.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$ROOT/../.." && pwd)"
PROJECT="${TOKI_GCP_PROJECT:-menudesigner}"
REGION="${TOKI_GCP_REGION:-us-central1}"
SERVICE="${TOKI_GCP_SERVICE:-toki-api}"
KEY="${TOKI_SA_KEY:-$REPO/secrets/google-service-account.json}"

if [[ ! -f "$KEY" ]]; then
  echo "missing service account json: $KEY" >&2
  exit 1
fi

cp "$ROOT/../toki_server.py" "$ROOT/toki_server.py"
trap 'rm -f "$ROOT/toki_server.py"' EXIT

gcloud config set project "$PROJECT"
gcloud services enable run.googleapis.com secretmanager.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com --project "$PROJECT"

if ! gcloud secrets describe toki-sa-json --project "$PROJECT" >/dev/null 2>&1; then
  gcloud secrets create toki-sa-json --project "$PROJECT" --replication-policy=automatic
fi
gcloud secrets versions add toki-sa-json --project "$PROJECT" --data-file="$KEY"

PROJ_NUM="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
COMPUTE_SA="${PROJ_NUM}-compute@developer.gserviceaccount.com"
gcloud secrets add-iam-policy-binding toki-sa-json \
  --project "$PROJECT" \
  --member="serviceAccount:${COMPUTE_SA}" \
  --role="roles/secretmanager.secretAccessor" >/dev/null

gcloud run deploy "$SERVICE" \
  --project "$PROJECT" \
  --region "$REGION" \
  --source "$ROOT" \
  --allow-unauthenticated \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 2 \
  --timeout 60 \
  --set-env-vars "TOKI_API_ONLY=1" \
  --set-secrets "TOKI_SA_JSON=toki-sa-json:latest" \
  --quiet

gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format='value(status.url)'
