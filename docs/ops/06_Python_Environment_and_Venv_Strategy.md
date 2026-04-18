# Python Environment and Venv Strategy

## 1. 结论

Synapse 当前不应把 `gateway`、`provider_service`、`admin/gateway-admin`、`sdk/python` 强行统一到一个虚拟环境里。

应该统一的是：

1. Python 主版本基线
2. 虚拟环境命名约定
3. 安装与启动命令格式
4. CI 的环境创建与校验方式
5. 依赖升级节奏与约束来源

不应该统一的是：

1. 所有子项目共用一个 `.venv`
2. 用某个服务目录的虚拟环境去替代另一个子项目的开发环境
3. 用“本地刚好能跑”替代发布、测试、打包边界

## 2. 为什么不能只用一个虚拟环境

### 2.1 这四类 Python 目录不是同一种产物

当前仓库里至少有四类不同边界：

1. `gateway/` 是运行态结算网关
2. `admin/gateway-admin/` 是后台治理服务
3. `provider_service/` 是 provider 侧服务进程
4. `sdk/python/` 是对外分发的 Python SDK 包

其中前三者本质是长期运行的服务进程，`sdk/python` 则是可安装、可构建、可发布的包。

如果把它们塞进一个虚拟环境，会产生三个直接问题：

1. 服务依赖升级互相污染，定位回归困难
2. SDK 的打包验证会被服务侧额外依赖掩盖
3. 生产与 CI 无法按交付单元独立复现

### 2.2 单一虚拟环境会放大变更爆炸半径

例如：

1. `gateway` 升级 `httpx` 或 `pydantic`，可能影响 `admin/gateway-admin`
2. `provider_service` 引入运行依赖，可能让 `sdk/python` 的本地测试“假通过”
3. 某个目录临时安装 `build`、`pytest-cov`、`ruff`，会让另一个目录误以为这些依赖已经被声明

对 Synapse 这种金融与结算链路系统来说，这种污染会直接削弱可审计性和发布可信度。

### 2.3 生产部署本来就不是一个环境

即便开发时勉强共用一个 `.venv`，上线时也不会这样部署：

1. `gateway` 会独立部署
2. `admin/gateway-admin` 会独立部署
3. `provider_service` 会独立部署
4. `sdk/python` 会独立发布到包分发渠道或供外部项目安装

既然部署边界独立，开发与 CI 的环境边界也应尽量保持一致。

## 3. 推荐策略

### 3.1 基线选择：统一到 3.13.x

推荐把整个仓库的 Python minor version 基线统一到 `3.13.x`。

不建议把仓库基线直接推到 `3.14.x`，原因是：

1. `3.13` 允许直接使用 `typing.Self` 和更严格的现代类型写法，适合当前仓库的资金安全收口
2. `3.13` 对金融与结算路径的静态检查收益更高，能减少 `float` / 宽松签名继续渗透
3. 生产、CI、本地协作最怕 minor version 漂移，统一到 `3.13.x` 更容易复制环境
4. 统一 minor version 比“部分目录 3.12、部分目录 3.13”更不容易在资金与后台链路上产生隐性行为差异

结论：

1. `3.13.x` 作为 Synapse 当前仓库基线
2. 其他 minor version 可以用于个人实验，不作为团队默认开发、CI、生产脚本基线

### 3.2 统一版本，不统一实例

推荐策略是：

1. 整个仓库统一一个 Python minor version 基线：`3.13.x`
2. 每个 Python 子项目各自维护自己的 `.venv`
3. 每个子项目只安装自己声明的依赖
4. 测试、启动、构建都从本目录的 `.venv/bin/python` 触发

这意味着我们统一的是解释器标准，不是共享同一个 site-packages。

### 3.3 每个子项目的标准形态

建议按下面方式收敛：

| 目录 | 角色 | 推荐虚拟环境 | 安装方式 |
| --- | --- | --- | --- |
| `gateway/` | Runtime service | `gateway/.venv` | `pip install -r requirements.txt` |
| `admin/gateway-admin/` | Runtime service | `admin/gateway-admin/.venv` | `pip install -r requirements.txt` |
| `provider_service/` | Runtime service | `provider_service/.venv` | `pip install -r requirements.txt` |
| `sdk/python/` | Distributable package | `sdk/python/.venv` | `pip install -e .` |

### 3.4 允许一个可选的根级工具环境，但它不是事实源

如果团队确实需要一个仓库级工具环境，最多只允许它承担下面的角色：

1. 文档脚本
2. 一次性迁移脚本
3. 开发辅助工具，例如 `pre-commit`、`invoke`、`tox`、`nox`

这个根级工具环境不能替代各子项目自己的运行与测试环境，不能作为：

1. Gateway 的发布验证环境
2. Admin backend 的回归测试环境
3. Provider service 的运行环境
4. SDK 的构建与发布环境

## 4. 目录级执行规范

### 4.1 gateway

```bash
cd /Users/cliff/workspace/Synapse-Network/gateway
python3.13 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
PYTHONPATH="$PWD" .venv/bin/python -m pytest -q
```

### 4.2 admin/gateway-admin

```bash
cd /Users/cliff/workspace/Synapse-Network/admin/gateway-admin
python3.13 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
.venv/bin/python -m pytest -q
```

### 4.3 provider_service

```bash
cd /Users/cliff/workspace/Synapse-Network/provider_service
python3.13 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
.venv/bin/python -m pytest -q
```

### 4.4 sdk/python

```bash
cd /Users/cliff/workspace/Synapse-Network/sdk/python
python3.13 -m venv .venv
source .venv/bin/activate
python -m pip install -e ".[dev]"
PYTHONPATH="$PWD" .venv/bin/python -m pytest synapse_client/test/test_client_unit.py -q
```

如果要做构建校验：

```bash
cd /Users/cliff/workspace/Synapse-Network/sdk/python
.venv/bin/python -m pip install build
.venv/bin/python -m build
```

## 5. 设计原则

### 5.1 交付单元独立

一个目录如果可以独立运行、独立发布、独立回归，就必须有独立环境。

### 5.2 CI 必须复现本地最小真相

CI 不应依赖开发者本地共享环境里“顺手装过”的包。

### 5.3 SDK 必须像外部用户那样被验证

SDK 的测试与构建必须在它自己的环境里完成，否则就无法证明：

1. `pyproject.toml` 声明是完整的
2. `pip install -e .` 的行为是正确的
3. 外部用户不会因为缺少服务侧依赖而失败

### 5.4 生产服务环境要最小化

服务环境越小，越容易：

1. 控制漏洞面
2. 进行依赖审计
3. 快速回滚
4. 定位兼容性回归

## 6. 迁移建议

建议按下面顺序收敛：

1. 停止在 `docs/sdk/README.md` 里使用 `admin/gateway-admin/.venv/bin/python` 作为 SDK 默认解释器
2. 明确四个目录各自的 `.venv` 是默认事实源
3. 在仓库根目录固定 `.python-version = 3.13`，并让 CI 和脚本都解析 `Python 3.13`
4. CI 继续按目录分别建环境与执行测试
5. 后续如果要统一依赖上限，可引入共享 `constraints` 文件，但仍保持目录级虚拟环境隔离

## 7. 文档结论

Synapse 应采用：

**一个仓库级 Python 版本基线 + 多个目录级虚拟环境**

而不是：

**一个仓库级共享 `.venv` 承载所有 Python 子系统**

前者强化可复现、可审计、可发布；后者只是在本地短期省事，但会把测试、发布和运维边界一起做坏。
