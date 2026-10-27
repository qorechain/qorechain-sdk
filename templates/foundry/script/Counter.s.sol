// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {Counter} from "../src/Counter.sol";

/// @notice Deploys Counter. The sender needs a registered ML-DSA-87 key and a
///         live EVM authorisation window first (see README).
contract CounterScript is Script {
    function run() external returns (Counter counter) {
        // Forge loads .env from the project root.
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        uint256 initial = vm.envOr("COUNTER_INITIAL", uint256(0));
        vm.startBroadcast(deployerKey);
        counter = new Counter(initial);
        vm.stopBroadcast();
        console.log("Counter deployed at", address(counter));
    }
}
