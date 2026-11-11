import { describe, it, expect, vi } from "vitest";
import { ed25519 } from "@noble/curves/ed25519";
import { secp256k1 } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha256";
import { bech32 } from "bech32";
import { recoverMessageAddress } from "viem";

import {
  authenticatorLinkMessage,
  authenticatorLinkMessageBytes,
  validateAuthenticatorKey,
} from "../../src/tx/authenticator";
import {
  signAuthenticatorLinkEd25519,
  signAuthenticatorLinkSecp256k1,
  signAuthenticatorLinkEip191,
  signAuthenticatorLinkPhantom,
  signAuthenticatorLinkMetaMask,
  verifyAuthenticatorLinkProof,
  registerAuthenticatorMsg,
  linkAuthenticatorMsgs,
  decodeAuthenticatorExecutions,
  assertAuthenticatorExecutionsSucceeded,
  AuthenticatorExecutionError,
  executeEvmMsg,
  buildPhantomExecuteEvm,
} from "../../src/wallet/authenticator";
import { msg } from "../../src/messages";
import { qorechainRegistry } from "../../src/messages/registry";
import { checkValuePermissionRules, ruleBoundsEveryDenom } from "../../src/messages/spending-rules";
import * as aaTx from "../../src/codegen/qorechain/abstractaccount/v1/tx";
import * as crossvmTx from "../../src/codegen/qorechain/crossvm/v1/tx";
import * as svmTx from "../../src/codegen/qorechain/svm/v1/tx";
import * as rdkTx from "../../src/codegen/qorechain/rdk/v1/tx";
import * as crossvmQuery from "../../src/codegen/qorechain/crossvm/v1/query";
import {
  validateCrossVmUpdateParams,
  validateSvmUpdateParams,
  crossvmUpdateParamsFromCurrent,
  rdkUpdateParamsFromCurrent,
  svmUpdateParamsFromCurrent,
} from "../../src/governance";
import { createCrossVMClient } from "../../src/helpers/crossvm";
import { createQueryClients } from "../../src/query/grpc";
import { openEvmWindowMsg } from "../../src/pqc/evm-window";
import {
  estimateFee,
  fetchEvmLimits,
  fetchMinGasPriceUqor,
  recommendedGasPriceUqor,
  checkCosmosGasLimit,
  checkEvmGasLimit,
  carriesWasmExecution,
} from "../../src/tx/fees";
import { TxClient } from "../../src/tx/builder";
import { wasmFee } from "../../src/cosmwasm";
import { RestClient } from "../../src/query/rest";

const CHAIN = "qorechain-diana";
const KAT_ACCOUNT = "qor1rfjz7r3u8t65teavh5utquj3kwvsj983hh5zaj";
const ADDR = "qor15yk64u7zc9g9k2yr2wmzeva5qgwxps6yjecvvu";
const GOV = "qor10d07y265gmmuvt4z0w9aw880jnsr700jzj3ese";
const VALOPER = bech32.encode("qorvaloper", bech32.toWords(new Uint8Array(20).fill(9)));
const SEED = new Uint8Array(32).fill(0x11);
const SECP = new Uint8Array(32).fill(0x22);

function json(body: unknown, ok = true) {
  return vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => body }) as unknown as Response);
}

