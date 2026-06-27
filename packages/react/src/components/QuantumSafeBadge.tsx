/**
 * {@link QuantumSafeBadge} — a "Quantum-safe" indicator for an address.
 *
 * Reads the address's PQC registration via {@link usePqcStatus} and renders a
 * compact badge: a positive "Quantum-safe" state when a PQC key is registered,
 * otherwise a muted "Not quantum-safe" state (or nothing, with
 * `hideWhenUnsafe`). Styling is minimal; theme it via `className` / `style` or
 * supply a `children` render-prop.
 */

import { type CSSProperties, type ReactNode } from "react";
import { usePqcStatus } from "../hooks/usePqcStatus";

/** Props for {@link QuantumSafeBadge}. */
export interface QuantumSafeBadgeProps {
  /** Address to check. Defaults to the connected account. */
  address?: string;
  /** When `true`, render nothing if the address is not quantum-safe. */
  hideWhenUnsafe?: boolean;
  /** Label for the safe state. Defaults to `"Quantum-safe"`. */
  safeLabel?: string;
  /** Label for the unsafe state. Defaults to `"Not quantum-safe"`. */
  unsafeLabel?: string;
  /** Optional class applied to the root element. */
  className?: string;
  /** Optional inline styles merged onto the root element. */
  style?: CSSProperties;
  /** Render-prop override for full control over the rendered UI. */
  children?: (state: QuantumSafeRenderState) => ReactNode;
}

/** State passed to the {@link QuantumSafeBadgeProps.children} render-prop. */
export interface QuantumSafeRenderState {
  /** Whether the address has a registered PQC key. */
  isRegistered: boolean;
  /** Whether the status is still loading. */
  isLoading: boolean;
  /** The last fetch error, if any. */
  error?: Error;
}

const baseStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.35rem",
  font: "inherit",
  fontSize: "0.85em",
  padding: "0.15rem 0.55rem",
  borderRadius: "999px",
  border: "1px solid currentColor",
  lineHeight: 1.4,
};

/**
 * A badge showing whether an address is quantum-safe (has a registered PQC key).
 */
export function QuantumSafeBadge(props: QuantumSafeBadgeProps): ReactNode {
  const { isRegistered, isLoading, error } = usePqcStatus(props.address);

  if (props.children) {
    return props.children({ isRegistered, isLoading, error });
  }

  if (isLoading && !isRegistered) {
    return (
      <span
        className={props.className}
        style={{ ...baseStyle, opacity: 0.6, ...props.style }}
        data-quantum-safe="loading"
      >
        Checking…
      </span>
    );
  }

  if (!isRegistered) {
    if (props.hideWhenUnsafe) return null;
    return (
      <span
        className={props.className}
        style={{ ...baseStyle, opacity: 0.7, ...props.style }}
        data-quantum-safe="false"
        title="No post-quantum key registered for this address"
      >
        <span aria-hidden="true">○</span>
        {props.unsafeLabel ?? "Not quantum-safe"}
      </span>
    );
  }

  return (
    <span
      className={props.className}
      style={{ ...baseStyle, ...props.style }}
      data-quantum-safe="true"
      title="Post-quantum (ML-DSA-87) key registered — transactions can be hybrid-signed"
    >
      <span aria-hidden="true">🛡️</span>
      {props.safeLabel ?? "Quantum-safe"}
    </span>
  );
}
