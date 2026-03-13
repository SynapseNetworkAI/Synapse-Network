def normalize_wallet(wallet: str) -> str:
    if not wallet:
        return ""
    return wallet.lower()