describe("authenticator link message (chain v3.2.8)", () => {
  it("matches the known-answer text", () => {
    expect(authenticatorLinkMessage(CHAIN, KAT_ACCOUNT, "ed25519", new Uint8Array(32).fill(7))).toBe(
      "QoreChain authenticator link v1\nchain: qorechain-diana\naccount: qor1rfjz7r3u8t65teavh5utquj3kwvsj983hh5zaj\nscheme: ed25519\nkey: 0707070707070707070707070707070707070707070707070707070707070707",
    );
    expect(authenticatorLinkMessage(CHAIN, KAT_ACCOUNT, "ed25519", "0x" + "07".repeat(32))).toBe(
      authenticatorLinkMessage(CHAIN, KAT_ACCOUNT, "ed25519", new Uint8Array(32).fill(7)),
    );
  });

  it("checks the key shape per scheme", () => {
    expect(() => validateAuthenticatorKey("secp256k1", new Uint8Array(65))).toThrow(/uncompressed/);
    expect(() => validateAuthenticatorKey("ed25519", new Uint8Array(33))).toThrow(/32 bytes/);
    expect(() => validateAuthenticatorKey("sr25519", new Uint8Array(32))).toThrow(/unknown authenticator scheme/);
    expect(() => validateAuthenticatorKey("secp256k1", new Uint8Array(20))).not.toThrow();
    expect(() => validateAuthenticatorKey("secp256k1", new Uint8Array(33))).not.toThrow();
  });

  it("ed25519 proof verifies with ed25519.verify over the raw text", () => {
    const p = signAuthenticatorLinkEd25519({ chainId: CHAIN, account: ADDR, privateKey: SEED });
    const text = authenticatorLinkMessageBytes(CHAIN, ADDR, "ed25519", p.pubkey);
    expect(p.pubkey).toEqual(ed25519.getPublicKey(SEED));
    expect(ed25519.verify(p.possessionProof, text, p.pubkey)).toBe(true);
    expect(verifyAuthenticatorLinkProof({ chainId: CHAIN, account: ADDR, ...p })).toBe(true);
    expect(verifyAuthenticatorLinkProof({ chainId: "other", account: ADDR, ...p })).toBe(false);
  });

  it("secp256k1 proof is 64-byte low-S r||s over sha256(text)", () => {
    const p = signAuthenticatorLinkSecp256k1({ chainId: CHAIN, account: ADDR, privateKey: SECP });
    expect(p.pubkey.length).toBe(33);
    expect(p.possessionProof.length).toBe(64);
    const text = authenticatorLinkMessageBytes(CHAIN, ADDR, "secp256k1", p.pubkey);
    expect(secp256k1.verify(p.possessionProof, sha256(text), p.pubkey, { lowS: true })).toBe(true);
    expect(verifyAuthenticatorLinkProof({ chainId: CHAIN, account: ADDR, ...p })).toBe(true);
  });

  it("EIP-191 proof recovers to the 20-byte address with a standard personal_sign verifier", async () => {
    const p = signAuthenticatorLinkEip191({ chainId: CHAIN, account: ADDR, privateKey: SECP });
    expect(p.pubkey.length).toBe(20);
    expect(p.possessionProof.length).toBe(65);
    expect([27, 28]).toContain(p.possessionProof[64]);
    const text = authenticatorLinkMessage(CHAIN, ADDR, "secp256k1", p.pubkey);
    const recovered = await recoverMessageAddress({
      message: text,
      signature: `0x${Buffer.from(p.possessionProof).toString("hex")}`,
    });
    expect(recovered.toLowerCase()).toBe(`0x${Buffer.from(p.pubkey).toString("hex")}`);
    expect(verifyAuthenticatorLinkProof({ chainId: CHAIN, account: ADDR, ...p })).toBe(true);
    // v = 0/1 is accepted too.
    const v01 = p.possessionProof.slice();
    v01[64] -= 27;
    expect(verifyAuthenticatorLinkProof({ chainId: CHAIN, account: ADDR, ...p, possessionProof: v01 })).toBe(true);
    expect(verifyAuthenticatorLinkProof({ chainId: CHAIN, account: KAT_ACCOUNT, ...p })).toBe(false);
  });

  it("Phantom and MetaMask wallets sign the link text", async () => {
    const wallet = {
      publicKey: ed25519.getPublicKey(SEED),
      signMessage: vi.fn(async (m: Uint8Array) => ({ signature: ed25519.sign(m, SEED) })),
    };
    const ph = await signAuthenticatorLinkPhantom({ chainId: CHAIN, account: ADDR, wallet });
    expect(new TextDecoder().decode(wallet.signMessage.mock.calls[0][0])).toMatch(/^QoreChain authenticator link v1\nchain: /);
    expect(verifyAuthenticatorLinkProof({ chainId: CHAIN, account: ADDR, ...ph })).toBe(true);

    const eip = signAuthenticatorLinkEip191({ chainId: CHAIN, account: ADDR, privateKey: SECP });
    const address = `0x${Buffer.from(eip.pubkey).toString("hex")}`;
    const provider = {
      request: vi.fn(async () => `0x${Buffer.from(eip.possessionProof).toString("hex")}`),
    };
    const mm = await signAuthenticatorLinkMetaMask({ chainId: CHAIN, account: ADDR, provider, address });
    const [args] = provider.request.mock.calls[0] as unknown as [{ method: string; params: string[] }];
    expect(args.method).toBe("personal_sign");
    expect(Buffer.from(args.params[0].slice(2), "hex").toString()).toBe(
      authenticatorLinkMessage(CHAIN, ADDR, "secp256k1", eip.pubkey),
    );
    expect(verifyAuthenticatorLinkProof({ chainId: CHAIN, account: ADDR, ...mm })).toBe(true);
  });
});

