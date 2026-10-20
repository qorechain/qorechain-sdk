import { describe, it, expect, vi } from "vitest";

import { lookupDeliverCodespace } from "../../src/tx/broadcast";
import { signAndBroadcastHybrid } from "../../src/tx/hybrid-tx";
import { qorechainRegistry } from "../../src/messages/registry";
import { directSignerFromPrivateKey } from "../../src/tx/signer-adapter";
import { generatePqcKeypair } from "../../src/accounts/pqc";
import { QoreTxError } from "../../src/errors";
import { isHybridSignBytesRejection } from "../../src/tx/signbytes";

const HASH = "DAEB18EB5CBB8709D9E3CD210FEDA4E9979F929FE4E0F0F22855BFCAE3F5CE72";

describe("lookupDeliverCodespace (cosmjs's DeliverTxResponse has no codespace)", () => {
  it("reads it over REST", async () => {
    const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ tx_response: { code: 231, codespace: "pqc" } }) }));
    expect(await lookupDeliverCodespace(HASH, { rest: "https://lcd/", fetch })).toBe("pqc");
    expect(fetch).toHaveBeenCalledWith(`https://lcd/cosmos/tx/v1beta1/txs/${HASH}`);
  });

  it("falls back to the cosmjs client's consensus connection", async () => {
    const tx = vi.fn(async () => ({ result: { code: 3, codespace: "ai" } }));
    const client = { getCometClient: () => ({ tx }) };
    expect(await lookupDeliverCodespace(HASH, { client })).toBe("ai");
    expect(tx.mock.calls[0][0].hash.length).toBe(32);
  });

  it("is best effort: undefined when nothing answers", async () => {
    const fetch = vi.fn(async () => { throw new Error("down"); });
    expect(await lookupDeliverCodespace(HASH, { rest: "https://lcd", fetch, client: {} })).toBeUndefined();
  });
});

describe("signAndBroadcastHybrid: a failure in the block keeps its module", () => {
  it("throws a QoreTxError decoded under the chain's codespace", async () => {
    const signer = await directSignerFromPrivateKey(new Uint8Array(32).fill(7), "qor");
    const [{ address }] = await signer.getAccounts();
    const transport = {
      broadcastTx: vi.fn(async () => ({ code: 231, transactionHash: HASH, rawLog: "PQC proof of possession does not verify" })),
      broadcastTxSync: vi.fn(),
      getCometClient: () => ({ tx: async () => ({ result: { code: 231, codespace: "pqc" } }) }),
    };
    const err = await signAndBroadcastHybrid({
      registry: qorechainRegistry(),
      signer,
      pqcKeypair: generatePqcKeypair(new Uint8Array(32).fill(1)),
      messages: [{ typeUrl: "/cosmos.bank.v1beta1.MsgSend", value: { fromAddress: address, toAddress: address, amount: [] } }],
      fee: { amount: [{ denom: "uqor", amount: "60000" }], gas: "400000" },
      chainId: "qorechain-diana",
      accountNumber: 1,
      sequence: 0,
      signBytesVersion: "v2",
      transport,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(QoreTxError);
    expect(err.codespace).toBe("pqc");
    expect(err.code).toBe(231);
    expect(err.kind).toBe("pqc_proof_of_possession_invalid");
    expect(err.transactionHash).toBe(HASH);
    expect(isHybridSignBytesRejection(err)).toBe(false);
  });
});
