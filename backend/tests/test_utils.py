"""Unit tests for pure helper functions."""
import hashlib

import pytest

from app.services.tag_reader import _first, _hash_bytes


class TestFirst:
    def test_none_returns_none(self):
        assert _first(None) is None

    def test_empty_list_returns_none(self):
        assert _first([]) is None

    def test_list_with_none_returns_none(self):
        assert _first([None]) is None

    def test_string_passthrough(self):
        assert _first("hello") == "hello"

    def test_strips_whitespace(self):
        assert _first("  hi  ") == "hi"

    def test_blank_string_returns_none(self):
        assert _first("   ") is None

    def test_list_returns_first_as_string(self):
        assert _first(["track1", "track2"]) == "track1"

    def test_stringifies_value(self):
        # mutagen tag objects stringify to their text content
        assert _first(42) == "42"


class TestHashBytes:
    def test_known_hash(self):
        data = b"hello"
        expected = hashlib.sha256(b"hello").hexdigest()
        assert _hash_bytes(data) == expected

    def test_empty_bytes(self):
        result = _hash_bytes(b"")
        assert len(result) == 64  # sha256 hex digest length

    def test_different_inputs_differ(self):
        assert _hash_bytes(b"a") != _hash_bytes(b"b")
