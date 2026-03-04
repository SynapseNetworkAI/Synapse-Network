// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// 这是一个用于本地测试的模拟 USDC 合约
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}

    function mint(address to, uint256 amount) public {
        _mint(to, amount);
    }

    // USDC 的精度是 6
    function decimals() public view virtual override returns (uint8) {
        return 6;
    }
}
