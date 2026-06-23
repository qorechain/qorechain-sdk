import { describe, it, expect, vi } from "vitest";
import { Registry } from "@cosmjs/proto-signing";
import { defaultRegistryTypes } from "@cosmjs/stargate";
import { TxBody, TxRaw, SignDoc } from "cosmjs-types/cosmos/tx/v1beta1/tx";
import { MsgSend } from "cosmjs-types/cosmos/bank/v1beta1/tx";
import { secp256k1 } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha256";

import { buildHybridTx, signAndBroadcastHybrid } from "../../src/tx/hybrid-tx";
import { directSignerFromPrivateKey } from "../../src/tx/signer-adapter";
import {
  generatePqcKeypair,
  pqcVerify,
  AlgorithmDilithium5,
  HYBRID_SIG_TYPE_URL,
  ML_DSA_87_SIGNATURE_LENGTH,
} from "../../src/accounts/pqc";

const PREFIX = "qor";
const CHAIN_ID = "qorechain-diana";

// Deterministic 32-byte secp256k1 private key (valid, < curve order).
const PRIVKEY = new Uint8Array(32).fill(0).map((_, i) => (i + 1) & 0xff);

const FEE = { amount: [{ denom: "uqor", amount: "5000" }], gas: "200000" };

function registry(): Registry {
  return new Registry(defaultRegistryTypes);
}

async function fixtures() {
  const signer = await directSignerFromPrivateKey(PRIVKEY, PREFIX);
  const [account] = await signer.getAccounts();
  const pqc = generatePqcKeypair(new Uint8Array(32).fill(9));
  const msg = {
    typeUrl: "/cosmos.bank.v1beta1.MsgSend",
    value: MsgSend.fromPartial({
      fromAddress: account.address,
      toAddress: account.address,
      amount: [{ denom: "uqor", amount: "1000" }],
    }),
  };
  return { signer, account, pqc, msg };
}

/** Big-endian 4-byte length prefix, mirroring the chain contract framing. */
function be32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  b[0] = (n >>> 24) & 0xff;
  b[1] = (n >>> 16) & 0xff;
  b[2] = (n >>> 8) & 0xff;
  b[3] = n & 0xff;
  return b;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

describe("buildHybridTx", () => {
  it("signs B0 (body WITHOUT the PQC extension) + authInfo, not the final body", async () => {
    const { signer, pqc, msg } = await fixtures();
    const built = await buildHybridTx({
      registry: registry(),
      signer,
      pqcKeypair: pqc,
      messages: [msg],
      fee: FEE,
      memo: "hi",
      chainId: CHAIN_ID,
      accountNumber: 7,
      sequence: 3,
    });

    // Independently reconstruct B0 by taking the FINAL body, stripping the ext,
    // and re-encoding. This must equal the body the builder framed for the PQC
    // signature — proving the signature covers B0, not the with-ext body.
    const finalBody = TxBody.decode(built.txRaw.bodyBytes);
    expect(finalBody.extensionOptions).toHaveLength(1);

    const stripped = TxBody.fromPartial({
      messages: finalBody.messages,
      memo: finalBody.memo,
      timeoutHeight: finalBody.timeoutHeight,
      // no extensionOptions / nonCriticalExtensionOptions
    });
    const b0 = TxBody.encode(stripped).finish();
    const a = built.authInfoBytes;
    const expectedMessage = concat(be32(b0.length), b0, be32(a.length), a);

    expect(built.pqcSignedMessage).toEqual(expectedMessage);
    // The framing must NOT include the final (with-ext) body bytes.
    expect(built.pqcSignedMessage).not.toEqual(
      concat(be32(built.txRaw.bodyBytes.length), built.txRaw.bodyBytes, be32(a.length), a),
    );
  });

  it("produces a 4627-byte ML-DSA-87 signature that verifies over the framed message", async () => {
    const { signer, pqc, msg } = await fixtures();
    const built = await buildHybridTx({
      registry: registry(),
      signer,
      pqcKeypair: pqc,
      messages: [msg],
      fee: FEE,
      chainId: CHAIN_ID,
      accountNumber: 0,
      sequence: 0,
    });
    expect(built.pqcSignature).toHaveLength(ML_DSA_87_SIGNATURE_LENGTH);
    expect(
      pqcVerify(pqc.publicKey, built.pqcSignedMessage, built.pqcSignature),
    ).toBe(true);
  });

  it("attaches exactly one critical extension Any with the correct type URL and JSON payload", async () => {
    const { signer, pqc, msg } = await fixtures();
    const built = await buildHybridTx({
      registry: registry(),
      signer,
      pqcKeypair: pqc,
      messages: [msg],
      fee: FEE,
      chainId: CHAIN_ID,
      accountNumber: 0,
      sequence: 0,
    });
    const body = TxBody.decode(built.txRaw.bodyBytes);
    expect(body.extensionOptions).toHaveLength(1);
    expect(body.nonCriticalExtensionOptions).toHaveLength(0);
    const ext = body.extensionOptions[0];
    expect(ext.typeUrl).toBe(HYBRID_SIG_TYPE_URL);

    const decoded = JSON.parse(new TextDecoder().decode(ext.value));
    expect(decoded.algorithm_id).toBe(AlgorithmDilithium5);
    // Standard padded base64 of the 4627-byte signature.
    const expectedSig = Buffer.from(built.pqcSignature).toString("base64");
    expect(decoded.pqc_signature).toBe(expectedSig);
    expect(expectedSig.endsWith("=") || expectedSig.length % 4 === 0).toBe(true);
  });

  it("includes the PQC public key in the extension when requested", async () => {
    const { signer, pqc, msg } = await fixtures();
    const built = await buildHybridTx({
      registry: registry(),
      signer,
      pqcKeypair: pqc,
      messages: [msg],
      fee: FEE,
      chainId: CHAIN_ID,
      accountNumber: 0,
      sequence: 0,
      includePqcPublicKey: true,
    });
    const body = TxBody.decode(built.txRaw.bodyBytes);
    const decoded = JSON.parse(
      new TextDecoder().decode(body.extensionOptions[0].value),
    );
    expect(decoded.pqc_public_key).toBe(
      Buffer.from(pqc.publicKey).toString("base64"),
    );
  });

  it("puts the classical signature in TxRaw.signatures, signed over the FINAL (with-ext) body", async () => {
    const { signer, account, pqc, msg } = await fixtures();
    const built = await buildHybridTx({
      registry: registry(),
      signer,
      pqcKeypair: pqc,
      messages: [msg],
      fee: FEE,
      chainId: CHAIN_ID,
      accountNumber: 7,
      sequence: 3,
    });

    expect(built.txRaw.signatures).toHaveLength(1);
    const classicalSig = built.txRaw.signatures[0];
    expect(classicalSig.length).toBe(64);

    // Recompute the SignDoc over the FINAL body + authInfo and verify the
    // secp256k1 signature against the account public key.
    const signDoc = SignDoc.fromPartial({
      bodyBytes: built.txRaw.bodyBytes,
      authInfoBytes: built.authInfoBytes,
      chainId: CHAIN_ID,
      accountNumber: BigInt(7),
    });
    const signBytes = SignDoc.encode(signDoc).finish();
    const hash = sha256(signBytes);
    const ok = secp256k1.verify(classicalSig, hash, account.pubkey);
    expect(ok).toBe(true);
  });

  it("round-trips through TxRaw encode/decode", async () => {
    const { signer, pqc, msg } = await fixtures();
    const built = await buildHybridTx({
      registry: registry(),
      signer,
      pqcKeypair: pqc,
      messages: [msg],
      fee: FEE,
      chainId: CHAIN_ID,
      accountNumber: 0,
      sequence: 0,
    });
    const decoded = TxRaw.decode(built.txRawBytes);
    expect(decoded.bodyBytes).toEqual(built.txRaw.bodyBytes);
    expect(decoded.authInfoBytes).toEqual(built.authInfoBytes);
    expect(decoded.signatures).toHaveLength(1);
  });
});

