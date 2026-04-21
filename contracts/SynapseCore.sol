// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract SynapseCore is Ownable, EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    address public platformSigner;
    
    // 利润记录池: ensures Admin only extracts collected fees, never user principal
    uint256 public platformFeePool;

    mapping(bytes32 => bool) public consumedTickets;

    event DepositInfo(address indexed user, uint256 amount);
    event WithdrawInfo(address indexed user, bytes32 indexed ticketHash, uint256 amount, uint256 fee);
    event PlatformFeeDrawn(address indexed owner, uint256 amount);
    event SignerUpdated(address oldSigner, address newSigner);

    bytes32 private constant WITHDRAW_TYPEHASH =
        keccak256("Withdraw(address user,uint256 amount,uint256 fee,bytes32 ticketId,uint256 deadline)");

    constructor(address _usdc, address _signer, address _initialOwner) 
        Ownable(_initialOwner)
        EIP712("SynapseCore", "1")
    {
        require(_usdc != address(0), "Invalid USDC");
        require(_signer != address(0), "Invalid Signer");
        usdc = IERC20(_usdc);
        platformSigner = _signer;
    }

    function setSigner(address _newSigner) external onlyOwner {
        require(_newSigner != address(0), "Invalid Signer");
        emit SignerUpdated(platformSigner, _newSigner);
        platformSigner = _newSigner;
    }

    function depositWithPermit(
        uint256 amount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant {
        IERC20Permit(address(usdc)).permit(msg.sender, address(this), amount, deadline, v, r, s);
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit DepositInfo(msg.sender, amount);
    }

    function deposit(uint256 amount) external nonReentrant {
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit DepositInfo(msg.sender, amount);
    }

    function withdraw(
        uint256 amount,
        uint256 fee,
        bytes32 ticketId,
        uint256 deadline,
        bytes calldata signature
    ) external nonReentrant {
        require(block.timestamp <= deadline, "Ticket expired");
        require(ticketId != bytes32(0), "Invalid ticket");
        
        bytes32 structHash = keccak256(abi.encode(
            WITHDRAW_TYPEHASH,
            msg.sender,
            amount,
            fee,
            ticketId,
            deadline
        ));
        
        bytes32 ticketHash = _hashTypedDataV4(structHash);
        require(!consumedTickets[ticketHash], "Ticket consumed");

        address signer = ECDSA.recover(ticketHash, signature);
        
        require(signer == platformSigner, "Invalid Oracle Signature");
        consumedTickets[ticketHash] = true;
        
        // 顺手牵羊 0 Gas Protocol Fee Accrual
        if (fee > 0) {
            platformFeePool += fee;
        }
        
        // Transfer principal to the user
        usdc.safeTransfer(msg.sender, amount);
        
        emit WithdrawInfo(msg.sender, ticketHash, amount, fee);
    }

    function isTicketConsumed(bytes32 ticketHash) external view returns (bool) {
        return consumedTickets[ticketHash];
    }

    function withdrawPlatformFees(uint256 amount) external onlyOwner nonReentrant {
        require(amount <= platformFeePool, "Exceeds purely accrued fees");
        platformFeePool -= amount;
        
        usdc.safeTransfer(msg.sender, amount);
        
        emit PlatformFeeDrawn(msg.sender, amount);
    }

}
