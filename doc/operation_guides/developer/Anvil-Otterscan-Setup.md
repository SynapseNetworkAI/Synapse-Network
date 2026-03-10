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

In the root of the A2A-pay project, we have a `docker-compose.yml` that includes Otterscan.

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

Otterscan will now connect perfectly to your Anvil node, providing deep transaction tracing and fast block browsing.
