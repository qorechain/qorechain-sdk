/**
 * `@qorechain/react` — React hooks and components for quantum-safe QoreChain
 * dApps.
 *
 * Wrap your app in {@link QoreChainProvider} once, then use the hooks
 * ({@link useQoreClient}, {@link useAccount}, {@link useBalance},
 * {@link useConnect} / {@link useWallet}, {@link useTx}, {@link usePqcStatus})
 * and the drop-in components ({@link ConnectButton}, {@link QuantumSafeBadge}).
 *
 * The kit is built entirely on `@qorechain/sdk`: the provider holds a
 * {@link createClient} instance, `useConnect` wraps the existing Keplr/Leap,
 * EIP-1193 (MetaMask), and Wallet-Standard (Phantom) adapters, and
 * `usePqcStatus` / {@link QuantumSafeBadge} surface the SDK's quantum-safe DX so
 * a dApp can be PQC-protected by default.
 */

// Provider + context.
export {
  QoreChainProvider,
  useQoreContext,
  type QoreChainProviderProps,
  type QoreChainProviderConfig,
  type QoreContextValue,
  type ConnectedAddresses,
  type ConnectionStatus,
  type ConnectedWalletKind,
} from "./context";

// Hooks.
export { useQoreClient } from "./hooks/useQoreClient";
export { useAccount, type UseAccountResult } from "./hooks/useAccount";
export {
  useBalance,
  type UseBalanceOptions,
  type UseBalanceResult,
} from "./hooks/useBalance";
export {
  useConnect,
  useWallet,
  type UseConnectResult,
  type ConnectOptions,
  type ConnectKind,
  type Eip1193Like,
  type SolanaProviderLike,
} from "./hooks/useConnect";
export {
  useTx,
  type UseTxResult,
  type SendOptions,
  type TxStatus,
} from "./hooks/useTx";
export {
  usePqcStatus,
  type UsePqcStatusOptions,
  type UsePqcStatusResult,
} from "./hooks/usePqcStatus";

// Components.
export {
  ConnectButton,
  type ConnectButtonProps,
  type ConnectButtonRenderState,
} from "./components/ConnectButton";
export {
  QuantumSafeBadge,
  type QuantumSafeBadgeProps,
  type QuantumSafeRenderState,
} from "./components/QuantumSafeBadge";
