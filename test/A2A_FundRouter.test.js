const { expect } = require('chai');
const { ethers } = require('hardhat');
describe('A2A_FundRouter (Relayer Pattern)', function () {
    let A2A_FundRouter, fundRouter, MockUSDC, usdc;
    let owner, master, subAccount, relayer, treasury, attacker;
    const INITIAL_MASTER_BALANCE = ethers.parseUnits('1000', 6);
    const APPROVAL_AMOUNT = ethers.parseUnits('10000', 6);
    beforeEach(async function () {
        [owner, master, subAccount, relayer, treasury, attacker] = await ethers.getSigners();
        MockUSDC = await ethers.getContractFactory('MockUSDC');
        usdc = await MockUSDC.deploy();
        await usdc.mint(master.address, INITIAL_MASTER_BALANCE);
        A2A_FundRouter = await ethers.getContractFactory('A2A_FundRouter');
        fundRouter = await A2A_FundRouter.deploy(await usdc.getAddress(), treasury.address);
        await fundRouter.setRelayerStatus(relayer.address, true);
        await fundRouter.registerSubAccount(master.address, subAccount.address, true);
        await usdc.connect(master).approve(await fundRouter.getAddress(), APPROVAL_AMOUNT);
    });
    describe('Deployment & Configuration', function () {
        it('should set the right owner', async function () {
            expect(await fundRouter.owner()).to.equal(owner.address);
        });
        it('should correctly store payment token and treasury', async function () {
            expect(await fundRouter.paymentToken()).to.equal(await usdc.getAddress());
            expect(await fundRouter.platformTreasury()).to.equal(treasury.address);
        });
    });
    describe('triggerTopUp (Relayer)', function () {
        it('should top up, deduct gas and 0.1% platform fee', async function () {
            const topUpAmount = ethers.parseUnits('100', 6);
            const gasCost = ethers.parseUnits('0.5', 6);
            const expectedFee = ethers.parseUnits('0.1', 6);
            const expectedTotalDeduction = topUpAmount + gasCost + expectedFee;
            await expect(fundRouter.connect(relayer).triggerTopUp(
                master.address, subAccount.address, topUpAmount, gasCost
            )).to.emit(fundRouter, 'TopUpTriggered').withArgs(master.address, subAccount.address, topUpAmount, gasCost + expectedFee);
            const expectedNewMasterBal = INITIAL_MASTER_BALANCE - expectedTotalDeduction;
            expect(await usdc.balanceOf(master.address)).to.equal(expectedNewMasterBal);
            expect(await usdc.balanceOf(subAccount.address)).to.equal(topUpAmount);
            expect(await usdc.balanceOf(treasury.address)).to.equal(gasCost + expectedFee);
        });
    });
});
