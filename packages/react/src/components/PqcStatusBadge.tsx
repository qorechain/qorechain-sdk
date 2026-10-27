/**
 * {@link PqcStatusBadge} - shows whether an address has a registered PQC key.
 *
 * Reads the address's PQC registration via {@link usePqcStatus} and renders a
 * compact badge: a positive "PQC key registered" state when an ML-DSA-87 key is
 * registered, otherwise a muted "No PQC key" state (or nothing, with
 * `hideWhenUnsafe`). Styling is minimal; theme it via `className` / `style` or
 * supply a `children` render-prop.
 *
 * The root element carries `data-pqc-status` and, for existing stylesheets,
 * `data-quantum-safe`, both set to `"loading"`, `"false"` or `"true"`.
 *
 * {@link QuantumSafeBadge} is the earlier name of this component and remains
 * exported as a deprecated alias.
 */

import { type CSSProperties, type ReactNode } from "react";
import { usePqcStatus } from "../hooks/usePqcStatus";

/** Props for {@link PqcStatusBadge}. */
export interface PqcStatusBadgeProps {
  /** Address to check. Defaults to the connected account. */
  address?: string;
  /** When `true`, render nothing if the address has no registered PQC key. */
  hideWhenUnsafe?: boolean;
  /** Label for the registered state. Defaults to `"PQC key registered"`. */
  safeLabel?: string;
  /** Label for the unregistered state. Defaults to `"No PQC key"`. */
  unsafeLabel?: string;
  /** Optional class applied to the root element. */
  className?: string;
  /** Optional inline styles merged onto the root element. */
  style?: CSSProperties;
  /** Render-prop override for full control over the rendered UI. */
  children?: (state: PqcStatusRenderState) => ReactNode;
}

/** State passed to the {@link PqcStatusBadgeProps.children} render-prop. */
export interface PqcStatusRenderState {
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
 * A badge showing whether an address has a registered PQC (ML-DSA-87) key.
 */
export function PqcStatusBadge(props: PqcStatusBadgeProps): ReactNode {
  const { isRegistered, isLoading, error } = usePqcStatus(props.address);

  if (props.children) {
    return props.children({ isRegistered, isLoading, error });
  }

  if (isLoading && !isRegistered) {
    return (
      <span
        className={props.className}
        style={{ ...baseStyle, opacity: 0.6, ...props.style }}
        data-pqc-status="loading"
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
        data-pqc-status="false"
        data-quantum-safe="false"
        title="No ML-DSA-87 key registered for this address"
      >
        <span aria-hidden="true">○</span>
        {props.unsafeLabel ?? "No PQC key"}
      </span>
    );
  }

  return (
    <span
      className={props.className}
      style={{ ...baseStyle, ...props.style }}
      data-pqc-status="true"
      data-quantum-safe="true"
      title="Post-quantum (ML-DSA-87) key registered - transactions can be hybrid-signed"
    >
      <span aria-hidden="true">🛡️</span>
      {props.safeLabel ?? "PQC key registered"}
    </span>
  );
}

/**
 * @deprecated Use {@link PqcStatusBadge}. Kept as an alias for compatibility.
 */
export const QuantumSafeBadge = PqcStatusBadge;

/**
 * @deprecated Use {@link PqcStatusBadgeProps}. Kept as an alias for compatibility.
 */
export type QuantumSafeBadgeProps = PqcStatusBadgeProps;

/**
 * @deprecated Use {@link PqcStatusRenderState}. Kept as an alias for compatibility.
 */
export type QuantumSafeRenderState = PqcStatusRenderState;