describe("registering and linking a key (chain v3.2.8)", () => {
  const ed = signAuthenticatorLinkEd25519({ chainId: CHAIN, account: ADDR, privateKey: SEED });
  const bounded = { id: "r1", enabled: true, perTxLimit: "1000", dailyLimit: "0" };

  it("the composer refuses an empty proof and encodes field 8", () => {
    expect(() =>
      msg.abstractaccount.registerAuthenticator({ owner: ADDR, accountAddress: ADDR, scheme: "ed25519", pubkey: ed.pubkey }),
    ).toThrow(/possessionProof is required from chain v3\.2\.8.*authenticatorLinkMessage/);
    const m = registerAuthenticatorMsg({
      owner: ADDR,
      scheme: "ed25519",
      pubkey: ed.pubkey,
      permissions: ["svm"],
      expiryUnix: 1_900_000_000,
      possessionProof: ed.possessionProof,
    });
    const any = qorechainRegistry().encodeAsAny(m);
    expect(aaTx.MsgRegisterAuthenticator.decode(any.value).possessionProof).toEqual(ed.possessionProof);
  });

  it("builds [MsgUpdateSpendingRules, MsgRegisterAuthenticator] for one owner-signed tx", () => {
    const msgs = linkAuthenticatorMsgs({
      owner: ADDR,
      chainId: CHAIN,
      scheme: "ed25519",
      pubkey: ed.pubkey,
      permissions: ["send"],
      expiryUnix: 1_900_000_000,
      label: "phantom",
      possessionProof: ed.possessionProof,
      spendingRule: bounded,
    });
    expect(msgs.map((m) => m.typeUrl)).toEqual([
      "/qorechain.abstractaccount.v1.MsgUpdateSpendingRules",
      "/qorechain.abstractaccount.v1.MsgRegisterAuthenticator",
    ]);
    const upd = msgs[0].value as aaTx.MsgUpdateSpendingRules;
    expect(upd.accountAddress).toBe(ADDR);
    expect(upd.rules[0].perTxLimit).toBe("1000");
    for (const m of msgs) qorechainRegistry().encode(m);
  });

  it("refuses a value permission without a bounding first enabled rule", () => {
    const base = {
      owner: ADDR,
      scheme: "ed25519" as const,
      pubkey: ed.pubkey,
      expiryUnix: 1_900_000_000,
      possessionProof: ed.possessionProof,
    };
    expect(() => linkAuthenticatorMsgs({ ...base, permissions: ["evm"] })).toThrow(/needs an enabled spending rule/);
    // The first enabled rule is the one applied: a bounding second rule does not help.
    expect(() =>
      linkAuthenticatorMsgs({
        ...base,
        permissions: ["all"],
        spendingRules: [
          { id: "calls", enabled: true, allowedEvmCalls: ["0x" + "11".repeat(20)] },
          bounded,
        ],
      }),
    ).toThrow(/first enabled spending rule \(calls\) does not bound every denom/);
    // A disabled first rule is skipped.
    expect(
      linkAuthenticatorMsgs({ ...base, permissions: ["deploy"], spendingRules: [{ id: "off", enabled: false }, bounded] }),
    ).toHaveLength(2);
    // Non-value permissions need no rule.
    expect(linkAuthenticatorMsgs({ ...base, permissions: ["vote"] })).toHaveLength(1);
    // A proof for another chain is refused when chainId is given.
    expect(() => linkAuthenticatorMsgs({ ...base, chainId: "qorechain-vladi", permissions: ["vote"] })).toThrow(
      /does not verify/,
    );
  });

  it("denom-limited rules bound every listed denom, compared case-insensitively", () => {
    const erc = "erc20/0x" + "Ab".repeat(20);
    expect(
      ruleBoundsEveryDenom({
        allowedDenoms: ["uqor", erc],
        denomLimits: [
          { denom: "UQOR", perTxLimit: "5", dailyLimit: "" },
          { denom: erc.toLowerCase(), perTxLimit: "", dailyLimit: "9" },
        ],
      }),
    ).toBe(true);
    expect(ruleBoundsEveryDenom({ allowedDenoms: ["uqor", erc], denomLimits: [{ denom: "uqor", perTxLimit: "5" }] })).toBe(
      false,
    );
    expect(ruleBoundsEveryDenom({ allowedDenoms: [] })).toBe(false);
    expect(ruleBoundsEveryDenom({ dailyLimit: 1n })).toBe(true);
    expect(() => checkValuePermissionRules(["svm"], [{ enabled: true, allowedDenoms: ["uqor"] }])).toThrow(/does not bound/);
  });
});

