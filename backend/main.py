"""Smart Camp Monitoring - FastAPI entrypoint."""

from __future__ import annotations

import asyncio
import base64
import json
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
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from detector import CATEGORIES, get_detector
from streamer import annotate, encode_jpeg, stream_source, stream_synthetic

BASE_DIR = Path(__file__).parent
UPLOAD_DIR = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

app = FastAPI(title="Smart Camp Monitoring", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict:
    det = get_detector()
    return {
        "status": "ok",
        "detector_mode": det.mode,
        "model_path": str(det.model_path),
        "model_loaded": det.model is not None,
        "categories": [
            {"ar": ar, "en": meta["en"], "color": meta["color"]}
            for ar, meta in CATEGORIES.items()
        ],
    }


@app.post("/api/detector/reload")
def reload_detector() -> dict:
    mode = get_detector().reload()
    return {"mode": mode}


# ---------------------------------------------------------------------------
# Single-frame detection (used by the browser webcam preview)
# ---------------------------------------------------------------------------

class FramePayload(BaseModel):
    image: str  # base64-encoded JPEG/PNG, optional data URL prefix


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
    detections = detector.predict(frame)
    annotated = annotate(frame, detections)
    return {
        "mode": detector.mode,
        "detections": [d.to_dict() for d in detections],
        "annotated": encode_jpeg(annotated),
    }


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
    try:
        if source == "synthetic" or (source == "webcam" and not value):
            gen = stream_synthetic(fps=fps)
        elif source == "webcam":
            try:
                idx = int(value)
            except (TypeError, ValueError):
                idx = 0
            gen = stream_source(idx, fps=fps, loop_video=False)
        elif source == "rtsp":
            if not value:
                await ws.send_text(json.dumps({"type": "error", "message": "missing rtsp url"}))
                await ws.close()
                return
            gen = stream_source(value, fps=fps, loop_video=False)
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
            gen = stream_source(str(path), fps=fps, loop_video=True)
        else:
            await ws.send_text(json.dumps({"type": "error", "message": f"unknown source {source}"}))
            await ws.close()
            return

        async for payload in gen:
            await ws.send_text(json.dumps(payload))
    except WebSocketDisconnect:
        return
    except Exception as exc:  # surface unexpected failures to the client
        try:
            await ws.send_text(json.dumps({"type": "error", "message": str(exc)}))
        finally:
            await ws.close()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
