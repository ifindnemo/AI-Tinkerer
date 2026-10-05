import sqlite3

import pytest

from store import Store


def test_connect_closes_the_connection_after_use(tmp_path) -> None:
    store = Store(tmp_path / "close-test.db")
    with store.connect() as connection:
        connection.execute("SELECT 1")

    with pytest.raises(sqlite3.ProgrammingError):
        connection.execute("SELECT 1")


def test_connect_rolls_back_when_the_block_fails(tmp_path) -> None:
    store = Store(tmp_path / "rollback-test.db")
    store.initialize()

    with pytest.raises(RuntimeError):
        with store.connect() as connection:
            connection.execute(
                "INSERT INTO reminders VALUES ('rem_x', 'inc_x', 'v', 't', 'm', 't')"
            )
            raise RuntimeError("abort")

    with store.connect() as connection:
        count = connection.execute("SELECT COUNT(*) FROM reminders").fetchone()[0]
    assert count == 0


def test_initialize_runs_once_and_enables_wal(tmp_path, monkeypatch) -> None:
    store = Store(tmp_path / "init-test.db")
    store.initialize()

    calls = 0
    original = store.connect

    def counting_connect():
        nonlocal calls
        calls += 1
        return original()

    monkeypatch.setattr(store, "connect", counting_connect)
    store.initialize()
    assert calls == 0

    with original() as connection:
        mode = connection.execute("PRAGMA journal_mode").fetchone()[0]
    assert mode == "wal"
