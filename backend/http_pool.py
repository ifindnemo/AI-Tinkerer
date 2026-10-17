"""One keep-alive HTTP client per provider, shared by every request thread.

A client made per request pays a DNS lookup and a TLS handshake each time. `httpx.Client` is safe to use from
several threads. The keep-alive window is short so a connection the server already closed is not reused.
"""
import threading

import httpx

_lock = threading.Lock()
_clients: dict[str, httpx.Client] = {}


def shared(name: str) -> httpx.Client:
    with _lock:
        client = _clients.get(name)
        if client is None or client.is_closed:
            client = httpx.Client(
                timeout=30.0,
                limits=httpx.Limits(max_keepalive_connections=4, keepalive_expiry=10.0),
                transport=httpx.HTTPTransport(retries=1),  # connection errors only; a sent request is never repeated
            )
            _clients[name] = client
        return client


def close_all() -> None:
    with _lock:
        clients = list(_clients.values())
        _clients.clear()
    for client in clients:
        client.close()
