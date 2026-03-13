from fastapi import Request
from .base import BaseStorage
from .json_impl import JsonStorage

def get_storage(request: Request) -> BaseStorage:
    return request.app.state.storage
