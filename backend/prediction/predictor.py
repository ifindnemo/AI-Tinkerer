import os
from pathlib import Path
from threading import Lock

import joblib
import numpy as np

from prediction.train_model import FEATURE_NAMES, train_and_save
from schemas import PredictionResult, Severity, TelemetryInput


CLASS_SEVERITY = {
    "normal": Severity.NORMAL,
    "overheating": Severity.CRITICAL,
    "electrical": Severity.WARNING,
}


class VehiclePredictor:
    def __init__(self, model_dir: Path | None = None):
        self.model_dir = model_dir or Path(__file__).parent / "model"
        self.model_path = self.model_dir / "model.joblib"
        self.scaler_path = self.model_dir / "scaler.joblib"
        self.model = None
        self.scaler = None
        self._lock = Lock()

    def _ensure_loaded(self, window_size: int) -> None:
        with self._lock:
            if self.model is not None and self.scaler is not None:
                return
            if not self.model_path.exists() or not self.scaler_path.exists():
                train_and_save(self.model_dir, window_size=window_size)
            self.model = joblib.load(self.model_path)
            self.scaler = joblib.load(self.scaler_path)

    @staticmethod
    def extract_features(window: list[TelemetryInput]) -> np.ndarray:
        matrix = np.asarray(
            [[getattr(sample, name) for name in FEATURE_NAMES] for sample in window],
            dtype=float,
        )
        features: list[float] = []
        for column in range(matrix.shape[1]):
            values = matrix[:, column]
            features.extend([values.mean(), values.max(), values.min(), values.std()])
        features.append(np.polyfit(np.arange(len(matrix)), matrix[:, 0], 1)[0])
        return np.asarray(features, dtype=float).reshape(1, -1)

    def predict(self, window: list[TelemetryInput]) -> PredictionResult:
        self._ensure_loaded(len(window))
        features = self.extract_features(window)
        scaled = self.scaler.transform(features)
        probabilities_raw = self.model.predict_proba(scaled)[0]
        probabilities = {
            str(label): round(float(probability), 4)
            for label, probability in zip(self.model.classes_, probabilities_raw, strict=True)
        }
        label = max(probabilities, key=probabilities.get)
        return PredictionResult(
            label=label,
            severity=CLASS_SEVERITY[label],
            confidence=probabilities[label],
            probabilities=probabilities,
            model_version=os.getenv("ML_MODEL_VERSION", "synthetic-logreg-v1"),
        )


predictor = VehiclePredictor()
