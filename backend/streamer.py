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


def encode_jpeg(frame: np.ndarray, quality: int = 75) -> str:
    ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        return ""
    return base64.b64encode(buf.tobytes()).decode("ascii")


def annotate(frame: np.ndarray, detections: list[Detection]) -> np.ndarray:
    """Server-side OpenCV annotation. Kept for compatibility; the dashboard
    draws its own (richer) overlay client-side and disables this by default."""
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
        label = f"{det.category_en} {int(det.confidence * 100)}%"
        cv2.putText(
            out, label, (p1[0], max(0, p1[1] - 6)),
            cv2.FONT_HERSHEY_SIMPLEX, 0.6, (b, g, r), 2, cv2.LINE_AA,
        )
    return out


async def stream_source(
    source: str | int,
    source_label: str = "unknown",
    fps: int = 8,
    loop_video: bool = True,
    skip: int = 1,
    annotate_server: bool = False,
) -> AsyncIterator[dict]:
    """Open an OpenCV source and yield frame payloads.

    Parameters:
        skip:            run inference on every Nth read frame (drop the rest).
        annotate_server: when True, burn bboxes into the JPEG. When False
                         (the default) the client draws them on a canvas.
    """
    log.info(
        "opening source: label=%s value=%r fps=%d skip=%d annotate_server=%s loop=%s",
        source_label, source, fps, skip, annotate_server, loop_video,
    )
    cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        log.error("cannot open source: %r", source)
        yield {"type": "error", "message": f"cannot open source: {source}"}
        return

    detector = get_detector()
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
                continue  # skip without sleeping — keeps playback fast

            yield_idx += 1
            detections = detector.predict(frame, source=source_label)
            out_frame = annotate(frame, detections) if annotate_server else frame
            yield {
                "type": "frame",
                "ts": time.time(),
                "frame_index": yield_idx,
                "raw_index": raw_idx,
                "image": encode_jpeg(out_frame),
                "detections": [d.to_dict() for d in detections],
                "mode": detector.mode,
                "engine": detector.engine_label,
                "source": source_label,
            }
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
    detector = get_detector()
    interval = 1.0 / max(1, fps)
    frame_idx = 0
    log.info("starting synthetic stream fps=%d annotate_server=%s", fps, annotate_server)
    while True:
        frame_idx += 1
        frame = synthetic_frame()
        detections = detector.predict(frame, source=source_label)
        out_frame = annotate(frame, detections) if annotate_server else frame
        yield {
            "type": "frame",
            "ts": time.time(),
            "frame_index": frame_idx,
            "image": encode_jpeg(out_frame),
            "detections": [d.to_dict() for d in detections],
            "mode": detector.mode,
            "engine": detector.engine_label,
            "source": source_label,
        }
        await asyncio.sleep(interval)
