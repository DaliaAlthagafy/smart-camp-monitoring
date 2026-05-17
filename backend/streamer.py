"""Frame producers for webcam / RTSP / uploaded video sources."""

from __future__ import annotations

import asyncio
import base64
import logging
import time
from pathlib import Path
from typing import AsyncIterator

import cv2
import numpy as np

from detector import Detection, get_registry

log = logging.getLogger("smartcamp.streamer")


def encode_jpeg(frame: np.ndarray, quality: int = 75) -> str:
    ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        return ""
    return base64.b64encode(buf.tobytes()).decode("ascii")


def annotate(frame: np.ndarray, detections: list[Detection]) -> np.ndarray:
    """Server-side OpenCV annotation. The dashboard draws its own
    overlay client-side and disables this by default."""
    h, w = frame.shape[:2]
    out = frame.copy()
    for det in detections:
        x1, y1, x2, y2 = det.bbox
        p1 = (int(x1 * w), int(y1 * h))
        p2 = (int(x2 * w), int(y2 * h))
        color_hex = det.color.lstrip("#")
        b = int(color_hex[4:6], 16)
        g = int(color_hex[2:4], 16)
        r = int(color_hex[0:2], 16)
        cv2.rectangle(out, p1, p2, (b, g, r), 3)
        label = f"{det.model_name}:{det.category_en} {int(det.confidence * 100)}%"
        cv2.putText(
            out, label, (p1[0], max(0, p1[1] - 6)),
            cv2.FONT_HERSHEY_SIMPLEX, 0.6, (b, g, r), 2, cv2.LINE_AA,
        )
    return out


def _build_payload(detections, image_b64: str, frame_idx: int, raw_idx: int,
                   source_label: str) -> dict:
    reg = get_registry()
    return {
        "type": "frame",
        "ts": time.time(),
        "frame_index": frame_idx,
        "raw_index": raw_idx,
        "image": image_b64,
        "detections": [d.to_dict() for d in detections],
        "engine": reg.engine_label(),
        "mode": reg.overall_mode(),
        "active_models": list(reg.active),
        "source": source_label,
    }


async def stream_source(
    source: str | int,
    source_label: str = "unknown",
    fps: int = 8,
    loop_video: bool = True,
    skip: int = 1,
    annotate_server: bool = False,
) -> AsyncIterator[dict]:
    log.info(
        "opening source: label=%s value=%r fps=%d skip=%d annotate_server=%s loop=%s",
        source_label, source, fps, skip, annotate_server, loop_video,
    )
    cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        log.error("cannot open source: %r", source)
        yield {"type": "error", "message": f"cannot open source: {source}"}
        return

    reg = get_registry()
    frame_interval = 1.0 / max(1, fps)
    yield_idx = 0
    raw_idx = 0
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                if loop_video and isinstance(source, str) and Path(source).exists():
                    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    log.info("[%s] looping video back to start", source_label)
                    continue
                log.info("[%s] stream ended", source_label)
                break

            raw_idx += 1
            if skip > 1 and (raw_idx - 1) % skip != 0:
                continue

            yield_idx += 1
            detections = reg.predict_all(frame, source=source_label)
            out_frame = annotate(frame, detections) if annotate_server else frame
            yield _build_payload(
                detections, encode_jpeg(out_frame), yield_idx, raw_idx, source_label,
            )
            await asyncio.sleep(frame_interval)
    finally:
        cap.release()
        log.info(
            "[%s] capture released after %d yields (%d raw frames)",
            source_label, yield_idx, raw_idx,
        )


def synthetic_frame(width: int = 640, height: int = 360) -> np.ndarray:
    frame = np.full((height, width, 3), 18, dtype=np.uint8)
    t = int(time.time()) % 100
    cx = 80 + (int(time.time() * 80) % (width - 160))
    cv2.circle(frame, (cx, height // 2 + 60), 18, (90, 200, 255), -1)
    cv2.putText(
        frame, "SYNTHETIC FEED", (40, height // 2),
        cv2.FONT_HERSHEY_SIMPLEX, 1.1, (90, 200, 255), 2, cv2.LINE_AA,
    )
    cv2.putText(
        frame, f"t={t}", (40, height // 2 + 40),
        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (180, 180, 180), 1, cv2.LINE_AA,
    )
    return frame


async def stream_synthetic(
    fps: int = 4,
    source_label: str = "synthetic",
    annotate_server: bool = False,
) -> AsyncIterator[dict]:
    reg = get_registry()
    interval = 1.0 / max(1, fps)
    frame_idx = 0
    log.info("starting synthetic stream fps=%d annotate_server=%s", fps, annotate_server)
    while True:
        frame_idx += 1
        frame = synthetic_frame()
        detections = reg.predict_all(frame, source=source_label)
        out_frame = annotate(frame, detections) if annotate_server else frame
        yield _build_payload(
            detections, encode_jpeg(out_frame), frame_idx, frame_idx, source_label,
        )
        await asyncio.sleep(interval)
