import { isNullish } from "./utils/NumberUtils.js";

const entries = [
  ["30101", "0xc02ab410f0734efa3f14628780e6e695156024c2"],
  ["30111", "0x3c4962ff6258dcfcafd23a814237b7d6eb712063"],
  ["30102", "0xb217266c3a98c8b2709ee26836c98cf12f6ccec1"],
  ["30320", "0xe1844c5d63a9543023008d332bd3d2e6f1fe1043"],
  ["30109", "0x1322871e4ab09bc7f5717189434f97bbd9546e95"],
  ["30165", "0x04830f6decf08dec9ed6c3fcad215245b78a59e1"],
  ["30319", "0xe1844c5d63a9543023008d332bd3d2e6f1fe1043"],
  ["30367", "0x7cacbe439ead55fa1c22790330b12835c6884a91"],
  ["30321", "0xe1844c5d63a9543023008d332bd3d2e6f1fe1043"],
  ["30340", "0x364b548d8e6db7ca84aaafa54595919eccf961ea"],
  ["30184", "0xc70ab6f32772f59fbfc23889caf4ba3376c84baf"],
  ["30260", "0xc1b621b18187f74c8f6d52a6f709dd2780c09821"],
  ["30110", "0x7b9e184e07a6ee1ac23eae0fe8d6be2f663f05e6"],
  ["30339", "0x473132bb594caef281c68718f4541f73fe14dc89"],
  ["30183", "0xe22ed54177ce1148c557de74e4873619e6c6b205"],
  ["30243", "0x377530cda84dfb2673bf4d145dcf0c4d7fdcb5b6"],
  ["30214", "0x8363302080e711e0cab978c081b9e69308d49808"],
  ["30195", "0x57d9775ee8fec31f1b612a06266f599da167d211"],
];

export const TRACKED_RECEIVE_LIBRARIES = Object.freeze(
  Object.fromEntries(entries.map(([key, value]) => [key, value.toLowerCase()])),
);

export function getTrackedReceiveLibrary(localEid) {
  return isNullish(localEid) ? undefined : TRACKED_RECEIVE_LIBRARIES[String(localEid)];
}
