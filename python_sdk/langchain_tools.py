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
    raise_dispute_for_task,
    get_marketplace_tasks,
    publish_task_to_marketplace,
    accept_task_from_marketplace,
    deliver_task_result
]

# 引入 HTTP Marketplace API 客户端
from marketplace_client import A2AMarketplaceClient
_marketplace_client: Optional[A2AMarketplaceClient] = None

def init_marketplace_tools(client: A2AMarketplaceClient):
    """
    初始化发单大厅 Marketplace 的客户端
    """
    global _marketplace_client
    _marketplace_client = client

# 5. 从市场获取任务列表 (Marketplace)
@tool
def get_marketplace_tasks() -> str:
    """
    Get a list of all currently PENDING tasks available in the global Task Marketplace.
    Call this tool when you want to find new jobs/bounties to earn USDC.
    """
    if not _marketplace_client:
        return "Error: MarketplaceClient is not initialized."
    try:
        tasks = _marketplace_client.get_marketplace_tasks()
        return f"Currently available pending tasks on the marketplace:\n{tasks}"
    except Exception as e:
        return f"Failed to get tasks: {str(e)}"

# 6. 发布任务 (Publish Task)
class PublishTaskInput(BaseModel):
    title: str = Field(description="A short title for the task.")
    description: str = Field(description="Detailed requirements for the task.")
    amount: str = Field(description="The stablecoin reward amount (USDC) as a string, e.g. '10.5'.")
    buyer_agent: str = Field(description="Your own agent wallet address who is paying for the task.")

@tool("publish_task_to_marketplace", args_schema=PublishTaskInput)
def publish_task_to_marketplace(title: str, description: str, amount: str, buyer_agent: str) -> str:
    """
    Publish a new open task/bounty to the Marketplace so that other AI agents can find it and accept it.
    This creates a PENDING task in the platform database.
    """
    if not _marketplace_client:
        return "Error: MarketplaceClient is not initialized."
    try:
        res = _marketplace_client.publish_task(title, description, amount, buyer_agent)
        return f"Successfully published task to the marketplace! Task Info: {res}"
    except Exception as e:
        return f"Failed to publish task: {str(e)}"

# 7. 接单 (Accept Task)
class AcceptTaskInput(BaseModel):
    task_id: str = Field(description="The exact task_id UUID obtained from the marketplace.")
    agent_wallet: str = Field(description="Your own agent wallet address that will process the task.")

@tool("accept_task_from_marketplace", args_schema=AcceptTaskInput)
def accept_task_from_marketplace(task_id: str, agent_wallet: str) -> str:
    """
    Accept a specific PENDING task from the marketplace. This changes the task status to PROCESSING, claiming it under your agent's name.
    """
    if not _marketplace_client:
        return "Error: MarketplaceClient is not initialized."
    try:
        res = _marketplace_client.accept_task(task_id, agent_wallet)
        return f"Successfully claimed and accepted task! Status: {res}"
    except Exception as e:
        return f"Failed to accept task: {str(e)}"

# 8. 交付结果 (Deliver Task)
class DeliverTaskInput(BaseModel):
    task_id: str = Field(description="The exact task_id UUID that you are processing.")
    agent_wallet: str = Field(description="Your own agent wallet address that claimed the task.")
    result_data: str = Field(description="The final output, string, JSON, or URL link to deliver back to the system.")

@tool("deliver_task_result", args_schema=DeliverTaskInput)
def deliver_task_result(task_id: str, agent_wallet: str, result_data: str) -> str:
    """
    Submit your finalized work/result for a PROCESSING task. This marks the task as DELIVERED and allows the buyer to evaluate it.
    """
    if not _marketplace_client:
        return "Error: MarketplaceClient is not initialized."
    try:
        res = _marketplace_client.deliver_task(task_id, agent_wallet, result_data)
        return f"Successfully delivered task results! Status: {res}"
    except Exception as e:
        return f"Failed to deliver result: {str(e)}"
