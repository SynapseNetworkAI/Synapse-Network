from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional, Union

from .repository_provider import StorageRepositoryProvider

class BaseStorage(ABC):
    @abstractmethod
    def get_repository_provider(self) -> StorageRepositoryProvider:
        pass

    @abstractmethod
    def get_collection(self, collection_name: str) -> Union[List[Any], Dict[str, Any]]:
        pass
        
    @abstractmethod
    def save_collection(self, collection_name: str, data: Union[List[Any], Dict[str, Any]]) -> None:
        pass
        
    @abstractmethod
    def append_to_collection(self, collection_name: str, item: Any) -> None:
        pass
