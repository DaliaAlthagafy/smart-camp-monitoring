"""Smart Camp Monitoring - FastAPI entrypoint."""

from __future__ import annotations

import base64
import json
import logging
import uuid
from pathlib import Path
from typing import Optional

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

from detector import CATEGORIES, get_detector
from streamer import annotate, encode_jpeg, stream_source, stream_synthetic

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("smartcamp.api")

BASE_DIR = Path(__file__).parent
UPLOAD_DIR = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

app = FastAPI(title="Smart Camp Monitoring", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _banner() -> None:
    det = get_detector()
    line = "=" * 60
    log.info(line)
    if det.mode == "yolo":
        log.info("Smart Camp Monitoring — ACTIVE ENGINE: REAL YOLO")
        log.info("  weights: %s", det.model_path)
    else:
        log.info("Smart Camp Monitoring — ACTIVE ENGINE: MOCK")
        if det._is_lfs_pointer():
            log.info("  reason: model file is a Git-LFS pointer (run `git lfs pull`)")
        elif not det.model_path.exists():
            log.info("  reason: %s not found", det.model_path)
        else:
            log.info("  reason: ultralytics could not load the model")
    log.info(line)


@app.get("/api/health")
def health() -> dict:
    det = get_detector()
    return {
        "status": "ok",
        "detector_mode": det.mode,
        "engine": det.engine_label,
        "model_path": str(det.model_path),
        "model_present": det.model_path.exists(),
        "model_loaded": det.model is not None,
        "is_lfs_pointer": det._is_lfs_pointer(),
        "categories": [
            {"ar": ar, "en": meta["en"], "color": meta["color"]}
            for ar, meta in CATEGORIES.items()
        ],
    }


@app.post("/api/detector/reload")
def reload_detector() -> dict:
    det = get_detector()
    mode = det.reload()
    log.info("detector reloaded: mode=%s engine=%s", mode, det.engine_label)
    return {"mode": mode, "engine": det.engine_label}


# ---------------------------------------------------------------------------
# Single-frame detection (used by the browser webcam loop)
# ---------------------------------------------------------------------------

class FramePayload(BaseModel):
    image: str  # base64-encoded JPEG/PNG, optional data URL prefix
    source: Optional[str] = "webcam"
    annotate: Optional[bool] = False  # browser draws its own overlay by default


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

    detector = get_detector()
    log.info("Current source: %s", payload.source or "webcam")
    detections = detector.predict(frame, source=payload.source or "webcam")
    response = {
        "mode": detector.mode,
        "engine": detector.engine_label,
        "source": payload.source or "webcam",
        "detections": [d.to_dict() for d in detections],
    }
    if payload.annotate:
        response["annotated"] = encode_jpeg(annotate(frame, detections))
    return response


# ---------------------------------------------------------------------------
# Video upload + processing
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
    fps: int = Query(8, ge=1, le=30),
) -> None:
    """Push annotated frames to the client.

    Query params:
        source = synthetic | webcam | rtsp | upload
        value  = device index, RTSP url, or uploaded file id
    """
    await ws.accept()
    log.info("WS connect: source=%s value=%r fps=%d", source, value, fps)
    label_map = {
        "synthetic": "synthetic",
        "webcam":    "webcam_server",
        "rtsp":      "rtsp",
        "upload":    "uploaded_video",
    }
    src_label = label_map.get(source, source)

    try:
        if source == "synthetic":
            gen = stream_synthetic(fps=fps, source_label=src_label)
        elif source == "webcam":
            try:
                idx = int(value) if value else 0
            except (TypeError, ValueError):
                idx = 0
            gen = stream_source(idx, source_label=src_label, fps=fps, loop_video=False)
        elif source == "rtsp":
            if not value:
                await ws.send_text(json.dumps({"type": "error", "message": "missing rtsp url"}))
                await ws.close()
                return
            gen = stream_source(value, source_label=src_label, fps=fps, loop_video=False)
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
            gen = stream_source(str(path), source_label=src_label, fps=fps, loop_video=True)
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
