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

from detector import Detection, get_detector

log = logging.getLogger("smartcamp.streamer")


def encode_jpeg(frame: np.ndarray, quality: int = 70) -> str:
    ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        return ""
    return base64.b64encode(buf.tobytes()).decode("ascii")


def annotate(frame: np.ndarray, detections: list[Detection]) -> np.ndarray:
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
        cv2.rectangle(out, p1, p2, (b, g, r), 2)
        label = f"{det.category_en} {int(det.confidence * 100)}%"
        cv2.putText(
            out, label, (p1[0], max(0, p1[1] - 6)),
            cv2.FONT_HERSHEY_SIMPLEX, 0.5, (b, g, r), 1, cv2.LINE_AA,
        )
    return out


async def stream_source(
    source: str | int,
    source_label: str = "unknown",
    fps: int = 8,
    loop_video: bool = True,
) -> AsyncIterator[dict]:
    """Open an OpenCV source and yield annotated frame payloads."""

    log.info("opening source: label=%s value=%r fps=%d loop=%s",
             source_label, source, fps, loop_video)
    cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        log.error("cannot open source: %r", source)
        yield {"type": "error", "message": f"cannot open source: {source}"}
        return

    detector = get_detector()
    frame_interval = 1.0 / max(1, fps)
    frame_idx = 0
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

            frame_idx += 1
            detections = detector.predict(frame, source=source_label)
            annotated = annotate(frame, detections)
            yield {
                "type": "frame",
                "ts": time.time(),
                "frame_index": frame_idx,
                "image": encode_jpeg(annotated),
                "detections": [d.to_dict() for d in detections],
                "mode": detector.mode,
                "engine": detector.engine_label,
                "source": source_label,
            }
            await asyncio.sleep(frame_interval)
    finally:
        cap.release()
        log.info("[%s] capture released after %d frames", source_label, frame_idx)


def synthetic_frame(width: int = 640, height: int = 360) -> np.ndarray:
    """Generate a placeholder frame so the UI shows something without a camera."""
    frame = np.full((height, width, 3), 18, dtype=np.uint8)
    t = int(time.time()) % 100
    # Moving element so the user can SEE the stream is live, not stuck.
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


async def stream_synthetic(fps: int = 4, source_label: str = "synthetic") -> AsyncIterator[dict]:
    detector = get_detector()
    interval = 1.0 / max(1, fps)
    frame_idx = 0
    log.info("starting synthetic stream fps=%d", fps)
    while True:
        frame_idx += 1
        frame = synthetic_frame()
        detections = detector.predict(frame, source=source_label)
        annotated = annotate(frame, detections)
        yield {
            "type": "frame",
            "ts": time.time(),
            "frame_index": frame_idx,
            "image": encode_jpeg(annotated),
            "detections": [d.to_dict() for d in detections],
            "mode": detector.mode,
            "engine": detector.engine_label,
            "source": source_label,
        }
        await asyncio.sleep(interval)
