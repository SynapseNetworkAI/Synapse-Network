import json
import os
import time
from typing import Any, Dict, List, Optional, Union
from .base import BaseStorage


def _normalize_service_row(row: Any) -> Any:
    if not isinstance(row, dict):
        return row
    service_name = str(row.get('serviceName') or row.get('name') or '').strip()
    invoke = row.get('invoke') if isinstance(row.get('invoke'), dict) else {}
    endpoint = str(row.get('endpoint') or invoke.get('url') or '').strip()
    normalized = {
        **row,
        'schemaVersion': int(row.get('schemaVersion') or 2),
        'name': service_name,
        'serviceName': service_name,
        'endpoint': endpoint,
        'status': row.get('status') or ('active' if row.get('isActive', True) else 'inactive'),
        'constraints': row.get('constraints') if isinstance(row.get('constraints'), dict) else {
            'timeoutMs': 3000,
            'maxResponseBytes': 2048,
            'maxRequestBytes': 4096,
            'maxQps': 50,
        },
        'healthCheck': row.get('healthCheck') if isinstance(row.get('healthCheck'), dict) else {
            'url': str(row.get('health_check') or ''),
            'method': 'GET',
            'intervalSec': 30,
            'timeoutMs': 3000,
            'successCodes': [200],
            'healthyThreshold': 2,
            'unhealthyThreshold': 3,
        },
    }
    return normalized

class JsonStorage(BaseStorage):
    def __init__(self, directory: str = '.'):
        self.directory = directory
        if not os.path.exists(self.directory):
            os.makedirs(self.directory, exist_ok=True)
            
    def _path(self, collection_name: str) -> str:
        return os.path.join(self.directory, f'{collection_name}.json')

    def get_collection(self, collection_name: str) -> Union[List[Any], Dict[str, Any]]:
        path = self._path(collection_name)
        if not os.path.exists(path): 
            if collection_name in {'credentials', 'agent_credentials', 'buyer_credentials', 'seller_secrets', 'provider_secrets'}: return {}
            return {} if 'ledger' in collection_name or 'config' in collection_name else []
            
        try:
            with open(path, 'r', encoding='utf-8') as f: 
                data = json.load(f)
                
                if isinstance(data, dict):
                    if collection_name == 'service_registry' and 'services' in data:
                        services = data['services']
                        if isinstance(services, list):
                            return [_normalize_service_row(svc) for svc in services]
                        return services
                    if collection_name == 'agent_registry' and 'agents' in data:
                        return data['agents']
                    if collection_name == 'deposit_intents' and 'intents' in data:
                        return data['intents']
                    if collection_name == 'usage_log' and 'logs' in data:
                        return data['logs']
                if collection_name == 'service_registry' and isinstance(data, list):
                    return [_normalize_service_row(svc) for svc in data]
                return data
        except json.JSONDecodeError:
            if collection_name in {'credentials', 'agent_credentials', 'buyer_credentials', 'seller_secrets', 'provider_secrets'}: return {}
            return {} if 'ledger' in collection_name or 'config' in collection_name else []

    def save_collection(self, collection_name: str, data: Union[List[Any], Dict[str, Any]]) -> None:
        path = self._path(collection_name)
        
        payload = data
        if collection_name == 'service_registry' and isinstance(data, list):
            payload = {'services': data, 'updatedAt': int(time.time())}
        elif collection_name == 'agent_registry' and isinstance(data, list):
            payload = {'agents': data, 'updatedAt': int(time.time())}
            
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(payload, f, indent=2, ensure_ascii=False)

    def append_to_collection(self, collection_name: str, item: Any) -> None:
        path = self._path(collection_name)
        
        if collection_name == 'audit_log':
            path = path.replace('.json', '.jsonl')
            with open(path, 'a', encoding='utf-8') as f:
                f.write(json.dumps(item, ensure_ascii=False) + '\n')
            return
            
        data = self.get_collection(collection_name)
        if isinstance(data, list):
            data.append(item)
            self.save_collection(collection_name, data)
