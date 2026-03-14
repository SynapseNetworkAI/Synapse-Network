import sys
from loguru import logger

def setup_logger():
    # Remove default console output
    logger.remove()
    
    # Ensure request_id always exists in extra
    logger.configure(extra={"request_id": "SYS"})
    
    # 1) Console output: developer-friendly single-line logs with request_id.
    logger.add(
        sys.stdout,
        colorize=True,
        format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{extra[request_id]}</cyan> | <level>{message}</level>",
        enqueue=True,
    )
    
    # 2) Optional JSON file sink for production shipping/analysis.
    # logger.add(
    #     "logs/gateway_{time:YYYY-MM-DD}.log",
    #     rotation="100 MB",
    #     retention="30 days",
    #     serialize=True,
    #     enqueue=True,
    # )
    
    return logger

setup_logger()
