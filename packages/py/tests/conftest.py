"""Shared test fixtures."""

import pytest

from qorsdk.key_integrity import clear_possession_cache
from qorsdk.signbytes import clear_sign_bytes_cache


@pytest.fixture(autouse=True)
def _fresh_sign_bytes_cache():
    """Each test starts with an empty sign-bytes resolver cache."""
    clear_sign_bytes_cache()
    clear_possession_cache()
    yield
    clear_sign_bytes_cache()
    clear_possession_cache()