describe("signAndBroadcastHybrid", () => {
  function fakeTransport() {
    return {
      broadcastTx: vi.fn(async () => ({
        code: 0,
        transactionHash: "HYBRIDCOMMIT",
        height: 42,
      })),
      broadcastTxSync: vi.fn(async () => "HYBRIDSYNC"),
    };
  }

  it("broadcasts the assembled TxRaw bytes via commit by default", async () => {
    const { signer, pqc, msg } = await fixtures();
    const transport = fakeTransport();
    const res = await signAndBroadcastHybrid({
      transport: transport as never,
      registry: registry(),
      signer,
      pqcKeypair: pqc,
      messages: [msg],
      fee: FEE,
      chainId: CHAIN_ID,
      accountNumber: 0,
      sequence: 0,
    });
    expect(transport.broadcastTx).toHaveBeenCalledOnce();
    expect(transport.broadcastTxSync).not.toHaveBeenCalled();
    const sentBytes = transport.broadcastTx.mock.calls[0][0] as Uint8Array;
    // The exact assembled TxRaw bytes must be what is broadcast.
    const rebuilt = await buildHybridTx({
      registry: registry(),
      signer,
      pqcKeypair: pqc,
      messages: [msg],
      fee: FEE,
      chainId: CHAIN_ID,
      accountNumber: 0,
      sequence: 0,
    });
    expect(sentBytes).toEqual(rebuilt.txRawBytes);
    expect(res.transactionHash).toBe("HYBRIDCOMMIT");
    expect(res.code).toBe(0);
  });

  it("maps sync mode to broadcastTxSync and returns the hash", async () => {
    const { signer, pqc, msg } = await fixtures();
    const transport = fakeTransport();
    const res = await signAndBroadcastHybrid({
      transport: transport as never,
      registry: registry(),
      signer,
      pqcKeypair: pqc,
      messages: [msg],
      fee: FEE,
      chainId: CHAIN_ID,
      accountNumber: 0,
      sequence: 0,
      mode: "sync",
    });
    expect(transport.broadcastTxSync).toHaveBeenCalledOnce();
    expect(transport.broadcastTx).not.toHaveBeenCalled();
    expect(res.transactionHash).toBe("HYBRIDSYNC");
  });

  it("maps async mode to broadcastTxSync (fire-and-forget hash)", async () => {
    const { signer, pqc, msg } = await fixtures();
    const transport = fakeTransport();
    await signAndBroadcastHybrid({
      transport: transport as never,
      registry: registry(),
      signer,
      pqcKeypair: pqc,
      messages: [msg],
      fee: FEE,
      chainId: CHAIN_ID,
      accountNumber: 0,
      sequence: 0,
      mode: "async",
    });
    expect(transport.broadcastTxSync).toHaveBeenCalledOnce();
  });

  it("throws on a non-zero commit code", async () => {
    const { signer, pqc, msg } = await fixtures();
    const transport = fakeTransport();
    transport.broadcastTx.mockResolvedValueOnce({
      code: 11,
      transactionHash: "BAD",
      rawLog: "pqc signature verification failed",
    });
    await expect(
      signAndBroadcastHybrid({
        transport: transport as never,
        registry: registry(),
        signer,
        pqcKeypair: pqc,
        messages: [msg],
        fee: FEE,
        chainId: CHAIN_ID,
        accountNumber: 0,
        sequence: 0,
      }),
    ).rejects.toThrow(/pqc signature verification failed|code 11/);
  });
});
