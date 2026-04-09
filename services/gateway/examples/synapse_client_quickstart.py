"""Synapse Python SDK 快速入门示例

演示两种调用模式:
  Mode 1: 硬编码 Service ID 直接调用指定服务
  Mode 2: 语义发现（Semantic Discovery）由网络自动推荐最优服务

环境变量:
    SYNAPSE_API_KEY  (必填) Agent 凭据令牌，格式为 agt_...

使用方式:
    pip install synapse-client  # 或本地引用 SDK
    export SYNAPSE_API_KEY='agt_...'
    python synapse_client_quickstart.py
"""

import os
import sys
import uuid
from pathlib import Path

# 尝试导入 SDK，本地开发时自动添加父目录到 sys.path
try:
    from synapse_client import SynapseClient
except ModuleNotFoundError:
    root = Path(__file__).resolve().parents[1]
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    from synapse_client import SynapseClient

def main():
    """主流程: 初始化客户端 → 硬编码调用 → 语义发现调用。"""
    api_key = os.getenv("SYNAPSE_API_KEY")
    if not api_key:
        print("Please set SYNAPSE_API_KEY environment variable.")
        print("E.g. export SYNAPSE_API_KEY='agt_...'")
        return

    # Initialize Synapse Client
    client = SynapseClient(api_key=api_key)

    print("=== Mode 1: Hardcoded Service ID ===")
    service_id = "svc_quotes_famous_top3"
    print(f"Calling specific service: {service_id}")
    
    try:
        response = client.invoke(
            service_id=service_id,
            payload={"text": "给我一句名人名言"},
            cost_usdc=0.01,
        )
        print("\n[ Invoke Success ]")
        print(f"Result        : {response.result}")
        print(f"Fee Deducted  : {response.charged_usdc} USDC")
        print(f"Invocation ID : {response.invocation_id}")
    except Exception as e:
        print(f"Error calling {service_id}: {e}")

    print("\n" + "="*40 + "\n")

    print("=== Mode 2: Semantic Discovery ===")
    intent = "quotes"
    print(f"Searching for network services handling: '{intent}'")
    discovery = client.discover_services(intent=intent)
    
    if not discovery.results:
        print(f"No services found for intent: {intent}")
    else:
        best = discovery.results[0]
        print(f"Network suggested best service: {best.service_id}")
        
        try:
            res = client.invoke(
                service_id=best.service_id,
                payload={"text": "名人名言"},
                cost_usdc=float(best.pricing.amount),
            )
            print("\n[ Invoke Success ]")
            print(f"Result        : {res.result}")
            print(f"Fee Deducted  : {res.charged_usdc} USDC")
        except Exception as e:
            print(f"Error calling {best.service_id}: {e}")

if __name__ == '__main__':
    main()
