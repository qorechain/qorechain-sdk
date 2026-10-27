---
id: evm-quickstarts
title: EVM quickstarts
sidebar_position: 2
---

# EVM quickstarts

QoreChain's EVM lane speaks standard Ethereum JSON-RPC, so the usual libraries
work unchanged. Each snippet below connects to the public testnet, reads the
chain id, an account balance and an ERC-20 through `eth_call`. Every snippet was
run against `https://evm-testnet.qore.host` and printed:

```text
chain id: 9800
balance: 0.703004000000004 QOR
token: WQOR 18
```

| Network | EVM chain id | HTTP RPC | WebSocket |
| --- | --- | --- | --- |
| Testnet (`qorechain-diana`) | 9800 | `https://evm-testnet.qore.host` | `wss://evm-ws-testnet.qore.host` |
| Mainnet (`qorechain-vladi`) | 9801 | `https://evm.qore.host` | |

The token at `0x9C2F...Ba1c` is a test ERC-20 deployed on the testnet; replace
it, and the address, with your own. Reads need no key and no authorisation.
Before you **send** anything, read [Before you send](#before-you-send) below.

## TypeScript: viem

```bash
npm install viem @qorechain/evm
```

```ts
import { createPublicClient, erc20Abi, formatEther, http } from "viem";
import { qorechainTestnet } from "@qorechain/evm";

const client = createPublicClient({ chain: qorechainTestnet, transport: http() });

const ADDRESS = "0x000000000000000000000000000000000000dEaD"; // any 0x address
const TOKEN = "0x9C2F20329750c16B215bDc50455d320De2a7Ba1c"; // a test ERC-20 on the testnet

const chainId = await client.getChainId();
const balance = await client.getBalance({ address: ADDRESS });
const symbol = await client.readContract({ address: TOKEN, abi: erc20Abi, functionName: "symbol" });
const decimals = await client.readContract({ address: TOKEN, abi: erc20Abi, functionName: "decimals" });

console.log("chain id:", chainId); // 9800
console.log("balance:", formatEther(balance), "QOR");
console.log("token:", symbol, decimals);
```

`qorechainTestnet` and `qorechain` are viem chain definitions exported by
`@qorechain/evm`; they also plug into wagmi and RainbowKit.

## TypeScript: ethers v6

```bash
npm install ethers@6
```

```ts
import { Contract, JsonRpcProvider, formatEther } from "ethers";

const provider = new JsonRpcProvider("https://evm-testnet.qore.host", 9800, { staticNetwork: true });

const ADDRESS = "0x000000000000000000000000000000000000dEaD"; // any 0x address
const TOKEN = "0x9C2F20329750c16B215bDc50455d320De2a7Ba1c"; // a test ERC-20 on the testnet
const erc20 = new Contract(
  TOKEN,
  ["function symbol() view returns (string)", "function decimals() view returns (uint8)"],
  provider,
);

const { chainId } = await provider.getNetwork();
const balance = await provider.getBalance(ADDRESS);
const symbol: string = await erc20.symbol();
const decimals: bigint = await erc20.decimals();

console.log("chain id:", chainId); // 9800n
console.log("balance:", formatEther(balance), "QOR");
console.log("token:", symbol, decimals);
```

## Python: web3.py

```bash
pip install "web3>=7,<8"
```

```python
from web3 import Web3

w3 = Web3(Web3.HTTPProvider("https://evm-testnet.qore.host"))

ADDRESS = Web3.to_checksum_address("0x000000000000000000000000000000000000dead")  # any 0x address
TOKEN = Web3.to_checksum_address("0x9c2f20329750c16b215bdc50455d320de2a7ba1c")  # a test ERC-20 on the testnet
ERC20_ABI = [
    {"name": "symbol", "type": "function", "stateMutability": "view", "inputs": [], "outputs": [{"name": "", "type": "string"}]},
    {"name": "decimals", "type": "function", "stateMutability": "view", "inputs": [], "outputs": [{"name": "", "type": "uint8"}]},
]

token = w3.eth.contract(address=TOKEN, abi=ERC20_ABI)

print("chain id:", w3.eth.chain_id)  # 9800
print("balance:", Web3.from_wei(w3.eth.get_balance(ADDRESS), "ether"), "QOR")
print("token:", token.functions.symbol().call(), token.functions.decimals().call())
```

Tested with web3.py 7.16.

## Go: go-ethereum

```bash
go get github.com/ethereum/go-ethereum@latest
```

```go
package main

import (
	"context"
	"fmt"
	"log"
	"math/big"
	"strings"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/ethclient"
)

const erc20ABI = `[
  {"name":"symbol","type":"function","stateMutability":"view","inputs":[],"outputs":[{"name":"","type":"string"}]},
  {"name":"decimals","type":"function","stateMutability":"view","inputs":[],"outputs":[{"name":"","type":"uint8"}]}
]`

func main() {
	ctx := context.Background()
	client, err := ethclient.DialContext(ctx, "https://evm-testnet.qore.host")
	if err != nil {
		log.Fatal(err)
	}
	defer client.Close()

	address := common.HexToAddress("0x000000000000000000000000000000000000dEaD") // any 0x address
	token := common.HexToAddress("0x9C2F20329750c16B215bDc50455d320De2a7Ba1c")   // a test ERC-20 on the testnet

	chainID, err := client.ChainID(ctx)
	if err != nil {
		log.Fatal(err)
	}
	balance, err := client.BalanceAt(ctx, address, nil)
	if err != nil {
		log.Fatal(err)
	}

	parsed, err := abi.JSON(strings.NewReader(erc20ABI))
	if err != nil {
		log.Fatal(err)
	}
	call := func(method string) []interface{} {
		data, err := parsed.Pack(method)
		if err != nil {
			log.Fatal(err)
		}
		out, err := client.CallContract(ctx, ethereum.CallMsg{To: &token, Data: data}, nil)
		if err != nil {
			log.Fatal(err)
		}
		values, err := parsed.Unpack(method, out)
		if err != nil {
			log.Fatal(err)
		}
		return values
	}

	qor := new(big.Float).Quo(new(big.Float).SetInt(balance), big.NewFloat(1e18))
	fmt.Println("chain id:", chainID) // 9800
	fmt.Println("balance:", qor.Text('f', 6), "QOR")
	fmt.Println("token:", call("symbol")[0], call("decimals")[0])
}
```

Tested with go-ethereum 1.17.10 (it prints the balance rounded to 6 decimals).

## Rust: alloy

```toml
[dependencies]
alloy = { version = "1", features = ["provider-http", "contract", "sol-types"] }
tokio = { version = "1", features = ["macros", "rt-multi-thread"] }
```

```rust
use alloy::{
    primitives::{address, utils::format_ether},
    providers::{Provider, ProviderBuilder},
    sol,
};

sol! {
    #[sol(rpc)]
    interface IERC20 {
        function symbol() external view returns (string);
        function decimals() external view returns (uint8);
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let provider = ProviderBuilder::new().connect_http("https://evm-testnet.qore.host".parse()?);

    let account = address!("0x000000000000000000000000000000000000dEaD"); // any 0x address
    let token = IERC20::new(address!("0x9C2F20329750c16B215bDc50455d320De2a7Ba1c"), &provider); // a test ERC-20

    let chain_id = provider.get_chain_id().await?;
    let balance = provider.get_balance(account).await?;
    let symbol = token.symbol().call().await?;
    let decimals = token.decimals().call().await?;

    println!("chain id: {chain_id}"); // 9800
    println!("balance: {} QOR", format_ether(balance));
    println!("token: {symbol} {decimals}");
    Ok(())
}
```

Tested with alloy 1.8.

## Java: web3j

```xml
<dependency>
  <groupId>org.web3j</groupId>
  <artifactId>core</artifactId>
  <version>5.0.0</version>
</dependency>
```

```java
import java.math.BigInteger;
import java.util.List;

import org.web3j.abi.FunctionEncoder;
import org.web3j.abi.FunctionReturnDecoder;
import org.web3j.abi.TypeReference;
import org.web3j.abi.datatypes.Function;
import org.web3j.abi.datatypes.Type;
import org.web3j.abi.datatypes.Utf8String;
import org.web3j.abi.datatypes.generated.Uint8;
import org.web3j.protocol.Web3j;
import org.web3j.protocol.core.DefaultBlockParameterName;
import org.web3j.protocol.core.methods.request.Transaction;
import org.web3j.protocol.http.HttpService;
import org.web3j.utils.Convert;

public class Quickstart {
    static final String ADDRESS = "0x000000000000000000000000000000000000dEaD"; // any 0x address
    static final String TOKEN = "0x9C2F20329750c16B215bDc50455d320De2a7Ba1c"; // a test ERC-20 on the testnet

    public static void main(String[] args) throws Exception {
        Web3j web3 = Web3j.build(new HttpService("https://evm-testnet.qore.host"));
        try {
            BigInteger chainId = web3.ethChainId().send().getChainId();
            BigInteger balance = web3.ethGetBalance(ADDRESS, DefaultBlockParameterName.LATEST).send().getBalance();

            System.out.println("chain id: " + chainId); // 9800
            System.out.println("balance: " + Convert.fromWei(balance.toString(), Convert.Unit.ETHER) + " QOR");
            System.out.println("token: " + call(web3, "symbol", new TypeReference<Utf8String>() {})
                    + " " + call(web3, "decimals", new TypeReference<Uint8>() {}));
        } finally {
            web3.shutdown();
        }
    }

    /** eth_call a no-argument view function and decode its single return value. */
    @SuppressWarnings({"rawtypes", "unchecked"})
    static Object call(Web3j web3, String name, TypeReference<?> out) throws Exception {
        Function fn = new Function(name, List.of(), List.of((TypeReference<Type>) (TypeReference) out));
        String data = FunctionEncoder.encode(fn);
        String raw = web3.ethCall(Transaction.createEthCallTransaction(null, TOKEN, data), DefaultBlockParameterName.LATEST)
                .send().getValue();
        List<Type> decoded = FunctionReturnDecoder.decode(raw, fn.getOutputParameters());
        return decoded.get(0).getValue();
    }
}
```

Tested with web3j 5.0.0 on JDK 21.

## Before you send

Reads, `eth_call` and `eth_estimateGas` work for any account. **Sending is
different from Ethereum**: QoreChain admits an EVM transaction only when the
sender has

1. a registered **ML-DSA-87** key, and
2. a live **EVM authorisation window**.

Both are set up on QoreChain's native lane with messages signed hybrid
(secp256k1 + ML-DSA-87), so the secp256k1 key your EVM library holds can never
authorise spending on its own. The window bounds the number of blocks, the
number of EVM transactions, and the total they may spend (value plus the
maximum fee of each transaction). Without it the node refuses the transaction
with "no open EVM authorisation window" (or "has no registered post-quantum
key").

The order is always:

1. Register the account's ML-DSA-87 key (once per account).
2. Open a window with `MsgOpenEVMWindow`, signed hybrid on the native lane.
3. **Then** read the nonce and sign the EVM transaction. Opening the window is
   a native-lane transaction and advances the account's nonce, so a
   transaction signed before it is refused as "nonce too low".
4. Send with your EVM library as usual, until the window runs out.

Each QoreChain SDK builds and checks the window message:

| Language | Open a window | Read a window |
| --- | --- | --- |
| TypeScript | `openEvmWindowMsg` (`@qorechain/sdk`), `openEvmWindowMessage` (`@qorechain/evm`) | `fetchEvmWindow`, `evmWindowStatus` |
| Python | `qorsdk.msg.pqc.open_evm_window` | `qorsdk.evm_window.get_evm_window` |
| Go | `messages.NewOpenEVMWindow` | REST `/qorechain/pqc/v1/evm_window/{address}` |
| Rust | `qorechain::msg::pqc::open_evm_window` | REST `/qorechain/pqc/v1/evm_window/{address}` |
| Java | `io.github.qorechain.evm.EvmWindow.open` | `EvmWindow.restPath` |

In TypeScript, for an eth-native account (one key for `0x...` and `qor1...`):

```ts
import { StargateClient } from "@cosmjs/stargate";
import { EthNativeSigner, deriveUnifiedAccount, openEvmWindowMsg } from "@qorechain/sdk";

const account = await deriveUnifiedAccount(mnemonic); // account.evm = 0x..., account.cosmos = qor1...
const signer = new EthNativeSigner(account, { rest: "https://api-testnet.qore.host" });
const transport = await StargateClient.connect("https://rpc-testnet.qore.host");

await signer.signAndBroadcast(transport, {
  chainId: "qorechain-diana",
  accountNumber, // from /cosmos/auth/v1beta1/accounts/{qor1...}
  sequence,
  fee: { amount: [{ denom: "uqor", amount: "100000" }], gas: "800000" },
  messages: [openEvmWindowMsg({ sender: account.cosmos, blocks: 600, maxTxs: 5, maxValue: "3750000" })],
});
// Now read the nonce and send with viem, ethers, Foundry or Hardhat.
```

The `foundry` and `hardhat` templates of `create-qorechain-dapp` wrap these
steps in `pnpm window register` and `pnpm window open`. See
[QoreChain EVM compared with Ethereum](evm-differences.md) for the rest of what
differs.
