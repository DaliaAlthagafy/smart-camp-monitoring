"""Multi-model registry for the Smart Camp Monitoring detectors.

Models registered:
    waste     -> النفايات
    food      -> الطعام
    gloves    -> قفازات / بدون قفازات
    mask      -> كمامة / بدون كمامة
    headcover -> غطاء رأس / بدون غطاء رأس

Each entry loads independently; a missing or broken weights file makes
only that single model "unavailable" — the rest keep working.
"""

from __future__ import annotations

import logging
import random
import time
from dataclasses import dataclass, asdict, field
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np

log = logging.getLogger("smartcamp.detector")

MODELS_DIR = Path(__file__).parent / "models"

# Per-category (Arabic) metadata shared with the frontend.
CATEGORIES = {
    # Waste & food
    "النفايات":         {"en": "waste",         "color": "#ff5436", "severity": "alert"},
    "الطعام":           {"en": "food",          "color": "#22d3ee", "severity": "info"},
    # Hygiene — compliance (green family)
    "قفازات":           {"en": "gloves",        "color": "#10b981", "severity": "ok"},
    "كمامة":            {"en": "mask",          "color": "#14b8a6", "severity": "ok"},
    "غطاء رأس":         {"en": "head_cover",    "color": "#84cc16", "severity": "ok"},
    # Hygiene — violation (red/amber family)
    "بدون قفازات":      {"en": "no_gloves",     "color": "#f97316", "severity": "violation"},
    "بدون كمامة":       {"en": "no_mask",       "color": "#ef4444", "severity": "violation"},
    "بدون غطاء رأس":    {"en": "no_head_cover", "color": "#f59e0b", "severity": "violation"},
}


@dataclass
class Detection:
    category: str
    category_en: str
    confidence: float
    bbox: List[float]
    color: str
    model_name: str
    severity: str = "info"

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
    class_map: Dict[str, str]                  # raw class name (lower) -> Arabic category
    legacy_names: List[str] = field(default_factory=list)

    # State populated after load()
    model: Any = None
    mode: str = "unavailable"                  # yolo | mock | unavailable
    resolved_path: Optional[Path] = None

    # ------------------------------------------------------------------
    def _resolve_file(self) -> Optional[Path]:
        """Return the first existing weights file, trying the standard
        name first and then any legacy aliases the user might still have."""
        if self.model_path.exists():
            return self.model_path
        for legacy in self.legacy_names:
            p = self.model_path.parent / legacy
            if p.exists():
                return p
        return None

    def load(self) -> None:
        self.model = None
        path = self._resolve_file()
        self.resolved_path = path
        if path is None:
            log.warning(
                "[%s] no weights file at %s (or any of %s) — MARKED UNAVAILABLE",
                self.name, self.model_path.name, self.legacy_names or "[]",
            )
            self.mode = "unavailable"
            return
        if _is_lfs_pointer(path):
            log.warning("[%s] %s is a Git-LFS pointer (run `git lfs pull`) — using MOCK",
                        self.name, path)
            self.mode = "mock"
            return
        try:
            from ultralytics import YOLO  # type: ignore

            self.model = YOLO(str(path))
            self.mode = "yolo"
            log.info("[%s] loaded real YOLO weights from %s", self.name, path)
        except Exception as exc:  # pragma: no cover
            log.warning("[%s] could not load YOLO (%s) — using MOCK", self.name, exc)
            self.mode = "mock"

    # ------------------------------------------------------------------
    def _categories_set(self) -> List[str]:
        # Deduplicated, preserves insertion order so mock output is stable.
        seen: List[str] = []
        for v in self.class_map.values():
            if v not in seen:
                seen.append(v)
        return seen

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
                    severity=meta.get("severity", "info"),
                ))
        return dets

    def _predict_mock(self, frame: np.ndarray) -> List[Detection]:
        rng = random.Random(int(time.time() * 2) + abs(hash(self.name)) % 10_000)
        possible = self._categories_set()
        count = rng.randint(1, 2)
        dets: List[Detection] = []
        for _ in range(count):
            category = rng.choice(possible)
            meta = CATEGORIES[category]
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
                severity=meta.get("severity", "info"),
            ))
        return dets

    # ------------------------------------------------------------------
    def status_ar(self) -> str:
        if self.mode == "yolo":  return "YOLO فعلي"
        if self.mode == "mock":  return "Mock"
        return "غير متوفر"

    def to_dict(self) -> dict:
        present = self.resolved_path is not None and self.resolved_path.exists()
        rp = str(self.resolved_path) if self.resolved_path else None
        return {
            "name": self.name,
            "display_ar": self.display_ar,
            "display_en": self.display_en,
            "color": self.color,
            "mode": self.mode,
            "status_ar": self.status_ar(),
            "available": self.mode != "unavailable",
            "loaded": self.mode == "yolo",
            "model_present": present,
            "is_lfs_pointer": _is_lfs_pointer(self.resolved_path) if self.resolved_path else False,
            "model_path": str(self.model_path),     # canonical
            "resolved_path": rp,                    # what was actually used (may be a legacy name)
            "legacy_names": list(self.legacy_names),
            "categories": [
                {"ar": cat, "en": CATEGORIES[cat]["en"], "color": CATEGORIES[cat]["color"],
                 "severity": CATEGORIES[cat].get("severity", "info")}
                for cat in self._categories_set()
            ],
        }