describe("authenticator execution results (chain v3.2.8)", () => {
  const evmOk = aaTx.MsgExecuteEVMResponse.encode(
    aaTx.MsgExecuteEVMResponse.fromPartial({ success: true, ret: new Uint8Array([1]), gasUsed: "21000" }),
  ).finish();
  const evmFail = aaTx.MsgExecuteEVMResponse.encode(
    aaTx.MsgExecuteEVMResponse.fromPartial({ success: false, gasUsed: "50000", vmError: "execution reverted" }),
  ).finish();
  const cosmosFail = aaTx.MsgExecuteCosmosResponse.encode(aaTx.MsgExecuteCosmosResponse.fromPartial({ success: false })).finish();
  const result = {
    transactionHash: "HASH",
    code: 0,
    msgResponses: [
      { typeUrl: "/qorechain.abstractaccount.v1.MsgExecuteEVMResponse", value: evmOk },
      { typeUrl: "/cosmos.bank.v1beta1.MsgSendResponse", value: new Uint8Array() },
      { typeUrl: "/qorechain.abstractaccount.v1.MsgExecuteEVMResponse", value: evmFail },
      { typeUrl: "/qorechain.abstractaccount.v1.MsgExecuteCosmosResponse", value: cosmosFail },
    ],
    events: [
      {
        type: "abstractaccount_execution_failed",
        attributes: [
          { key: "account", value: "qor1b" },
          { key: "lane", value: "cosmos" },
          { key: "nonce", value: "4" },
          { key: "reason", value: "spending limit exceeded" },
        ],
      },
      {
        type: "abstractaccount_execution_failed",
        attributes: [
          { key: "account", value: "qor1a" },
          { key: "lane", value: "evm" },
          { key: "nonce", value: "7" },
          { key: "reason", value: "call reverted" },
        ],
      },
    ],
  };

  it("decodes every execute response and matches failure events by account and nonce", () => {
    const messages = [
      { typeUrl: "/qorechain.abstractaccount.v1.MsgExecuteEVM", value: { account: "qor1a", nonce: 6n } },
      { typeUrl: "/cosmos.bank.v1beta1.MsgSend", value: {} },
      { typeUrl: "/qorechain.abstractaccount.v1.MsgExecuteEVM", value: { account: "qor1a", nonce: 7n } },
      { typeUrl: "/qorechain.abstractaccount.v1.MsgExecuteCosmos", value: { account: "qor1b", nonce: 4n } },
    ];
    const out = decodeAuthenticatorExecutions(result, messages);
    expect(out.map((r) => [r.index, r.lane, r.success])).toEqual([
      [0, "evm", true],
      [2, "evm", false],
      [3, "cosmos", false],
    ]);
    expect(out[0].gasUsed).toBe(21000n);
    expect(out[1]).toMatchObject({ reason: "call reverted", vmError: "execution reverted", nonce: "7" });
    expect(out[2]).toMatchObject({ reason: "spending limit exceeded", account: "qor1b" });
  });

  it("without messages, failure events are matched in order", () => {
    const out = decodeAuthenticatorExecutions(result);
    expect(out[1].reason).toBe("spending limit exceeded");
  });

  it("assert throws when an execution failed in a code-0 tx", () => {
    expect(() => assertAuthenticatorExecutionsSucceeded(result)).toThrow(AuthenticatorExecutionError);
    expect(() => assertAuthenticatorExecutionsSucceeded(result)).toThrow(/nonce was consumed/);
    const ok = assertAuthenticatorExecutionsSucceeded({ ...result, msgResponses: [result.msgResponses[0]] });
    expect(ok).toHaveLength(1);
  });
});

const CV_FULL = {
  authority: GOV,
  maxMessageSize: "65536",
  maxQueueSize: 1000,
  queueTimeoutBlocks: "100",
  enabled: true,
  bridgeAllowedTargets: [`cosmwasm:${ADDR}`],
  bridgeTargetPins: [{ target: `cosmwasm:${ADDR}`, codeId: "5", historyLen: "1" }],
  maxPendingPerSender: 100,
  maxCosmosTxGas: "50000000",
  recordRetentionBlocks: "100000",
  maxBlockWasmGas: "3000000",
  maxTxWasmShareBps: 5000,
  maxBlockLevelWasmGas: "10000000",
  queueWasmReserveBps: 2500,
  wasmCongestionMaxFactor: 1000,
  wasmCongestionTargetBps: 5000,
  maxBlockUploadBps: 5000,
  maxQueueTimeoutsPerBlock: 100,
};

