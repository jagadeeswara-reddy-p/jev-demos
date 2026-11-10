# Self-hosting Laya and Strands Decider

Two of the decision models have open weights and run on hardware you provide:

- [Laya](https://github.com/NandhaKishorM/laya) (ConvAI Innovations, Apache 2.0): a
  421M-parameter ModernBERT encoder. Its `laya-serve` speaks the same `/v1/systemone` API as Jev.
- [AWS Strands Decider 2B](https://github.com/strands-labs/strands-decider) (Apache 2.0):
  a 1.9B model on Qwen3.5-2B. Its `strands-decider serve` speaks the same API.

Both plug into the Decision adapter unchanged; `models.json` reads their addresses
from `LAYA_BASE_URL` and `STRANDS_BASE_URL`.

## On AWS: a short-lived GPU box (recommended)

```sh
deploy/ec2/launch.sh        # g5.xlarge, NVIDIA A10G, $1.006/hour on demand in us-east-1
deploy/ec2/wait-ready.sh    # waits until both answer real moves (about 4 minutes)
bun dev                     # restart so the page uses the new address
deploy/ec2/teardown.sh      # when you're done
```

- `launch.sh` installs Laya 0.4.8 and Strands Decider (pinned commit) side by side,
  each in its own virtualenv, opens ports 8000, 8001 and 22 to your current IP
  only, writes `LAYA_*` and `STRANDS_*` into `.env`, and has the box **delete itself
  after one hour**. Pass other minutes as the first argument; `WITH_LAYA=0` serves
  Strands only. It needs AWS credentials in `.env` and checks them first.
- `wait-ready.sh` waits for real answers, not just health checks: Strands compiles
  its GPU kernels on its first requests, which takes 30–60 seconds, longer than the
  arena's timeout. It sends warm-up moves first, prints setup errors from the box's
  boot log as they appear, and ends with a test move through the arena's adapters.
- `teardown.sh` removes the box sooner, and cleans up (firewall rule, SSH key, `.env`
  settings) after one that already deleted itself.
- Debugging: `ssh -i .ec2-key.pem ubuntu@$EC2_IP`, then `journalctl -u laya -u strands`
  or `/var/log/jev-setup.log`.
- Strands Decider needs an Ampere or newer GPU (bf16 and Triton kernels). For Laya
  alone, `INSTANCE_TYPE=g4dn.xlarge` (T4, $0.526/hour) works.
- Strands Decider's server has no authentication; the firewall rule is what protects it.
  If your public IP is shared (a company or mobile-carrier NAT), everyone behind it can
  reach both servers while the box is up.
- The scripts need bash 4+ and GNU tools: Linux, or WSL on Windows. They check this
  before creating anything. Box, firewall rule and key are named per AWS user, so people
  sharing an account don't touch each other's.
- When the box is gone (deleted on its timer or by `teardown.sh`), Laya and Strands
  show as unavailable ("Not responding at …") within a couple of seconds: their
  `models.json` entries set `healthCheck: "/health"`, so the server pings them
  instead of letting every move wait out the 30-second timeout.

## On your own machine

Laya runs on a CPU (hundreds of milliseconds per move) or any CUDA GPU:

```sh
python -m venv .venv && .venv/bin/pip install "laya[serve]==0.4.8"
LAYA_MODELS=typed-decisions LAYA_PRELOAD=1 LAYA_PORT=8000 .venv/bin/laya-serve
```

Strands Decider needs a recent NVIDIA GPU, an Apple-silicon Mac (`--device mlx` or
`mps`) or a CPU (seconds per move). Install from GitHub, not PyPI: the PyPI release
0.1.0 is older than this checkpoint.

```sh
python -m venv .venv && .venv/bin/pip install "strands-decider @ git+https://github.com/strands-labs/strands-decider@b9fc83626bcca822d00f822d6c2e151b8d244ee9"
.venv/bin/strands-decider serve StrandsAgents/strands-decider-2B-qwen3.5-v1-2610 --port 8001 --strict-window
```

Then in `.env`:

```
LAYA_BASE_URL=http://localhost:8000
STRANDS_BASE_URL=http://localhost:8001
LAYA_HOST_NOTE=self-hosted, CPU        # shown on the board
STRANDS_HOST_NOTE=self-hosted, M3 Mac
```

Restart `bun dev`, tick them in the Models panel and press **Test**.

## Before reading their numbers

- **Hardware is part of their latency.** Jev and Clef run on their providers'
  servers; these run on whatever you give them. Say which in the host notes, so it
  shows on the board.
- **Laya gets a larger token budget and four rotations** (`models.json`). At its
  default budget each of 34 options would be cut to about 7 tokens without a
  warning; rotations halve its preference for the first options. Neither makes it
  good at Tetris: see [findings.md](findings.md#laya).
- **Strands Decider gets no rotations**: its server ignores `option_order`, and it
  shows no position bias. See [findings.md](findings.md#strands-decider).

## Lessons from deploying

What went wrong the first time, and what `deploy/ec2/` now does about it:

| What happened | Fix |
|---|---|
| `pip install strands-decider` installed 0.1.0 from PyPI, older than the repository, and the server never started | Strands is pinned to a known-good commit; Laya to 0.4.8, which matches its repository |
| Laya's Docker image took 12 minutes to build on every launch | Laya is installed from PyPI into its own virtualenv, next to Strands: both are ready in about 4 minutes |
| Strands' first moves took 30–60 s while Triton compiled its kernels, longer than the arena's timeout | `wait-ready.sh` sends real warm-up moves before calling a model ready |
| A passing health check didn't mean a model could answer; one failure went unnoticed for 20 minutes | `wait-ready.sh` waits for real answers, and prints errors from the boot log as they appear |
| There was no way to log in to a failing box | A throwaway SSH key, with port 22 open to your current IP only; teardown removes both |
| Strands needs bf16 and Triton kernels, which the T4 lacks | g5.xlarge (A10G, $1.006/hour) by default; the T4 only for Laya alone |
| The firewall kept a previous IP's access after the address changed | Every launch clears old rules |
| Laya could silently fall back to the CPU | `LAYA_DEVICE=cuda`, so it fails loudly instead |
| Temporary AWS credentials expired between sessions | `launch.sh` checks them first |
