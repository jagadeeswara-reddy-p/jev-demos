#!/bin/bash
# Boot script for a short-lived GPU box serving Laya (port 8000) and
# EmbeddingGemma 2 (port 8001), both on the TypeSafe /v1/systemone protocol.
# launch.sh fills in the __PLACEHOLDERS__; keys are never committed.
set -euxo pipefail
exec > >(tee /var/log/jev-setup.log) 2>&1

# Safety net: the instance is launched with shutdown behaviour "terminate".
shutdown -h +__SHUTDOWN_MINUTES__

# ---- Laya: the author's own GPU serving setup ----
git clone --depth 1 https://github.com/NandhaKishorM/laya /opt/laya
(
  cd /opt/laya
  export LAYA_BIND_ADDRESS=0.0.0.0 LAYA_API_KEY=__LAYA_KEY__ \
    LAYA_PRELOAD=1 LAYA_MODELS=typed-decisions LAYA_IDLE_UNLOAD_SECONDS=0 LAYA_MAX_TOKEN_BUDGET=8192
  docker compose -f compose.yaml -f compose.http.yaml -f compose.cuda.yaml up -d --build --wait laya-serve
  echo "LAYA READY"
) &

# ---- EmbeddingGemma 2: a small FastAPI wrapper (deploy/gemma-serve/server.py) ----
mkdir -p /opt/gemma
echo '__GEMMA_SERVER_B64__' | base64 -d > /opt/gemma/server.py
curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh
cd /opt/gemma
uv venv --python 3.12 .venv
uv pip install --python .venv torch --index-url https://download.pytorch.org/whl/cu128
uv pip install --python .venv transformers accelerate safetensors sentence-transformers fastapi "uvicorn[standard]"
cat > /etc/systemd/system/gemma.service <<UNIT
[Unit]
Description=EmbeddingGemma 2 typed-decision server
After=network-online.target

[Service]
WorkingDirectory=/opt/gemma
Environment=GEMMA_API_KEY=__GEMMA_KEY__
Environment=HF_HOME=/opt/gemma/hf
ExecStart=/opt/gemma/.venv/bin/uvicorn server:app --host 0.0.0.0 --port 8001
Restart=on-failure

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now gemma
echo "GEMMA STARTED"

wait
echo "SETUP DONE"
