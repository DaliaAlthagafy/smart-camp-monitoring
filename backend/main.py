"""Smart Camp Monitoring - FastAPI entrypoint."""

from __future__ import annotations

import base64
import json
import logging
import uuid
from pathlib import Path
from typing import List, Optional

import cv2
import numpy as np
from fastapi import (
    FastAPI,
    File,
    HTTPException,
    Query,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from detector import CATEGORIES, get_registry
from streamer import annotate, encode_jpeg, stream_source, stream_synthetic

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("smartcamp.api")

BACKEND_VERSION = "mask-debug-v11"

BASE_DIR = Path(__file__).parent
UPLOAD_DIR = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

app = FastAPI(title="Smart Camp Monitoring", version=BACKEND_VERSION)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _banner() -> None:
    reg = get_registry()
    line = "=" * 60
    log.info(line)
    log.info("Smart Camp Monitoring — BACKEND VERSION: %s", BACKEND_VERSION)
    log.info("Registered models:")
    for s in reg.statuses():
        resolved = s.get("resolved_path") or "(none)"
        canonical = s["model_path"]
        using = Path(resolved).name if resolved != "(none)" else "—"
        legacy_note = ""
        if resolved != "(none)" and resolved != canonical:
            legacy_note = " [via legacy filename]"
        log.info(
            "  - %-9s (%s): mode=%-11s using=%s%s",
            s["name"], s["display_ar"], s["mode"], using, legacy_note,
        )
    log.info("Active models: %s", " + ".join(reg.active) or "(none)")
    log.info(line)


# ---------------------------------------------------------------------------
# Health & model management
# ---------------------------------------------------------------------------

@app.get("/api/health")
def health() -> dict:
    reg = get_registry()
    return {
        "status": "ok",
        "version": BACKEND_VERSION,
        "engine": reg.engine_label(),
        "overall_mode": reg.overall_mode(),
        "active_models": list(reg.active),
        "models": reg.statuses(),
        "categories": [
            {"ar": ar, "en": m["en"], "color": m["color"]}
            for ar, m in CATEGORIES.items()
        ],
    }


@app.get("/api/models")
def list_models() -> dict:
    reg = get_registry()
    return {"active_models": list(reg.active), "models": reg.statuses()}


class ModelSelectPayload(BaseModel):
    active_models: List[str]


@app.post("/api/models/select")
def select_models(payload: ModelSelectPayload) -> dict:
    reg = get_registry()
    reg.set_active(payload.active_models)
    return {
        "active_models": list(reg.active),
        "models": reg.statuses(),
        "engine": reg.engine_label(),
    }


@app.post("/api/detector/reload")
def reload_detector() -> dict:
    reg = get_registry()
    reg.reload()
    return {
        "engine": reg.engine_label(),
        "active_models": list(reg.active),
        "models": reg.statuses(),
    }


# ---------------------------------------------------------------------------
# Single-frame detection
# ---------------------------------------------------------------------------

class FramePayload(BaseModel):
    image: str
    source: Optional[str] = "webcam"
    annotate: Optional[bool] = False


@app.post("/api/detect/frame")
def detect_frame(payload: FramePayload) -> dict:
    data = payload.image
    if "," in data:
        data = data.split(",", 1)[1]
    try:
        raw = base64.b64decode(data)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"bad base64: {exc}")

    arr = np.frombuffer(raw, dtype=np.uint8)
    frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if frame is None:
        raise HTTPException(status_code=400, detail="cannot decode image")

    reg = get_registry()
    log.info("Current source: %s", payload.source or "webcam")
    detections = reg.predict_all(frame, source=payload.source or "webcam")
    response = {
        "engine": reg.engine_label(),
        "active_models": list(reg.active),
        "source": payload.source or "webcam",
        "detections": [d.to_dict() for d in detections],
    }
    if payload.annotate:
        response["annotated"] = encode_jpeg(annotate(frame, detections))
    return response


# ---------------------------------------------------------------------------
# Upload + WebSocket stream
# ---------------------------------------------------------------------------

@app.post("/api/upload")
async def upload_video(file: UploadFile = File(...)) -> dict:
    suffix = Path(file.filename or "video.mp4").suffix or ".mp4"
    name = f"{uuid.uuid4().hex}{suffix}"
    dest = UPLOAD_DIR / name
    with dest.open("wb") as fh:
        while chunk := await file.read(1 << 20):
            fh.write(chunk)
    log.info("uploaded video saved: %s (%d bytes)", dest, dest.stat().st_size)
    return {"id": name, "path": str(dest)}


@app.websocket("/ws/stream")
async def stream(
    ws: WebSocket,
    source: str = Query("synthetic"),
    value: Optional[str] = Query(None),
    fps: int = Query(8, ge=1, le=60),
    speed: float = Query(1.0, ge=0.25, le=8.0),
    skip: int = Query(1, ge=1, le=10),
    annotate: bool = Query(False),
) -> None:
    await ws.accept()
    effective_fps = max(1, min(240, int(round(fps * speed))))
    log.info(
        "WS connect: source=%s value=%r fps=%d speed=%.2fx skip=%d "
        "annotate=%s -> effective_fps=%d",
        source, value, fps, speed, skip, annotate, effective_fps,
    )
    label_map = {
        "synthetic": "synthetic",
        "webcam":    "webcam_server",
        "rtsp":      "rtsp",
        "upload":    "uploaded_video",
    }
    src_label = label_map.get(source, source)

    try:
        if source == "synthetic":
            gen = stream_synthetic(
                fps=effective_fps, source_label=src_label, annotate_server=annotate,
            )
        elif source == "webcam":
            try:
                idx = int(value) if value else 0
            except (TypeError, ValueError):
                idx = 0
            gen = stream_source(
                idx, source_label=src_label, fps=effective_fps, loop_video=False,
                skip=skip, annotate_server=annotate,
            )
        elif source == "rtsp":
            if not value:
                await ws.send_text(json.dumps({"type": "error", "message": "missing rtsp url"}))
                await ws.close()
                return
            gen = stream_source(
                value, source_label=src_label, fps=effective_fps, loop_video=False,
                skip=skip, annotate_server=annotate,
            )
        elif source == "upload":
            if not value:
                await ws.send_text(json.dumps({"type": "error", "message": "missing upload id"}))
                await ws.close()
                return
            path = UPLOAD_DIR / value
            if not path.exists():
                await ws.send_text(json.dumps({"type": "error", "message": "upload not found"}))
                await ws.close()
                return
            gen = stream_source(
                str(path), source_label=src_label, fps=effective_fps, loop_video=True,
                skip=skip, annotate_server=annotate,
            )
        else:
            await ws.send_text(json.dumps({"type": "error", "message": f"unknown source {source}"}))
            await ws.close()
            return

        async for payload in gen:
            await ws.send_text(json.dumps(payload))
    except WebSocketDisconnect:
        log.info("WS disconnect: source=%s", src_label)
        return
    except Exception as exc:
        log.exception("WS error on source=%s", src_label)
        try:
            await ws.send_text(json.dumps({"type": "error", "message": str(exc)}))
        finally:
            await ws.close()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
