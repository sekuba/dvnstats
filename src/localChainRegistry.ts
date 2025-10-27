export type LocalChainConfig = {
  chainId: number;
  localEid: bigint;
  endpointV2: string;
  receiveUln302?: string;
};

const LOCAL_CHAIN_CONFIGS: LocalChainConfig[] = [
  {
    chainId: 1,
    localEid: 30101n,
    endpointV2: "0x1a44076050125825900e736c501f859c50fe728c",
    receiveUln302: "0xc02ab410f0734efa3f14628780e6e695156024c2",
  },
  {
    chainId: 10,
    localEid: 30111n,
    endpointV2: "0x1a44076050125825900e736c501f859c50fe728c",
    receiveUln302: "0x3c4962ff6258dcfcafd23a814237b7d6eb712063",
  },
  {
    chainId: 56,
    localEid: 30102n,
    endpointV2: "0x1a44076050125825900e736c501f859c50fe728c",
    receiveUln302: "0xb217266c3a98c8b2709ee26836c98cf12f6ccec1",
  },
  {
    chainId: 130,
    localEid: 30320n,
    endpointV2: "0x6f475642a6e85809b1c36fa62763669b1b48dd5b",
    receiveUln302: "0xe1844c5d63a9543023008d332bd3d2e6f1fe1043",
  },
  {
    chainId: 137,
    localEid: 30109n,
    endpointV2: "0x1a44076050125825900e736c501f859c50fe728c",
    receiveUln302: "0x1322871e4ab09bc7f5717189434f97bbd9546e95",
  },
  {
    chainId: 324,
    localEid: 30165n,
    endpointV2: "0xd07c30af3ff30d96bdc9c6044958230eb797ddbf",
    receiveUln302: "0x04830f6decf08dec9ed6c3fcad215245b78a59e1",
  },
  {
    chainId: 480,
    localEid: 30319n,
    endpointV2: "0x6f475642a6e85809b1c36fa62763669b1b48dd5b",
    receiveUln302: "0xe1844c5d63a9543023008d332bd3d2e6f1fe1043",
  },
  {
    chainId: 999,
    localEid: 30367n,
    endpointV2: "0x3a73033c0b1407574c76bdbac67f126f6b4a9aa9",
    receiveUln302: "0x7cacbe439ead55fa1c22790330b12835c6884a91",
  },
  {
    chainId: 1135,
    localEid: 30321n,
    endpointV2: "0x6f475642a6e85809b1c36fa62763669b1b48dd5b",
    receiveUln302: "0xe1844c5d63a9543023008d332bd3d2e6f1fe1043",
  },
  {
    chainId: 1868,
    localEid: 30340n,
    endpointV2: "0x4bcb6a963a9563c33569d7a512d35754221f3a19",
    receiveUln302: "0x364b548d8e6db7ca84aaafa54595919eccf961ea",
  },
  {
    chainId: 8453,
    localEid: 30184n,
    endpointV2: "0x1a44076050125825900e736c501f859c50fe728c",
    receiveUln302: "0xc70ab6f32772f59fbfc23889caf4ba3376c84baf",
  },
  {
    chainId: 34443,
    localEid: 30260n,
    endpointV2: "0x1a44076050125825900e736c501f859c50fe728c",
    receiveUln302: "0xc1b621b18187f74c8f6d52a6f709dd2780c09821",
  },
  {
    chainId: 42161,
    localEid: 30110n,
    endpointV2: "0x1a44076050125825900e736c501f859c50fe728c",
    receiveUln302: "0x7b9e184e07a6ee1ac23eae0fe8d6be2f663f05e6",
  },
  {
    chainId: 57073,
    localEid: 30339n,
    endpointV2: "0xca29f3a6f966cb2fc0de625f8f325c0c46dbe958",
    receiveUln302: "0x473132bb594caef281c68718f4541f73fe14dc89",
  },
  {
    chainId: 59144,
    localEid: 30183n,
    endpointV2: "0x1a44076050125825900e736c501f859c50fe728c",
    receiveUln302: "0xe22ed54177ce1148c557de74e4873619e6c6b205",
  },
  {
    chainId: 81457,
    localEid: 30243n,
    endpointV2: "0x1a44076050125825900e736c501f859c50fe728c",
    receiveUln302: "0x377530cda84dfb2673bf4d145dcf0c4d7fdcb5b6",
  },
  {
    chainId: 534352,
    localEid: 30214n,
    endpointV2: "0x1a44076050125825900e736c501f859c50fe728c",
    receiveUln302: "0x8363302080e711e0cab978c081b9e69308d49808",
  },
  {
    chainId: 7777777,
    localEid: 30195n,
    endpointV2: "0x1a44076050125825900e736c501f859c50fE728c",
    receiveUln302: "0x57D9775eE8feC31F1B612a06266f599dA167d211",
  },
];

const LOCAL_EID_BY_CHAIN_ID = new Map<number, bigint>(
  LOCAL_CHAIN_CONFIGS.map((config) => [config.chainId, config.localEid]),
);

const RECEIVE_LIBRARY_BY_LOCAL_EID = new Map<bigint, string>(
  LOCAL_CHAIN_CONFIGS.filter((config) => config.receiveUln302).map((config) => [
    config.localEid,
    config.receiveUln302!.toLowerCase(),
  ]),
);

export const resolveLocalEid = (chainId: number): bigint => {
  const localEid = LOCAL_EID_BY_CHAIN_ID.get(chainId);
  if (localEid === undefined) {
    throw new Error(`Unmapped chainId ${chainId} in local chain registry`);
  }
  return localEid;
};

export const getTrackedReceiveLibraryAddress = (localEid: bigint): string | undefined =>
  RECEIVE_LIBRARY_BY_LOCAL_EID.get(localEid);

export const listLocalChainConfigs = (): LocalChainConfig[] => LOCAL_CHAIN_CONFIGS.slice();
