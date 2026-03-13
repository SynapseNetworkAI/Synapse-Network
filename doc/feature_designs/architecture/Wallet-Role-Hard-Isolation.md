# Wallet Role Hard Isolation Protocol (钱包双向硬隔离架构)

## 1. 背景与隐患
在目前的架构中，买家(Consumer)需要拥有余额并高频调用，卖家(Provider)负责签名和收款。如果不做严格的角色隔离，**黑客可以在同一钱包地址上既注册服务(卖家)，又铸造调用密钥(买家)**，从而污染系统的账本或绕开同端路由安全检测。

此前的防御主要依赖于两点：
1. **纯前端拦截**: 在主页点击角色时进行 `localStorage` 会话绑定。
2. **读库猜测拦截**: 进入主页时通过请求 `listAgentCredentials` 和 `listServiceRegistry` 查询是否已有对应业务记录。

**问题在于：** 黑客可以直接绕过前端和猜测拦截，直接给后端的网关 `/api/v1/agent-credentials` (买家行为) 以及 `/api/v1/services` (发布行为) 发送 API 请求。如果后端数据库本身不对身份排他性做强校验，同一钱包会被同时赋予两个身份。

## 2. 解决方案：DB 会话与意图绑定 (Hard Isolation)
引入全盘统一的 `WalletRole` 注册表系统：

1. **底层唯一注册表**: 在网关加入 `wallet_roles.json` (或持久化 DB)，数据结构如：`{ "0xAddress": "CONSUMER" }`。
2. **网关写入锁死**: 
   - 只要钱包发起了 `POST /api/v1/agent-credentials` 操作，则将当前钱包记录为 `CONSUMER`。若发现其已经是 `PROVIDER`，返回 403 阻断。
   - 只要钱包发起了 `POST /api/v1/services` 操作，则将当前钱包记录为 `PROVIDER`。若发现其已经是 `CONSUMER`，返回 403 阻断。
3. **前端快速阻断**: 添加 `/api/v1/wallet/role/{address}` 接口，供前端主页进行秒级查询，替代掉以前的猜账本操作，使得前后端隔离策略彻底一致！