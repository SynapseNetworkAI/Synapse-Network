// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract MockUSDC is ERC20, ERC20Permit, Ownable {
    constructor(address initialOwner) ERC20("Mock USDC", "USDC") ERC20Permit("Mock USDC") Ownable(initialOwner) {
        _mint(initialOwner, 1000000 * 10 ** decimals());
    }

    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }
}
