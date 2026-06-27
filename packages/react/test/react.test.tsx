import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import type { ReactNode } from "react";

import {
  QoreChainProvider,
  useQoreClient,
  useAccount,
  useBalance,
  usePqcStatus,
  useConnect,
  QuantumSafeBadge,
  ConnectButton,
} from "../src/index";

/**
 * Build a minimal mocked QoreChainClient. Only the surface the hooks touch is
 * implemented: `network.coin.base`, `rest.getBalance`, `qor.getPqcKeyStatus`,
 * and `connectTx`.
 */
function mockClient(opts: {
  balance?: string;
  registered?: boolean;
} = {}) {
  const getBalance = vi.fn(async () => ({
    balance: { denom: "uqor", amount: opts.balance ?? "1000000" },
  }));
  const getPqcKeyStatus = vi.fn(async () => ({
    registered: opts.registered ?? false,
    algorithmId: 1,
  }));
  const connectTx = vi.fn(async () => ({
    senderAddress: "qor1signer",
    signAndBroadcast: vi.fn(),
    bankSend: vi.fn(),
  }));
  const client = {
    network: {
      name: "testnet",
      chainId: "qorechain-test",
      coin: { base: "uqor", display: "QOR", exponent: 6 },
      bech32: {
        account: "qor",
        validator: "qorvaloper",
        consensus: "qorvalcons",
      },
      endpoints: {
        rpc: "http://localhost:26657",
        rest: "http://localhost:1317",
        evmRpc: "http://localhost:8545",
      },
    },
    rest: { getBalance },
    qor: { getPqcKeyStatus },
    connectTx,
  };
  return { client, getBalance, getPqcKeyStatus, connectTx };
}

function wrapper(client: unknown) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QoreChainProvider
        config={{ network: "testnet" }}
        client={client as never}
      >
        {children}
      </QoreChainProvider>
    );
  };
}

describe("QoreChainProvider + useQoreClient", () => {
  it("provides the injected client", () => {
    const { client } = mockClient();
    let seen: unknown;
    function C() {
      seen = useQoreClient();
      return null;
    }
    render(<C />, { wrapper: wrapper(client) });
    expect(seen).toBe(client);
  });

  it("useQoreContext throws outside a provider", () => {
    function C() {
      useQoreClient();
      return null;
    }
    // Suppress the expected React error boundary console noise.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<C />)).toThrow(/no QoreChainProvider/);
    spy.mockRestore();
  });
});

describe("useAccount", () => {
  it("reports disconnected by default", () => {
    const { client } = mockClient();
    function C() {
      const a = useAccount();
      return <span>{a.isConnected ? "yes" : "no"}</span>;
    }
    render(<C />, { wrapper: wrapper(client) });
    expect(screen.getByText("no")).toBeTruthy();
  });
});

describe("useBalance", () => {
  it("fetches and exposes the balance for an address", async () => {
    const { client, getBalance } = mockClient({ balance: "4200000" });
    function C() {
      const b = useBalance("qor1abc");
      return <span>{b.data ? b.data.amount : "loading"}</span>;
    }
    render(<C />, { wrapper: wrapper(client) });
    await waitFor(() => expect(screen.getByText("4200000")).toBeTruthy());
    expect(getBalance).toHaveBeenCalledWith("qor1abc", "uqor");
  });

  it("surfaces an error", async () => {
    const { client, getBalance } = mockClient();
    getBalance.mockRejectedValueOnce(new Error("boom"));
    function C() {
      const b = useBalance("qor1abc");
      return <span>{b.error ? b.error.message : "ok"}</span>;
    }
    render(<C />, { wrapper: wrapper(client) });
    await waitFor(() => expect(screen.getByText("boom")).toBeTruthy());
  });
});

describe("usePqcStatus + QuantumSafeBadge", () => {
  it("usePqcStatus reports registered true", async () => {
    const { client } = mockClient({ registered: true });
    function C() {
      const s = usePqcStatus("qor1abc");
      return <span>{s.isRegistered ? "safe" : "unsafe"}</span>;
    }
    render(<C />, { wrapper: wrapper(client) });
    await waitFor(() => expect(screen.getByText("safe")).toBeTruthy());
  });

  it("renders the safe badge when registered", async () => {
    const { client } = mockClient({ registered: true });
    render(<QuantumSafeBadge address="qor1abc" />, {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(screen.getByText("Quantum-safe")).toBeTruthy());
  });

  it("renders the unsafe badge when not registered", async () => {
    const { client } = mockClient({ registered: false });
    render(<QuantumSafeBadge address="qor1abc" />, {
      wrapper: wrapper(client),
    });
    await waitFor(() =>
      expect(screen.getByText("Not quantum-safe")).toBeTruthy(),
    );
  });

  it("hides the badge when unsafe and hideWhenUnsafe is set", async () => {
    const { client } = mockClient({ registered: false });
    const { container } = render(
      <QuantumSafeBadge address="qor1abc" hideWhenUnsafe />,
      { wrapper: wrapper(client) },
    );
    // Give the effect a tick; nothing should render.
    await waitFor(() =>
      expect(container.querySelector('[data-quantum-safe]')).toBeNull(),
    );
  });
});

describe("useConnect (mocked wallet) + ConnectButton", () => {
  beforeEach(() => {
    // Provide a mock injected Cosmos wallet on window for getCosmosWallet.
    (window as unknown as Record<string, unknown>).keplr = {
      experimentalSuggestChain: vi.fn(async () => {}),
      enable: vi.fn(async () => {}),
      getOfflineSignerAuto: vi.fn(async () => ({
        getAccounts: async () => [
          { address: "qor1connected", pubkey: new Uint8Array() },
        ],
      })),
      getOfflineSigner: vi.fn(),
    };
  });

  it("connects a Cosmos wallet and updates account state", async () => {
    const { client, connectTx } = mockClient();
    let connectFn: (() => Promise<void>) | undefined;
    function C() {
      const { connect } = useConnect();
      const a = useAccount();
      connectFn = () => connect({ kind: "keplr" });
      return <span>{a.address ?? "none"}</span>;
    }
    render(<C />, { wrapper: wrapper(client) });
    expect(screen.getByText("none")).toBeTruthy();

    await act(async () => {
      await connectFn!();
    });
    await waitFor(() =>
      expect(screen.getByText("qor1connected")).toBeTruthy(),
    );
    expect(connectTx).toHaveBeenCalled();
  });

  it("ConnectButton renders a connect control", () => {
    const { client } = mockClient();
    render(<ConnectButton label="Connect" />, { wrapper: wrapper(client) });
    expect(screen.getByText("Connect")).toBeTruthy();
  });

  it("ConnectButton render-prop exposes connection state", () => {
    const { client } = mockClient();
    render(
      <ConnectButton>
        {({ isConnected }) => <span>{isConnected ? "in" : "out"}</span>}
      </ConnectButton>,
      { wrapper: wrapper(client) },
    );
    expect(screen.getByText("out")).toBeTruthy();
  });
});
