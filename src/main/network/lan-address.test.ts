import { rankLanAddresses, type InterfaceEntry } from './lan-address';

const ipv4 = (address: string, internal = false): InterfaceEntry => ({
  address,
  family: 'IPv4',
  internal,
});

describe('rankLanAddresses', () => {
  it('returns nothing when the terminal has no network', () => {
    expect(rankLanAddresses({})).toEqual([]);
  });

  it('skips loopback and IPv6', () => {
    expect(
      rankLanAddresses({
        Loopback: [ipv4('127.0.0.1', true)],
        Ethernet: [{ address: 'fe80::1', family: 'IPv6', internal: false }],
      }),
    ).toEqual([]);
  });

  // Newer Node reports the numeric family; the terminal must not go blind on an Electron upgrade.
  it('accepts the numeric IPv4 family', () => {
    expect(
      rankLanAddresses({ Ethernet: [{ address: '192.168.1.7', family: 4, internal: false }] }),
    ).toEqual(['192.168.1.7']);
  });

  // The whole point of ranking: a till commonly has a VirtualBox or WSL adapter whose address a
  // phone cannot reach, and the OS may well list it first.
  it('puts a real adapter ahead of a virtual one', () => {
    expect(
      rankLanAddresses({
        'VirtualBox Host-Only Network': [ipv4('192.168.56.1')],
        'Ethernet 2': [ipv4('192.168.1.7')],
      }),
    ).toEqual(['192.168.1.7', '192.168.56.1']);
  });

  it.each([
    ['vEthernet (WSL)', '172.20.16.1'],
    ['Docker Desktop', '10.99.0.1'],
    ['Tailscale', '100.64.0.1'],
  ])('demotes the %s adapter', (name, address) => {
    expect(rankLanAddresses({ [name]: [ipv4(address)], 'Wi-Fi': [ipv4('10.0.0.5')] })).toEqual([
      '10.0.0.5',
      address,
    ]);
  });

  it('prefers private ranges in shop-LAN order', () => {
    expect(
      rankLanAddresses({
        A: [ipv4('203.0.113.9')],
        B: [ipv4('172.16.4.2')],
        C: [ipv4('10.0.0.5')],
        D: [ipv4('192.168.1.7')],
      }),
    ).toEqual(['192.168.1.7', '10.0.0.5', '172.16.4.2', '203.0.113.9']);
  });

  // 172.32+ is public space, not the private 172.16–31 block.
  it('does not treat every 172.x address as private', () => {
    expect(rankLanAddresses({ A: [ipv4('172.32.0.1')], B: [ipv4('172.31.0.1')] })).toEqual([
      '172.31.0.1',
      '172.32.0.1',
    ]);
  });

  it('keeps every usable address so a caller can offer alternatives', () => {
    expect(
      rankLanAddresses({ 'Wi-Fi': [ipv4('192.168.1.7')], Ethernet: [ipv4('192.168.1.8')] }),
    ).toHaveLength(2);
  });
});
