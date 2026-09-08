import { networkInterfaces } from 'os';

/**
 * The terminal's own address on the shop's network.
 *
 * Used to build a URL a phone on the same Wi-Fi can open. A till commonly has several IPv4
 * addresses — a real NIC plus whatever VirtualBox, WSL, Docker or Hyper-V left behind — and only
 * the real one is reachable from a phone, so the candidates are ranked rather than taken in the
 * arbitrary order the OS reports them.
 */

/** Adapter names that belong to a virtual network no phone can reach. */
const VIRTUAL_ADAPTER = /(virtualbox|vmware|hyper-v|wsl|docker|loopback|vethernet|tailscale|zerotier|tap-|tun)/i;

/** Private IPv4 ranges, in the order a shop LAN is most likely to use them. */
function privateRank(address: string): number {
  if (address.startsWith('192.168.')) return 0;
  if (address.startsWith('10.')) return 1;
  // 172.16.0.0 – 172.31.255.255
  const match = /^172\.(\d+)\./.exec(address);
  if (match) {
    const second = Number(match[1]);
    if (second >= 16 && second <= 31) return 2;
  }
  // A public or link-local address still beats nothing, but it is the last thing to try.
  return 3;
}

/** The subset of Node's `NetworkInterfaceInfo` this needs, so tests can supply plain objects. */
export interface InterfaceEntry {
  address: string;
  family: string | number;
  internal: boolean;
}

/**
 * Rank the addresses of every adapter, best candidate first. Pure, so it can be tested without
 * standing up network interfaces.
 */
export function rankLanAddresses(
  interfaces: Record<string, InterfaceEntry[] | undefined>,
): string[] {
  const candidates: Array<{ address: string; rank: number }> = [];

  for (const [name, addresses] of Object.entries(interfaces)) {
    for (const entry of addresses ?? []) {
      // Node <18 reports `family` as 'IPv4', newer versions as 4. Accept both.
      if ((entry.family !== 'IPv4' && entry.family !== 4) || entry.internal) continue;

      candidates.push({
        address: entry.address,
        // A virtual adapter sorts below every real one, whatever its range.
        rank: privateRank(entry.address) + (VIRTUAL_ADAPTER.test(name) ? 10 : 0),
      });
    }
  }

  // Sort is stable in Node, so equally ranked adapters keep the order the OS listed them in.
  return candidates.sort((a, b) => a.rank - b.rank).map((c) => c.address);
}

/**
 * Every usable IPv4 address of this machine, best candidate first.
 *
 * Empty when the terminal has no network at all — callers must handle that rather than assume a
 * first element.
 */
export function getLanAddresses(): string[] {
  return rankLanAddresses(networkInterfaces());
}

/** The single best guess at this terminal's LAN address, or null when it has no network. */
export function getLanAddress(): string | null {
  return getLanAddresses()[0] ?? null;
}
