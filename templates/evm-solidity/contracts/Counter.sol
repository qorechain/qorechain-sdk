// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @title Counter
/// @notice A minimal storage contract: a single number you can read, set, and
///         increment. Used as the smallest useful example of deploying and
///         interacting with a contract on the QoreChain EVM Engine.
contract Counter {
    /// @notice The current count.
    uint256 public count;

    /// @notice Emitted whenever the count changes.
    event CountChanged(uint256 newCount);

    /// @param initial The starting value for the counter.
    constructor(uint256 initial) {
        count = initial;
        emit CountChanged(initial);
    }

    /// @notice Increase the count by one.
    function increment() external {
        count += 1;
        emit CountChanged(count);
    }

    /// @notice Set the count to an explicit value.
    /// @param value The new count.
    function set(uint256 value) external {
        count = value;
        emit CountChanged(value);
    }
}
