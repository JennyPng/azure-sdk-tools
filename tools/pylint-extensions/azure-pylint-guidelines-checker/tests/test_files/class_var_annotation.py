# ------------------------------------
# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.
# ------------------------------------
"""Test file for ClassVar annotation checker."""
from typing import ClassVar, Optional, List, Dict


# ---- VIOLATIONS ----

class GoodClient:
    """Client with class variables that should use ClassVar annotation."""

    # These should be flagged - class vars without ClassVar annotation
    MAX_RETRIES = 3  # plain assignment, no annotation
    DEFAULT_TIMEOUT = 30  # plain assignment, no annotation
    _BASE_URL = "https://example.com"  # private, should not be flagged


class AnotherClient:
    """Another client with violations."""

    # Annotated, but not with ClassVar - should be flagged
    MAX_RETRIES: int = 3
    DEFAULT_TIMEOUT: int = 30
    SOME_LIST: List[str] = []

    # ClassVar annotation - should NOT be flagged
    GOOD_VAR: ClassVar[int] = 42


class YetAnotherClient:
    """Yet another client."""

    # Class var with Optional but not ClassVar - should be flagged
    OPTIONAL_SETTING: Optional[str] = None


# ---- ACCEPTABLE ----

class ProperClient:
    """Client with correct ClassVar annotations."""

    # All correct - annotated with ClassVar
    MAX_RETRIES: ClassVar[int] = 3
    DEFAULT_TIMEOUT: ClassVar[int] = 30
    SOME_LIST: ClassVar[List[str]] = []
    OPTIONAL_SETTING: ClassVar[Optional[str]] = None

    def __init__(self):
        # Instance variables should not be flagged
        self.name = "test"
        self.value: int = 42


class ProperClientTwo:
    """Another client with correct usage."""

    _INTERNAL: ClassVar[str] = "internal"  # private with ClassVar, acceptable

    def method(self):
        # Local variables should not be flagged
        local_var = 10
        SCREAMING_LOCAL = 20


class NonClientClass:
    """A non-client class - should not be checked."""

    SOME_CONST = 42  # should not be flagged
    VALUE: int = 10  # should not be flagged


class _PrivateClient:
    """Private client class - should not be checked."""

    SOME_CONST = 42  # should not be flagged


class MyMixin:
    """A mixin class - should not be checked."""

    SOME_CONST = 42  # should not be flagged


class DunderClient:
    """Client with dunder attributes."""

    __slots__ = ()  # should not be flagged
    __doc__ = "test"  # should not be flagged
    MAX_RETRIES = 3  # should be flagged


class MethodOnlyClient:
    """Client that only has methods, no class vars."""

    def __init__(self):
        self.value = 10

    def do_something(self):
        pass
