"""EmbeddingGemma 2 typed-decision model behind the TypeSafe /v1/systemone protocol.

mrm8488/embeddinggemma-2-ft-typed-decision (Apache-2.0, 0.3B) answers typed
questions about a state with calibrated probabilities, the same contract Jev
and Laya serve, so the arena talks to it with the same adapter.

    GEMMA_API_KEY=... uvicorn server:app --host 0.0.0.0 --port 8001

Request:  {"model": "...", "state": str | dict, "questions": {id: {type, instructions, criteria, option_order?}}}
Response: {"model": "...", "answers": {id: {type, choice, probabilities, confidence}},
           "usage": {"input_tokens": n, "output_tokens": 0}}
"""

import os
import time

import torch
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel
from transformers import AutoModel, AutoTokenizer

MODEL_ID = os.environ.get("GEMMA_MODEL_ID", "mrm8488/embeddinggemma-2-ft-typed-decision")
API_KEY = os.environ.get("GEMMA_API_KEY", "")
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

# float32 on purpose: the model card says float16 returns NaNs, and bfloat16
# needs an Ampere or newer GPU (the T4 is Turing).
model = AutoModel.from_pretrained(MODEL_ID, trust_remote_code=True, torch_dtype=torch.float32).to(DEVICE).eval()
try:
    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, trust_remote_code=True)
except Exception:  # token counts are only for the cost column
    tokenizer = None

app = FastAPI(title="embeddinggemma-serve")


class Request(BaseModel):
    model: str | None = None
    state: str | dict | list
    questions: dict[str, dict]


def presented(question: dict) -> dict:
    """Applies `option_order` (slot s shows option option_order[s]) by reordering the criteria,
    as laya-serve does, so the arena can rotate options to cancel a position bias."""
    order = question.get("option_order")
    q = {k: v for k, v in question.items() if k != "option_order"}
    criteria = q.get("criteria")
    if order is None or not isinstance(criteria, dict):
        return q
    items = list(criteria.items())
    if sorted(order) != list(range(len(items))):
        raise HTTPException(status_code=422, detail="option_order must be a permutation of the option indices")
    q["criteria"] = dict(items[i] for i in order)
    return q


def check_key(authorization: str | None = Header(default=None)):
    if API_KEY and authorization != f"Bearer {API_KEY}":
        raise HTTPException(status_code=401, detail="Missing or wrong bearer token")


@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL_ID, "device": DEVICE}


@app.post("/v1/systemone", dependencies=[Depends(check_key)])
def systemone(req: Request):
    # decide() flattens a dict into "key: value" lines; wrap plain text so it reads as one field.
    state = req.state if isinstance(req.state, dict) else {"state": req.state}
    started = time.perf_counter()
    with torch.inference_mode():
        answers = model.decide(state, {qid: presented(q) for qid, q in req.questions.items()})
    elapsed_ms = (time.perf_counter() - started) * 1000

    out = {}
    for qid, a in answers.items():
        d = a.to_dict() if hasattr(a, "to_dict") else dict(a)
        kind = d.get("kind", req.questions[qid].get("type"))
        entry = {"type": kind, "probabilities": d.get("probabilities"), "confidence": d.get("confidence")}
        if kind == "choice":
            entry["choice"] = d.get("label", d.get("value"))
        else:
            entry["value"] = d.get("value")
        out[qid] = entry

    text = str(req.state) + "".join(str(q) for q in req.questions.values())
    input_tokens = len(tokenizer(text)["input_ids"]) if tokenizer else 0
    return {
        "model": MODEL_ID,
        "answers": out,
        "usage": {"input_tokens": input_tokens, "output_tokens": 0, "model_ms": round(elapsed_ms, 1)},
    }
