from fastapi import Depends, Request
from src.storage import get_storage
from src.storage.base import BaseStorage
from src.services.platform.balance_service import BalanceService
from src.services.seller.provider_analytics_service import ProviderAnalyticsService
from src.services.seller.registry_service import RegistryService

def get_balance_service(storage: BaseStorage = Depends(get_storage)) -> BalanceService:
    return BalanceService(storage)

def get_registry_service(storage: BaseStorage = Depends(get_storage)) -> RegistryService:
    return RegistryService(storage)


def get_provider_analytics_service(storage: BaseStorage = Depends(get_storage)) -> ProviderAnalyticsService:
    return ProviderAnalyticsService(storage)
