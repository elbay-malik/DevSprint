/** Eight hextets, or undefined when the text is not a well-formed IPv6 address. */
function expandIpv6(address: string): string[] | undefined {
  // A dotted tail (`::ffff:203.0.113.9`) is the last two hextets, written differently.
  const lastColon = address.lastIndexOf(':')
  const tail = address.slice(lastColon + 1)
  let text = address
  if (tail.includes('.')) {
    const octets = tail.split('.').map(Number)
    if (octets.length !== 4 || !octets.every((o) => Number.isInteger(o) && o >= 0 && o <= 255)) {
      return undefined
    }
    const [a, b, c, d] = octets as [number, number, number, number]
    const high = ((a << 8) | b).toString(16)
    const low = ((c << 8) | d).toString(16)
    text = `${address.slice(0, lastColon + 1)}${high}:${low}`
  }

  const sides = text.split('::')
  if (sides.length > 2) return undefined
  const head = sides[0] ? sides[0].split(':') : []
  const rest = sides[1] ? sides[1].split(':') : []
  const missing = 8 - head.length - rest.length
  if (sides.length === 1 ? missing !== 0 : missing < 1) return undefined

  const hextets = [...head, ...Array<string>(Math.max(missing, 0)).fill('0'), ...rest]
  if (!hextets.every((hextet) => /^[0-9a-f]{1,4}$/.test(hextet))) return undefined
  // Written out in one form, so two spellings of an address are one client.
  return hextets.map((hextet) => hextet.replace(/^0+(?=.)/, ''))
}

/**
 * The bucket a client IP is rate-limited under.
 *
 * An IPv4 address is one client. An IPv6 address is not: a home connection or a
 * cloud host is routinely given a whole /64, so a script can take a new address
 * per request and never meet a per-address limit. The /64 is the practical IPv6
 * equivalent of one IPv4 address, so that is the key. A host holding a /48 still
 * has many /64s, which makes this slower to rotate through rather than impossible.
 *
 * Text that parses as neither comes back as it arrived. It came from Cloudflare,
 * and limiting it on its own is still better than folding it into a shared bucket.
 */
export function ipRateLimitKey(ip: string): string {
  if (!ip.includes(':')) return ip

  // A zone (`fe80::1%en0`) names the sender's interface, not a different network.
  const hextets = expandIpv6(ip.split('%')[0]!.toLowerCase())
  if (!hextets) return ip

  // An IPv4 client reached over IPv6 is still that one IPv4 client.
  const isMapped = hextets.slice(0, 5).every((hextet) => hextet === '0') && hextets[5] === 'ffff'
  if (isMapped) {
    const high = Number.parseInt(hextets[6]!, 16)
    const low = Number.parseInt(hextets[7]!, 16)
    return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.')
  }

  return `${hextets.slice(0, 4).join(':')}::/64`
}
