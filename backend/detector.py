"""Multi-model registry for the Smart Camp Monitoring detectors.

Each registered model owns its weights file, class mapping, and a
mock-fallback path. The registry tracks which models are currently
active and merges detections from all of them, tagging each detection
with its originating ``model_name``.
"""

from __future__ import annotations

import logging
import random
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np

log = logging.getLogger("smartcamp.detector")

MODELS_DIR = Path(__file__).parent / "models"

# Per-category (Arabic) metadata shared with the frontend.
CATEGORIES = {
    "النفايات": {"en": "waste", "color": "#ff5436"},
    "الطعام":   {"en": "food",  "color": "#22d3ee"},
}


@dataclass
class Detection:
    category: str
    category_en: str
    confidence: float
    bbox: List[float]       # [x1, y1, x2, y2] normalized 0..1
    color: str
    model_name: str         # "waste" | "food"

    def to_dict(self) -> dict:
        return asdict(self)


def _is_lfs_pointer(path: Path) -> bool:
    try:
        if not path.exists():
            return False
        if path.stat().st_size > 4096:
            return False
        with path.open("rb") as fh:
            return fh.read(64).startswith(b"version https://git-lfs.github.com/spec")
    except OSError:
        return False


@dataclass
class ModelEntry:
    name: str
    display_ar: str
    display_en: str
    color: str
    model_path: Path
    class_map: Dict[str, str]   # raw class name (lower) -> Arabic category
    model: Any = None
    mode: str = "unavailable"   # "yolo" | "mock" | "unavailable"

    # ------------------------------------------------------------------
    # Loading
    # ------------------------------------------------------------------
    def load(self) -> None:
        self.model = None
        if not self.model_path.exists():
            log.warning("[%s] model file not found at %s — MARKED UNAVAILABLE",
                        self.name, self.model_path)
            self.mode = "unavailable"
            return
        if _is_lfs_pointer(self.model_path):
            log.warning("[%s] %s is a Git-LFS pointer (run `git lfs pull`) — using MOCK",
                        self.name, self.model_path)
            self.mode = "mock"
            return
        try:
            from ultralytics import YOLO  # type: ignore

            self.model = YOLO(str(self.model_path))
            self.mode = "yolo"
            log.info("[%s] loaded real YOLO weights from %s", self.name, self.model_path)
        except Exception as exc:  # pragma: no cover
            log.warning("[%s] could not load YOLO (%s) — using MOCK", self.name, exc)
            self.mode = "mock"

    # ------------------------------------------------------------------
    # Inference
    # ------------------------------------------------------------------
    def predict(self, frame: np.ndarray) -> List[Detection]:
        if self.mode == "unavailable":
            return []
        if self.mode == "yolo":
            return self._predict_yolo(frame)
        return self._predict_mock(frame)

    def _predict_yolo(self, frame: np.ndarray) -> List[Detection]:
        h, w = frame.shape[:2]
        results = self.model.predict(frame, verbose=False, conf=0.35)
        dets: List[Detection] = []
        for r in results:
            names = r.names
            for box in r.boxes:
                cls_id = int(box.cls[0])
                cls_name = names.get(cls_id, str(cls_id)).lower()
                category = self.class_map.get(cls_name)
                if category is None:
                    continue
                meta = CATEGORIES[category]
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                dets.append(Detection(
                    category=category,
                    category_en=meta["en"],
                    confidence=float(box.conf[0]),
                    bbox=[x1 / w, y1 / h, x2 / w, y2 / h],
                    color=meta["color"],
                    model_name=self.name,
                ))
        return dets

    def _predict_mock(self, frame: np.ndarray) -> List[Detection]:
        # Seed by time + model name so each model emits its own boxes.
        rng = random.Random(int(time.time() * 2) + abs(hash(self.name)) % 10_000)
        count = rng.randint(1, 2)
        category = self.display_ar
        meta = CATEGORIES[category]
        dets: List[Detection] = []
        for _ in range(count):
            x1 = rng.uniform(0.05, 0.6)
            y1 = rng.uniform(0.05, 0.6)
            x2 = min(1.0, x1 + rng.uniform(0.15, 0.3))
            y2 = min(1.0, y1 + rng.uniform(0.15, 0.3))
            dets.append(Detection(
                category=category,
                category_en=meta["en"],
                confidence=round(rng.uniform(0.55, 0.95), 2),
                bbox=[x1, y1, x2, y2],
                color=meta["color"],
                model_name=self.name,
            ))
        return dets

    # ------------------------------------------------------------------
    def status_ar(self) -> str:
        if self.mode == "yolo":  return "YOLO فعلي"
        if self.mode == "mock":  return "Mock"
        return "غير متوفر"

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "display_ar": self.display_ar,
            "display_en": self.display_en,
            "color": self.color,
            "mode": self.mode,
            "status_ar": self.status_ar(),
            "available": self.mode != "unavailable",
            "loaded": self.mode == "yolo",
            "model_present": self.model_path.exists(),
            "is_lfs_pointer": _is_lfs_pointer(self.model_path),
            "model_path": str(self.model_path),
        }


