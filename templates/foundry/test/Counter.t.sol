// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Counter} from "../src/Counter.sol";

contract CounterTest is Test {
    Counter internal counter;

    event CountChanged(uint256 newCount);

    function setUp() public {
        counter = new Counter(41);
    }

    function test_InitialValue() public view {
        assertEq(counter.count(), 41);
    }

    function test_Increment() public {
        vm.expectEmit(address(counter));
        emit CountChanged(42);
        counter.increment();
        assertEq(counter.count(), 42);
    }

    function testFuzz_Set(uint256 value) public {
        counter.set(value);
        assertEq(counter.count(), value);
    }
}
