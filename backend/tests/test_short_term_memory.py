from store import Store


def _assessment() -> dict:
    return {
        "severity": "warning",
        "diagnosis": "Phát hiện dấu hiệu bất thường.",
        "suspected_faults": ["Hỗn hợp nhiên liệu nghèo"],
        "evidence": ["Lambda tăng qua nhiều mẫu."],
        "confidence": 0.78,
        "missing_data": [],
        "recommendations": ["Kiểm tra hệ thống nạp."],
    }


def test_short_term_memory_is_created_loaded_and_updated(tmp_path) -> None:
    store = Store(tmp_path / "memory-test.db")
    incident = store.create_incident(
        vehicle_id="VF-DEMO-001",
        severity="warning",
        diagnosis="Phát hiện dấu hiệu bất thường.",
        assessment=_assessment(),
        reasons=["Lambda tăng qua nhiều mẫu."],
        recommendations=["Kiểm tra hệ thống nạp."],
        tool_trace=[],
    )
    telemetry_context = {
        "vehicle_id": "VF-DEMO-001",
        "batch_id": "batch-test",
        "records": [{"lambda_value": 1.18}],
    }

    memory = store.upsert_incident_memory(
        incident_id=incident["id"],
        vehicle_id="VF-DEMO-001",
        telemetry_context=telemetry_context,
        assessment=_assessment(),
        tool_trace=[],
        ttl_minutes=30,
    )

    assert memory["status"] == "active"
    assert memory["telemetry_context"]["batch_id"] == "batch-test"
    assert store.get_active_incident_memory("VF-DEMO-001")["id"] == memory["id"]

    updated = store.update_incident_memory_status(
        incident["id"],
        "waiting_confirmation",
    )
    assert updated["status"] == "waiting_confirmation"
