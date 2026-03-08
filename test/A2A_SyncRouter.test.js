const { expect } = require('chai');
const { ethers } = require('hardhat');
describe('A2APaySyncRouter', function () {
  let usdc, router, deployer, buyer, seller, treasury;
  beforeEach(async function () {
    [deployer, buyer, seller, treasury] = await ethers.getSigners();
    const MockUSDC = await ethers.getContractFactory('MockUSDC');
    usdc = await MockUSDC.deploy();
    const Router = await ethers.getContractFactory('A2APaySyncRouter');
    router = await Router.deploy(treasury.address, 100);
    const dec = await usdc.decimals();
    const amount = ethers.parseUnits('100', dec);
    await usdc.mint(buyer.address, amount);
    await usdc.connect(buyer).approve(await router.getAddress(), amount);
  });
  it('should split funds', async function () {
    const dec = await usdc.decimals();
    const price = ethers.parseUnits('10', dec);
    await router.connect(buyer).payForService(await usdc.getAddress(), seller.address, price, 'sx');
    expect(await usdc.balanceOf(seller.address)).to.equal(ethers.parseUnits('9.9', dec));
    expect(await usdc.balanceOf(treasury.address)).to.equal(ethers.parseUnits('0.1', dec));
  });
});