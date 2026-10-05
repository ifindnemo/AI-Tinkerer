import pytest

from car_neuron_gateway.allowlist import ForbiddenCommand, check_command


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("0105", "0105"),
        ("01 0c", "010C"),
        ("03", "03"),
        ("07", "07"),
        ("0902", "0902"),
        ("020C00", "020C00"),
        ("ATZ", "ATZ"),
        ("AT SP0", "ATSP0"),
        ("ATRV", "ATRV"),
    ],
)
def test_read_commands_pass(raw, expected) -> None:
    assert check_command(raw) == expected


@pytest.mark.parametrize(
    "raw",
    [
        "04",  # clear DTCs + freeze frame
        "04 ",
        "14FFFFFF",  # UDS ClearDiagnosticInformation
        "2E1234",  # UDS WriteDataByIdentifier
        "3101",  # UDS RoutineControl
        "0A",  # not in the read set
        "ATPP0CSV0A",  # writes adapter EEPROM
        "ATMA",
        "0105\r04",
        "",
        "XYZ",
    ],
)
def test_clear_write_and_unknown_commands_are_blocked(raw) -> None:
    with pytest.raises(ForbiddenCommand):
        check_command(raw)


def test_mode_04_message_says_why() -> None:
    with pytest.raises(ForbiddenCommand, match="Mode 04"):
        check_command("04")
