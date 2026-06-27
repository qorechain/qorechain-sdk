/**
 * Minimal React dApp wiring together the @qorechain/react kit:
 *   QoreChainProvider → ConnectButton → balance → QuantumSafeBadge.
 *
 * Point the endpoints at your node and run `pnpm dev`.
 */

import {
  QoreChainProvider,
  ConnectButton,
  QuantumSafeBadge,
  useAccount,
  useBalance,
  usePqcStatus,
} from "@qorechain/react";

function Dashboard() {
  const { address, isConnected } = useAccount();
  const { data: balance, isLoading } = useBalance(undefined, {
    refreshInterval: 10_000,
  });
  const { isRegistered } = usePqcStatus();

  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 560, margin: "3rem auto" }}>
      <h1>QoreChain React dApp</h1>

      <ConnectButton wallets={["keplr", "leap", "evm"]} />

      {isConnected && (
        <section style={{ marginTop: "1.5rem" }}>
          <p>
            <strong>Address:</strong> {address}
          </p>
          <p>
            <strong>Balance:</strong>{" "}
            {isLoading
              ? "loading…"
              : `${balance?.amount ?? "0"} ${balance?.denom ?? "uqor"}`}
          </p>
          <p>
            <QuantumSafeBadge />{" "}
            {isRegistered
              ? "Your account is protected by a post-quantum key."
              : "Register a PQC key to become quantum-safe."}
          </p>
        </section>
      )}
    </main>
  );
}

export default function App() {
  return (
    <QoreChainProvider
      config={{
        network: "testnet",
        endpoints: {
          rpc: "http://localhost:26657",
          rest: "http://localhost:1317",
          evmRpc: "http://localhost:8545",
        },
      }}
    >
      <Dashboard />
    </QoreChainProvider>
  );
}
