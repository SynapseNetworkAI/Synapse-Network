# Feature Design Map

本目录只放“专题深化设计”，不放整个平台的 canonical 主协议。

换句话说：

1. `docs/agent/` 定义主模型和主协议。
2. 本目录补充某个前端或后台专题如何落地。

## 子目录说明

### frontend_product/

用于前端专题设计，当前重点包括：

1. [frontend_product/Homepage_V2_Functional_Design.md](./frontend_product/Homepage_V2_Functional_Design.md)
2. [frontend_product/Provider_Console_IA_V3.md](./frontend_product/Provider_Console_IA_V3.md)
3. [frontend_product/Wallet_Auth_Challenge_Session_Design.md](./frontend_product/Wallet_Auth_Challenge_Session_Design.md)
4. [frontend_product/Security-Key-Management.md](./frontend_product/Security-Key-Management.md)

### backend_admin/

用于后台专题设计，当前重点包括：

1. [backend_admin/Deposit_Reconciliation_Backoffice_Requirements.md](./backend_admin/Deposit_Reconciliation_Backoffice_Requirements.md)

## 使用原则

1. 先看根目录 README 和对应业务域 README，再看这里的专题深化。
2. 本目录不负责重新定义身份模型、Runtime 协议和数据库主语义。
3. 如果某专题已经上升为主流程设计，应把 canonical 部分回写到 `docs/agent/`、`docs/01_Product_Frontend/`、`docs/03_Core_Workflows/` 或其他官方业务模块。