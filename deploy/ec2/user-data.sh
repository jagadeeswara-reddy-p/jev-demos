#!/bin/bash
# Boot script for a short-lived GPU box serving two open decision models on the
# /v1/systemone protocol: Laya (port 8000) and AWS Strands Decider 2B (port 8001).
# launch.sh fills in the double-underscore placeholders; keys are never committed.
# Both install into their own virtualenv at the same time; progress goes to
# /var/log/jev-setup.log and the console, and each server runs under systemd.
set -euxo pipefail
exec > >(tee /var/log/jev-setup.log) 2>&1

# Safety net: the instance is launched with shutdown behaviour "terminate".
shutdown -h +__SHUTDOWN_MINUTES__

curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh

unit() { # name, description, workdir, command, environment lines
  cat > /etc/systemd/system/$1.service <<UNIT
[Unit]
Description=$2
After=network-online.target

[Service]
WorkingDirectory=$3
$5
ExecStart=$4
Restart=on-failure

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  systemctl enable --now $1
}

# ---- Laya (skipped with WITH_LAYA=0) ----
# From PyPI: laya 0.4.8 is the same version as the repository, and installing it
# directly skips the Docker image build (about 12 minutes). fp16 on purpose: Laya's
# docs say it stays closer to fp32 than bf16, and it is what the T4 runs used.
laya() {
  mkdir -p /opt/laya && cd /opt/laya
  uv venv --python 3.12 .venv
  uv pip install --python .venv torch --index-url https://download.pytorch.org/whl/cu128
  uv pip install --python .venv "laya[serve]==__LAYA_VERSION__"
  unit laya "Laya decision server" /opt/laya /opt/laya/.venv/bin/laya-serve \
    "Environment=LAYA_HOST=0.0.0.0 LAYA_PORT=8000 LAYA_DEVICE=cuda LAYA_API_KEY=__LAYA_KEY__ LAYA_CUDA_AMP=fp16 LAYA_PRELOAD=1 LAYA_MODELS=typed-decisions LAYA_IDLE_UNLOAD_SECONDS=0 LAYA_MAX_TOKEN_BUDGET=8192 HF_HOME=/opt/laya/hf"
  echo "LAYA STARTED"
}

# ---- Strands Decider ----
# Pinned to a commit that served this checkpoint: the PyPI release (0.1.0) predates
# the CUDA extra and the qwen3.5 v1 checkpoint. The server has no authentication,
# so the firewall (launch.sh: your IP only) is what protects it. --strict-window
# refuses a prompt longer than the model's window instead of silently cutting it.
strands() {
  mkdir -p /opt/strands && cd /opt/strands
  uv venv --python 3.12 .venv
  uv pip install --python .venv torch --index-url https://download.pytorch.org/whl/cu128
  uv pip install --python .venv "strands-decider[cuda] @ git+https://github.com/strands-labs/strands-decider@__STRANDS_COMMIT__"
  unit strands "AWS Strands Decider decision server" /opt/strands \
    "/opt/strands/.venv/bin/strands-decider serve __STRANDS_MODEL__ --host 0.0.0.0 --port 8001 --device cuda --strict-window" \
    "Environment=HF_HOME=/opt/strands/hf"
  echo "STRANDS STARTED"
}

[ "__WITH_LAYA__" = 1 ] && laya &
strands &
wait
echo "SETUP DONE"
