// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract AgentPayEscrow {
    IERC20 public immutable settlementToken;
    address public treasury;
    
    uint256 public feeBasisPoints = 250;
    uint256 public constant DENOMINATOR = 10000;
    uint256 public constant TIMELOCK_DURATION = 1 hours;

    enum TaskStatus { Locked, Completed, Disputed, Resolved }

    struct Task {
        address buyer;
        address seller;
        uint256 totalAmount;
        TaskStatus status;
        uint256 createdAt;
    }

    mapping(bytes32 => Task) public tasks;

    event TaskCreated(bytes32 indexed taskId, address indexed buyer, address indexed seller, uint256 amount);
    event TaskCompleted(bytes32 indexed taskId, address indexed seller, uint256 sellerAmount, uint256 feeAmount);
    event DisputeRaised(bytes32 indexed taskId, address indexed raiser);
    event DisputeResolved(bytes32 indexed taskId, address indexed winner);

    constructor(address _settlementToken, address _treasury) {
        settlementToken = IERC20(_settlementToken);
        treasury = _treasury;
    }

    function lockFunds(bytes32 taskId, address seller, uint256 amount) external {
        require(tasks[taskId].buyer == address(0), 'Task already exists');
        require(amount > 0, 'Amount must be greater than 0');

        require(settlementToken.transferFrom(msg.sender, address(this), amount), 'Transfer failed');

        tasks[taskId] = Task({
            buyer: msg.sender,
            seller: seller,
            totalAmount: amount,
            status: TaskStatus.Locked,
            createdAt: block.timestamp
        });

        emit TaskCreated(taskId, msg.sender, seller, amount);
    }

    function releaseFunds(bytes32 taskId) external {
        Task storage task = tasks[taskId];
        require(task.buyer != address(0), 'Task does not exist');
        require(task.status == TaskStatus.Locked, 'Task not in Locked status');
        require(msg.sender == task.buyer, 'Only buyer can release funds');

        task.status = TaskStatus.Completed;

        uint256 feeAmount = (task.totalAmount * feeBasisPoints) / DENOMINATOR;
        uint256 sellerAmount = task.totalAmount - feeAmount;

        require(settlementToken.transfer(task.seller, sellerAmount), 'Transfer to seller failed');
        if (feeAmount > 0) {
            require(settlementToken.transfer(treasury, feeAmount), 'Transfer to treasury failed');
        }

        emit TaskCompleted(taskId, task.seller, sellerAmount, feeAmount);
    }

    function raiseDispute(bytes32 taskId) external {
        Task storage task = tasks[taskId];
        require(task.status == TaskStatus.Locked, 'Task not in Locked status');
        require(msg.sender == task.buyer || msg.sender == task.seller, 'Not participant');

        task.status = TaskStatus.Disputed;
        emit DisputeRaised(taskId, msg.sender);
    }

    function resolveDispute(bytes32 taskId, address winner) external {
        require(msg.sender == treasury, 'Only treasury/Jury can resolve');
        Task storage task = tasks[taskId];
        require(task.status == TaskStatus.Disputed, 'Task not in Disputed status');
        require(winner == task.buyer || winner == task.seller, 'Invalid winner');

        task.status = TaskStatus.Resolved;

        if (winner == task.seller) {
            uint256 feeAmount = (task.totalAmount * feeBasisPoints) / DENOMINATOR;
            uint256 sellerAmount = task.totalAmount - feeAmount;

            require(settlementToken.transfer(task.seller, sellerAmount), 'Transfer to seller failed');
            if (feeAmount > 0) {
                require(settlementToken.transfer(treasury, feeAmount), 'Transfer to treasury failed');
            }
            emit TaskCompleted(taskId, task.seller, sellerAmount, feeAmount);
        } else {
            require(settlementToken.transfer(task.buyer, task.totalAmount), 'Refund to buyer failed');
        }

        emit DisputeResolved(taskId, winner);
    }

    function autoRelease(bytes32 taskId) external {
        Task storage task = tasks[taskId];
        require(task.status == TaskStatus.Locked, 'Task not in Locked status');
        require(msg.sender == task.seller, 'Only seller can auto release');
        require(block.timestamp > task.createdAt + TIMELOCK_DURATION, 'Timelock not expired');

        task.status = TaskStatus.Completed;

        uint256 feeAmount = (task.totalAmount * feeBasisPoints) / DENOMINATOR;
        uint256 sellerAmount = task.totalAmount - feeAmount;

        require(settlementToken.transfer(task.seller, sellerAmount), 'Transfer to seller failed');
        if (feeAmount > 0) {
            require(settlementToken.transfer(treasury, feeAmount), 'Transfer to treasury failed');
        }

        emit TaskCompleted(taskId, task.seller, sellerAmount, feeAmount);
    }
}
