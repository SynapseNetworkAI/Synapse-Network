const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const TOKEN_UNIT = 10n ** 18n;

async function deployFixture() {
  const [owner, platformSigner, user, attacker, nextSigner] = await ethers.getSigners();

  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();

  const SynapseCore = await ethers.getContractFactory("SynapseCore");
  const core = await SynapseCore.deploy(
    await usdc.getAddress(),
    platformSigner.address,
    owner.address,
  );

  await usdc.mint(user.address, 1_000n * TOKEN_UNIT);
  await usdc.connect(user).approve(await core.getAddress(), 1_000n * TOKEN_UNIT);

  return { owner, platformSigner, user, attacker, nextSigner, usdc, core };
}

async function signWithdraw(core, signer, user, amount, fee, nonce, deadline) {
  const network = await ethers.provider.getNetwork();
  return signer.signTypedData(
    {
      name: "SynapseCore",
      version: "1",
      chainId: network.chainId,
      verifyingContract: await core.getAddress(),
    },
    {
      Withdraw: [
        { name: "user", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "fee", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    {
      user: user.address,
      amount,
      fee,
      nonce,
      deadline,
    },
  );
}

describe("SynapseCore security invariants", function () {
  it("rejects zero custody and signer addresses during deployment", async function () {
    const [owner, signer] = await ethers.getSigners();
    const SynapseCore = await ethers.getContractFactory("SynapseCore");

    await expect(
      SynapseCore.deploy(ethers.ZeroAddress, signer.address, owner.address),
    ).to.be.revertedWith("Invalid USDC");

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const usdc = await MockUSDC.deploy();

    await expect(
      SynapseCore.deploy(await usdc.getAddress(), ethers.ZeroAddress, owner.address),
    ).to.be.revertedWith("Invalid Signer");
  });

  it("accepts deposits and emits the chain custody event", async function () {
    const { user, usdc, core } = await deployFixture();
    const amount = 100n * TOKEN_UNIT;

    await expect(core.connect(user).deposit(amount))
      .to.emit(core, "DepositInfo")
      .withArgs(user.address, amount);

    expect(await usdc.balanceOf(await core.getAddress())).to.equal(amount);
  });

  it("executes a valid signed withdrawal once and accrues protocol fee", async function () {
    const { owner, platformSigner, user, usdc, core } = await deployFixture();
    const depositAmount = 100n * TOKEN_UNIT;
    const withdrawAmount = 40n * TOKEN_UNIT;
    const fee = 2n * TOKEN_UNIT;
    const nonce = 0n;
    const deadline = BigInt(await time.latest()) + 3600n;

    await core.connect(user).deposit(depositAmount);
    const beforeUserBalance = await usdc.balanceOf(user.address);
    const signature = await signWithdraw(
      core,
      platformSigner,
      user,
      withdrawAmount,
      fee,
      nonce,
      deadline,
    );

    await expect(core.connect(user).withdraw(withdrawAmount, fee, nonce, deadline, signature))
      .to.emit(core, "WithdrawInfo")
      .withArgs(user.address, withdrawAmount, fee);

    expect(await core.userNonces(user.address)).to.equal(1n);
    expect(await core.platformFeePool()).to.equal(fee);
    expect(await usdc.balanceOf(user.address)).to.equal(beforeUserBalance + withdrawAmount);

    await expect(core.connect(owner).withdrawPlatformFees(fee))
      .to.emit(core, "PlatformFeeDrawn")
      .withArgs(owner.address, fee);
    expect(await core.platformFeePool()).to.equal(0n);
  });

  it("prevents replaying a consumed withdrawal ticket", async function () {
    const { platformSigner, user, core } = await deployFixture();
    const amount = 10n * TOKEN_UNIT;
    const fee = 1n * TOKEN_UNIT;
    const nonce = 0n;
    const deadline = BigInt(await time.latest()) + 3600n;

    await core.connect(user).deposit(50n * TOKEN_UNIT);
    const signature = await signWithdraw(core, platformSigner, user, amount, fee, nonce, deadline);

    await core.connect(user).withdraw(amount, fee, nonce, deadline, signature);
    await expect(
      core.connect(user).withdraw(amount, fee, nonce, deadline, signature),
    ).to.be.revertedWith("Invalid nonce");
  });

  it("rejects expired tickets, wrong signers, wrong nonces, and tampered amounts", async function () {
    const { platformSigner, user, attacker, core } = await deployFixture();
    const amount = 10n * TOKEN_UNIT;
    const fee = 1n * TOKEN_UNIT;
    const validDeadline = BigInt(await time.latest()) + 3600n;

    await core.connect(user).deposit(100n * TOKEN_UNIT);

    const expiredDeadline = BigInt(await time.latest()) - 1n;
    const expiredSignature = await signWithdraw(
      core,
      platformSigner,
      user,
      amount,
      fee,
      0n,
      expiredDeadline,
    );
    await expect(
      core.connect(user).withdraw(amount, fee, 0n, expiredDeadline, expiredSignature),
    ).to.be.revertedWith("Ticket expired");

    const wrongSignerSignature = await signWithdraw(
      core,
      attacker,
      user,
      amount,
      fee,
      0n,
      validDeadline,
    );
    await expect(
      core.connect(user).withdraw(amount, fee, 0n, validDeadline, wrongSignerSignature),
    ).to.be.revertedWith("Invalid Oracle Signature");

    const wrongNonceSignature = await signWithdraw(
      core,
      platformSigner,
      user,
      amount,
      fee,
      1n,
      validDeadline,
    );
    await expect(
      core.connect(user).withdraw(amount, fee, 1n, validDeadline, wrongNonceSignature),
    ).to.be.revertedWith("Invalid nonce");

    const signature = await signWithdraw(core, platformSigner, user, amount, fee, 0n, validDeadline);
    await expect(
      core.connect(user).withdraw(amount + 1n, fee, 0n, validDeadline, signature),
    ).to.be.revertedWith("Invalid Oracle Signature");
    await expect(
      core.connect(user).withdraw(amount, fee + 1n, 0n, validDeadline, signature),
    ).to.be.revertedWith("Invalid Oracle Signature");
  });

  it("limits platform fee withdrawals to accrued fees only", async function () {
    const { owner, platformSigner, user, core } = await deployFixture();
    const amount = 20n * TOKEN_UNIT;
    const fee = 3n * TOKEN_UNIT;
    const deadline = BigInt(await time.latest()) + 3600n;

    await core.connect(user).deposit(100n * TOKEN_UNIT);
    await expect(core.connect(owner).withdrawPlatformFees(1n)).to.be.revertedWith(
      "Exceeds purely accrued fees",
    );

    const signature = await signWithdraw(core, platformSigner, user, amount, fee, 0n, deadline);
    await core.connect(user).withdraw(amount, fee, 0n, deadline, signature);

    await expect(core.connect(owner).withdrawPlatformFees(fee + 1n)).to.be.revertedWith(
      "Exceeds purely accrued fees",
    );
    await core.connect(owner).withdrawPlatformFees(fee);
  });

  it("restricts signer rotation to the owner and rejects zero signer", async function () {
    const { owner, attacker, platformSigner, nextSigner, core } = await deployFixture();

    await expect(core.connect(attacker).setSigner(nextSigner.address)).to.be.reverted;

    await expect(core.connect(owner).setSigner(ethers.ZeroAddress)).to.be.revertedWith(
      "Invalid Signer",
    );

    await expect(core.connect(owner).setSigner(nextSigner.address))
      .to.emit(core, "SignerUpdated")
      .withArgs(platformSigner.address, nextSigner.address);
    expect(await core.platformSigner()).to.equal(nextSigner.address);
  });
});
