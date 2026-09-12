from pathlib import Path

import joblib
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler


FEATURE_NAMES = (
    "coolant_temp",
    "engine_rpm",
    "vehicle_speed",
    "intake_air_temp",
    "engine_load",
    "battery_voltage",
)


def _window_features(window: np.ndarray) -> np.ndarray:
    features: list[float] = []
    for column in range(window.shape[1]):
        values = window[:, column]
        features.extend([values.mean(), values.max(), values.min(), values.std()])
    coolant_trend = np.polyfit(np.arange(len(window)), window[:, 0], 1)[0]
    features.append(coolant_trend)
    return np.asarray(features, dtype=float)


def _build_training_data(seed: int = 42, window_size: int = 12):
    rng = np.random.default_rng(seed)
    rows: list[np.ndarray] = []
    labels: list[str] = []

    profiles = {
        "normal": [92, 2100, 48, 31, 42, 13.8],
        "overheating": [112, 3200, 42, 38, 82, 13.5],
        "electrical": [94, 1800, 32, 30, 38, 10.1],
    }

    for label, base in profiles.items():
        for _ in range(450):
            window = np.tile(np.asarray(base, dtype=float), (window_size, 1))
            noise = rng.normal(0, [2.5, 240, 7, 2.5, 7, 0.18], window.shape)
            window += noise
            if label == "overheating":
                window[:, 0] += np.linspace(0, rng.uniform(5, 14), window_size)
            elif label == "normal" and rng.random() < 0.25:
                # Hot ambient air without a rising coolant trend is still normal.
                window[:, 3] += rng.uniform(9, 16)
                window[:, 0] += rng.uniform(2, 6)
            elif label == "electrical" and rng.random() < 0.5:
                window[:, 5] = rng.normal(15.8, 0.2, window_size)

            rows.append(_window_features(window))
            labels.append(label)

    return np.vstack(rows), np.asarray(labels)


def train_and_save(model_dir: Path, window_size: int = 12) -> tuple[Path, Path]:
    model_dir.mkdir(parents=True, exist_ok=True)
    features, labels = _build_training_data(window_size=window_size)
    scaler = StandardScaler().fit(features)
    model = LogisticRegression(
        max_iter=2000,
        random_state=42,
        class_weight="balanced",
    ).fit(scaler.transform(features), labels)

    model_path = model_dir / "model.joblib"
    scaler_path = model_dir / "scaler.joblib"
    joblib.dump(model, model_path)
    joblib.dump(scaler, scaler_path)
    return model_path, scaler_path


if __name__ == "__main__":
    train_and_save(Path(__file__).parent / "model")
