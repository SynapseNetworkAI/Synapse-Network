import os
import glob
import re

mapping = {
    "AuditLogRow": "audit",
    "SystemAuditLogRow": "audit",
    "UsageLogRow": "finance",
    "UsageAppendBatch": "finance",
    "CredentialRow": "auth",
    "WalletRoleRow": "auth",
    "AuthSessionRow": "auth",
    "BalanceRow": "finance",
    "DepositIntentRow": "finance",
    "RefundIntentRow": "finance",
    "WithdrawalIntentRow": "finance",
    "WithdrawalDecision": "finance",
    "BuyerChargeResult": "finance",
    "BalanceMutationResult": "finance",
    "DepositDedupRow": "system",
    "WithdrawTxDedupRow": "system",
    "ProcessedDepositEventRow": "system",
    "PlatformFeePolicyDefaultRow": "system",
    "PlatformFeePolicyOwnerRow": "system",
    "ServiceRegistryRow": "registry",
    "IdempotencyKeyRow": "idempotency",
    "FinanceRateLimitRow": "idempotency",
}

# Recursively find all python files in gateway/src
target_files = []
for root, _, files in os.walk("src"):
    for file in files:
        if file.endswith(".py"):
            target_files.append(os.path.join(root, file))

for file in target_files:
    if "domain/entities" in file or file.endswith("storage_entities.py"):
        continue
    
    with open(file, "r") as f:
        content = f.read()
    
    if "src.domain.storage_entities" not in content and "domain.storage_entities" not in content:
        continue
    
    # We have an import from storage_entities or domain.storage_entities
    # Usually it looks like: from src.domain.storage_entities import X, Y, Z
    # We should replace it with the new paths.
    
    # Let's just do it cleanly: run ruff check --fix and rely on it?
    # No, ruff can't guess where things moved to.
    
    lines = content.split('\n')
    new_lines = []
    
    i = 0
    while i < len(lines):
        line = lines[i]
        if "from src.domain.storage_entities import" in line or "from domain.storage_entities import" in line:
            # this might span multiple lines if there are parentheses!
            import_statement = line
            while '(' in import_statement and ')' not in import_statement and i + 1 < len(lines):
                i += 1
                import_statement += "\n" + lines[i]
            
            # Now extract the classes
            # "from src.domain.storage_entities import ( A, B, C )"
            matches = re.findall(r"([A-Za-z0-9_]+)", import_statement.split("import")[1])
            new_imports = {}
            for match in matches:
                if match in mapping:
                    target = mapping[match]
                    if target not in new_imports:
                        new_imports[target] = []
                    new_imports[target].append(match)
            
            for target, classes in new_imports.items():
                new_lines.append(f"from src.domain.{target} import {', '.join(classes)}")
        else:
            new_lines.append(line)
        i += 1
            
    with open(file, "w") as f:
        f.write('\n'.join(new_lines))

print("Imports updated.")