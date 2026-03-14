from typing import Dict, Any, List, Optional
from src.storage.base import BaseStorage
import uuid
import time
import asyncio

class RegistryService:
    def __init__(self, storage: BaseStorage):
        self.storage = storage
        self._lock = asyncio.Lock()

    async def register_service(self, req_data: Dict[str, Any], owner_wallet: str) -> Dict[str, Any]:
        """
        [网关防弹层] 注册新的 AI Service
        """
        async with self._lock:
            rows = self.storage.get_collection('service_registry') or []
            new_svc = {**req_data}
            new_svc["ownerAddress"] = owner_wallet
            if not new_svc.get("serviceId"):
                new_svc["serviceId"] = "svc-" + str(uuid.uuid4())[:8]
            new_svc["createdAt"] = int(time.time() * 1000)
            
            rows.append(new_svc)
            self.storage.save_collection('service_registry', rows)
            return new_svc

    async def update_service(self, service_record_id: str, req_data: Dict[str, Any], owner_wallet: str) -> Optional[Dict[str, Any]]:
        """
        [网关防弹层] 更新现有的 AI Service
        """
        async with self._lock:
            rows = self.storage.get_collection('service_registry') or []
            for i, svc in enumerate(rows):
                if svc.get("serviceId") == service_record_id and svc.get("ownerAddress") == owner_wallet:
                    updated = {**svc, **req_data}
                    updated["ownerAddress"] = owner_wallet
                    updated["updatedAt"] = int(time.time() * 1000)
                    rows[i] = updated
                    self.storage.save_collection('service_registry', rows)
                    return updated
            return None

    async def delete_service(self, service_record_id: str, owner_wallet: str) -> bool:
        async with self._lock:
            rows = self.storage.get_collection('service_registry') or []
            original_len = len(rows)
            rows = [
                r for r in rows
                if not (r.get("serviceId") == service_record_id and r.get("ownerAddress") == owner_wallet)
            ]
            if len(rows) == original_len:
                return False
            self.storage.save_collection('service_registry', rows)
            return True

    async def has_owner_service(self, service_record_id: str, owner_wallet: str) -> bool:
        rows = self.storage.get_collection('service_registry') or []
        for svc in rows:
            if svc.get("serviceId") == service_record_id and svc.get("ownerAddress") == owner_wallet:
                return True
        return False

    async def discover_services(self, intent: Optional[str] = None) -> List[Dict[str, Any]]:
        rows = self.storage.get_collection('service_registry') or []
        available_services = [row for row in rows if row.get("isActive") is True]
        
        if intent:
            intent_lower = intent.lower()
            matched_services = []
            for svc in available_services:
                searchable_text = " ".join([
                    str(svc.get("serviceName", "")).lower(),
                    str(svc.get("summary", "")).lower(),
                    " ".join(str(t).lower() for t in svc.get("tags", []))
                ])
                if intent_lower in searchable_text:
                    matched_services.append(svc)
            available_services = matched_services

        # Filter out sensitive info just in case
        public_services = []
        for svc in available_services:
            public_svc = {
                "serviceId": svc.get("serviceId"),
                "serviceName": svc.get("serviceName"),
                "pricing": svc.get("pricing"),
                "summary": svc.get("summary"),
                "tags": svc.get("tags"),
                "invoke": svc.get("invoke", {})
            }
            public_services.append(public_svc)

        return public_services

    async def list_owner_services(self, owner_wallet: str) -> List[Dict[str, Any]]:
        rows = self.storage.get_collection("service_registry") or []
        return [svc for svc in rows if svc.get("ownerAddress") == owner_wallet]
