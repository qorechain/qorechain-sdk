"""Recovery codes and the seed-path PQC options of ``unified_account_from_seed``.

The vectors come from ``@qorechain/wallet-adapter`` (0.4.0). If any break, the
Python derivation has diverged from the canonical wallet.
"""

from __future__ import annotations

import hashlib

import pytest

from qorsdk import (
    PQC_RECOVERY_CODE_PREFIX,
    generate_pqc_recovery_code,
    is_valid_recovery_code,
    normalize_recovery_code,
    pqc_key_from_recovery_code,
    pqc_recovery_code_from_secret,
    unified_account_from_seed,
)

SEED32 = bytes([1]) * 32
SEED_COSMOS = "qor1rfjz7r3u8t65teavh5utquj3kwvsj983hh5zaj"
SECRET32 = bytes([7]) * 32
CODE = "QRC1-0W3G-E1R7-0W3G-E1R7-0W3G-E1R7-0W3G-E1R7-0W3G-E1R7-0W3G-E1R7-0W3X-19XK"
RECOVERY_PUB_SHA256 = "cf50dca6c9a0d86eeac9d6a50ee54e567e2126184143be694b8df1f31c8e23ef"
LEGACY_PUB_SHA256 = "3710d198ff5d3206601e9dfd7e0e4bac0656de0fee28f5a20b39e05c81e46bd0"


def _sha(public_key: bytes) -> str:
    assert len(public_key) == 2592
    return hashlib.sha256(public_key).hexdigest()


def test_code_from_secret_known_answer():
    assert pqc_recovery_code_from_secret(SECRET32) == CODE
    assert pqc_recovery_code_from_secret(bytearray(SECRET32)) == CODE


def test_seed_with_recovery_code_known_answer():
    acct = unified_account_from_seed(SEED32, recovery_code=CODE)
    assert acct.cosmos == SEED_COSMOS
    assert acct.private_key == SEED32
    assert _sha(acct.pqc.public_key) == RECOVERY_PUB_SHA256


def test_seed_with_pqc_secret_gives_same_key():
    acct = unified_account_from_seed(SEED32, pqc_secret=SECRET32)
    assert acct.cosmos == SEED_COSMOS
    assert _sha(acct.pqc.public_key) == RECOVERY_PUB_SHA256
    by_code = unified_account_from_seed(SEED32, recovery_code=CODE)
    assert acct.pqc.secret_key == by_code.pqc.secret_key


def test_pqc_key_from_recovery_code_known_answer():
    keypair = pqc_key_from_recovery_code(CODE, SEED_COSMOS)
    assert _sha(keypair.public_key) == RECOVERY_PUB_SHA256
    # The address is read case-insensitively.
    assert pqc_key_from_recovery_code(CODE, SEED_COSMOS.upper()).public_key == keypair.public_key


def test_seed_legacy_derivation_known_answer():
    acct = unified_account_from_seed(SEED32, legacy_seed_derivation=True)
    assert _sha(acct.pqc.public_key) == LEGACY_PUB_SHA256


def test_lowercase_spaces_and_confusables_decode():
    body = CODE[len("QRC1-") :]
    # The first "1" is written as "I", the rest as "l"; zeros as "o".
    lowered = body.lower().replace("-", " ").replace("0", "o").replace("1", "i", 1)
    messy = "qrcl " + lowered.replace("1", "l")
    assert "i" in messy and "l" in messy and "o" in messy
    assert is_valid_recovery_code(messy)
    assert normalize_recovery_code(messy) == body.replace("-", "")
    keypair = pqc_key_from_recovery_code(messy, SEED_COSMOS)
    assert _sha(keypair.public_key) == RECOVERY_PUB_SHA256
    # Without the prefix, and with underscores / dots as separators.
    assert is_valid_recovery_code(body.replace("-", "_"))
    assert is_valid_recovery_code(body.replace("-", "."))


def test_one_changed_character_fails_checksum():
    chars = list(CODE)
    idx = len("QRC1-")
    chars[idx] = "1" if chars[idx] != "1" else "2"
    bad = "".join(chars)
    assert not is_valid_recovery_code(bad)
    with pytest.raises(ValueError, match="checksum"):
        pqc_key_from_recovery_code(bad, SEED_COSMOS)
    with pytest.raises(ValueError, match="checksum"):
        unified_account_from_seed(SEED32, recovery_code=bad)


def test_bad_length_and_characters_rejected():
    assert not is_valid_recovery_code(CODE[:-1])
    assert not is_valid_recovery_code(CODE.replace("W", "U", 1))
    assert not is_valid_recovery_code(CODE.replace("W", "*", 1))
    assert not is_valid_recovery_code(123)  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="56 characters"):
        normalize_recovery_code("QRC1-ABCD")


def test_pqc_key_from_recovery_code_requires_qor_address():
    for bad in (
        "",
        "cosmos1rfjz7r3u8t65teavh5utquj3kwvsj983abcdef",
        SEED_COSMOS[:-1] + "q",
        "0x1a642f0E3c3aF545E7AcBD38b07251B3990914F1",
    ):
        with pytest.raises(ValueError, match="qor1"):
            pqc_key_from_recovery_code(CODE, bad)


def test_generate_round_trips():
    code = generate_pqc_recovery_code()
    assert code.startswith(PQC_RECOVERY_CODE_PREFIX + "-")
    assert len(code) == 5 + 14 * 4 + 13
    assert is_valid_recovery_code(code)
    assert generate_pqc_recovery_code() != code


def test_recovery_code_differs_from_legacy_key():
    a = unified_account_from_seed(SEED32, recovery_code=CODE)
    b = unified_account_from_seed(SEED32, legacy_seed_derivation=True)
    assert a.pqc.public_key != b.pqc.public_key


def test_no_option_raises_with_the_three_choices():
    with pytest.raises(ValueError) as exc:
        unified_account_from_seed(SEED32)
    message = str(exc.value)
    assert "recovery_code" in message
    assert "pqc_secret" in message
    assert "legacy_seed_derivation" in message


@pytest.mark.parametrize(
    "kwargs",
    [
        {"recovery_code": CODE, "pqc_secret": SECRET32},
        {"recovery_code": CODE, "legacy_seed_derivation": True},
        {"pqc_secret": SECRET32, "legacy_seed_derivation": True},
        {"recovery_code": CODE, "pqc_secret": SECRET32, "legacy_seed_derivation": True},
    ],
)
def test_more_than_one_option_raises(kwargs):
    with pytest.raises(ValueError, match="only one"):
        unified_account_from_seed(SEED32, **kwargs)


def test_options_are_keyword_only():
    with pytest.raises(TypeError):
        unified_account_from_seed(SEED32, CODE)  # type: ignore[misc]


def test_pqc_secret_must_be_32_bytes():
    with pytest.raises(ValueError, match="32 bytes"):
        unified_account_from_seed(SEED32, pqc_secret=bytes(31))
    with pytest.raises(ValueError, match="32 bytes"):
        pqc_recovery_code_from_secret(bytes(33))


def test_pqc_secret_identical_to_seed_rejected():
    with pytest.raises(ValueError, match="independent of seed32"):
        unified_account_from_seed(SEED32, pqc_secret=SEED32)
    with pytest.raises(ValueError, match="independent of seed32"):
        unified_account_from_seed(SEED32, pqc_secret=bytearray(SEED32))


def test_legacy_flag_must_be_bool():
    with pytest.raises(ValueError):
        unified_account_from_seed(SEED32, legacy_seed_derivation=1)  # type: ignore[arg-type]
