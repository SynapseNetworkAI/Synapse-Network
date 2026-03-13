# 平台网关服务(API Gateway)应用日志接入与设计方案

本文档规范了平台网关（Seller API）的内部应用级别日志（Application Logger）的选型、规范以及在核心路由 `generate_response_v2` 中的具体接入方案。

## 一、 日志框架选型：推荐使用 `Loguru`

在 FastAPI 项目中，推荐完全放弃 Python 原生的 `logging` 模块，改用 **Loguru** 框架。

**推荐理由：**
1. **开箱即用 & 结构化支持**：原生支持将日志输出为标准的 JSON 格式序列化（`serialize=True`），这是后续接入 ELK（Elasticsearch + Logstash + Kibana）等日志平台的必要前置条件。
2. **免配多线程/异步问题**：Loguru 对异步框架十分友好。
3. **强大的上下文绑定 (Context Variables)**：利用 `.bind()` 机制，可以轻松将 `request_id` 绑定到该请求生命周知的所有日志节点中，无需每次手动传参。
4. **日志轮转与保留策略**：只需一行代码即可实现按天切割、按文件大小切割（如 `rotation="50 MB"`）。

---

## 二、 日志结构设计规范

所有的网关应用日志应当输出为 JSON 格式，并必须包含以下核心上下文：

- **`timestamp`**: 日志发生的时间戳。
- **`level`**: INFO / WARNING / ERROR。
- **`request_id`**: 全局追踪 ID（与业务扣费日志中的 Request ID 保持 100% 一致）。
- **`action`**: 当前日志所属的子动作（如 `request_enter`, `request_exit`, `billing_success`）。

---

## 三、 代码接入方案

### 1. 安装 Loguru 并进行基础配置 (如在 `log_config.py` 中)

```python
# pip install loguru
import sys
from loguru import logger

def setup_logger():
    # 移除默认的控制台输出
    logger.remove()
    
    # 1. 终端输出（供本地调试，带高亮颜色）
    logger.add(sys.stdout, colorize=True, format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{extra[request_id]}</cyan> | <level>{message}</level>", enqueue=True)
    
    # 2. 存入文件（供生产环境收集，输出为原生 JSON 格式）
    logger.add(
        "logs/gateway_{time:YYYY-MM-DD}.log", 
        rotation="100 MB",     # 每 100MB 轮转一次
        retention="30 days",   # 保留最近 30 天日志
        serialize=True,        # 【核心】结构化为 JSON
        enqueue=True           # 开启异步写入队列，保证高并发下不阻塞 FastAPI
    )
    
    return logger
```

### 2. 在 `generate_response_v2` 中注入和记录（记录请求与响应）

为了记录请求的入出状态、参数及计算耗时，我们需要在路由函数中接入 Loguru，并结合前面设计好的 `request_id` 进行 Context 绑定。

**核心代码实现：**

```python
import time
from fastapi import APIRouter, Request, BackgroundTasks
from loguru import logger # 引入 loguru

router = APIRouter()

@router.post("/v1/generate_v2")
async def generate_response_v2(
    request: Request,
    body: dict,
    background_tasks: BackgroundTasks
):
    # 1. 获取（或生成）此请求的 Request ID
    request_id = request.headers.get("X-Request-Id") or request.state.request_id
    
    # 2. 绑定 Request ID 到当前协程上下文的 Logger
    # 此后通过 req_logger 打印的任何日志，都会自动带上 "request_id" 字段！
    req_logger = logger.bind(request_id=request_id)
    
    start_time = time.time()
    
    # ====== 【请求进入日志】 ======
    # 如果 payload 很大，建议精简或遮选 (Mask) 后打印
    req_logger.bind(action="request_enter").info(
        "Generate request started", 
        client_ip=request.client.host,
        payload=body
    )
    
    # ----------------------------------------------------
    #      (这里是原有的业务处理逻辑：鉴权、寻找Provider、扣费等)
    # ----------------------------------------------------
    try:
        # 伪代码：处理请求
        bot_response = await perform_some_ai_generation(body)
        
        # 成功后的扣费逻辑...
        pass
        
    except Exception as e:
        # ====== 【请求异常日志】 ======
        process_time_ms = round((time.time() - start_time) * 1000, 2)
        req_logger.bind(action="request_error", error=str(e), process_time_ms=process_time_ms).error("Generate request failed")
        raise e
        
    finally:
        # 此处可以做一些清理工作
        pass

    # 计算整体耗时
    process_time_ms = round((time.time() - start_time) * 1000, 2)
    response_data = {
        "status": "success",
        "result": bot_response,
        "request_id": request_id
    }

    # ====== 【请求结束日志】 ======
    req_logger.bind(action="request_exit", process_time_ms=process_time_ms).info(
        "Generate request completed",
        response=response_data
    )

    return response_data
```

---

## 四、 最佳实践补充：全局中间件日志 (Middleware Logging)

如果日后网关的接口变多，不仅限于 `generate_response_v2`，每个接口都写一遍进入和离开的日志会非常冗余。
**生产级别的推荐做法是：将全局请求与响应的日志记录提取到 FastAPI 的 Middleware 中实现**，而在 `generate_response_v2` 中只负责记录核心业务逻辑状态（如“扣费成功”、“路由转发成功”），彻底剥离通用的进出日志。

### 示例中间件：

```python
from starlette.middleware.base import BaseHTTPMiddleware
from loguru import logger
import time
import uuid

class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get("X-Request-Id") or str(uuid.uuid4())
        
        # 将 request_id 塞给 request.state，方便下游使用
        request.state.request_id = request_id
        
        req_logger = logger.bind(request_id=request_id)
        start_time = time.time()
        
        req_logger.info(f"==> Incoming Request: {request.method} {request.url.path}")
        
        response = await call_next(request)
        
        process_time_ms = round((time.time() - start_time) * 1000, 2)
        req_logger.info(f"<== Request completed: {response.status_code} in {process_time_ms}ms")
        
        # 注入 Header
        response.headers["X-Request-Id"] = request_id
        return response

# 在 main.py 中： app.add_middleware(RequestLoggingMiddleware)
```
使用中间件拦截的好处是，所有的路由都会被自动统一覆盖日志，极大地保护了业务代码（像 `generate_response_v2`）的纯粹性。