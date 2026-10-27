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
  PqcStatusBadge,
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

/** A promise whose resolution the test controls. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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

  it("ignores a late response for the previous address", async () => {
    const { client, getBalance } = mockClient();
    const pending: Record<string, ReturnType<typeof deferred<unknown>>> = {};
    getBalance.mockImplementation(((addr: string) => {
      pending[addr] = deferred<unknown>();
      return pending[addr].promise;
    }) as never);
    function C({ addr }: { addr: string }) {
      const b = useBalance(addr);
      return <span data-testid="bal">{b.data ? b.data.amount : "none"}</span>;
    }
    const { rerender } = render(<C addr="qor1old" />, {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(pending["qor1old"]).toBeDefined());

    rerender(<C addr="qor1new" />);
    await waitFor(() => expect(pending["qor1new"]).toBeDefined());

    // The new address answers first, then the old one arrives late.
    await act(async () => {
      pending["qor1new"].resolve({ balance: { denom: "uqor", amount: "222" } });
    });
    expect(screen.getByTestId("bal").textContent).toBe("222");
    await act(async () => {
      pending["qor1old"].resolve({ balance: { denom: "uqor", amount: "111" } });
    });
    expect(screen.getByTestId("bal").textContent).toBe("222");
  });

  it("clears the old address's data and error when the address changes", async () => {
    const { client, getBalance } = mockClient();
    const pending: Record<string, ReturnType<typeof deferred<unknown>>> = {};
    getBalance.mockImplementation(((addr: string) => {
      pending[addr] = deferred<unknown>();
      return pending[addr].promise;
    }) as never);
    function C({ addr }: { addr: string }) {
      const b = useBalance(addr);
      return (
        <span data-testid="bal">
          {b.error ? `err:${b.error.message}` : b.data ? b.data.amount : "none"}
        </span>
      );
    }
    const { rerender } = render(<C addr="qor1old" />, {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(pending["qor1old"]).toBeDefined());
    await act(async () => {
      pending["qor1old"].resolve({ balance: { denom: "uqor", amount: "111" } });
    });
    expect(screen.getByTestId("bal").textContent).toBe("111");

    rerender(<C addr="qor1new" />);
    // Not the old balance while the new one is loading.
    expect(screen.getByTestId("bal").textContent).toBe("none");

    await waitFor(() => expect(pending["qor1new"]).toBeDefined());
    await act(async () => {
      pending["qor1new"].reject(new Error("boom"));
    });
    expect(screen.getByTestId("bal").textContent).toBe("err:boom");
    rerender(<C addr="qor1third" />);
    expect(screen.getByTestId("bal").textContent).toBe("none");
  });

  it("a refetch kept from the old address does nothing, and an older refetch cannot overwrite a newer one", async () => {
    const { client, getBalance } = mockClient();
    const calls: Array<{
      addr: string;
      d: ReturnType<typeof deferred<unknown>>;
    }> = [];
    getBalance.mockImplementation(((addr: string) => {
      const d = deferred<unknown>();
      calls.push({ addr, d });
      return d.promise;
    }) as never);
    let latest: (() => Promise<void>) | undefined;
    function C({ addr }: { addr: string }) {
      const b = useBalance(addr);
      latest = b.refetch;
      return <span data-testid="bal">{b.data ? b.data.amount : "none"}</span>;
    }
    const { rerender } = render(<C addr="qor1old" />, {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(calls.length).toBe(1));
    const oldRefetch = latest!;

    rerender(<C addr="qor1new" />);
    await waitFor(() => expect(calls.length).toBe(2));
    await act(async () => {
      void oldRefetch();
    });
    // No request went out for the old address.
    expect(calls.map((c) => c.addr)).toEqual(["qor1old", "qor1new"]);

    // A second (newer) request for the same address resolves first.
    await act(async () => {
      void latest!();
    });
    expect(calls.length).toBe(3);
    await act(async () => {
      calls[2].d.resolve({ balance: { denom: "uqor", amount: "333" } });
    });
    expect(screen.getByTestId("bal").textContent).toBe("333");
    await act(async () => {
      calls[1].d.resolve({ balance: { denom: "uqor", amount: "200" } });
      calls[0].d.resolve({ balance: { denom: "uqor", amount: "100" } });
    });
    expect(screen.getByTestId("bal").textContent).toBe("333");
  });

  it("does not update state after unmount", async () => {
    const { client, getBalance } = mockClient();
    const d = deferred<unknown>();
    getBalance.mockImplementation((() => d.promise) as never);
    const errSpy = vi.spyOn(console, "error");
    function C() {
      const b = useBalance("qor1abc");
      return <span>{b.data ? b.data.amount : "none"}</span>;
    }
    const { unmount } = render(<C />, { wrapper: wrapper(client) });
    await waitFor(() => expect(getBalance).toHaveBeenCalled());
    unmount();
    await act(async () => {
      d.resolve({ balance: { denom: "uqor", amount: "1" } });
    });
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe("usePqcStatus + PqcStatusBadge", () => {
  it("ignores a late status for the previous address", async () => {
    const { client, getPqcKeyStatus } = mockClient();
    const pending: Record<string, ReturnType<typeof deferred<unknown>>> = {};
    getPqcKeyStatus.mockImplementation(((addr: string) => {
      pending[addr] = deferred<unknown>();
      return pending[addr].promise;
    }) as never);
    function C({ addr }: { addr: string }) {
      const s = usePqcStatus(addr);
      return (
        <span data-testid="pqc">
          {s.data ? (s.isRegistered ? "safe" : "unsafe") : "none"}
        </span>
      );
    }
    const { rerender } = render(<C addr="qor1old" />, {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(pending["qor1old"]).toBeDefined());

    rerender(<C addr="qor1new" />);
    await waitFor(() => expect(pending["qor1new"]).toBeDefined());

    await act(async () => {
      pending["qor1new"].resolve({ registered: false, algorithmId: 1 });
    });
    expect(screen.getByTestId("pqc").textContent).toBe("unsafe");
    // The old address IS registered; its late answer must not mark the new
    // address as registered.
    await act(async () => {
      pending["qor1old"].resolve({ registered: true, algorithmId: 1 });
    });
    expect(screen.getByTestId("pqc").textContent).toBe("unsafe");
  });

  it("clears the old address's status when the address changes", async () => {
    const { client, getPqcKeyStatus } = mockClient();
    const pending: Record<string, ReturnType<typeof deferred<unknown>>> = {};
    getPqcKeyStatus.mockImplementation(((addr: string) => {
      pending[addr] = deferred<unknown>();
      return pending[addr].promise;
    }) as never);
    function C({ addr }: { addr: string }) {
      const s = usePqcStatus(addr);
      return (
        <span data-testid="pqc">
          {s.data ? (s.isRegistered ? "safe" : "unsafe") : "none"}
        </span>
      );
    }
    const { rerender } = render(<C addr="qor1old" />, {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(pending["qor1old"]).toBeDefined());
    await act(async () => {
      pending["qor1old"].resolve({ registered: true, algorithmId: 1 });
    });
    expect(screen.getByTestId("pqc").textContent).toBe("safe");
    rerender(<C addr="qor1new" />);
    expect(screen.getByTestId("pqc").textContent).toBe("none");
  });
  it("usePqcStatus reports registered true", async () => {
    const { client } = mockClient({ registered: true });
    function C() {
      const s = usePqcStatus("qor1abc");
      return <span>{s.isRegistered ? "safe" : "unsafe"}</span>;
    }
    render(<C />, { wrapper: wrapper(client) });
    await waitFor(() => expect(screen.getByText("safe")).toBeTruthy());
  });

  it("renders the registered badge when registered", async () => {
    const { client } = mockClient({ registered: true });
    const { container } = render(<PqcStatusBadge address="qor1abc" />, {
      wrapper: wrapper(client),
    });
    await waitFor(() =>
      expect(screen.getByText("PQC key registered")).toBeTruthy(),
    );
    const root = container.querySelector("[data-pqc-status]");
    expect(root?.getAttribute("data-pqc-status")).toBe("true");
    expect(root?.getAttribute("data-quantum-safe")).toBe("true");
  });

  it("renders the unregistered badge when not registered", async () => {
    const { client } = mockClient({ registered: false });
    const { container } = render(<PqcStatusBadge address="qor1abc" />, {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(screen.getByText("No PQC key")).toBeTruthy());
    const root = container.querySelector("[data-pqc-status]");
    expect(root?.getAttribute("data-pqc-status")).toBe("false");
    expect(root?.getAttribute("data-quantum-safe")).toBe("false");
  });

  it("hides the badge when unregistered and hideWhenUnsafe is set", async () => {
    const { client } = mockClient({ registered: false });
    const { container } = render(
      <PqcStatusBadge address="qor1abc" hideWhenUnsafe />,
      { wrapper: wrapper(client) },
    );
    // Give the effect a tick; nothing should render.
    await waitFor(() =>
      expect(container.querySelector("[data-pqc-status]")).toBeNull(),
    );
    expect(container.querySelector("[data-quantum-safe]")).toBeNull();
  });

  it("keeps QuantumSafeBadge as a deprecated alias of PqcStatusBadge", async () => {
    expect(QuantumSafeBadge).toBe(PqcStatusBadge);
    const { client } = mockClient({ registered: true });
    render(<QuantumSafeBadge address="qor1abc" safeLabel="custom label" />, {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(screen.getByText("custom label")).toBeTruthy());
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
