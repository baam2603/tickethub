import { BlockList, isIP } from "node:net";

function normalizeAddress(address: string) {
  const mappedV4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  return mappedV4 ?? address;
}

export function parseIpAllowlist(value: string) {
  const blockList = new BlockList();
  if (!value.trim()) return blockList;

  for (const item of value.split(",")) {
    const [rawAddress = "", prefix, ...extra] = item.trim().split("/");
    const address = normalizeAddress(rawAddress);
    const version = isIP(address);
    const bits = version === 4 ? 32 : 128;
    const length = prefix === undefined ? bits : Number(prefix);
    if (
      extra.length ||
      !version ||
      (prefix !== undefined && !/^\d{1,3}$/.test(prefix)) ||
      !Number.isInteger(length) ||
      length <= 0 ||
      length > bits ||
      (address !== rawAddress && prefix !== undefined)
    ) {
      throw new Error("Invalid IP or CIDR");
    }
    blockList.addSubnet(address, length, version === 4 ? "ipv4" : "ipv6");
  }
  return blockList;
}

export function isAllowedIp(list: BlockList, candidate: string | undefined) {
  if (!candidate) return false;
  const address = normalizeAddress(candidate);
  const version = isIP(address);
  return version !== 0 && list.check(address, version === 4 ? "ipv4" : "ipv6");
}
