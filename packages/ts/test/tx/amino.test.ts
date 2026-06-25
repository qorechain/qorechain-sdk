import { describe, it, expect } from "vitest";
import { AminoTypes } from "@cosmjs/stargate";
import { buildAminoTypes, MSG_SEND_TYPE_URL } from "../../src/tx/builder";

const SENDER = "qor15yk64u7zc9g9k2yr2wmzeva5qgwxps6yjecvvu";
const RECIPIENT = "qor1erxf3sa9q2j4vgseu7jq4a258ckmk7cym4dgjq";

const sendMsg = {
  typeUrl: MSG_SEND_TYPE_URL,
  value: {
    fromAddress: SENDER,
    toAddress: RECIPIENT,
    amount: [{ denom: "uqor", amount: "1000" }],
  },
};

describe("buildAminoTypes", () => {
  it("returns an AminoTypes instance", () => {
    expect(buildAminoTypes()).toBeInstanceOf(AminoTypes);
  });

  it("has a working Amino converter for the standard MsgSend", () => {
    const types = buildAminoTypes();
    const amino = types.toAmino(sendMsg);
    // Standard cosmos-sdk Amino type for a bank send.
    expect(amino.type).toBe("cosmos-sdk/MsgSend");
    expect(amino.value).toMatchObject({
      from_address: SENDER,
      to_address: RECIPIENT,
      amount: [{ denom: "uqor", amount: "1000" }],
    });

    // Round-trips back to the proto message shape.
    const back = types.fromAmino(amino);
    expect(back.typeUrl).toBe(MSG_SEND_TYPE_URL);
    expect(back.value).toMatchObject({
      fromAddress: SENDER,
      toAddress: RECIPIENT,
      amount: [{ denom: "uqor", amount: "1000" }],
    });
  });

  it("merges extra converters on top of the defaults", () => {
    const customTypeUrl = "/qorechain.example.v1.MsgExample";
    const types = buildAminoTypes({
      [customTypeUrl]: {
        aminoType: "qorechain/MsgExample",
        toAmino: (v: { value: string }) => ({ value: v.value }),
        fromAmino: (v: { value: string }) => ({ value: v.value }),
      },
    });

    // Custom converter is present...
    const amino = types.toAmino({
      typeUrl: customTypeUrl,
      value: { value: "hi" },
    });
    expect(amino.type).toBe("qorechain/MsgExample");

    // ...and the defaults are still there.
    expect(types.toAmino(sendMsg).type).toBe("cosmos-sdk/MsgSend");
  });
});