const SVM_FULL: svmTx.SVMParams = {
  maxProgramSize: "1048576",
  maxAccountDataSize: "10485760",
  computeBudgetMax: "1400000",
  lamportsPerByte: "6960",
  rentExemptionMulti: "2.000000000000000000",
  enabled: false,
  svmSlotOffset: "100",
  defaultSigScheme: 1,
  maxCpi: 4,
  maxCustodyUqor: "1000000000",
  maxCustodyHardUqor: "0",
  maxAccountExcessUqor: "0",
};

describe("governance params composers carry every field (chain v3.2.8)", () => {
  it("crossvm names the missing fields", () => {
    const partial: Partial<typeof CV_FULL> = { ...CV_FULL };
    delete partial.bridgeTargetPins;
    delete partial.maxQueueTimeoutsPerBlock;
    expect(() => msg.crossvm.updateParams(partial)).toThrow(/missing: bridgeTargetPins, maxQueueTimeoutsPerBlock/);
    expect(() => msg.crossvm.updateParams(partial)).toThrow(/crossvmUpdateParamsFromCurrent/);
    const any = qorechainRegistry().encodeAsAny(msg.crossvm.updateParams(CV_FULL));
    expect(crossvmTx.MsgUpdateParams.decode(any.value).bridgeTargetPins[0].codeId).toBe("5");
  });

  it("crossvm checks pins and the v3.2.8 ranges (zero is the default)", () => {
    expect(() => validateCrossVmUpdateParams({ ...CV_FULL, bridgeTargetPins: [{ target: "cosmwasm:qor1x", codeId: 1n }] })).toThrow(
      /not in bridgeAllowedTargets/,
    );
    expect(() => validateCrossVmUpdateParams({ ...CV_FULL, bridgeTargetPins: [{ target: `cosmwasm:${ADDR}`, codeId: 0 }] })).toThrow(
      /codeId/,
    );
    expect(() => validateCrossVmUpdateParams({ ...CV_FULL, maxCosmosTxGas: 5_000_000n })).toThrow(/10000000\.\.1000000000/);
    expect(() => validateCrossVmUpdateParams({ ...CV_FULL, queueWasmReserveBps: 9_001 })).toThrow(/1\.\.9000/);
    expect(() =>
      validateCrossVmUpdateParams({ ...CV_FULL, bridgeTargetPins: [], maxCosmosTxGas: 0n, queueWasmReserveBps: 0 }),
    ).not.toThrow();
  });

  it("svm requires every SVMParams field and a hard ceiling before enabling", () => {
    expect(() => msg.svm.updateParams({ authority: GOV })).toThrow(/params is required/);
    const partial: Partial<svmTx.SVMParams> = { ...SVM_FULL };
    delete partial.maxCustodyHardUqor;
    expect(() => msg.svm.updateParams({ authority: GOV, params: partial })).toThrow(/missing: maxCustodyHardUqor/);
    expect(() => validateSvmUpdateParams({ authority: GOV, params: { ...SVM_FULL, enabled: true } })).toThrow(
      /hard custody ceiling before opening the lane/,
    );
    const m = msg.svm.updateParams({ authority: GOV, params: { ...SVM_FULL, enabled: true, maxCustodyHardUqor: "5000000000" } });
    const any = qorechainRegistry().encodeAsAny(m);
    expect(svmTx.MsgUpdateParams.decode(any.value).params?.maxCustodyHardUqor).toBe("5000000000");
    const built = svmUpdateParamsFromCurrent({ authority: GOV, current: SVM_FULL, changes: { maxCpi: 8 } });
    expect((built.value as svmTx.MsgUpdateParams).params).toMatchObject({ maxCpi: 8, maxCustodyUqor: "1000000000" });
  });

  it("rdk names the missing v3.2.8 fields", () => {
    const p = {
      authority: GOV,
      maxRollups: 100,
      minStakeForRollup: "10000000000",
      rollupCreationBurnRate: "0.01",
      defaultChallengeWindow: "604800",
      maxDaBlobSize: "2097152",
      blobRetentionBlocks: "432000",
      maxBatchesPerBlock: 10,
    };
    expect(() => msg.rdk.updateParams(p)).toThrow(/missing: finalizedBatchRetentionBlocks, maxPostedDataBytes/);
  });

  it("crossvmUpdateParamsFromCurrent copies the values in force and applies the changes", async () => {
    const f = json({
      max_message_size: "65536",
      max_queue_size: 1000,
      queue_timeout_blocks: "100",
      enabled: true,
      bridge_allowed_targets: [`cosmwasm:${ADDR}`],
      bridge_target_pins: [{ target: `cosmwasm:${ADDR}`, code_id: "5", history_len: "1" }],
      max_pending_per_sender: 100,
      max_cosmos_tx_gas: "50000000",
      record_retention_blocks: "100000",
      max_block_wasm_gas: "3000000",
      max_tx_wasm_share_bps: 5000,
      max_block_level_wasm_gas: "10000000",
      queue_wasm_reserve_bps: 2500,
      wasm_congestion_max_factor: 1000,
      wasm_congestion_target_bps: 5000,
      wasm_congestion_factor_micro: "1000000",
      max_block_upload_bps: 5000,
      max_queue_timeouts_per_block: 100,
    });
    const m = await crossvmUpdateParamsFromCurrent({
      rest: "https://rest.example/",
      fetch: f as never,
      authority: GOV,
      changes: { maxQueueSize: 2000 },
    });
    expect(f.mock.calls[0][0]).toBe("https://rest.example/qorechain/crossvm/v1/params");
    const v = m.value as crossvmTx.MsgUpdateParams;
    expect(v).toMatchObject({ authority: GOV, maxQueueSize: 2000, maxBlockWasmGas: "3000000", maxQueueTimeoutsPerBlock: 100 });
    expect(v.bridgeTargetPins).toEqual([{ target: `cosmwasm:${ADDR}`, codeId: "5", historyLen: "1" }]);
  });

  it("rdkUpdateParamsFromCurrent reads { params } and applies the changes", async () => {
    const f = json({
      params: {
        max_rollups: 100,
        min_stake_for_rollup: "10000000000",
        rollup_creation_burn_rate: "0.010000000000000000",
        default_challenge_window: "604800",
        max_da_blob_size: "2097152",
        blob_retention_blocks: "432000",
        max_batches_per_block: 10,
        finalized_batch_retention_blocks: "100000",
        max_posted_data_bytes: "131072",
        max_posted_data_bytes_per_block: "1048576",
        posted_data_fee_per_byte: "10",
        posted_data_retention_blocks: "100000",
        min_submitter_bond: "1000000000",
      },
    });
    const m = await rdkUpdateParamsFromCurrent({ rest: "https://rest.example", fetch: f as never, authority: GOV, changes: { maxRollups: 50 } });
    expect(f.mock.calls[0][0]).toBe("https://rest.example/qorechain/rdk/v1/params");
    expect(m.value as rdkTx.MsgUpdateParams).toMatchObject({ maxRollups: 50, minSubmitterBond: "1000000000", postedDataFeePerByte: "10" });
  });
});

