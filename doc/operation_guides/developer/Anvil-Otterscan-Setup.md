# Local Otterscan Setup with Anvil

For debugging and block exploration, we recommend using [Otterscan](https://github.com/otterscan/otterscan) along with [Foundry's Anvil](https://github.com/foundry-rs/foundry) node. Anvil provides the specific `erigon_` and `ots_` RPC methods required by the latest versions of Otterscan, which Hardhat currently does not fully support.

## 1. Install Foundry (which includes Anvil)

Install the latest version of Foundry by running the following command in your terminal:

```bash
curl -L https://foundry.paradigm.xyz | bash
```

After installation, reload your shell configuration (e.g., `source ~/.zshenv`, `source ~/.zshrc`, or `source ~/.bashrc`), then initialize Foundry:

```bash
foundryup
```

## 2. Start the Anvil Node

Instead of using `npx hardhat node`, use `anvil` to start your local testnet. This will run on `localhost:8545` by default, making it fully interchangeable with your existing scripts.

```bash
anvil
```

## 3. Run Otterscan via Docker Compose

In the root of the Synapse Network project, we have a `docker-compose.yml` that includes Otterscan.

```bash
cd docker-compose
docker-compose up -d otterscan
```

This starts Otterscan on port `5100`.

## 4. Connect Otterscan to Anvil

1. Open your browser and navigate to [http://localhost:5100](http://localhost:5100).
2. If it asks you to configure the node or shows connection errors, go to the settings page: [http://localhost:5100/scam](http://localhost:5100/scam).
3. In the **Erigon rpcdaemon endpoint** field, enter: `http://127.0.0.1:8545`
4. Press Enter, then return to the main dashboard.

## 5. Adding Anvil Accounts to MetaMask

Anvil uses the exact same default testing mnemonic as Hardhat:
`test test test test test test test test test test test junk`

This means the test accounts and private keys are identical.

### 5.1 Configure the Network (If first time)
If you haven't connected MetaMask to your local node yet, add a new network:
- **Network Name**: Localhost 8545 (or Anvil)
- **RPC URL**: `http://127.0.0.1:8545`
- **Chain ID**: `31337` (Anvil defaults to 31337, same as Hardhat)
- **Currency Symbol**: ETH

### 5.2 Import Test Accounts
To use the pre-funded accounts (each with 10,000 ETH), you can import their private keys directly into MetaMask:

**Account 0 (Default Deployer)**
- Address: `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`
- **Private Key**: `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`

**Account 1**
- Address: `0x70997970C51812dc3A010C7d01b50e0d17dc79C8`
- **Private Key**: `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d`

**Account 2**
- Address: `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC`
- **Private Key**: `0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a`

*Please Note: Never use these test accounts on Mainnet!*

### 5.3 Post-Restart Actions
Because switching from Hardhat to Anvil means starting a fresh chain (Block 0):
1. **Redeploy Contracts**: You must re-deploy our project contracts to the Anvil node by running:
   ```bash
   npx hardhat run scripts/deploy.js --network localhost
   ```
2. **Re-fund USDC**: 
   ```bash
   npx hardhat run scripts/fund_usdc.js --network localhost
   ```
3. **Reset MetaMask Nonce**: If your transactions stall or you see a Nonce error, go to MetaMask **Settings -> Advanced -> Clear activity tab data** (or Reset Account). This clears the cached transaction history so MetaMask syncs with the fresh chain.
