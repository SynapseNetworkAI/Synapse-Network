// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract A2A_FundRouter is Ownable {
    IERC20 public paymentToken;
    address public platformTreasury;
    
    mapping(address => bool) public isAuthorizedRelayer;
    mapping(address => mapping(address => bool)) public isSubAccountRegistered;

    event RelayerAuthorized(address indexed relayer, bool status);
    event SubAccountRegistered(address indexed master, address indexed subAccount, bool status);
    event TopUpTriggered(address indexed master, address indexed subAccount, uint256 amount, uint256 feeAndGas);

    modifier onlyRelayer() {
        require(isAuthorizedRelayer[msg.sender], "A2A_FundRouter: caller is not an authorized relayer");
        _;
    }

    constructor(address _paymentToken, address _platformTreasury) Ownable(msg.sender) {
        paymentToken = IERC20(_paymentToken);
        platformTreasury = _platformTreasury;
    }

    function setRelayerStatus(address _relayer, bool _status) external onlyOwner {
        isAuthorizedRelayer[_relayer] = _status;
        emit RelayerAuthorized(_relayer, _status);
    }

    function registerSubAccount(address master, address subAccount, bool status) external onlyOwner {
        isSubAccountRegistered[master][subAccount] = status;
        emit SubAccountRegistered(master, subAccount, status);
    }

    function setTreasury(address _treasury) external onlyOwner {
        platformTreasury = _treasury;
    }

    function triggerTopUp(address master, address subAccount, uint256 amount, uint256 gasCost) external onlyRelayer {
        require(isSubAccountRegistered[master][subAccount], "A2A_FundRouter: unregistered sub-account");
        
        uint256 platformFee = (amount * 1) / 1000;
        
        require(paymentToken.transferFrom(master, subAccount, amount), "A2A_FundRouter: TopUp transfer failed");
        require(paymentToken.transferFrom(master, platformTreasury, gasCost + platformFee), "A2A_FundRouter: Fee/Gas transfer failed");

        emit TopUpTriggered(master, subAccount, amount, gasCost + platformFee);
    }
}
