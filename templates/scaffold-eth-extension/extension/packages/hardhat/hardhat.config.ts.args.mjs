export const configOverrides = {
  networks: {
    qorechainTestnet: {
      type: "http",
      url: "https://evm-testnet.qore.host",
      accounts: ["$$deployerPrivateKey$$"],
      chainId: 9800,
    },
    qorechain: {
      type: "http",
      url: "https://evm.qore.host",
      accounts: ["$$deployerPrivateKey$$"],
      chainId: 9801,
    },
  },
};
