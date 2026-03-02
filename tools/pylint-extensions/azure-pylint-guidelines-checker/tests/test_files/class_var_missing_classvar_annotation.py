# ------------------------------------
# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.
# ------------------------------------
from typing import ClassVar, Optional


# ====== VIOLATIONS ======

class MyClient:
    MAX_RETRIES = 3  # violation: no annotation at all
    DEFAULT_TIMEOUT: int = 30  # violation: annotated but not ClassVar
    name: str = "default"  # violation: annotated but not ClassVar
    endpoint: Optional[str] = None  # violation: annotated but not ClassVar


class SomeModel:
    DELIMITER = ","  # violation: no annotation at all
    count: int = 0  # violation: annotated but not ClassVar


# ====== ACCEPTABLE ======

class GoodClient:
    MAX_RETRIES: ClassVar[int] = 3  # ok: properly annotated
    DEFAULT_TIMEOUT: ClassVar[int] = 30  # ok: properly annotated
    _internal = "private"  # ok: private variable
    __slots__ = ()  # ok: dunder name
    __doc__ = "docstring"  # ok: dunder name

    def __init__(self):
        self.instance_var = "hello"  # ok: instance variable in __init__


class _InternalModel:
    something = "ok"  # ok: private class (starts with _)
    count: int = 0  # ok: private class


class AlsoGoodModel:
    name: ClassVar[str] = "model"  # ok: properly annotated
    _private_val = 42  # ok: private variable
