window.buildEthereumFixture = function buildEthereumFixture(
  address,
  chainId,
  chainHex
) {
  const listeners = {};
  return {
    isMetaMask: true,
    chainId: chainHex,
    networkVersion: String(chainId),
    selectedAddress: address,
    _metamask: { isUnlocked: () => Promise.resolve(true) },
    isConnected: () => true,
    request: async (args) => {
      const method = args?.method;
      if (method === "eth_requestAccounts" || method === "eth_accounts")
        return [address];
      if (method === "eth_chainId") return chainHex;
      if (method === "net_version") return String(chainId);
      if (method === "wallet_switchEthereumChain") return null;
      if (method === "wallet_requestPermissions")
        return [{ parentCapability: "eth_accounts" }];
      if (method === "eth_getBalance") return "0x2386f26fc10000";
      if (method === "eth_call") return "0x";
      if (method === "eth_estimateGas") return "0x5208";
      if (method === "eth_gasPrice") return "0x3b9aca00";
      if (
        method === "eth_sendTransaction" &&
        localStorage.getItem("synapse_error_toast_wallet_reject") === "1"
      ) {
        const error = new Error("User denied message signature");
        error.code = 4001;
        throw error;
      }
      if (method === "eth_sendTransaction")
        return "0x0000000000000000000000000000000000000000000000000000000000000abc";
      return null;
    },
    on: (event, cb) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(cb);
    },
    removeListener: (event, cb) => {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter(
          (listener) => listener !== cb
        );
      }
    },
    removeAllListeners: () => {},
  };
};
