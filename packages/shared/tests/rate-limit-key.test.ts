import { describe, expect, it } from 'vitest'
import { ipRateLimitKey } from '../src/index'

describe('ipRateLimitKey', () => {
  it('leaves an IPv4 address alone', () => {
    expect(ipRateLimitKey('203.0.113.9')).toBe('203.0.113.9')
  })

  it('puts every address in one /64 in one bucket', () => {
    // Rotating through a /64 is free, so a per-address key would never trip.
    const key = '2001:db8:1:2::/64'
    expect(ipRateLimitKey('2001:db8:1:2::a')).toBe(key)
    expect(ipRateLimitKey('2001:db8:1:2:a:b:c:d')).toBe(key)
  })

  it('treats two spellings of a network as one client', () => {
    expect(ipRateLimitKey('2001:0DB8:0001:0002:a:b:c:d')).toBe('2001:db8:1:2::/64')
  })

  it('gives a different /64 a different bucket', () => {
    expect(ipRateLimitKey('2001:db8:1:3::a')).not.toBe(ipRateLimitKey('2001:db8:1:2::a'))
  })

  it('expands a :: that falls inside the first four hextets', () => {
    expect(ipRateLimitKey('2001:db8::1')).toBe('2001:db8:0:0::/64')
    expect(ipRateLimitKey('2001::')).toBe('2001:0:0:0::/64')
    expect(ipRateLimitKey('::1')).toBe('0:0:0:0::/64')
    expect(ipRateLimitKey('::')).toBe('0:0:0:0::/64')
  })

  it('keys an IPv4 client reached over IPv6 as that IPv4 client', () => {
    expect(ipRateLimitKey('::ffff:203.0.113.9')).toBe('203.0.113.9')
    expect(ipRateLimitKey('::FFFF:cb00:7109')).toBe('203.0.113.9')
  })

  it('does not mistake other addresses with a dotted tail for mapped IPv4', () => {
    expect(ipRateLimitKey('64:ff9b:1:2::203.0.113.9')).toBe('64:ff9b:1:2::/64')
  })

  it('ignores a zone', () => {
    expect(ipRateLimitKey('fe80::1%en0')).toBe('fe80:0:0:0::/64')
  })

  it('returns text it cannot parse unchanged rather than a shared key', () => {
    for (const junk of ['not:an:address', '1:2:3', '1::2::3', 'gggg::1', '::ffff:999.0.0.1']) {
      expect(ipRateLimitKey(junk)).toBe(junk)
    }
  })
})
