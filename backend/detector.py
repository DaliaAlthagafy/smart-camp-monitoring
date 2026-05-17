"""
YOLO-ready detection module.

Loads a real YOLO model from ``backend/models/waste_model.pt`` when
ultralytics + the weights are available. Falls back to deterministic mock
detections so the dashboard works end-to-end before the trained model lands.
"""

from __future__ import annotations

import logging
import random
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import List, Optional

import numpy as np

log = logging.getLogger("smartcamp.detector")

MODEL_PATH = Path(__file__).parent / "models" / "waste_model.pt"

# Bilingual category map. Keys are the Arabic labels surfaced in the UI.
CATEGORIES = {
    "النفايات": {"en": "waste", "color": "#ef4444"},
    "الطعام": {"en": "food", "color": "#22c55e"},
}

# Map raw model class names (English) -> Arabic category.
CLASS_TO_CATEGORY = {
    "waste": "النفايات",
    "trash": "النفايات",
    "garbage": "النفايات",
    "bottle": "النفايات",
    "plastic": "النفايات",
    "food": "الطعام",
    "meal": "الطعام",
    "tray": "الطعام",
    "plate": "الطعام",
}


@dataclass
class Detection:
    category: str          # Arabic label
    category_en: str
    confidence: float
    bbox: List[float]      # [x1, y1, x2, y2] normalized 0-1
    color: str

    def to_dict(self) -> dict:
        return asdict(self)


class Detector:
    """Thin wrapper around a YOLO model with a mock fallback."""

    def __init__(self, model_path: Path = MODEL_PATH):
        self.model_path = model_path
        self.model = None
        self.mode = "mock"           # "yolo" or "mock"
        self.engine_label = "MOCK"   # human label for logs / UI
        self._try_load()

    # ------------------------------------------------------------------
    # Loading
    # ------------------------------------------------------------------
    def _is_lfs_pointer(self) -> bool:
        try:
            if self.model_path.stat().st_size > 4096:
                return False
            with self.model_path.open("rb") as fh:
                head = fh.read(64)
            return head.startswith(b"version https://git-lfs.github.com/spec")
        except OSError:
            return False

    def _try_load(self) -> None:
        if not self.model_path.exists():
            log.warning("model file not found at %s — using MOCK", self.model_path)
            self.mode, self.engine_label = "mock", "MOCK"
            return
        if self._is_lfs_pointer():
            log.warning(
                "model file at %s is a Git-LFS pointer (run `git lfs pull`) — using MOCK",
                self.model_path,
            )
            self.model, self.mode, self.engine_label = None, "mock", "MOCK"
            return
        try:
            from ultralytics import YOLO  # type: ignore

            self.model = YOLO(str(self.model_path))
            self.mode, self.engine_label = "yolo", "YOLO"
            log.info("loaded real YOLO weights from %s", self.model_path)
        except Exception as exc:  # pragma: no cover - depends on env
            log.warning("could not load YOLO (%s) — using MOCK", exc)
            self.model, self.mode, self.engine_label = None, "mock", "MOCK"

    def reload(self) -> str:
        self._try_load()
        return self.mode

    # ------------------------------------------------------------------
    # Inference
    # ------------------------------------------------------------------
    def predict(self, frame: np.ndarray, source: str = "unknown") -> List[Detection]:
        if self.model is not None:
            log.info("[%s] Running YOLO inference on frame... (source=%s)", self.engine_label, source)
            dets = self._predict_yolo(frame)
        else:
            log.info("[%s] Running MOCK inference on frame... (source=%s)", self.engine_label, source)
            dets = self._predict_mock(frame)
        log.info("[%s] Detections found: %d", self.engine_label, len(dets))
        return dets

    def _predict_yolo(self, frame: np.ndarray) -> List[Detection]:
        h, w = frame.shape[:2]
        results = self.model.predict(frame, verbose=False, conf=0.35)
        detections: List[Detection] = []
        for r in results:
            names = r.names
            for box in r.boxes:
                cls_id = int(box.cls[0])
                cls_name = names.get(cls_id, str(cls_id)).lower()
                category = CLASS_TO_CATEGORY.get(cls_name)
                if category is None:
                    continue
                meta = CATEGORIES[category]
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                detections.append(
                    Detection(
                        category=category,
                        category_en=meta["en"],
                        confidence=float(box.conf[0]),
                        bbox=[x1 / w, y1 / h, x2 / w, y2 / h],
                        color=meta["color"],
                    )
                )
        return detections

    def _predict_mock(self, frame: np.ndarray) -> List[Detection]:
        rng = random.Random(int(time.time() * 2))
        count = rng.randint(1, 3)
        detections: List[Detection] = []
        labels = list(CATEGORIES.items())
        for _ in range(count):
            category, meta = rng.choice(labels)
            x1 = rng.uniform(0.05, 0.6)
            y1 = rng.uniform(0.05, 0.6)
            x2 = min(1.0, x1 + rng.uniform(0.15, 0.3))
            y2 = min(1.0, y1 + rng.uniform(0.15, 0.3))
            detections.append(
                Detection(
                    category=category,
                    category_en=meta["en"],
                    confidence=round(rng.uniform(0.55, 0.95), 2),
                    bbox=[x1, y1, x2, y2],
                    color=meta["color"],
                )
            )
        return detections


_detector: Optional[Detector] = None


def get_detector() -> Detector:
    global _detector
    if _detector is None:
        _detector = Detector()
    return _detector
