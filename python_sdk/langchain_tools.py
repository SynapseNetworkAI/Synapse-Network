from typing import Optional
from pydantic import BaseModel, Field
from langchain_core.tools import tool

from agent_pay import AgentPayClient

# 全局客户端实例（便于被无状态的 LangChain Tool 共享）
# 实际生产中可以注入或使用类包裹
_client: Optional[AgentPayClient] = None

def init_langchain_tools(client: AgentPayClient):
    """
    初始化全局的 AgentPay 客户端
    """
    global _client
    _client = client

# 1. 查询余额工具 (Get Balance)
@tool
def get_agent_balance() -> str:
    """
    Check the current agent's (your) wallet balance of USDC.
    Call this tool when you need to know if you have enough balance to pay a seller.
    """
    if not _client:
        return "Error: AgentPayClient is not initialized."
    balance = _client.get_balance()
    return f"Your current USDC balance is: {balance}"


# 2. 锁定资金工具 (Lock Funds)的输入 Schema
class LockFundsInput(BaseModel):
    task_id: str = Field(description="The unique identifier or name of the task (e.g. 'data-scraping-01'). Max 32 chars.")
    seller_address: str = Field(description="The Ethereum wallet address of the Seller or Provider receiving the funds. Must be a valid 0x hex string.")
    amount: float = Field(description="The numeric amount of USDC to lock. E.g. 15.0")

@tool("lock_funds_for_task", args_schema=LockFundsInput)
def lock_funds_for_task(task_id: str, seller_address: str, amount: float) -> str:
    """
    Lock the specified amount of USDC into the Escrow contract for a task.
    Call this tool when you agree on a price with a seller and want to secure the funds for them.
    """
    if not _client:
        return "Error: AgentPayClient is not initialized."
        
    try:
        tx_hash = _client.lock_funds(task_id, seller_address, amount)
        return f"Successfully locked {amount} USDC for task '{task_id}'. Transaction Hash: {tx_hash}"
    except Exception as e:
        return f"Failed to lock funds: {str(e)}"


# 3. 释放资金工具 (Release Funds)的输入 Schema
class ReleaseFundsInput(BaseModel):
    task_id: str = Field(description="The unique identifier or name of the task to release funds for.")

@tool("release_funds_for_task", args_schema=ReleaseFundsInput)
def release_funds_for_task(task_id: str) -> str:
    """
    Release previously locked funds from the Escrow contract to the Seller.
    Call this tool ONLY when you have verified that the task was successfully completed by the Seller.
    """
    if not _client:
        return "Error: AgentPayClient is not initialized."
        
    try:
        tx_hash = _client.release_funds(task_id)
        return f"Successfully released funds for task '{task_id}'. Transaction Hash: {tx_hash}"
    except Exception as e:
        return f"Failed to release funds: {str(e)}"

# 4. 发起争议仲裁 (Raise Dispute)
class RaiseDisputeInput(BaseModel):
    task_id: str = Field(description="The unique identifier of the task to dispute.")

@tool("raise_dispute_for_task", args_schema=RaiseDisputeInput)
def raise_dispute_for_task(task_id: str) -> str:
    """
    Raise a dispute for a task to freeze funds and call the decentralised jury.
    Call this tool ONLY if the other party is cheating, trying to run away with funds, or delivering fake/bad data.
    """
    if not _client:
        return "Error: AgentPayClient is not initialized."
        
    try:
        tx_hash = _client.raise_dispute(task_id)
        return f"Successfully raised dispute for task '{task_id}'. Funds are FROZEN. Transaction Hash: {tx_hash}"
    except Exception as e:
        return f"Failed to raise dispute: {str(e)}"

# 导出工具列表供 Agent 使用
agent_pay_tools = [
    get_agent_balance,
    lock_funds_for_task,
    release_funds_for_task,
    raise_dispute_for_task
]
