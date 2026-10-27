import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * Deploys Counter. On QoreChain the deployer needs a registered ML-DSA-87 key
 * and a live EVM authorisation window first (see README: pnpm window open).
 */
export default buildModule("CounterModule", (m) => {
  const initial = m.getParameter("initial", 0n);
  const counter = m.contract("Counter", [initial]);
  return { counter };
});