describe("cross-VM async gas and pending pages (chain v3.2.8)", () => {
  const base = { sender: ADDR, targetVm: "cosmwasm", targetContract: ADDR, payload: new Uint8Array([1]) };

  it("the composer checks asyncGasLimit / asyncMaxFactor", () => {
    const m = msg.crossvm.crossVmCall({ ...base, async: true, asyncGasLimit: "250000", asyncMaxFactor: "2000000" });
    const any = qorechainRegistry().encodeAsAny(m);
    expect(crossvmTx.MsgCrossVMCall.decode(any.value)).toMatchObject({ asyncGasLimit: "250000", asyncMaxFactor: "2000000" });
    expect(() => msg.crossvm.crossVmCall({ ...base, async: true, asyncGasLimit: "249999" })).toThrow(/250000\.\.10000000/);
    expect(() => msg.crossvm.crossVmCall({ ...base, async: true, asyncGasLimit: "10000001" })).toThrow(/250000\.\.10000000/);
    expect(() => msg.crossvm.crossVmCall({ ...base, async: false, asyncGasLimit: "300000" })).toThrow(/only to async calls/);
    expect(() => msg.crossvm.crossVmCall({ ...base, targetVm: "evm", async: true, asyncMaxFactor: "1" })).toThrow(
      /into cosmwasm/,
    );
    expect(() => msg.crossvm.crossVmCall({ ...base, async: false })).not.toThrow();
  });

  it("the cross-VM client passes the async fields through", () => {
    const tx = { senderAddress: ADDR } as unknown as TxClient;
    const client = createCrossVMClient(tx);
    const m = client.buildCall({ targetVm: "cosmwasm", targetContract: ADDR, cosmwasm: { a: 1 }, async: true, asyncGasLimit: 400_000 });
    expect((m.value as crossvmTx.MsgCrossVMCall).asyncGasLimit).toBe("400000");
    expect(() => client.buildCall({ targetVm: "svm", targetContract: ADDR, svm: { data: "0x01" }, asyncGasLimit: 400_000 })).toThrow();
  });

  it("the typed query client follows nextKey", async () => {
    const pages = [
      crossvmQuery.QueryPendingMessagesResponse.fromPartial({
        messages: [{ id: "1" }, { id: "2" }],
        pagination: { nextKey: new Uint8Array([1]) },
      }),
      crossvmQuery.QueryPendingMessagesResponse.fromPartial({ messages: [{ id: "3" }], pagination: { nextKey: new Uint8Array() } }),
    ];
    const request = vi.fn(async () => crossvmQuery.QueryPendingMessagesResponse.encode(pages.shift()!).finish());
    const clients = createQueryClients({ request } as never);
    const all = await clients.crossvm.allPendingMessages();
    expect(all.map((m) => m.id)).toEqual(["1", "2", "3"]);
    const second = crossvmQuery.QueryPendingMessagesRequest.decode(request.mock.calls[1][2] as Uint8Array);
    expect(second.pagination?.key).toEqual(new Uint8Array([1]));
  });
});

