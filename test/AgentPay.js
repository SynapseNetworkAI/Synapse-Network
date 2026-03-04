const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("🤖 AgentPay Protocol MVP - 机器经济实盘推演", function () {
  let usdc;
  let escrow;
  let smartWallet;
  let owner, treasury, aiBuyerWallet, aiSellerWallet, aiSessionKey;

  // USDC 的精度是 6
  const parseUSDC = (val) => ethers.parseUnits(val, 6);

  before(async function () {
    [owner, treasury, aiBuyerWallet, aiSellerWallet, aiSessionKey] = await ethers.getSigners();

    // 1. 发行一波我们自己的测试 USDC
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    usdc = await MockUSDC.deploy();
    await usdc.waitForDeployment();

    // 2. 部署 AgentPay Escrow (平台抽水的核心机器)
    const Escrow = await ethers.getContractFactory("AgentPayEscrow");
    escrow = await Escrow.deploy(await usdc.getAddress(), treasury.address);
    await escrow.waitForDeployment();

    // 3. 部署买方 AI 的智能钱包 (带有每日限额防暴走功能)
    const SmartWallet = await ethers.getContractFactory("AgentSmartWallet");
    smartWallet = await SmartWallet.deploy(owner.address);
    await smartWallet.waitForDeployment();

    // 4. 老板给智能钱包充值 100 USDC 当作 AI 的储备金
    await usdc.mint(await smartWallet.getAddress(), parseUSDC("100"));
  });

  it("Step 1: 老板为 AI 颁发 Session Key 并设置每日 10 USDC 额度", async function () {
    await smartWallet.connect(owner).issueSessionKey(aiSessionKey.address, parseUSDC("10"));
    expect(await smartWallet.agentSessionKey()).to.equal(aiSessionKey.address);
    expect(await smartWallet.dailyLimit()).to.equal(parseUSDC("10"));
  });

  it("Step 2: AI 使用 Session Key 免密发起购买 (原子级担保交易)", async function () {
    const payAmount = parseUSDC("2"); // AI 要花 2 USDC 购买数据
    const taskId = ethers.encodeBytes32String("AI-TASK-001");

    // 打包 AI 要执行的子交易数据 (第一小步：授权给 Escrow 合约扣款)
    const approveData = usdc.interface.encodeFunctionData("approve", [
      await escrow.getAddress(),
      payAmount
    ]);
    
    // AI 用 Session Key 偷偷帮自己把授权签了
    await smartWallet.connect(aiSessionKey).executeAsAgent(await usdc.getAddress(), approveData, 0n);

    // 第二小步：调用 Escrow 进行锁款
    const lockFundsData = escrow.interface.encodeFunctionData("lockFunds", [
      taskId,
      aiSellerWallet.address,
      payAmount
    ]);

    // AI 继续用 Session Key 发起资金托管！系统扣除它的花销限额！
    // 监听事件：看到 TaskCreated，说明钱安全锁在里面了
    await expect(
      smartWallet.connect(aiSessionKey).executeAsAgent(await escrow.getAddress(), lockFundsData, payAmount)
    )
      .to.emit(escrow, "TaskCreated")
      .withArgs(taskId, await smartWallet.getAddress(), aiSellerWallet.address, payAmount);

    // 验证：Escrow 合约账户应该多出了 2 块钱
    expect(await usdc.balanceOf(await escrow.getAddress())).to.equal(payAmount);
    
    // 验证：AI 的每日限额已被消耗 2 块钱
    expect(await smartWallet.spentToday()).to.equal(payAmount);
  });

  it("Step 3: 卖方交货，AI 释放资金，平台无情抽走 2.5% 利润", async function () {
    const payAmount = parseUSDC("2");
    const taskId = ethers.encodeBytes32String("AI-TASK-001");

    // 买方 AI 验证到数据后，触发放款机制
    const releaseFundsData = escrow.interface.encodeFunctionData("releaseFunds", [
      taskId
    ]);

    // 调用放量，且不占用新的消费额度（amount 参数传0）
    await expect(
      smartWallet.connect(aiSessionKey).executeAsAgent(await escrow.getAddress(), releaseFundsData, 0n)
    ).to.emit(escrow, "TaskCompleted");

    // ===================================
    // 最激动人心的时刻：分钱！
    // 2 块钱的 2.5% = 0.05 块钱
    // 卖方实际收入 = 1.95 块钱
    // ===================================
    const expectedFee = parseUSDC("0.05");
    const expectedSellerAmount = parseUSDC("1.95");

    expect(await usdc.balanceOf(aiSellerWallet.address)).to.equal(expectedSellerAmount);
    expect(await usdc.balanceOf(treasury.address)).to.equal(expectedFee);

    console.log(`\n       💰 [财务报表]`);
    console.log(`       卖方 Agent 入账: ${ethers.formatUnits(expectedSellerAmount, 6)} USDC`);
    console.log(`       咱们平台抽水入账: ${ethers.formatUnits(expectedFee, 6)} USDC\n`);
  });

  it("Step 4: AI 尝试背叛老板超额消费，被智能合约直接击毙 (防暴走测试)", async function () {
    const hugeAmount = parseUSDC("9"); // 今天已经花了 2 块，再花 9 块就会超每日 10 块限额
    
    const fakeData = "0x";
    
    // AI 用它的 Session Key 偷偷试图把里面的钱卷走，被抓个现行！
    await expect(
      smartWallet.connect(aiSessionKey).executeAsAgent(owner.address, fakeData, hugeAmount)
    ).to.be.revertedWith("Agent exceeded daily limit! Boss is angry.");
  });
});
