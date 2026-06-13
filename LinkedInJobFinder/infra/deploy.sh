#!/usr/bin/env bash
# One-shot deploy: Bicep -> resource group -> zip upload.
# Prereq: `az login`. Set APP_NAME (DNS-unique) and RG, or accept defaults below.
set -euo pipefail

APP_NAME="${APP_NAME:-kush-linkedinfinder}"
RG="${RG:-${APP_NAME}-rg}"
LOCATION="${LOCATION:-eastus}"

cd "$(dirname "$0")/.."

USER_OBJECT_ID="$(az ad signed-in-user show --query id -o tsv)"
TENANT_ID="$(az account show --query tenantId -o tsv)"

if [ -f .env ]; then
  set -a; . ./.env; set +a
fi

echo "==> Creating resource group $RG in $LOCATION"
az group create -n "$RG" -l "$LOCATION" -o none

echo "==> Deploying Bicep template (app: $APP_NAME)"
az deployment group create \
  -g "$RG" \
  -f infra/main.bicep \
  -p appName="$APP_NAME" \
     location="$LOCATION" \
     allowedUserObjectId="$USER_OBJECT_ID" \
     tenantId="$TENANT_ID" \
     azureAiEndpoint="${AZURE_AI_ENDPOINT:-}" \
     azureAiDeployment="${AZURE_AI_DEPLOYMENT:-}" \
     azureAiApiKey="${AZURE_AI_API_KEY:-}" \
  -o table

APP_URL="$(az deployment group show -g "$RG" -n main --query properties.outputs.appUrl.value -o tsv)"
BLOB_URL="$(az deployment group show -g "$RG" -n main --query properties.outputs.blobAccountUrl.value -o tsv)"

echo "==> Packaging source"
ZIP="/tmp/${APP_NAME}.zip"
rm -f "$ZIP"
# Exclude local-only state, secrets, browser profile, virtualenvs, caches.
zip -r "$ZIP" . \
  -x "data/*" "resumes/*" "outreach/*" ".env" ".git/*" \
     ".venv/*" "__pycache__/*" "*.pyc" ".pytest_cache/*" \
     "node_modules/*" ".DS_Store"

echo "==> Uploading to App Service"
az webapp deploy \
  -g "$RG" -n "$APP_NAME" \
  --src-path "$ZIP" --type zip \
  -o none

echo ""
echo "Done."
echo "  App URL:    $APP_URL"
echo "  Blob URL:   $BLOB_URL"
echo ""
echo "Add this to your local .env so the daily pipeline mirrors to cloud:"
echo "  BLOB_ACCOUNT_URL=$BLOB_URL"
echo "  BLOB_STATE_CONTAINER=state"
echo "  BLOB_DRAFTS_CONTAINER=drafts"
echo ""
echo "Then test: linkedin-finder daily"
echo "Then open: $APP_URL (sign in with $(az account show --query user.name -o tsv))"
