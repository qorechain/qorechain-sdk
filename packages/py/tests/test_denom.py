import pytest

from qorsdk import from_base, to_base


@pytest.mark.parametrize(
    "amount,expected",
    [
        ("1", "1000000"),
        ("1.5", "1500000"),
        ("0.1", "100000"),
        ("0.000001", "1"),
        ("0", "0"),
        ("0.0", "0"),
        ("123456.789012", "123456789012"),
        ("  1.5  ", "1500000"),
        ("+2", "2000000"),
        ("000.500000", "500000"),
    ],
)
def test_to_base(amount, expected):
    assert to_base(amount) == expected


@pytest.mark.parametrize(
    "base,expected",
    [
        ("1000000", "1"),
        ("1500000", "1.5"),
        ("1", "0.000001"),
        ("0", "0"),
        ("123456789012", "123456.789012"),
        ("100000", "0.1"),
    ],
)
def test_from_base(base, expected):
    assert from_base(base) == expected


def test_round_trip():
    for amt in ("1", "1.5", "0.000001", "999999.999999", "0"):
        assert from_base(to_base(amt)) == (amt if amt != "0.0" else "0")


@pytest.mark.parametrize(
    "bad",
    ["", ".", "1.2.3", "1e3", "abc", "1,000", "0x10", "  ", "1."],
)
def test_to_base_rejects_garbage(bad):
    with pytest.raises(ValueError):
        to_base(bad)


def test_to_base_rejects_negative():
    with pytest.raises(ValueError):
        to_base("-1")


def test_to_base_rejects_excess_decimals():
    with pytest.raises(ValueError):
        to_base("0.1234567")  # 7 > exponent 6


def test_from_base_rejects_garbage():
    for bad in ["", "1.5", "abc", "-1", "0x1"]:
        with pytest.raises(ValueError):
            from_base(bad)


def test_custom_exponent():
    assert to_base("1", exponent=18) == "1000000000000000000"
    assert from_base("1000000000000000000", exponent=18) == "1"
    assert to_base("5", exponent=0) == "5"
    assert from_base("5", exponent=0) == "5"


def test_invalid_exponent():
    with pytest.raises(ValueError):
        to_base("1", exponent=-1)
