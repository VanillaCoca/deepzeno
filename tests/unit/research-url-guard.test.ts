import assert from "node:assert/strict";
import { describe, it } from "node:test";

// Pure module — fetch-page.ts imports "server-only" which throws in plain
// node:test. Host/IP classification is pure and lives in url-guard.ts.
import { isBlockedHost, isBlockedIp } from "../../lib/research/url-guard.ts";

describe("isBlockedIp (IPv4)", () => {
  it("blocks loopback", () => {
    assert.equal(isBlockedIp("127.0.0.1"), true);
    assert.equal(isBlockedIp("127.255.255.254"), true);
  });

  it("blocks RFC 1918 private ranges", () => {
    assert.equal(isBlockedIp("10.0.0.1"), true);
    assert.equal(isBlockedIp("10.255.255.255"), true);
    assert.equal(isBlockedIp("172.16.0.1"), true);
    assert.equal(isBlockedIp("172.31.255.255"), true);
    assert.equal(isBlockedIp("192.168.1.1"), true);
  });

  it("does not block the public neighbors of private ranges", () => {
    assert.equal(isBlockedIp("9.255.255.255"), false);
    assert.equal(isBlockedIp("11.0.0.0"), false);
    assert.equal(isBlockedIp("172.15.255.255"), false);
    assert.equal(isBlockedIp("172.32.0.0"), false);
    assert.equal(isBlockedIp("192.167.255.255"), false);
    assert.equal(isBlockedIp("192.169.0.0"), false);
  });

  it("blocks link-local incl. cloud metadata endpoints", () => {
    assert.equal(isBlockedIp("169.254.169.254"), true);
    assert.equal(isBlockedIp("169.254.0.1"), true);
  });

  it("blocks CGNAT (incl. Alibaba/ECS metadata 100.100.100.200)", () => {
    assert.equal(isBlockedIp("100.64.0.0"), true);
    assert.equal(isBlockedIp("100.100.100.200"), true);
    assert.equal(isBlockedIp("100.127.255.255"), true);
    assert.equal(isBlockedIp("100.63.255.255"), false);
    assert.equal(isBlockedIp("100.128.0.0"), false);
  });

  it("blocks unspecified, multicast, and reserved ranges", () => {
    assert.equal(isBlockedIp("0.0.0.0"), true);
    assert.equal(isBlockedIp("0.1.2.3"), true);
    assert.equal(isBlockedIp("192.0.0.192"), true);
    assert.equal(isBlockedIp("198.18.0.1"), true);
    assert.equal(isBlockedIp("224.0.0.1"), true);
    assert.equal(isBlockedIp("240.0.0.1"), true);
    assert.equal(isBlockedIp("255.255.255.255"), true);
  });

  it("allows ordinary public addresses", () => {
    assert.equal(isBlockedIp("8.8.8.8"), false);
    assert.equal(isBlockedIp("1.1.1.1"), false);
    assert.equal(isBlockedIp("93.184.216.34"), false);
  });
});

describe("isBlockedIp (IPv6)", () => {
  it("blocks loopback and unspecified", () => {
    assert.equal(isBlockedIp("::1"), true);
    assert.equal(isBlockedIp("::"), true);
    assert.equal(isBlockedIp("0:0:0:0:0:0:0:1"), true);
  });

  it("blocks link-local and unique-local (incl. AWS IMDSv6)", () => {
    assert.equal(isBlockedIp("fe80::1"), true);
    assert.equal(isBlockedIp("febf::1"), true);
    assert.equal(isBlockedIp("fc00::1"), true);
    assert.equal(isBlockedIp("fd00:ec2::254"), true);
    assert.equal(isBlockedIp("fdff::1"), true);
  });

  it("blocks multicast", () => {
    assert.equal(isBlockedIp("ff02::1"), true);
  });

  it("classifies IPv4-mapped addresses by their embedded IPv4", () => {
    assert.equal(isBlockedIp("::ffff:127.0.0.1"), true);
    assert.equal(isBlockedIp("::ffff:169.254.169.254"), true);
    assert.equal(isBlockedIp("::ffff:8.8.8.8"), false);
    // hex-group form of ::ffff:127.0.0.1
    assert.equal(isBlockedIp("::ffff:7f00:1"), true);
  });

  it("classifies NAT64 (64:ff9b::/96) by the embedded IPv4", () => {
    assert.equal(isBlockedIp("64:ff9b::7f00:1"), true);
    assert.equal(isBlockedIp("64:ff9b::808:808"), false);
  });

  it("allows ordinary public IPv6 addresses", () => {
    assert.equal(isBlockedIp("2606:4700::1111"), false);
    assert.equal(isBlockedIp("2001:4860:4860::8888"), false);
  });

  it("blocks malformed addresses (fail closed)", () => {
    assert.equal(isBlockedIp("not-an-ip"), true);
    assert.equal(isBlockedIp(""), true);
    assert.equal(isBlockedIp("1.2.3"), true);
    assert.equal(isBlockedIp("1.2.3.4.5"), true);
    assert.equal(isBlockedIp("::1::2"), true);
    assert.equal(isBlockedIp("12345::1"), true);
  });
});

describe("isBlockedHost", () => {
  it("blocks localhost and *.localhost (case/dot-insensitive)", () => {
    assert.equal(isBlockedHost("localhost"), true);
    assert.equal(isBlockedHost("LOCALHOST"), true);
    assert.equal(isBlockedHost("localhost."), true);
    assert.equal(isBlockedHost("foo.localhost"), true);
  });

  it("blocks mDNS .local names and empty hosts", () => {
    assert.equal(isBlockedHost("printer.local"), true);
    assert.equal(isBlockedHost(""), true);
  });

  it("blocks IP literals via the IP classifier", () => {
    assert.equal(isBlockedHost("127.0.0.1"), true);
    assert.equal(isBlockedHost("169.254.169.254"), true);
    // URL.hostname keeps brackets on IPv6 literals
    assert.equal(isBlockedHost("[::1]"), true);
    assert.equal(isBlockedHost("[fd00:ec2::254]"), true);
    assert.equal(isBlockedHost("[2606:4700::1111]"), false);
  });

  it("allows ordinary public hostnames", () => {
    assert.equal(isBlockedHost("example.com"), false);
    assert.equal(isBlockedHost("en.wikipedia.org"), false);
    assert.equal(isBlockedHost("localhost.example.com"), false);
  });
});
