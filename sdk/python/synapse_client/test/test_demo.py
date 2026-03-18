import os
from synapse_client import SynapseClient
from synapse_client.exceptions import SynapseClientError

def test_synapse():
    # 1. 配置参数：由于你在本地，我们需要指定网关，否则代码会默认去连线上的正式服
    # 你这里必须填入你在前端获取的完整 API Key，前缀应该是 agt_ 加上 32位 字符
    api_key = os.getenv("SYNAPSE_API_KEY", "agt_0YJu_WOgq5sZ0YaiHP37dK21j3z9cq_eqfB3yxZ0jXA") 
    gateway_url = "http://127.0.0.1:8000"  # 你本地跑的 Provider Gateway 端口

    print(f"初始化客户端... \nGateway: {gateway_url}")
    client = SynapseClient(api_key=api_key, gateway_url=gateway_url)

    # 2. 根据意图从网络发现服务
    intent_keyword = "名人名言"
    print(f"\n--- 正在寻找处理 [{intent_keyword}] 的 AI 服务 ---")
    try:
        discovery = client.discover_services(intent=intent_keyword)
        if not discovery.services:
            print(f"目前网络内没有匹配 [{intent_keyword}] 的存活服务节点，请检查 gateway/provider_fastapi.py。")
            return
            
        for s in discovery.services:
            print(f"- 找到服务: {s.serviceName} | ID: {s.serviceId} | 定价: {s.pricing}")
            
    except SynapseClientError as e:
        print(f"服务发现失败: {e}")
        return

    # 3. 挑选第一个服务进行调用
    target_service_id = discovery.services[0].serviceId
    # API要求的是 JSON payload: {"text": "..."}
    payload_data = {"text": "想要放弃的时候，请给我一句关于坚持的名人名言"}
    
    print(f"\n--- 准备调用服务 {target_service_id} ---")
    print(f"Payload: {payload_data}")
    
    try:
        # 发起支付 + 调用请求 (使用 service_id 替代 service_name，以及使用 payload 而不是 prompt)
        response = client.call_service(
            service_id=target_service_id, 
            payload=payload_data
        )
        
        print("\n✅ 调用成功！")
        print("======== 返回内容 ========")
        print(response.content)
        print("==========================")
        print(f"💸 代币扣除: {response.fee_deducted} USDC")
        print(f"⛓  上链哈希: {response.tx_hash}")

    except SynapseClientError as e:
        print(f"❌ 调用失败，可能是余额不足或 API Key 错误: {e}")

if __name__ == "__main__":
    test_synapse()