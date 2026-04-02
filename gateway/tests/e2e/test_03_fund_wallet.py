"""Step 3: 链上发币 — ETH + USDC 转给 Owner / Provider 钱包"""
from decimal import Decimal
from web3 import Web3
from tests.e2e.conftest import FUND_ETH, FUND_USDC
from tests.e2e.helpers.chain import mint_usdc, fund_eth, get_usdc_decimals


def test_deployer_has_eth(w3, deployer_account):
    bal = w3.eth.get_balance(deployer_account.address)
    assert bal > 0, f"Deployer has no ETH: {deployer_account.address}"


def test_mint_usdc_to_owner(w3, contract_config, mock_usdc_abi, deployer_account, owner_account):
    usdc_addr = Web3.to_checksum_address(contract_config["MockUSDC"])
    usdc = w3.eth.contract(address=usdc_addr, abi=mock_usdc_abi)
    decimals = get_usdc_decimals(w3, usdc)

    bal_before = usdc.functions.balanceOf(owner_account.address).call()
    mint_usdc(w3, usdc, deployer_account, owner_account.address, FUND_USDC, decimals)
    bal_after = usdc.functions.balanceOf(owner_account.address).call()

    minted_wei = int(FUND_USDC * 10 ** decimals)
    assert bal_after >= bal_before + minted_wei, (
        f"USDC balance did not increase by {FUND_USDC}. "
        f"before={bal_before}, after={bal_after}"
    )


def test_fund_eth_to_owner(w3, deployer_account, owner_account):
    bal_before = w3.eth.get_balance(owner_account.address)
    fund_eth(w3, deployer_account, owner_account.address, FUND_ETH)
    bal_after = w3.eth.get_balance(owner_account.address)
    assert bal_after > bal_before, "Owner ETH balance did not increase"


def test_mint_usdc_to_provider(w3, contract_config, mock_usdc_abi, deployer_account, provider_account):
    """Provider needs USDC for potential future staking — mint a small amount."""
    usdc_addr = Web3.to_checksum_address(contract_config["MockUSDC"])
    usdc = w3.eth.contract(address=usdc_addr, abi=mock_usdc_abi)
    decimals = get_usdc_decimals(w3, usdc)
    mint_usdc(w3, usdc, deployer_account, provider_account.address, Decimal("10"), decimals)
    bal = usdc.functions.balanceOf(provider_account.address).call()
    assert bal > 0


def test_fund_eth_to_provider(w3, deployer_account, provider_account):
    fund_eth(w3, deployer_account, provider_account.address, Decimal("0.5"))
    bal = w3.eth.get_balance(provider_account.address)
    assert bal > 0
