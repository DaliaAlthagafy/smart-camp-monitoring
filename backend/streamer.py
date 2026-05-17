"""Frame producers for webcam / RTSP / uploaded video sources."""

from __future__ import annotations

import asyncio
import base64
import time
from pathlib import Path
from typing import AsyncIterator, Optional

import cv2
import numpy as np

from detector import Detection, get_detector


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
    fps: int = 8,
    loop_video: bool = True,
) -> AsyncIterator[dict]:
    """Open an OpenCV source and yield annotated frame payloads."""

    cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        yield {"type": "error", "message": f"cannot open source: {source}"}
        return

    detector = get_detector()
    frame_interval = 1.0 / max(1, fps)
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                if loop_video and isinstance(source, str) and Path(source).exists():
                    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    continue
                break

            detections = detector.predict(frame)
            annotated = annotate(frame, detections)
            yield {
                "type": "frame",
                "ts": time.time(),
                "image": encode_jpeg(annotated),
                "detections": [d.to_dict() for d in detections],
                "mode": detector.mode,
            }
            await asyncio.sleep(frame_interval)
    finally:
        cap.release()


def synthetic_frame(width: int = 640, height: int = 360) -> np.ndarray:
    """Generate a placeholder frame so the UI shows something without a camera."""
    frame = np.full((height, width, 3), 18, dtype=np.uint8)
    t = int(time.time()) % 100
    cv2.putText(
        frame, "MOCK FEED", (40, height // 2),
        cv2.FONT_HERSHEY_SIMPLEX, 1.2, (90, 200, 255), 2, cv2.LINE_AA,
    )
    cv2.putText(
        frame, f"frame {t}", (40, height // 2 + 40),
        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (180, 180, 180), 1, cv2.LINE_AA,
    )
    return frame


async def stream_synthetic(fps: int = 4) -> AsyncIterator[dict]:
    detector = get_detector()
    interval = 1.0 / max(1, fps)
    while True:
        frame = synthetic_frame()
        detections = detector.predict(frame)
        annotated = annotate(frame, detections)
        yield {
            "type": "frame",
            "ts": time.time(),
            "image": encode_jpeg(annotated),
            "detections": [d.to_dict() for d in detections],
            "mode": detector.mode,
        }
        await asyncio.sleep(interval)
