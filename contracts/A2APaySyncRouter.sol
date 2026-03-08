// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title A2APaySyncRouter
 * @dev A minimalistic synchronous payment router tailored for A2A (Agent-to-Agent) micro-payments.
 * It immediately splits the payment between the platform treasury and the API Provider (Seller),
 * emitting an event that Acts as the execution receipt for Web2 endpoints (like FastAPI).
 */
contract A2APaySyncRouter is Ownable {
    using SafeERC20 for IERC20;

    // Platform fee configuration
    address public feeTreasury;
    uint256 public platformFeeBps; // In basis points (e.g., 100 = 1%)
    uint256 public constant MAX_FEE_BPS = 1000; // Max 10%

    // Primary authorization flag, allowing specific addresses to use particular services
    // Can be used in the future to whitelist specific buyers or pause services.
    bool public isPaused;

    // Events
    event ServicePaid(
        address indexed buyer,
        address indexed seller,
        address indexed token,
        uint256 amount,
        uint256 fee,
        string serviceId
    );

    event TreasuryUpdated(address newTreasury);
    event FeeUpdated(uint256 newFeeBps);
    event Paused(bool isPaused);

    // Modifier to prevent payments during emergencies
    modifier whenNotPaused() {
        require(!isPaused, "A2ASyncRouter: System is paused");
        _;
    }

    /**
     * @dev Constructor
     * @param _feeTreasury Address to receive platform fees
     * @param _platformFeeBps Platform fee in basis points
     */
    constructor(address _feeTreasury, uint256 _platformFeeBps) Ownable(msg.sender) {
        require(_feeTreasury != address(0), "Invalid treasury address");
        require(_platformFeeBps <= MAX_FEE_BPS, "Fee exceeds maximum limit");
        
        feeTreasury = _feeTreasury;
        platformFeeBps = _platformFeeBps;
    }

    /**
     * @notice Pay for an AI Service dynamically and synchronously.
     * @dev The caller (Buyer) must have approved this contract to spend the `amount` of `token`.
     * @param token Address of the ERC20 token (e.g., USDC or USDT)
     * @param seller Address of the Provider / Seller Agent
     * @param amount Total amount paid by the buyer
     * @param serviceId Off-chain identifier of the AI API (e.g., "crypto-analysis-v1")
     */
    function payForService(
        address token,
        address seller,
        uint256 amount,
        string calldata serviceId
    ) external whenNotPaused {
        require(seller != address(0), "A2ASyncRouter: Invalid seller address");
        require(amount > 0, "A2ASyncRouter: Amount must be greater than zero");

        uint256 fee = (amount * platformFeeBps) / 10000;
        uint256 sellerAmount = amount - fee;

        // 1. Transfer total amount from Buyer to Router
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        // 2. Transfer fee to Treasury (if fee > 0)
        if (fee > 0) {
            IERC20(token).safeTransfer(feeTreasury, fee);
        }

        // 3. Transfer the rest to the Seller immediately
        if (sellerAmount > 0) {
            IERC20(token).safeTransfer(seller, sellerAmount);
        }

        // 4. Emit the receipt log to trigger the API server
        emit ServicePaid(msg.sender, seller, token, amount, fee, serviceId);
    }

    // --- Admin Functions ---

    function setFeeTreasury(address _newTreasury) external onlyOwner {
        require(_newTreasury != address(0), "Invalid treasury address");
        feeTreasury = _newTreasury;
        emit TreasuryUpdated(_newTreasury);
    }

    function setPlatformFeeBps(uint256 _newFeeBps) external onlyOwner {
        require(_newFeeBps <= MAX_FEE_BPS, "Fee exceeds maximum limit");
        platformFeeBps = _newFeeBps;
        emit FeeUpdated(_newFeeBps);
    }

    function setPaused(bool _paused) external onlyOwner {
        isPaused = _paused;
        emit Paused(_paused);
    }
}
