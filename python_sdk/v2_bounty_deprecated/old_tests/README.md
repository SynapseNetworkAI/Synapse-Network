# A2A-Pay 测试模块

这里存放了用于测试买卖双方与仲裁端的所有相关代码和用例。
通过运行不同的测试场景脚本，您可以验证系统在不同条件下的流程正确性（包括正常结算和意外情况的仲裁介入）。

## 目录结构

- `daemons/`: 真实模拟无限轮询和执行的后台进程。
  - `buyer_daemon_example.py`: 轮询需求交付并用大模型做判定，验收发钱或拒绝。
  - `seller_daemon_example.py`: 轮询未锁定的任务并承接，完成任务后交付数据。
  - `jury_daemon_example.py`: 官方仲裁委员会进程，对有纠纷状态(DISPUTED)的任务做最后判决。
- `scenarios/`: 特定确切流的端到端测试用例。
  - `scenario_1_happy_path.py`: 买家发布需求 -> 卖家正常完成 -> 正常结算打款。
  - `scenario_2_seller_bad_data.py`: 买家发布需求 -> 卖家恶意返回敷衍/错误数据 -> 买家验收打回 -> 进入仲裁。
  - `scenario_3_buyer_malicious.py`: 买家发布需求 -> 卖家极高质量完成 -> 买家恶意白嫖拒付 -> 进入仲裁。

## 如何运行场景测试？

启动前提：需要已经启动并运行了 `indexer/main.py`（FastAPI Gateway服务）和本地区块链测试网。

在 `python_sdk` 根目录下执行：

```bash
# 场景1：愉快的正常交易
python -m tests.scenarios.scenario_1_happy_path

# 场景2：糟糕的卖家，被抓包报错
python -m tests.scenarios.scenario_2_seller_bad_data

# 场景3：恶意的买家想白嫖，进入仲裁
python -m tests.scenarios.scenario_3_buyer_malicious
```

随后，您可以独立启动 `python tests/daemons/jury_daemon_example.py` 观察 AI 法官如何处理由场景2和场景3所制造出的仲裁任务。
