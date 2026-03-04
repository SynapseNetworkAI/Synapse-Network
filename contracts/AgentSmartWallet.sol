// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title AgentSmartWallet
 * @dev 挂载在人类老板名下的“智能体专属钱包”。
 * 利用会话密钥（Session Key）技术，让写在 Python 脚本里的 AI 凭临时私钥可以直接免密转账。
 * 但是通过合约底层的**每日消费限额（Daily Limit）**物理锁死，防止 AI 暴走。
 */
contract AgentSmartWallet {
    address public humanOwner;      // 人类老板的 MetaMask
    address public agentSessionKey; // 发给小弟 AI 的临时操作私钥对应的公钥

    uint256 public dailyLimit;      // 每日最大消耗额度 (如 10 USDC)
    uint256 public spentToday;      // 今天花进去的钱
    uint256 public lastResetTime;   // 上次重置限额的时间戳

    modifier onlyOwner() {
        require(msg.sender == humanOwner, "Only Human Owner!");
        _;
    }

    constructor(address _humanOwner) {
        humanOwner = _humanOwner;
        lastResetTime = block.timestamp;
    }

    /**
     * @dev 人类老板赋予 AI（代码）执行权限和额度
     * @param _sessionKey Python 脚本中 AI 持有的临时私钥对应的地址
     * @param _dailyLimit 每天的预算
     */
    function issueSessionKey(address _sessionKey, uint256 _dailyLimit) external onlyOwner {
        agentSessionKey = _sessionKey;
        dailyLimit = _dailyLimit;
    }

    /**
     * @dev AI 代码（或代理合约）调用此方法替自己花钱
     * @param target 目标购买的合约地址（比如 Escrow 担保合约）
     * @param data 调用该合约的哈希数据（包含要买什么、向谁买）
     * @param amount 涉及的支付金额（用于额度风控）
     */
    function executeAsAgent(address target, bytes calldata data, uint256 amount) external {
        // 1. 权限校验：这笔调用必须是由该 Session Key 签名的
        require(msg.sender == agentSessionKey, "Invalid Session Key");

        // 2. 额度恢复逻辑：过晚上12点，重新刷新 AI 带薪预算
        if (block.timestamp >= lastResetTime + 1 days) {
            spentToday = 0;
            lastResetTime = block.timestamp;
        }

        // 3. 防跑飞物理锁死 (非常硬核的规则)
        require(spentToday + amount <= dailyLimit, "Agent exceeded daily limit! Boss is angry.");

        // 4. 更新消耗，执行购买！(在 Base 链直接打向买入合约)
        spentToday += amount;

        (bool success, bytes memory result) = target.call(data);
        require(success, string(result));
    }

    /**
     * @dev 提现操作：万一不想让 AI 干了，老板随时直接把所有余额掏空
     */
    function emergencyWithdraw() external onlyOwner {
        // 逻辑略，把里面存放的 ETH 或 USDC 强行抽出到 humanOwner 账户中
    }
}
