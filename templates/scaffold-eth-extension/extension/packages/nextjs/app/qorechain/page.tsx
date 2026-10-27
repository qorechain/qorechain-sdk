"use client";

import { useEffect, useState } from "react";
import { QORECHAIN_REST_ENDPOINTS, type EvmWindow, evmWindowStatus } from "@qorechain/evm";
import type { NextPage } from "next";
import { useAccount } from "wagmi";
import { Address } from "~~/components/scaffold-eth";

const QoreChainWindow: NextPage = () => {
  const { address, chainId } = useAccount();
  const [evmWindow, setEvmWindow] = useState<EvmWindow | undefined>();
  const [error, setError] = useState<string | undefined>();
  const rest = chainId !== undefined ? QORECHAIN_REST_ENDPOINTS[chainId] : undefined;

  useEffect(() => {
    if (!address || !rest) return;
    let cancelled = false;
    const read = () =>
      evmWindowStatus({ rest, address })
        .then(w => !cancelled && (setEvmWindow(w), setError(undefined)))
        .catch((e: Error) => !cancelled && setError(e.message));
    read();
    const timer = setInterval(read, 10_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [address, rest]);

  return (
    <div className="flex flex-col items-center grow pt-10 px-5 gap-4 max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold">QoreChain EVM authorisation window</h1>
      <p>
        On QoreChain an EVM transaction (a deploy included) is accepted only when the sender has a registered
        ML-DSA-87 key and a live EVM authorisation window. Both are set up on the chain&apos;s native lane with the
        post-quantum key. Reads and simulation need neither.
      </p>
      {!address && <p>Connect a wallet to see your window.</p>}
      {address && !rest && <p>Switch to QoreChain or QoreChain Testnet.</p>}
      {address && rest && (
        <div className="flex flex-col gap-2 items-center">
          <Address address={address} />
          {error && <p className="text-error">Could not read the window: {error}</p>}
          {evmWindow && !evmWindow.found && <p>No window. Sending from this account is refused until one is opened.</p>}
          {evmWindow?.found && (
            <p>
              {evmWindow.live ? "Live" : "Not usable"}: {evmWindow.remainingBlocks.toString()} blocks,{" "}
              {evmWindow.remainingTxs.toString()} transactions, {evmWindow.remainingValue.toString()} uqor left.
            </p>
          )}
        </div>
      )}
      <p className="text-sm">
        Opening a window advances the account&apos;s nonce, so open it before you deploy. The window counts value plus
        the maximum fee of each transaction.
      </p>
    </div>
  );
};

export default QoreChainWindow;