class ModelRegistry:
    """Owns all detector model entries and the active-models selection."""

    def __init__(self) -> None:
        self.entries: Dict[str, ModelEntry] = {
            "waste": ModelEntry(
                name="waste",
                display_ar="النفايات",
                display_en="waste",
                color="#ff5436",
                model_path=MODELS_DIR / "waste_model.pt",
                class_map={
                    "waste": "النفايات",
                    "trash": "النفايات",
                    "garbage": "النفايات",
                    "bottle": "النفايات",
                    "plastic": "النفايات",
                },
            ),
            "food": ModelEntry(
                name="food",
                display_ar="الطعام",
                display_en="food",
                color="#22d3ee",
                model_path=MODELS_DIR / "food_model.pt",
                class_map={
                    "food":  "الطعام",
                    "meal":  "الطعام",
                    "tray":  "الطعام",
                    "plate": "الطعام",
                },
            ),
        }
        self.active: List[str] = ["waste"]
        self._load_all()

    # ------------------------------------------------------------------
    def _load_all(self) -> None:
        for e in self.entries.values():
            e.load()
        self._log_active()

    def reload(self) -> None:
        self._load_all()

    # ------------------------------------------------------------------
    def _log_active(self) -> None:
        joined = " + ".join(self.active) if self.active else "(none)"
        log.info("Active models: %s", joined)

    def set_active(self, names: List[str]) -> List[str]:
        cleaned: List[str] = []
        for n in names or []:
            if n not in self.entries:
                log.warning("ignoring unknown model: %s", n)
                continue
            if n in cleaned:
                continue
            cleaned.append(n)
        self.active = cleaned
        self._log_active()
        return self.active

    # ------------------------------------------------------------------
    def statuses(self) -> List[dict]:
        return [e.to_dict() for e in self.entries.values()]

    def overall_mode(self) -> str:
        active = [self.entries[n] for n in self.active if n in self.entries]
        modes = {e.mode for e in active}
        if "yolo" in modes:
            return "yolo"
        if "mock" in modes:
            return "mock"
        return "unavailable"

    def engine_label(self) -> str:
        return {"yolo": "YOLO", "mock": "MOCK", "unavailable": "NONE"}[self.overall_mode()]

    # ------------------------------------------------------------------
    def predict_all(self, frame: np.ndarray, source: str = "unknown") -> List[Detection]:
        merged: List[Detection] = []
        for n in self.active:
            e = self.entries.get(n)
            if e is None or e.mode == "unavailable":
                continue
            engine = "YOLO" if e.mode == "yolo" else "MOCK"
            log.info("[%s] Running %s inference on frame... (source=%s)",
                     e.name, engine, source)
            dets = e.predict(frame)
            log.info("[%s] Detections found: %d", e.name, len(dets))
            merged.extend(dets)
        return merged


_registry: Optional[ModelRegistry] = None


def get_registry() -> ModelRegistry:
    global _registry
    if _registry is None:
        _registry = ModelRegistry()
    return _registry
