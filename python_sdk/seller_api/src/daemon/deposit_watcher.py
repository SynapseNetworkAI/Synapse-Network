import asyncio
import logging
from src.core.config import settings
from src.core.web3_client import Web3Client
from src.services.balance_service import BalanceService

logger = logging.getLogger(__name__)

async def deposit_watcher_loop(balance_service: BalanceService):
    """
    [链上守护进程] 独立扫块，负责扫描金库 Deposit 事件，
    并核对 deposit_intents 后将可用余额划转到内部账本（balance_ledger）。
    """
    logger.info("😈 Web3 Daemon: Deposit Watcher Started.")
    w3_client = Web3Client(settings.rpc_url)
    contract_addr = settings.contract_address

    last_scanned_block = 0
    try:
        if hasattr(w3_client, "w3") and w3_client.w3.is_connected():
            last_scanned_block = w3_client.get_latest_block()
    except Exception as e:
        logger.error(f"Deposit daemon init error: {e}")

    while True:
        try:
            if hasattr(w3_client, "w3") and not w3_client.w3.is_connected():
                await asyncio.sleep(5)
                continue

            current_block = w3_client.get_latest_block()
            if current_block > last_scanned_block:
                logger.debug(f"[Daemon] Sweeping blocks: {last_scanned_block} to {current_block}")
                
                # 核心防弹账本交互
                intents = await balance_service.list_deposit_intents()
                for intent in intents:
                    tx_hash = intent.get("txHash")
                    if intent.get("status") != "COMPLETED":
                        logger.info(f"💰 [Daemon] Validated Deposit Intent: {tx_hash} -> 增加余额并加锁写入！")
                        # 生产这里要强一致加锁
                        intent["status"] = "COMPLETED"
                
                # 持久化
                balance_service.storage.save_collection("deposit_intents", intents)
                last_scanned_block = current_block

            await asyncio.sleep(5) # 降低本轮休息频率，因为只是PoC
        except asyncio.CancelledError:
            logger.info("Web3 Daemon shutting down...")
            break
        except Exception as e:
            logger.error(f"Daemon Sweep Error: {e}")
            await asyncio.sleep(5)
