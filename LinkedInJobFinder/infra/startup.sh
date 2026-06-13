#!/usr/bin/env bash
# App Service startup. Installs the package + cloud extras, then runs Streamlit
# on the port App Service expects (WEBSITES_PORT=8000).
set -euo pipefail

cd "$(dirname "$0")/.."

pip install --upgrade pip
pip install -e .[cloud]

exec streamlit run src/linkedin_finder/ui/app.py \
  --server.port "${PORT:-8000}" \
  --server.address 0.0.0.0 \
  --server.headless true \
  --browser.gatherUsageStats false
