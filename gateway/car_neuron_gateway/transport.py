import time


class LoopbackTransport:
    """Talks to an in-process device (the fake ELM327) through its text protocol."""

    def __init__(self, device):
        self.device = device
        self.buffer = b""

    def write(self, data: bytes) -> None:
        for command in data.decode("ascii").split("\r"):
            if command.strip():
                self.buffer += self.device.handle(command).encode("ascii")

    def read_until(self, terminator: bytes = b">", timeout: float = 5.0) -> bytes:
        index = self.buffer.find(terminator)
        if index < 0:
            raise TimeoutError("adapter did not answer")
        reply, self.buffer = self.buffer[: index + 1], self.buffer[index + 1 :]
        return reply

    def close(self) -> None:
        pass


class SerialTransport:
    """USB (/dev/ttyUSB0), Bluetooth classic (/dev/rfcomm0) or WiFi (socket://host:port)."""

    def __init__(self, port: str, baudrate: int = 38400):
        import serial  # pyserial is only needed for a real adapter

        self.serial = serial.serial_for_url(port, baudrate=baudrate, timeout=0.1)

    def write(self, data: bytes) -> None:
        self.serial.write(data)
        self.serial.flush()

    def read_until(self, terminator: bytes = b">", timeout: float = 5.0) -> bytes:
        deadline = time.monotonic() + timeout
        reply = b""
        while terminator not in reply:
            if time.monotonic() > deadline:
                raise TimeoutError("adapter did not answer")
            reply += self.serial.read(64)
        return reply

    def close(self) -> None:
        self.serial.close()
