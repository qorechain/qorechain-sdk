package io.github.qorechain;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.github.qorechain.address.Address;
import io.github.qorechain.address.Validators;
import io.github.qorechain.denom.Denom;
import io.github.qorechain.networks.NetworkConfig;
import io.github.qorechain.networks.Networks;
import io.github.qorechain.utils.Hashing;
import io.github.qorechain.utils.Hex;
import io.github.qorechain.utils.Units;
import java.math.BigInteger;
import org.junit.jupiter.api.Test;

/** Denom/units/address/validation/hash known-vector and network preset tests. */
class UtilsTest {

    @Test
    void denomToBaseFromBaseExact() {
        assertEquals("1500000", Denom.toBase("1.5"));
        assertEquals("100000", Denom.toBase("0.1"));
        assertEquals("1", Denom.toBase("0.000001"));
        assertEquals("1.5", Denom.fromBase("1500000"));
        assertEquals("1", Denom.fromBase("1000000"));
        assertEquals("0.000001", Denom.fromBase("1"));
        assertEquals("0", Denom.fromBase("0"));
        assertThrows(IllegalArgumentException.class, () -> Denom.toBase("1.2.3"));
        assertThrows(IllegalArgumentException.class, () -> Denom.toBase("-1"));
        assertThrows(IllegalArgumentException.class, () -> Denom.toBase("0.1234567")); // > 6 dp
    }

    @Test
    void unitsParseFormat() {
        assertEquals(new BigInteger("1500000000000000000"), Units.parseUnits("1.5", 18));
        assertEquals("1.5", Units.formatUnits(new BigInteger("1500000000000000000"), 18));
        assertEquals("0", Units.formatUnits(BigInteger.ZERO, 18));
    }

    @Test
    void eip55ChecksumAndValidators() {
        String addr = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
        assertEquals(addr, Validators.toChecksumAddress(addr.toLowerCase()));
        assertTrue(Validators.isChecksumAddress(addr));
        assertFalse(Validators.isChecksumAddress(addr.toLowerCase()));
        assertTrue(Validators.isValidEvmAddress(addr));
        assertFalse(Validators.isValidEvmAddress("0x1234"));
        // SVM
        assertTrue(Validators.isValidSvmAddress("oeYf6KAJkLYhBuR8CiGc6L4D4Xtfepr85fuDgA9kq96"));
        assertFalse(Validators.isValidSvmAddress("not-base58!!"));
    }

    @Test
    void bech32RoundTrip() {
        String addr = "qor15yk64u7zc9g9k2yr2wmzeva5qgwxps6yjecvvu";
        assertTrue(Address.isValidBech32(addr, "qor"));
        assertFalse(Address.isValidBech32(addr, "cosmos"));
        String hex = Address.bech32ToHex(addr);
        assertEquals(addr, Address.hexToBech32(hex, "qor"));
    }

    @Test
    void hashKnownVectors() {
        // SHA-256("") = e3b0c442...; keccak256("") = c5d2460186...; ripemd160("") = 9c1185a5...
        assertEquals(
                "0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
                Hashing.sha256Hex(""));
        assertEquals(
                "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
                Hashing.keccak256Hex(""));
        assertEquals("0x9c1185a5c5e9fc54612808977ee8f548b2258d31", Hashing.ripemd160Hex(""));
    }

    @Test
    void hexRoundTrip() {
        byte[] b = {0x00, (byte) 0xff, 0x10};
        assertEquals("00ff10", Hex.encode(b));
        assertEquals("0x00ff10", Hex.encodePrefixed(b));
        assertEquals("00ff10", Hex.encode(Hex.decode("0x00ff10")));
    }

    @Test
    void networkPresets() {
        NetworkConfig testnet = Networks.get("testnet");
        assertEquals("qorechain-diana", testnet.chainId);
        assertTrue(testnet.live);
        assertEquals("qor", testnet.bech32.account);
        assertEquals("uqor", testnet.coin.base);
        assertEquals(6, testnet.coin.exponent);
        assertEquals("http://localhost:1317", testnet.endpoints.rest);
        assertEquals("http://localhost:26657", testnet.endpoints.rpc);
        assertEquals("ws://localhost:8546", testnet.endpoints.evmWs);

        NetworkConfig mainnet = Networks.get("mainnet");
        assertEquals("qorechain-vladi", mainnet.chainId);
        assertTrue(mainnet.live);

        assertThrows(IllegalArgumentException.class, () -> Networks.get("nope"));
    }
}