describe("EVM window scope fields (chain v3.2.8)", () => {
  const p = { sender: ADDR, blocks: 100, maxTxs: 5, maxValue: 1000n };

  it("encodes validators, staking validators and IBC receivers", () => {
    const m = openEvmWindowMsg({
      ...p,
      validators: ["0x" + "aa".repeat(20)],
      stakingValidators: [VALOPER],
      ibcReceivers: ["channel-0/cosmos1abc"],
    });
    const any = qorechainRegistry().encodeAsAny(m);
    expect(any.typeUrl).toBe("/qorechain.pqc.v1.MsgOpenEVMWindow");
    expect(m.value).toMatchObject({ validators: ["0x" + "aa".repeat(20)], stakingValidators: [VALOPER], ibcReceivers: ["channel-0/cosmos1abc"] });
  });

  it("checks the formats", () => {
    expect(() => openEvmWindowMsg({ ...p, validators: ["0x12"] })).toThrow(/validators/);
    expect(() => openEvmWindowMsg({ ...p, stakingValidators: [ADDR] })).toThrow(/qorvaloper/);
    expect(() => openEvmWindowMsg({ ...p, ibcReceivers: ["cosmos1abc"] })).toThrow(/channel/);
    expect(() => openEvmWindowMsg({ ...p, stakingValidators: [VALOPER, VALOPER] })).toThrow(/twice/);
  });
});

