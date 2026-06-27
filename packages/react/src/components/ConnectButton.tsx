/**
 * {@link ConnectButton} — a minimal, headless-ish multi-wallet connect control.
 *
 * Renders a connect button (or a small picker when multiple wallet kinds are
 * offered) wired to {@link useConnect}; once connected it shows the truncated
 * address and a disconnect action. Styling is intentionally light — pass
 * `className` / `style` to theme it, or rebuild your own UI on the hooks.
 */

import { type CSSProperties, type ReactNode } from "react";
import { useConnect, type ConnectKind } from "../hooks/useConnect";
import { useAccount } from "../hooks/useAccount";

/** Props for {@link ConnectButton}. */
export interface ConnectButtonProps {
  /**
   * The wallet kinds to offer. With one entry the button connects it directly;
   * with several it renders a button per kind. Defaults to `["keplr"]`.
   */
  wallets?: ConnectKind[];
  /** Optional class applied to the root element. */
  className?: string;
  /** Optional inline styles merged onto the root element. */
  style?: CSSProperties;
  /** Label shown before connecting. Defaults to `"Connect Wallet"`. */
  label?: string;
  /** Render-prop override: full control over the rendered UI. */
  children?: (state: ConnectButtonRenderState) => ReactNode;
}

/** State passed to the {@link ConnectButtonProps.children} render-prop. */
export interface ConnectButtonRenderState {
  /** Whether a wallet is connected. */
  isConnected: boolean;
  /** Whether a connection attempt is in flight. */
  isConnecting: boolean;
  /** The connected primary address, if any. */
  address?: string;
  /** Connect a specific wallet kind. */
  connect(kind?: ConnectKind): void;
  /** Disconnect. */
  disconnect(): void;
  /** The last connection error, if any. */
  error?: Error;
}

const WALLET_LABEL: Record<ConnectKind, string> = {
  keplr: "Keplr",
  leap: "Leap",
  evm: "MetaMask",
  svm: "Phantom",
};

/** Truncate a long address for compact display (`qor1ab…xyz`). */
function truncate(addr: string): string {
  if (addr.length <= 13) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-5)}`;
}

const baseButtonStyle: CSSProperties = {
  font: "inherit",
  padding: "0.5rem 0.9rem",
  borderRadius: "0.5rem",
  border: "1px solid currentColor",
  background: "transparent",
  cursor: "pointer",
};

/**
 * A small connect / disconnect control. Single-wallet by default; pass
 * `wallets` for a multi-wallet picker, or `children` for full custom rendering.
 */
export function ConnectButton(props: ConnectButtonProps): ReactNode {
  const wallets = props.wallets ?? ["keplr"];
  const { connect, disconnect, isConnecting, error } = useConnect();
  const { isConnected, address } = useAccount();

  const doConnect = (kind?: ConnectKind): void => {
    void connect({ kind: kind ?? wallets[0] }).catch(() => {
      // The error is surfaced via the hook's `error`; swallow the rejection so
      // an unhandled promise does not bubble out of the click handler.
    });
  };

  if (props.children) {
    return props.children({
      isConnected,
      isConnecting,
      address,
      connect: doConnect,
      disconnect,
      error,
    });
  }

  if (isConnected && address) {
    return (
      <span className={props.className} style={props.style}>
        <span style={{ marginRight: "0.5rem" }}>{truncate(address)}</span>
        <button
          type="button"
          style={baseButtonStyle}
          onClick={() => disconnect()}
        >
          Disconnect
        </button>
      </span>
    );
  }

  const label = props.label ?? "Connect Wallet";

  return (
    <span className={props.className} style={props.style}>
      {wallets.length === 1 ? (
        <button
          type="button"
          style={baseButtonStyle}
          disabled={isConnecting}
          onClick={() => doConnect(wallets[0])}
        >
          {isConnecting ? "Connecting…" : label}
        </button>
      ) : (
        wallets.map((kind) => (
          <button
            key={kind}
            type="button"
            style={{ ...baseButtonStyle, marginRight: "0.4rem" }}
            disabled={isConnecting}
            onClick={() => doConnect(kind)}
          >
            {WALLET_LABEL[kind]}
          </button>
        ))
      )}
    </span>
  );
}
