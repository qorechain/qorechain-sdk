import { ConnectButton } from "@rainbow-me/rainbowkit";
import {
  QORECHAIN_REST_ENDPOINTS,
  classifyEvmWindowRejection,
  evmWindowStatus,
  type EvmWindowRejection,
} from "@qorechain/evm";
import { useQuery } from "@tanstack/react-query";
import { formatEther } from "viem";
import { useAccount, useBalance, useBlockNumber, useSendTransaction } from "wagmi";

const REMEDY: Record<EvmWindowRejection, string> = {
  "no-pqc-key": "This account has no registered ML-DSA-87 key. Register one on the native lane first.",
  "no-window": "No EVM authorisation window is open. Open one on the native lane, then retry.",
  exhausted: "The window has run out of blocks, transactions or value. Open a new one.",
  invalid: "The chain refused the window parameters.",
};

/** The account's EVM authorisation window, read over the native-lane REST API. */
function WindowStatus({ address, chainId }: { address: `0x${string}`; chainId: number }) {
  const rest = QORECHAIN_REST_ENDPOINTS[chainId];
  const { data, error, isLoading } = useQuery({
    queryKey: ["evm-window", chainId, address],
    queryFn: () => evmWindowStatus({ rest: rest!, address }),
    enabled: rest !== undefined,
    refetchInterval: 10_000,
  });
  if (!rest) return <p>Unknown network.</p>;
  if (isLoading) return <p>Reading the EVM window...</p>;
  if (error) return <p>Could not read the window: {error.message}</p>;
  if (!data?.found) {
    return <p>EVM window: none. Sending from this account is refused until one is opened.</p>;
  }
  return (
    <p>
      EVM window: {data.live ? "live" : "not usable"} ({data.remainingBlocks.toString()} blocks,{" "}
      {data.remainingTxs.toString()} transactions, {data.remainingValue.toString()} uqor left)
    </p>
  );
}

export function App() {
  const { address, chainId, isConnected } = useAccount();
  const { data: balance } = useBalance({ address });
  const { data: block } = useBlockNumber({ watch: true });
  const send = useSendTransaction();
  const rejection = send.error ? classifyEvmWindowRejection(send.error) : undefined;

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 720, margin: "2rem auto", padding: "0 1rem" }}>
      <h1>QoreChain EVM dApp</h1>
      <ConnectButton />
      <p>Latest block: {block?.toString() ?? "..."}</p>

      {isConnected && address && chainId ? (
        <section>
          <p>
            Account <code>{address}</code> on chain {chainId}
          </p>
          <p>Balance: {balance ? `${formatEther(balance.value)} QOR` : "..."}</p>
          <WindowStatus address={address} chainId={chainId} />
          <button type="button" disabled={send.isPending} onClick={() => send.sendTransaction({ to: address, value: 0n })}>
            Send 0 QOR to yourself
          </button>
          {send.data && <p>Sent: {send.data}</p>}
          {send.error && <p>Refused: {rejection ? REMEDY[rejection] : send.error.message}</p>}
        </section>
      ) : (
        <p>Connect a wallet to read your account.</p>
      )}
    </main>
  );
}
