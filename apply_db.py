import os
import json

base_dir = '/Users/cliff/workspace/A2A-pay/python_sdk/seller_api/'

# Append to settings.py
with open(os.path.join(base_dir, 'settings.py'), 'a') as f:
    f.write('''\nWALLET_ROLES_PATH = os.getenv("WALLET_ROLES_PATH", os.path.join(os.path.dirname(os.path.dirname(__file__)), "wallet_roles.json"))\n''')

# Append to persistence.py
with open(os.path.join(base_dir, 'persistence.py'), 'a') as f:
    f.write('''\n\ndef load_wallet_roles() -> Dict[str, str]:
    from .settings import WALLET_ROLES_PATH
    import os, json
    if not os.path.exists(WALLET_ROLES_PATH):
        return {}
    try:
        with open(WALLET_ROLES_PATH, 'r', encoding='utf-8') as file:
            return json.load(file)
    except Exception:
        return {}

def save_wallet_roles(roles: Dict[str, str]) -> None:
    from .settings import WALLET_ROLES_PATH
    import json
    with open(WALLET_ROLES_PATH, 'w', encoding='utf-8') as file:
        json.dump(roles, file, ensure_ascii=False, indent=2)

def enforce_wallet_role(wallet: str, required_role: str) -> None:
    from .common import normalize_wallet
    norm_wallet = normalize_wallet(wallet)
    roles = load_wallet_roles()
    current_role = roles.get(norm_wallet)
    
    if current_role and current_role != required_role:
        raise ValueError(f"Hard Isolation Error: Wallet {norm_wallet} is already registered as {current_role}. Cannot act as {required_role}.")
        
    if not current_role:
        roles[norm_wallet] = required_role
        save_wallet_roles(roles)
''')
