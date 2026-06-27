/**
 * The QoreChain React context: a {@link QoreChainProvider} that holds a single
 * composed {@link QoreChainClient} (from `@qorechain/sdk`'s {@link createClient})
 * plus the live wallet connection state, and the {@link useQoreContext} hook the
 * other hooks build on.
 *
 * One provider near the root of the app is enough; every hook
 * ({@link useQoreClient}, {@link useAccount}, {@link useBalance},
 * {@link useConnect}, {@link useTx}, {@link usePqcStatus}) reads from it.
 */

import {
  createContext,
  useContext,
  useMemo,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import {
  createClient,
  type QoreChainClient,
  type CreateClientOptions,
  type TxClient,
} from "@qorechain/sdk";

/** A connected wallet's resolved addresses, by VM family. */
export interface ConnectedAddresses {
  /** Native bech32 (`qor1...`) address, when a Cosmos wallet is connected. */
  native?: string;
  /** EVM (`0x...`) address, when an EVM wallet is connected. */
  evm?: string;
  /** SVM (base58) address, when an SVM wallet is connected. */
  svm?: string;
}

/** The live connection status of the provider. */
export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

/** Which wallet family is connected. */
export type ConnectedWalletKind = "keplr" | "leap" | "evm" | "svm";

/** The full context value exposed by {@link QoreChainProvider}. */
export interface QoreContextValue {
  /** The composed read client (created once from the provider config). */
  client: QoreChainClient;
  /** Current connection status. */
  status: ConnectionStatus;
  /** The connected addresses, keyed by VM family. Empty when disconnected. */
  addresses: ConnectedAddresses;
  /** Which wallet is connected, if any. */
  wallet?: ConnectedWalletKind;
  /** The connected signing client, if any (set by `useConnect`). */
  tx?: TxClient;
  /** The last connection error, if `status === "error"`. */
  error?: Error;
  /**
   * Internal: replace the connection state. Used by {@link useConnect}; apps use
   * the hooks rather than calling this directly.
   */
  setConnection(next: {
    status: ConnectionStatus;
    addresses?: ConnectedAddresses;
    wallet?: ConnectedWalletKind;
    tx?: TxClient;
    error?: Error;
  }): void;
}

/** Configuration for {@link QoreChainProvider}, forwarded to `createClient`. */
export interface QoreChainProviderConfig {
  /** Network preset to target. Defaults to `"testnet"`. */
  network?: CreateClientOptions["network"];
  /** Endpoint overrides merged over the preset's defaults. */
  endpoints?: CreateClientOptions["endpoints"];
  /** Chain id override. */
  chainId?: CreateClientOptions["chainId"];
  /** Additional HTTP transport options shared by the read clients. */
  http?: CreateClientOptions["http"];
}

/** Props for {@link QoreChainProvider}. */
export interface QoreChainProviderProps {
  /** Network + endpoint configuration for the underlying read client. */
  config: QoreChainProviderConfig;
  /**
   * A pre-built client to use instead of constructing one from `config`. Useful
   * for tests (inject a mocked client) and advanced composition.
   */
  client?: QoreChainClient;
  /** The app subtree that consumes the QoreChain hooks. */
  children: ReactNode;
}

const QoreContext = createContext<QoreContextValue | null>(null);

/**
 * Provide a single composed QoreChain client + connection state to the subtree.
 *
 * The client is created once (memoized on the config identity), so place the
 * provider above any component that uses the hooks. Pass `client` to inject a
 * pre-built (or mocked) client instead.
 */
export function QoreChainProvider(props: QoreChainProviderProps): ReactNode {
  const { config, client: injected, children } = props;

  // Build the read client once. When `injected` is provided it always wins.
  // The config object is treated as stable for the provider's lifetime; callers
  // that need to switch networks should remount the provider with a new `key`.
  // Memoize on the config's primitive fields so a new (but equal) config object
  // identity does not rebuild the client every render.
  const { network, chainId } = config;
  const endpoints = config.endpoints;
  const http = config.http;
  const client = useMemo<QoreChainClient>(() => {
    if (injected) return injected;
    return createClient({ network, endpoints, chainId, http });
  }, [injected, network, chainId, endpoints, http]);

  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [addresses, setAddresses] = useState<ConnectedAddresses>({});
  const [wallet, setWallet] = useState<ConnectedWalletKind | undefined>(
    undefined,
  );
  const [error, setError] = useState<Error | undefined>(undefined);
  // The TxClient is not React state we render off of; keep it in a ref but mirror
  // a setter for hooks. We store it in state too so `useTx` re-renders on connect.
  const txRef = useRef<TxClient | undefined>(undefined);
  const [tx, setTx] = useState<TxClient | undefined>(undefined);

  const setConnection = useCallback<QoreContextValue["setConnection"]>(
    (next) => {
      setStatus(next.status);
      setAddresses(next.addresses ?? {});
      setWallet(next.wallet);
      txRef.current = next.tx;
      setTx(next.tx);
      setError(next.error);
    },
    [],
  );

  const value = useMemo<QoreContextValue>(
    () => ({ client, status, addresses, wallet, tx, error, setConnection }),
    [client, status, addresses, wallet, tx, error, setConnection],
  );

  return <QoreContext.Provider value={value}>{children}</QoreContext.Provider>;
}

/**
 * Read the raw {@link QoreContextValue}. Throws when used outside a
 * {@link QoreChainProvider}. Most apps use the purpose-built hooks instead.
 */
export function useQoreContext(): QoreContextValue {
  const ctx = useContext(QoreContext);
  if (!ctx) {
    throw new Error(
      "useQoreContext: no QoreChainProvider found. Wrap your app in <QoreChainProvider config={...}>.",
    );
  }
  return ctx;
}
