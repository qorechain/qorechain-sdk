import { describe, it, expect, vi } from "vitest";
import { TxRaw, TxBody } from "cosmjs-types/cosmos/tx/v1beta1/tx";
import { SimulateResponse } from "cosmjs-types/cosmos/tx/v1beta1/service";

import { TxClient, HYBRID_VERIFY_GAS, type SigningClientLike } from "../../src/tx/builder";
import { directSignerFromPrivateKey } from "../../src/tx/signer-adapter";
import { generatePqcKeypair } from "../../src/accounts/pqc";
import { qorechainRegistry } from "../../src/messages/registry";
import { QoreTxError } from "../../src/errors";

const PQC_EXT = "/qorechain.pqc.v1.PQCHybridSignature";

async function setup(deliver: { code: number; rawLog?: string } = { code: 0 }) {
  const signer = await directSignerFromPrivateKey(new Uint8Array(32).fill(5), "qor");
  const [{ address }] = await signer.getAccounts();
  const sent: Uint8Array[] = [];
  const client = {
    simulate: vi.fn(async () => 1),
    signAndBroadcast: vi.fn(async () => ({ code: 0, transactionHash: "CLASSICAL", height: 1, gasUsed: 1n, gasWanted: 1n })),
    signAndBroadcastSync: vi.fn(async () => "CLASSICALSYNC"),
    getChainId: vi.fn(async () => "qorechain-diana"),
    getSequence: vi.fn(async () => ({ accountNumber: 7n, sequence: 3n })),
    broadcastTx: vi.fn(async (tx: Uint8Array) => {
      sent.push(tx);
      return { ...deliver, transactionHash: "HYBRID", height: 9, gasUsed: 2n, gasWanted: 3n, events: [], msgResponses: [] };
    }),
    broadcastTxSync: vi.fn(async (tx: Uint8Array) => (sent.push(tx), "HYBRIDSYNC")),
    getCometClient: () => ({ tx: async () => ({ result: { codespace: "sdk" } }) }),
    forceGetQueryClient: () => ({
      queryAbci: vi.fn(async () => ({
        value: SimulateResponse.encode(SimulateResponse.fromPartial({ gasInfo: { gasUsed: 100_000n } })).finish(),
      })),
    }),
  };
  const tx = new TxClient({
    signingClient: client as unknown as SigningClientLike,
    senderAddress: address,
    hybrid: {
      pqcKeypair: generatePqcKeypair(new Uint8Array(32).fill(1)),
      signer,
      registry: qorechainRegistry(),
      signBytesVersion: "v2",
    },
  });
  return { tx, client, sent, address };
}

const send = (from: string) => ({
  typeUrl: "/cosmos.bank.v1beta1.MsgSend",
  value: { fromAddress: from, toAddress: from, amount: [{ denom: "uqor", amount: "1" }] },
});

describe("TxClient with a PQC keypair signs hybrid", () => {
  it("sends every transaction with the hybrid extension", async () => {
    const { tx, client, sent, address } = await setup();
    const res = await tx.bankSend(address, [{ denom: "uqor", amount: "1" }], {
      fee: { amount: [{ denom: "uqor", amount: "60000" }], gas: "300000" },
    });
    expect(res.transactionHash).toBe("HYBRID");
    expect(res.events).toEqual([]);
    expect(client.signAndBroadcast).not.toHaveBeenCalled();
    const body = TxBody.decode(TxRaw.decode(sent[0]).bodyBytes);
    expect(body.extensionOptions.map((e) => e.typeUrl)).toEqual([PQC_EXT]);
  });

  it("keeps a bare key registration classical (the chain's bootstrap path)", async () => {
    const { tx, client, sent, address } = await setup();
    await tx.signAndBroadcast(
      [{ typeUrl: "/qorechain.pqc.v1.MsgRegisterPQCKeyV2", value: { sender: address } }],
      { amount: [], gas: "400000" },
    );
    expect(client.signAndBroadcast).toHaveBeenCalledOnce();
    expect(sent).toHaveLength(0);
  });

  it("fee auto simulates the hybrid tx itself and adds the verification gas", async () => {
    const { tx, client, address } = await setup();
    expect(await tx.simulate([send(address)])).toBe(100_000 + HYBRID_VERIFY_GAS);
    expect(client.simulate).not.toHaveBeenCalled();
  });

  it("sync mode returns after CheckTx with the hash", async () => {
    const { tx, address } = await setup();
    const res = await tx.signAndBroadcast([send(address)], { amount: [], gas: "300000" }, "", { mode: "sync" });
    expect(res).toEqual({ transactionHash: "HYBRIDSYNC", code: 0 });
  });

  it("a failure in the block is a QoreTxError under its module", async () => {
    const { tx, address } = await setup({ code: 5, rawLog: "insufficient funds" });
    const err = await tx.signAndBroadcast([send(address)], { amount: [], gas: "300000" }).catch((e) => e);
    expect(err).toBeInstanceOf(QoreTxError);
    expect(err.codespace).toBe("sdk");
    expect(err.kind).toBe("insufficient_funds");
  });

  it("without a keypair nothing changes: classical as before", async () => {
    const { client, address } = await setup();
    const classical = new TxClient({ signingClient: client as unknown as SigningClientLike, senderAddress: address });
    await classical.bankSend(address, [{ denom: "uqor", amount: "1" }], { fee: { amount: [], gas: "1" } });
    expect(client.signAndBroadcast).toHaveBeenCalledOnce();
    expect(classical.pqcKeypair).toBeUndefined();
  });
});
