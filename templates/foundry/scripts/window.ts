/**
 * window.ts - check and open the EVM authorisation window for your deployer.
 *
 * On QoreChain every EVM transaction (a deploy included) needs:
 *   1. a registered ML-DSA-87 key for the sending account, and
 *   2. a live EVM authorisation window, opened by a native-lane message signed
 *      hybrid (secp256k1 + ML-DSA-87).
 *
 * Usage (see README):
 *   pnpm window status     show the account, its PQC key and its window
 *   pnpm window register   register the account's ML-DSA-87 key (once)
 *   pnpm window open       open a window sized for a few deploys
 *
 * The account comes from QORE_MNEMONIC (BIP-44 m/44'/60'/0'/0/0) or, if unset,
 * from PRIVATE_KEY. Its ML-DSA-87 key is derived deterministically from the
 * same secret, so keep using the same one.
 */
import { StargateClient } from "@cosmjs/stargate";
import {
  EthNativeSigner,
  buildRegisterPqcKeyMsg,
  deriveUnifiedAccount,
  fetchPqcStatus,
  isRegisteredPqcKey,
  openEvmWindowMsg,
  signProofOfPossession,
  unifiedAccountFromSeed,
  type UnifiedAccount,
} from "@qorechain/sdk";
import { evmWindowCost, evmWindowStatus } from "@qorechain/evm";

const NETWORKS = {
  testnet: {
    chainId: "qorechain-diana",
    rest: "https://api-testnet.qore.host",
    rpc: "https://rpc-testnet.qore.host",
  },
  mainnet: {
    chainId: "qorechain-vladi",
    rest: "https://api.qore.host",
    rpc: "https://rpc.qore.host",
  },
} as const;

type NetworkName = keyof typeof NETWORKS;

function network(): (typeof NETWORKS)[NetworkName] {
  const name = (process.env.QORE_NETWORK ?? "testnet") as NetworkName;
  const n = NETWORKS[name];
  if (!n) throw new Error(`QORE_NETWORK must be "testnet" or "mainnet", got "${name}"`);
  return n;
}

async function account(): Promise<UnifiedAccount> {
  const mnemonic = process.env.QORE_MNEMONIC?.trim();
  if (mnemonic) return deriveUnifiedAccount(mnemonic, 0);
  const key = process.env.PRIVATE_KEY?.trim();
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error("Set QORE_MNEMONIC, or PRIVATE_KEY as 0x followed by 64 hex characters, in .env");
  }
  return unifiedAccountFromSeed(Uint8Array.from(Buffer.from(key.slice(2), "hex")));
}

/** account_number and sequence over REST; zero for an account never seen. */
async function accountSequence(rest: string, address: string): Promise<{ accountNumber: bigint; sequence: bigint }> {
  const res = await fetch(`${rest}/cosmos/auth/v1beta1/accounts/${address}`);
  if (res.status === 404) {
    throw new Error(`${address} does not exist on chain yet: send it some QOR first`);
  }
  if (!res.ok) throw new Error(`account query failed: HTTP ${res.status}`);
  const body = (await res.json()) as { account?: Record<string, unknown> };
  const acc = (body.account?.base_account ?? body.account ?? {}) as Record<string, string>;
  return { accountNumber: BigInt(acc.account_number ?? "0"), sequence: BigInt(acc.sequence ?? "0") };
}

/** A native-lane fee: hybrid transactions are large, so the gas limit is generous. */
const FEE = { amount: [{ denom: "uqor", amount: "100000" }], gas: "800000" };

async function status(): Promise<void> {
  const net = network();
  const acc = await account();
  console.log(`account:  ${acc.evm}  (${acc.cosmos})`);
  const pqc = await fetchPqcStatus({ rest: net.rest, address: acc.cosmos });
  const mine = pqc.registered ? isRegisteredPqcKey(pqc, acc.pqc.publicKey) : false;
  console.log(
    `PQC key:  ${pqc.registered ? (mine === false ? "registered, but NOT this key" : "registered") : "not registered (run: pnpm window register)"}`,
  );
  const w = await evmWindowStatus({ rest: net.rest, address: acc.cosmos });
  if (!w.found) {
    console.log("window:   none (run: pnpm window open)");
  } else {
    console.log(
      `window:   ${w.live ? "live" : "not usable"}; ${w.remainingBlocks} blocks, ${w.remainingTxs} txs, ${w.remainingValue} uqor left`,
    );
  }
}

async function broadcast(acc: UnifiedAccount, mode: "hybrid" | "classical", messages: Parameters<EthNativeSigner["sign"]>[0]["messages"]): Promise<string> {
  const net = network();
  const { accountNumber, sequence } = await accountSequence(net.rest, acc.cosmos);
  const signer = new EthNativeSigner(acc, { signMode: mode, rest: net.rest });
  const transport = await StargateClient.connect(net.rpc);
  try {
    const res = await signer.signAndBroadcast(transport, {
      chainId: net.chainId,
      accountNumber,
      sequence,
      fee: FEE,
      messages,
    });
    return res.transactionHash;
  } finally {
    transport.disconnect();
  }
}

async function register(): Promise<void> {
  const net = network();
  const acc = await account();
  const pqc = await fetchPqcStatus({ rest: net.rest, address: acc.cosmos });
  if (pqc.registered) {
    console.log("The account already has a PQC key; nothing to do.");
    return;
  }
  // Registration is the one message the chain accepts signed classically.
  const proofOfPossession = signProofOfPossession({ chainId: net.chainId, account: acc.cosmos, keypair: acc.pqc });
  const msg = buildRegisterPqcKeyMsg(acc.cosmos, { pqcKeypair: acc.pqc, proofOfPossession });
  console.log(`registered: ${await broadcast(acc, "classical", [msg])}`);
}

async function open(): Promise<void> {
  const net = network();
  const acc = await account();
  const blocks = BigInt(process.env.QORE_WINDOW_BLOCKS ?? "600");
  const maxTxs = BigInt(process.env.QORE_WINDOW_TXS ?? "5");
  // Each admitted transaction may consume value + gas limit x fee cap. Size the
  // window for `maxTxs` transactions of up to 3,000,000 gas at a 250 gwei fee cap
  // (tools commonly set the cap near twice the 100 gwei base fee).
  const perTx = evmWindowCost({ gas: 3_000_000n, maxFeePerGas: 250_000_000_000n });
  const maxValue = BigInt(process.env.QORE_WINDOW_MAX_UQOR ?? (perTx * maxTxs).toString());
  const msg = openEvmWindowMsg({ sender: acc.cosmos, blocks, maxTxs, maxValue });
  console.log(`opened: ${await broadcast(acc, "hybrid", [msg])}`);
  console.log(`window: ${blocks} blocks, ${maxTxs} txs, ${maxValue} uqor (value plus fees)`);
  console.log("Opening advanced the account's nonce; deploy now.");
}

const commands: Record<string, () => Promise<void>> = { status, register, open };
const cmd = process.argv[2] ?? "status";
const run = commands[cmd];
if (!run) {
  console.error(`Unknown command "${cmd}". Use: status | register | open`);
  process.exit(1);
}
run().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
