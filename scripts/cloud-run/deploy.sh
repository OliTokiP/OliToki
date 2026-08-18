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
MODE="${TOKI_DEPLOY_MODE:-api}"
ENV_NAME="${TOKI_ENV:-}"
FORCE_SOURCE="${TOKI_FORCE_SOURCE:-}"
KEY="${TOKI_SA_KEY:-$REPO/secrets/google-service-account.json}"
if [[ -z "$ENV_NAME" ]]; then
  if [[ "$SERVICE" == *testing* ]]; then ENV_NAME=testing
  elif [[ "$MODE" == "web" ]]; then ENV_NAME=testing
  else ENV_NAME=restaurant
  fi
fi
if [[ -z "$FORCE_SOURCE" ]]; then
  if [[ "$ENV_NAME" == "testing" ]]; then FORCE_SOURCE=alpha
  else FORCE_SOURCE=restaurant
  fi
fi

if [[ ! -f "$KEY" ]]; then
  echo "missing service account json: $KEY" >&2
  exit 1
fi

cp "$ROOT/../toki_server.py" "$ROOT/toki_server.py"
STAGE=""
cleanup() {
  rm -f "$ROOT/toki_server.py" "$REPO/Dockerfile"
  if [[ -n "$STAGE" && -d "$STAGE" ]]; then rm -rf "$STAGE"; fi
}
trap cleanup EXIT
if [[ "$MODE" == "web" ]]; then
  STAGE="$("$ROOT/stage-web.sh")"
  SOURCE_DIR="$STAGE"
  API_ONLY=0
  MEMORY="${TOKI_MEMORY:-1Gi}"
  echo "web context $(du -sh "$STAGE" | awk '{print $1}') in $STAGE"
else
  SOURCE_DIR="$ROOT"
  API_ONLY=1
  MEMORY="${TOKI_MEMORY:-512Mi}"
fi

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
  --source "$SOURCE_DIR" \
  --allow-unauthenticated \
  --memory "$MEMORY" \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 2 \
  --timeout 60 \
  --set-env-vars "TOKI_API_ONLY=${API_ONLY},TOKI_ENV=${ENV_NAME},TOKI_FORCE_SOURCE=${FORCE_SOURCE}" \
  --set-secrets "TOKI_SA_JSON=toki-sa-json:latest" \
  --quiet

gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format='value(status.url)'
