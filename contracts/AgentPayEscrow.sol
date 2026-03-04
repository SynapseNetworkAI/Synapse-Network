// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title AgentPayEscrow
 * @dev AgentPay 核心交易路由与担保合约（部署在 Base 链）
 * 实现 AI Agent 之间的“一手交钱、一手交接口”，并提取固定比例的协议费。
 */
interface IERC20 {
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract AgentPayEscrow {
    IERC20 public immutable settlementToken; // 结算代币（如 USDC）
    address public treasury;                 // 平台国库地址
    
    uint256 public feeBasisPoints = 250;     // 协议抽水：2.5% (250 / 10000)
    uint256 public constant DENOMINATOR = 10000;

    // 记录每笔交易的任务状态
    struct Task {
        address buyer;
        address seller;
        uint256 totalAmount;
        bool isCompleted;
    }

    mapping(bytes32 => Task) public tasks;

    // 事件：用于被链下 SDK 监听
    event TaskCreated(bytes32 indexed taskId, address indexed buyer, address indexed seller, uint256 amount);
    event TaskCompleted(bytes32 indexed taskId, address indexed seller, uint256 sellerAmount, uint256 feeAmount);

    /**
     * @param _settlementToken USDC在Base链上的合约地址
     * @param _treasury 咱们平台的国库钱包地址，用来装那 2.5% 的利润
     */
    constructor(address _settlementToken, address _treasury) {
        settlementToken = IERC20(_settlementToken);
        treasury = _treasury;
    }

    /**
     * @dev Step 1: 买方 Agent 发起任务并锁仓资金
     * @param taskId 唯一任务ID（可由买卖双方通过 Hash(交易内容) 生成）
     * @param seller 卖方 Agent 的钱包地址
     * @param amount 支付额度 (如 2 USDC = 2 * 10^6)
     */
    function lockFunds(bytes32 taskId, address seller, uint256 amount) external {
        require(tasks[taskId].buyer == address(0), "Task already exists");
        require(amount > 0, "Amount must be greater than 0");

        // 将买方的 USDC 扣除并锁入本合约
        // Note: 买方 Wallet 需提前 Approve 给本合约
        require(settlementToken.transferFrom(msg.sender, address(this), amount), "Transfer failed");

        tasks[taskId] = Task({
            buyer: msg.sender,
            seller: seller,
            totalAmount: amount,
            isCompleted: false
        });

        emit TaskCreated(taskId, msg.sender, seller, amount);
    }

    /**
     * @dev Step 2: 买方 Agent 验证到数据后，触发放款 (或者平台充当 Oracle 触发)
     * @param taskId 唯一任务ID
     */
    function releaseFunds(bytes32 taskId) external {
        Task storage task = tasks[taskId];
        require(task.buyer != address(0), "Task does not exist");
        require(!task.isCompleted, "Task already completed");
        require(msg.sender == task.buyer, "Only buyer can release funds"); // 极简MVP：由买方确认收货

        task.isCompleted = true;

        // 计算抽成
        uint256 feeAmount = (task.totalAmount * feeBasisPoints) / DENOMINATOR;
        uint256 sellerAmount = task.totalAmount - feeAmount;

        // 瞬间打给卖方 97.5%
        require(settlementToken.transfer(task.seller, sellerAmount), "Transfer to seller failed");
        
        // 抽水进入国库 2.5%
        if (feeAmount > 0) {
            require(settlementToken.transfer(treasury, feeAmount), "Transfer to treasury failed");
        }

        emit TaskCompleted(taskId, task.seller, sellerAmount, feeAmount);
    }
}
