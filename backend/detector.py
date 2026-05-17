"""
YOLO-ready detection module.

Loads a real YOLO model from ``backend/models/waste_model.pt`` when
ultralytics + the weights are available. Falls back to deterministic mock
detections so the dashboard works end-to-end before the trained model lands.
"""

from __future__ import annotations

import os
import random
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import List, Optional

import numpy as np

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
        self.mode = "mock"
        self._try_load()

    def _try_load(self) -> None:
        if not self.model_path.exists():
            return
        try:
            from ultralytics import YOLO  # type: ignore

            self.model = YOLO(str(self.model_path))
            self.mode = "yolo"
            print(f"[detector] loaded YOLO weights from {self.model_path}")
        except Exception as exc:  # pragma: no cover - depends on env
            print(f"[detector] could not load YOLO ({exc}); using mock")
            self.model = None
            self.mode = "mock"

    def reload(self) -> str:
        self._try_load()
        return self.mode

    def predict(self, frame: np.ndarray) -> List[Detection]:
        if self.model is not None:
            return self._predict_yolo(frame)
        return self._predict_mock(frame)

    # ------------------------------------------------------------------
    # YOLO inference
    # ------------------------------------------------------------------
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
                    # Skip classes outside the monitored set.
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

    # ------------------------------------------------------------------
    # Mock detections
    # ------------------------------------------------------------------
    def _predict_mock(self, frame: np.ndarray) -> List[Detection]:
        # Seed by time bucket so consecutive frames look stable but evolve.
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