describe("gas caps and wasm gas (chain v3.2.8)", () => {
  it("reads the EVM limits, preferring the top-level values", async () => {
    let f = json({ limits: { tx_max_gas: "0", precompile_input_max_bytes: "0" }, tx_max_gas: "30000000", precompile_input_max_bytes: "65536" });
    expect(await fetchEvmLimits({ rest: "https://r", fetch: f as never })).toEqual({ txMaxGas: 30_000_000n, precompileInputMaxBytes: 65536n });
    expect(f.mock.calls[0][0]).toBe("https://r/qorechain/pqc/v1/evm_limits");
    f = json({ limits: { tx_max_gas: "20000000", precompile_input_max_bytes: "1024" } });
    expect(await fetchEvmLimits({ rest: "https://r", fetch: f as never })).toEqual({ txMaxGas: 20_000_000n, precompileInputMaxBytes: 1024n });
    f = json({});
    expect((await fetchEvmLimits({ rest: "https://r", fetch: f as never })).txMaxGas).toBe(30_000_000n);
  });

  it("refuses EVM gas above the cap before signing", async () => {
    expect(() => checkEvmGasLimit(30_000_001)).toThrow(/EVM transaction cap of 30000000/);
    expect(() => checkEvmGasLimit(25_000_000, 20_000_000n)).toThrow(/cap of 20000000/);
    const base = { relayer: ADDR, account: ADDR, scheme: "ed25519" as const, pubkey: new Uint8Array(32), signature: new Uint8Array(64), nonce: 0 };
    expect(() => executeEvmMsg({ ...base, gasLimit: 30_000_001 })).toThrow(/cap/);
    const wallet = { publicKey: new Uint8Array(32), signMessage: vi.fn(async () => new Uint8Array(64)) };
    await expect(
      buildPhantomExecuteEvm({ wallet, relayer: ADDR, chainId: CHAIN, account: ADDR, nonce: 0, gasLimit: 40_000_000 }),
    ).rejects.toThrow(/cap/);
    expect(wallet.signMessage).not.toHaveBeenCalled();
  });

  it("refuses Cosmos gas above 50,000,000 before signing", async () => {
    expect(() => checkCosmosGasLimit("50000001")).toThrow(/50000000/);
    expect(() => checkCosmosGasLimit(50_000_000)).not.toThrow();
    const sg = { simulate: vi.fn(), signAndBroadcast: vi.fn(), signAndBroadcastSync: vi.fn() };
    const tx = new TxClient({ signingClient: sg as never, senderAddress: ADDR });
    await expect(
      tx.signAndBroadcast([{ typeUrl: "/cosmos.bank.v1beta1.MsgSend", value: {} }], { amount: [], gas: "60000000" }),
    ).rejects.toThrow(/Cosmos transaction cap/);
    expect(sg.signAndBroadcast).not.toHaveBeenCalled();
  });

  it("gives wasm and cross-VM txs at least 1.3x the simulation", async () => {
    const sg = { simulate: vi.fn(async () => 100_000), signAndBroadcast: vi.fn(), signAndBroadcastSync: vi.fn() };
    const tx = new TxClient({ signingClient: sg as never, senderAddress: ADDR });
    const wasm = [{ typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract", value: {} }];
    expect(carriesWasmExecution(wasm)).toBe(true);
    expect((await tx.estimateGasDetails(wasm, "", 1.1)).gasWanted).toBe(130_000);
    expect((await tx.estimateGasDetails(wasm)).gasWanted).toBe(140_000);
    const bank = [{ typeUrl: "/cosmos.bank.v1beta1.MsgSend", value: {} }];
    expect((await tx.estimateGasDetails(bank, "", 1.5)).gasWanted).toBe(150_000);
  });

  it("refuses the fixed fallback gas for a wasm or cross-VM tx", async () => {
    const rest = new RestClient("http://host:1317", { fetch: json({}, false) as never, retries: 0 } as never);
    await expect(estimateFee(rest, { messages: [{ typeUrl: "/qorechain.crossvm.v1.MsgCrossVMCall" }] })).rejects.toThrow(
      /use fee "auto"/,
    );
    const fee = await estimateFee(rest, { messages: [{ typeUrl: "/qorechain.crossvm.v1.MsgCrossVMCall" }], gas: 600_000 });
    expect(fee.gas).toBe("600000");
    expect(wasmFee(1.1)).toBe(1.3);
    expect(wasmFee(1.5)).toBe(1.5);
    expect(wasmFee("auto")).toBe("auto");
  });
});

describe("minimum gas price helper (opt-in)", () => {
  it("divides the feemarket minimum by 1e12 exactly, with a 0.1 floor", async () => {
    let f = json({ params: { min_gas_price: "250000000000.000000000000000000" } });
    expect(await fetchMinGasPriceUqor({ rest: "https://r/", fetch: f as never })).toBe("0.25");
    expect(f.mock.calls[0][0]).toBe("https://r/cosmos/evm/feemarket/v1/params");
    f = json({ params: { min_gas_price: "100000000000.000000000000000001" } });
    expect(await fetchMinGasPriceUqor({ rest: "https://r", fetch: f as never })).toBe("0.100000000000000000000000000001");
    f = json({ params: { min_gas_price: "0.000000000000000000" } });
    expect(await fetchMinGasPriceUqor({ rest: "https://r", fetch: f as never })).toBe("0.1");
  });

  it("recommends max(0.15, minimum x margin)", async () => {
    let f = json({ params: { min_gas_price: "100000000000" } });
    expect(await recommendedGasPriceUqor({ rest: "https://r", fetch: f as never })).toBe("0.15");
    f = json({ params: { min_gas_price: "200000000000" } });
    expect(await recommendedGasPriceUqor({ rest: "https://r", fetch: f as never })).toBe("0.3");
    f = json({ params: { min_gas_price: "200000000000" } });
    expect(await recommendedGasPriceUqor({ rest: "https://r", fetch: f as never, margin: "2" })).toBe("0.4");
  });
});
