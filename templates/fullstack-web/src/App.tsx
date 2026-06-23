import { useMemo, useState } from "react";

import { createClient, type QoreChainClient } from "@qorechain/sdk";

// Endpoints come from Vite env vars (VITE_-prefixed), with localhost defaults so
// the app runs out of the box against a local node. Override in `.env`.
const REST_URL = import.meta.env.VITE_QORE_REST_URL ?? "http://localhost:1317";
const EVM_RPC_URL =
  import.meta.env.VITE_QORE_EVM_RPC_URL ?? "http://localhost:8545";

interface Balance {
  denom: string;
  amount: string;
}

export function App(): JSX.Element {
  // One client for the app's lifetime.
  const client: QoreChainClient = useMemo(
    () =>
      createClient({
        network: "testnet",
        endpoints: { rest: REST_URL, evmRpc: EVM_RPC_URL },
      }),
    [],
  );

  const [address, setAddress] = useState("");
  const [balances, setBalances] = useState<Balance[] | null>(null);
  const [tokenomics, setTokenomics] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadBalance(): Promise<void> {
    setError(null);
    setBalances(null);
    if (!address.trim()) {
      setError("Enter an address first.");
      return;
    }
    setLoading(true);
    try {
      const res = await client.rest.getAllBalances(address.trim());
      setBalances(res.balances as Balance[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function loadTokenomics(): Promise<void> {
    setError(null);
    setTokenomics(null);
    setLoading(true);
    try {
      const overview = await client.qor.getTokenomicsOverview();
      setTokenomics(JSON.stringify(overview, null, 2));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: 720,
        margin: "2rem auto",
        padding: "0 1rem",
        lineHeight: 1.5,
      }}
    >
      <h1>QoreChain dApp</h1>
      <p style={{ color: "#555" }}>
        Network: <code>{client.network.name}</code> (
        <code>{client.network.chainId ?? "n/a"}</code>) &middot; REST:{" "}
        <code>{REST_URL}</code>
      </p>

      <section style={{ marginTop: "1.5rem" }}>
        <h2>Native balance</h2>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="qor1…"
            style={{ flex: 1, padding: "0.5rem" }}
            aria-label="QoreChain address"
          />
          <button onClick={loadBalance} disabled={loading}>
            Get balance
          </button>
        </div>
        {balances && (
          <ul>
            {balances.length === 0 && <li>(no balances)</li>}
            {balances.map((b) => (
              <li key={b.denom}>
                {b.amount} {b.denom}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <h2>Tokenomics overview</h2>
        <button onClick={loadTokenomics} disabled={loading}>
          Read qor_getTokenomicsOverview
        </button>
        {tokenomics && (
          <pre
            style={{
              background: "#f5f5f5",
              padding: "1rem",
              overflowX: "auto",
              borderRadius: 6,
            }}
          >
            {tokenomics}
          </pre>
        )}
      </section>

      {error && (
        <p style={{ color: "#b00020", marginTop: "1rem" }} role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
