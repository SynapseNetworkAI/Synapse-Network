"""Chain helpers: mint USDC, fund ETH, on-chain deposit."""
from __future__ import annotations

from decimal import Decimal

from web3 import Web3


# MockUSDC uses ERC20 base: decimals() = 18
USDC_DECIMALS = 18


def usdc_to_wei(amount: Decimal) -> int:
    return int(amount * 10 ** USDC_DECIMALS)


def get_usdc_decimals(w3: Web3, usdc_contract) -> int:
    try:
        return usdc_contract.functions.decimals().call()
    except Exception:
        return USDC_DECIMALS


def mint_usdc(
    w3: Web3,
    usdc_contract,
    deployer,
    recipient: str,
    amount_usdc: Decimal,
    decimals: int = USDC_DECIMALS,
) -> str:
    """Deployer calls MockUSDC.mint(recipient, amount_wei)."""
    amount_wei = int(amount_usdc * 10 ** decimals)
    nonce = w3.eth.get_transaction_count(deployer.address)
    tx = usdc_contract.functions.mint(
        Web3.to_checksum_address(recipient), amount_wei
    ).build_transaction({
        "from": deployer.address,
        "nonce": nonce,
        "chainId": w3.eth.chain_id,
        "gas": 200_000,
        "gasPrice": w3.eth.gas_price,
    })
    signed = deployer.sign_transaction(tx)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
    assert receipt["status"] == 1, f"mint failed: {tx_hash.hex()}"
    return tx_hash.hex()


def fund_eth(w3: Web3, from_account, to_address: str, amount_eth: Decimal) -> str:
    """Transfer ETH from from_account to to_address."""
    nonce = w3.eth.get_transaction_count(from_account.address)
    tx = {
        "from": from_account.address,
        "to": Web3.to_checksum_address(to_address),
        "value": w3.to_wei(amount_eth, "ether"),
        "nonce": nonce,
        "gas": 21_000,
        "gasPrice": w3.eth.gas_price,
        "chainId": w3.eth.chain_id,
    }
    signed = from_account.sign_transaction(tx)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
    assert receipt["status"] == 1, f"ETH transfer failed: {tx_hash.hex()}"
    return tx_hash.hex()


def approve_usdc(
    w3: Web3,
    usdc_contract,
    owner_account,
    spender: str,
    amount_usdc: Decimal,
    decimals: int = USDC_DECIMALS,
) -> str:
    """Owner approves spender to transfer USDC."""
    amount_wei = int(amount_usdc * 10 ** decimals)
    nonce = w3.eth.get_transaction_count(owner_account.address)
    tx = usdc_contract.functions.approve(
        Web3.to_checksum_address(spender), amount_wei
    ).build_transaction({
        "from": owner_account.address,
        "nonce": nonce,
        "chainId": w3.eth.chain_id,
        "gas": 100_000,
        "gasPrice": w3.eth.gas_price,
    })
    signed = owner_account.sign_transaction(tx)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
    assert receipt["status"] == 1, f"approve failed: {tx_hash.hex()}"
    return tx_hash.hex()


def deposit_on_chain(
    w3: Web3,
    synapse_core_contract,
    owner_account,
    amount_usdc: Decimal,
    decimals: int = USDC_DECIMALS,
) -> str:
    """Call SynapseCore.deposit(amount_wei)."""
    amount_wei = int(amount_usdc * 10 ** decimals)
    nonce = w3.eth.get_transaction_count(owner_account.address)
    tx = synapse_core_contract.functions.deposit(amount_wei).build_transaction({
        "from": owner_account.address,
        "nonce": nonce,
        "chainId": w3.eth.chain_id,
        "gas": 200_000,
        "gasPrice": w3.eth.gas_price,
    })
    signed = owner_account.sign_transaction(tx)
    tx_hash_bytes = w3.eth.send_raw_transaction(signed.raw_transaction)
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash_bytes)
    assert receipt["status"] == 1, f"deposit tx failed: {tx_hash_bytes.hex()}"
    # Always return 0x-prefixed hex string
    raw = tx_hash_bytes.hex()
    return raw if raw.startswith("0x") else f"0x{raw}"
