/**
 * Shared setup for the scripts: the network, the account and a hybrid-signing
 * transaction client.
 *
 * The account is the standard native one derived from QORE_MNEMONIC. QoreChain
 * signs native transactions hybrid (secp256k1 + ML-DSA-87); the ML-DSA-87 key
 * is derived from the same mnemonic and must already be registered for the
 * account (see README).
 */
import {
  getNetwork,
  createClient,
  deriveNativeAccount,
  derivePqcCanonical,
  directSignerFromPrivateKey,
  type TxClient,
} from "@qorechain/sdk";
import { MsgInstantiateContract, MsgExecuteContract } from "cosmjs-types/cosmwasm/wasm/v1/tx";

// The public endpoints come from the SDK's network presets. Set
// QORE_REST_URL / QORE_RPC_URL to use your own node instead.
const preset = (name: "testnet" | "mainnet") => {
  const n = getNetwork(name);
  return {
    chainId: n.chainId,
    rest: process.env.QORE_REST_URL?.trim() || n.endpoints.rest,
    rpc: process.env.QORE_RPC_URL?.trim() || n.endpoints.rpc,
  };
};

export const NETWORKS = {
  testnet: preset("testnet"),
  mainnet: preset("mainnet"),
} as const;

export type NetworkName = keyof typeof NETWORKS;

export function networkName(): NetworkName {
  const name = (process.env.QORE_NETWORK ?? "testnet") as NetworkName;
  if (!(name in NETWORKS)) throw new Error(`QORE_NETWORK must be "testnet" or "mainnet", got "${name}"`);
  return name;
}

export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Set ${name} in .env`);
  return value;
}

/** Connect a transaction client that signs hybrid for the QORE_MNEMONIC account. */
export async function connect(): Promise<{ tx: TxClient; address: string; network: NetworkName }> {
  const network = networkName();
  const endpoints = NETWORKS[network];
  const mnemonic = requireEnv("QORE_MNEMONIC");
  const account = await deriveNativeAccount(mnemonic);
  const signer = await directSignerFromPrivateKey(account.privateKey, "qor");
  const pqcKeypair = derivePqcCanonical(account.address, mnemonic);
  const client = createClient({ network, endpoints: { rest: endpoints.rest, rpc: endpoints.rpc } });
  const tx = await client.connectTx(signer, {
    pqcKeypair,
    registryTypes: [
      ["/cosmwasm.wasm.v1.MsgInstantiateContract", MsgInstantiateContract],
      ["/cosmwasm.wasm.v1.MsgExecuteContract", MsgExecuteContract],
    ],
  });
  return { tx, address: account.address, network };
}

/** GET a JSON document from the network's REST API. */
export async function restGet<T>(path: string): Promise<T> {
  const { rest } = NETWORKS[networkName()];
  const res = await fetch(`${rest}${path}`);
  const body = (await res.json()) as T & { message?: string };
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${body.message ?? ""}`);
  return body;
}
