import time
from web3 import Web3
from eth_account import Account

class AgentPayClient:
    def __init__(self, private_key: str, rpc_url: str, escrow_address: str, usdc_address: str):
        """
        初始化 AgentPay SDK
        """
        self.w3 = Web3(Web3.HTTPProvider(rpc_url))
        if not self.w3.is_connected():
            raise Exception("Failed to connect to Web3 RPC")

        # Set up local account
        self.account = Account.from_key(private_key)
        self.escrow_address = self.w3.to_checksum_address(escrow_address)
        self.usdc_address = self.w3.to_checksum_address(usdc_address)
        
        print(f"[*] AI Agent Client Initialized. Address: {self.account.address}")
        
        # Minimal ABIs for MVP
        self.usdc_abi = [
            {"constant": False, "inputs": [{"name": "spender", "type": "address"}, {"name": "amount", "type": "uint256"}], "name": "approve", "outputs": [{"name": "", "type": "bool"}], "type": "function"},
            {"constant": True, "inputs": [{"name": "account", "type": "address"}], "name": "balanceOf", "outputs": [{"name": "", "type": "uint256"}], "type": "function"}
        ]
        
        
        import json
        import os
        abi_path = os.path.join(os.path.dirname(__file__), 'EscrowABI.json')
        with open(abi_path, 'r') as f:
            self.escrow_abi = json.load(f)
        
        self.escrow = self.w3.eth.contract(address=self.escrow_address, abi=self.escrow_abi)

    def _build_and_send_tx(self, func):
        """Helper to build, sign, and send transaction"""
        nonce = self.w3.eth.get_transaction_count(self.account.address)
        tx = func.build_transaction({
            'from': self.account.address,
            'nonce': nonce,
            # Hardcoded gas params for local Hardhat node simplicity
            'gas': 300000,
            'gasPrice': self.w3.to_wei('2', 'gwei')
        })
        signed_tx = self.account.sign_transaction(tx)
        tx_hash = self.w3.eth.send_raw_transaction(signed_tx.raw_transaction) # Changed to raw_transaction
        receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash)
        return receipt

    def get_balance(self) -> float:
        """获取当前 Agent 的 USDC 余额"""
        balance_wei = self.usdc.functions.balanceOf(self.account.address).call()
        return float(self.w3.from_wei(balance_wei, 'ether'))

    def lock_funds(self, task_id: str, seller_address: str, amount: float):
        """
        发起支付：为特定任务锁定资金到担保合约中
        """
        amount_wei = self.w3.to_wei(amount, 'ether')
        seller_checksum = self.w3.to_checksum_address(seller_address)

        # 1. 检查授权额度 (简化：每次都重新授权)
        print(f"[*] Approving SDK to move {amount} USDC to Escrow...")
        self._build_and_send_tx(self.usdc.functions.approve(self.escrow_address, amount_wei))

        # 2. 锁定资金
        print(f"[*] Locking {amount} USDC for task {task_id} ...")
        
        # 将 taskId (字符串) 转换为 bytes32 (需要恰好32字节的 hex string 或者 bytes)
        # 这里用一种取巧的方法：对 task_id 做打包和补齐
        encoded_task_id = task_id.encode('utf-8').ljust(32, b'\0')

        receipt = self._build_and_send_tx(self.escrow.functions.lockFunds(encoded_task_id, seller_checksum, amount_wei))
        print(f"[+] Funds successfully locked! tx: {receipt.transactionHash.hex()}")
        return receipt.transactionHash.hex()

    def release_funds(self, task_id: str):
        """
        任务完成：调用合约释放资金给卖家 (2.5% 自动抽水给协议)
        """
        print(f"[*] Releasing funds for task {task_id} ...")
        encoded_task_id = task_id.encode('utf-8').ljust(32, b'\0')
        receipt = self._build_and_send_tx(self.escrow.functions.releaseFunds(encoded_task_id))
        print(f"[+] Funds successfully released! tx: {receipt.transactionHash.hex()}")
        return receipt.transactionHash.hex()

    def check_task_status(self, task_id: str):
        """
        查看某个 task 在链上的状态
        """
        encoded_task_id = task_id.encode('utf-8').ljust(32, b'\0')
        task = self.escrow.functions.tasks(encoded_task_id).call()
        buyer, seller, amount_wei, status_code, created_at = task
        if buyer == '0x0000000000000000000000000000000000000000':
            return None
        
        status_map = {
            0: "LOCKED",
            1: "COMPLETED",
            2: "DISPUTED",
            3: "RESOLVED"
        }
        
        return {
            "buyer": buyer,
            "seller": seller,
            "amount": self.w3.from_wei(amount_wei, 'ether'),
            "status": status_map.get(status_code, "UNKNOWN"),
            "createdAt": created_at
        }

    def raise_dispute(self, task_id: str):
        """
        发起争议：将任务状态置为 DISPUTED 冻结资金，进入仲裁模式。
        """
        print(f"[*] 🚨 Raising DISPUTE for task {task_id} ...")
        encoded_task_id = task_id.encode('utf-8').ljust(32, b'\0')
        receipt = self._build_and_send_tx(self.escrow.functions.raiseDispute(encoded_task_id))
        print(f"[+] 🚨 Dispute raised! tx: {receipt.transactionHash.hex()}")
        return receipt.transactionHash.hex()

    def resolve_dispute(self, task_id: str, winner_address: str):
        """
        解决争议：将仲裁胜诉方的地址传入，分配资金（或平分/没收等，此处简化为全抛给胜方）。
        需要有多签仲裁者或特权账号调用。
        """
        print(f"[*] ⚖️ Resolving DISPUTE for task {task_id}, winner is {winner_address} ...")
        encoded_task_id = task_id.encode('utf-8').ljust(32, b'\0')
        winner_checksum = self.w3.to_checksum_address(winner_address)
        receipt = self._build_and_send_tx(self.escrow.functions.resolveDispute(encoded_task_id, winner_checksum))
        print(f"[+] ⚖️ Dispute resolved! tx: {receipt.transactionHash.hex()}")
        return receipt.transactionHash.hex()

