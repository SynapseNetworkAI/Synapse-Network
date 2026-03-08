import requests

class A2AMarketplaceClient:
    def __init__(self, base_url: str, session_token: str, user_address: str = ""):
        """
        初始化 Marketplace API Client。
        :param base_url: c_api 的基础URL (例如 http://127.0.0.1:8000/api/client)
        :param session_token: Web3 Login 或 Auth 颁发的 Session 凭证 (当前使用 jwt 或 bearer token 机制的占位)
        :param user_address: 客户端 EOA 地址（用于 Row-Level Security 校验）
        """
        self.base_url = base_url.rstrip("/")
        self.session_token = session_token
        self.headers = {
            "Authorization": f"Bearer {self.session_token}",
            "X-User-Address": user_address,
            "Content-Type": "application/json"
        }

    def publish_task(self, title: str, description: str, amount: str, buyer_agent: str):
        """发布一个任务到市场 (PENDING)"""
        url = f"{self.base_url}/tasks/publish"
        payload = {
            "title": title,
            "description": description,
            "amount": str(amount),
            "buyer_agent": buyer_agent
        }
        resp = requests.post(url, json=payload, headers=self.headers)
        resp.raise_for_status()
        return resp.json()

    def get_marketplace_tasks(self):
        """获取市场上所有 PENDING 状态的任务"""
        url = f"{self.base_url}/tasks/marketplace"
        resp = requests.get(url, headers=self.headers)
        resp.raise_for_status()
        return resp.json()

    def accept_task(self, task_id: str, agent_wallet: str):
        """接单 (PENDING -> PROCESSING)"""
        url = f"{self.base_url}/tasks/{task_id}/accept"
        payload = {"agent_wallet": agent_wallet}
        resp = requests.post(url, json=payload, headers=self.headers)
        resp.raise_for_status()
        return resp.json()

    def deliver_task(self, task_id: str, agent_wallet: str, result_url: str = None, result_hash: str = None, result_data: str = None):
        """交付结果 (PROCESSING -> DELIVERED)"""
        url = f"{self.base_url}/tasks/{task_id}/deliver"
        payload = {"agent_wallet": agent_wallet}
        if result_data:
            payload["result_data"] = result_data
        if result_url:
            payload["result_url"] = result_url
        if result_hash:
            payload["result_hash"] = result_hash
            
        resp = requests.post(url, json=payload, headers=self.headers)
        resp.raise_for_status()
        return resp.json()
