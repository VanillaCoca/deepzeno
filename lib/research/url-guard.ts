// Pure helper — no server-only import so node:test can import this directly.
//
// SSRF guard for the research fetcher: classifies hostnames and IP addresses
// so fetch-page.ts can reject private/loopback/link-local/metadata targets.
// Fail closed: anything that does not parse as a clearly-public address is
// treated as blocked.

const BLOCKED_IPV4_CIDRS: ReadonlyArray<readonly [number, number]> = [
  [0x00_00_00_00, 8], // 0.0.0.0/8 "this network"
  [0x0a_00_00_00, 8], // 10.0.0.0/8 RFC 1918
  [0x64_40_00_00, 10], // 100.64.0.0/10 CGNAT (incl. Alibaba metadata 100.100.100.200)
  [0x7f_00_00_00, 8], // 127.0.0.0/8 loopback
  [0xa9_fe_00_00, 16], // 169.254.0.0/16 link-local (incl. AWS/GCP metadata)
  [0xac_10_00_00, 12], // 172.16.0.0/12 RFC 1918
  [0xc0_00_00_00, 24], // 192.0.0.0/24 IETF protocol assignments
  [0xc0_a8_00_00, 16], // 192.168.0.0/16 RFC 1918
  [0xc6_12_00_00, 15], // 198.18.0.0/15 benchmarking
  [0xe0_00_00_00, 4], // 224.0.0.0/4 multicast
  [0xf0_00_00_00, 4], // 240.0.0.0/4 reserved + broadcast
];

const IPV4_OCTET_PATTERN = /^\d{1,3}$/;
const IPV6_GROUP_PATTERN = /^[0-9a-f]{1,4}$/;

function parseIpv4(ip: string): number | null {
  const parts = ip.split(".");

  if (parts.length !== 4) {
    return null;
  }

  let value = 0;

  for (const part of parts) {
    if (!IPV4_OCTET_PATTERN.test(part)) {
      return null;
    }

    const octet = Number(part);

    if (octet > 255) {
      return null;
    }

    value = value * 256 + octet;
  }

  return value >>> 0;
}

function isBlockedIpv4Value(value: number): boolean {
  return BLOCKED_IPV4_CIDRS.some(([base, bits]) => {
    const mask = (~0 << (32 - bits)) >>> 0;
    return (value & mask) >>> 0 === base;
  });
}

// Expands a colon-separated section into 16-bit groups; an embedded IPv4
// tail ("::ffff:127.0.0.1") becomes two groups.
function ipv6Groups(parts: string[]): number[] | null {
  const groups: number[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    if (part.includes(".")) {
      if (i !== parts.length - 1) {
        return null;
      }

      const v4 = parseIpv4(part);

      if (v4 === null) {
        return null;
      }

      groups.push(v4 >>> 16, v4 & 0xff_ff);
    } else {
      if (!IPV6_GROUP_PATTERN.test(part)) {
        return null;
      }

      groups.push(Number.parseInt(part, 16));
    }
  }

  return groups;
}

function parseIpv6(raw: string): number[] | null {
  // Drop any zone id (fe80::1%eth0).
  const zoneIndex = raw.indexOf("%");
  const bare = (zoneIndex === -1 ? raw : raw.slice(0, zoneIndex)).toLowerCase();
  const sections = bare.split("::");

  if (sections.length === 1) {
    const groups = ipv6Groups(bare.split(":"));
    return groups?.length === 8 ? groups : null;
  }

  if (sections.length !== 2) {
    return null;
  }

  const head = sections[0] === "" ? [] : ipv6Groups(sections[0].split(":"));
  const tail = sections[1] === "" ? [] : ipv6Groups(sections[1].split(":"));

  if (head === null || tail === null) {
    return null;
  }

  const fill = 8 - head.length - tail.length;

  if (fill < 1) {
    return null;
  }

  return [...head, ...new Array(fill).fill(0), ...tail];
}

function isBlockedIpv6Groups(groups: number[]): boolean {
  const leadingZeros = groups.findIndex((g) => g !== 0);

  // :: (unspecified) and ::1 (loopback)
  if (leadingZeros === -1 || (leadingZeros === 7 && groups[7] === 1)) {
    return true;
  }

  // fe80::/10 link-local
  if ((groups[0] & 0xff_c0) === 0xfe_80) {
    return true;
  }

  // fc00::/7 unique-local (incl. AWS IMDSv6 fd00:ec2::254)
  if ((groups[0] & 0xfe_00) === 0xfc_00) {
    return true;
  }

  // ff00::/8 multicast
  if ((groups[0] & 0xff_00) === 0xff_00) {
    return true;
  }

  const embeddedV4 = ((groups[6] << 16) | groups[7]) >>> 0;

  // ::ffff:0:0/96 IPv4-mapped and ::/96 IPv4-compatible (deprecated)
  if (leadingZeros >= 5 && (groups[5] === 0xff_ff || groups[5] === 0)) {
    return isBlockedIpv4Value(embeddedV4);
  }

  // 64:ff9b::/96 NAT64
  if (
    groups[0] === 0x64 &&
    groups[1] === 0xff_9b &&
    groups[2] === 0 &&
    groups[3] === 0 &&
    groups[4] === 0 &&
    groups[5] === 0
  ) {
    return isBlockedIpv4Value(embeddedV4);
  }

  return false;
}

/**
 * Returns true when `ip` must not be fetched: private, loopback, link-local,
 * CGNAT, multicast, reserved, metadata-adjacent — or unparseable (fail closed).
 * Accepts bare IPv4/IPv6 strings as returned by DNS lookups.
 */
export function isBlockedIp(ip: string): boolean {
  if (ip.includes(":")) {
    const groups = parseIpv6(ip);
    return groups === null ? true : isBlockedIpv6Groups(groups);
  }

  const value = parseIpv4(ip);
  return value === null ? true : isBlockedIpv4Value(value);
}

/**
 * Returns true when a URL hostname must not be fetched. Handles bracketed
 * IPv6 literals as produced by URL.hostname, localhost aliases, and mDNS
 * .local names. Non-literal hostnames return false here — their resolved
 * addresses still need an isBlockedIp check at fetch time.
 */
export function isBlockedHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");

  if (normalized === "") {
    return true;
  }

  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    return isBlockedIp(normalized.slice(1, -1));
  }

  if (normalized === "localhost" || normalized.endsWith(".localhost")) {
    return true;
  }

  if (normalized.endsWith(".local")) {
    return true;
  }

  if (normalized.includes(":") || parseIpv4(normalized) !== null) {
    return isBlockedIp(normalized);
  }

  return false;
}