class ModelRegistry:
    """Owns all detector model entries and the active-models selection."""

    HYGIENE = ("gloves", "mask", "headcover")

    def __init__(self) -> None:
        self.entries: Dict[str, ModelEntry] = {
            "waste": ModelEntry(
                name="waste",
                display_ar="النفايات",
                display_en="waste",
                color="#ff5436",
                model_path=MODELS_DIR / "waste_model.pt",
                class_map={
                    "waste":   "النفايات",
                    "trash":   "النفايات",
                    "garbage": "النفايات",
                    "bottle":  "النفايات",
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
            "gloves": ModelEntry(
                name="gloves",
                display_ar="القفازات",
                display_en="gloves",
                color="#f97316",
                model_path=MODELS_DIR / "gloves_model.pt",
                legacy_names=["GlovesModel2.pt", "gloves.pt"],
                class_map={
                    "gloves":      "قفازات",
                    "glove":       "قفازات",
                    "with_gloves": "قفازات",
                    "no_gloves":   "بدون قفازات",
                    "no-gloves":   "بدون قفازات",
                    "nogloves":    "بدون قفازات",
                    "bare_hand":   "بدون قفازات",
                    "bare_hands":  "بدون قفازات",
                },
            ),
            "mask": ModelEntry(
                name="mask",
                display_ar="الكمامة",
                display_en="mask",
                color="#ef4444",
                model_path=MODELS_DIR / "mask_model.pt",
                legacy_names=["maskModel2.pt", "mask.pt"],
                class_map={
                    "mask":      "كمامة",
                    "face_mask": "كمامة",
                    "with_mask": "كمامة",
                    "no_mask":   "بدون كمامة",
                    "no-mask":   "بدون كمامة",
                    "nomask":    "بدون كمامة",
                    "without_mask": "بدون كمامة",
                },
            ),
            "headcover": ModelEntry(
                name="headcover",
                display_ar="غطاء الرأس",
                display_en="headcover",
                color="#f59e0b",
                model_path=MODELS_DIR / "headcover_model.pt",
                legacy_names=["headModel.pt", "head_cover.pt", "head.pt"],
                class_map={
                    "head_cover":     "غطاء رأس",
                    "head-cover":     "غطاء رأس",
                    "headcover":      "غطاء رأس",
                    "head":           "غطاء رأس",
                    "hair_net":       "غطاء رأس",
                    "hairnet":        "غطاء رأس",
                    "cap":            "غطاء رأس",
                    "no_head_cover":  "بدون غطاء رأس",
                    "no-head-cover":  "بدون غطاء رأس",
                    "no_headcover":   "بدون غطاء رأس",
                    "no_head":        "بدون غطاء رأس",
                    "no_hair_net":    "بدون غطاء رأس",
                    "uncovered_head": "بدون غطاء رأس",
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
