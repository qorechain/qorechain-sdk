import { describe, it, expect } from "vitest";
import { Registry } from "@cosmjs/proto-signing";
import { TxBody } from "cosmjs-types/cosmos/tx/v1beta1/tx";
import { MsgSend } from "cosmjs-types/cosmos/bank/v1beta1/tx";

// Cross-implementation byte vector. This MUST equal the chain's B0 for the same
// fixture (QoreChain x/pqc getSignBytes canonical B0). It proves the SDK
// (ts-proto) and the chain (gogoproto) serialize the signed TxBody (without the
// PQC extension) byte-for-byte identically — the precondition for any SDK-signed
// hybrid PQC tx to verify on chain. Verified equal 2026-06-23.
const CANONICAL_B0_HEX =
  "0a89010a1c2f636f736d6f732e62616e6b2e763162657461312e4d736753656e6412690a2a716f7231717171717171717171717171717171717171717171717171717171717171717170396a376432122a716f72317777777777777777777777777777777777777777777777777777777777777777667a306a78351a0f0a0475716f721207313233343536371214716f7265636861696e2d73646b2d766563746f72";

function toHex(b: Uint8Array): string {
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

describe("hybrid PQC B0 cross-implementation vector", () => {
  it("SDK B0 encoding is byte-identical to the chain (qorechain x/pqc)", () => {
    const registry = new Registry();
    registry.register("/cosmos.bank.v1beta1.MsgSend", MsgSend);

    const encodedMessages = [
      registry.encodeAsAny({
        typeUrl: "/cosmos.bank.v1beta1.MsgSend",
        value: {
          fromAddress: "qor1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqp9j7d2",
          toAddress: "qor1wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwfz0jx5",
          amount: [{ denom: "uqor", amount: "1234567" }],
        },
      }),
    ];

    // Exactly how buildHybridTx derives B0 (body WITHOUT the PQC extension).
    const baseBody = TxBody.fromPartial({
      messages: encodedMessages,
      memo: "qorechain-sdk-vector",
    });
    const b0 = TxBody.encode(baseBody).finish();

    expect(toHex(b0)).toEqual(CANONICAL_B0_HEX);
  });
});
