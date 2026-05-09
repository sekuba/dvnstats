export type LocalChainConfig = {
  chainId: number;
  localEid: bigint;
  endpointV2: string;
  receiveUln302: string;
};

export const LOCAL_CHAIN_CONFIGS = [
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
    chainId: 14,
    localEid: 30295n,
    endpointV2: "0x1a44076050125825900e736c501f859c50fe728c",
    receiveUln302: "0x2367325334447c5e1e0f1b3a6fb947b262f58312",
  },
  {
    chainId: 30,
    localEid: 30333n,
    endpointV2: "0xcb566e3b6934fa77258d68ea18e931fa75e1aaaa",
    receiveUln302: "0x2367325334447c5e1e0f1b3a6fb947b262f58312",
  },
  {
    chainId: 50,
    localEid: 30365n,
    endpointV2: "0xcb566e3b6934fa77258d68ea18e931fa75e1aaaa",
    receiveUln302: "0x2367325334447c5e1e0f1b3a6fb947b262f58312",
  },
  {
    chainId: 56,
    localEid: 30102n,
    endpointV2: "0x1a44076050125825900e736c501f859c50fe728c",
    receiveUln302: "0xb217266c3a98c8b2709ee26836c98cf12f6ccec1",
  },
  {
    chainId: 100,
    localEid: 30145n,
    endpointV2: "0x1a44076050125825900e736c501f859c50fe728c",
    receiveUln302: "0x9714ccf1dedef14bab5013625db92746c1358cb4",
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
    chainId: 143,
    localEid: 30390n,
    endpointV2: "0x6f475642a6e85809b1c36fa62763669b1b48dd5b",
    receiveUln302: "0xe1844c5d63a9543023008d332bd3d2e6f1fe1043",
  },
  {
    chainId: 146,
    localEid: 30332n,
    endpointV2: "0x6f475642a6e85809b1c36fa62763669b1b48dd5b",
    receiveUln302: "0xe1844c5d63a9543023008d332bd3d2e6f1fe1043",
  },
  {
    chainId: 148,
    localEid: 30230n,
    endpointV2: "0x148f693af10ddfae81cddb36f4c93b31a90076e1",
    receiveUln302: "0xb21f945e8917c6cd69fcfe66ac6703b90f7fe004",
  },
  {
    chainId: 169,
    localEid: 30217n,
    endpointV2: "0x1a44076050125825900e736c501f859c50fe728c",
    receiveUln302: "0xc1ec25a9e8a8de5aa346f635b33e5b74c4c081af",
  },
  {
    chainId: 204,
    localEid: 30202n,
    endpointV2: "0x1a44076050125825900e736c501f859c50fe728c",
    receiveUln302: "0x9c9e25f9fc4e8134313c2a9f5c719f5c9f4fbd95",
  },
  {
    chainId: 250,
    localEid: 30112n,
    endpointV2: "0x1a44076050125825900e736c501f859c50fe728c",
    receiveUln302: "0xe1dd69a2d08df4ea6a30a91cc061ac70f98aabe3",
  },
  {
    chainId: 252,
    localEid: 30255n,
    endpointV2: "0x1a44076050125825900e736c501f859c50fe728c",
    receiveUln302: "0x8bc1e36f015b9902b54b1387a4d733cebc2f5a4e",
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
    chainId: 1101,
    localEid: 30158n,
    endpointV2: "0x1a44076050125825900e736c501f859c50fe728c",
    receiveUln302: "0x581b26f362ad383f7b51ef8a165efa13dde398a4",
  },
  {
    chainId: 1135,
    localEid: 30321n,
    endpointV2: "0x6f475642a6e85809b1c36fa62763669b1b48dd5b",
    receiveUln302: "0xe1844c5d63a9543023008d332bd3d2e6f1fe1043",
  },
  {
    chainId: 1284,
    localEid: 30126n,
    endpointV2: "0x1a44076050125825900e736c501f859c50fe728c",
    receiveUln302: "0x2f4c6eea955e95e6d65e08620d980c0e0e92211f",
  },
  {
    chainId: 1329,
    localEid: 30280n,
    endpointV2: "0x1a44076050125825900e736c501f859c50fe728c",
    receiveUln302: "0xe1844c5d63a9543023008d332bd3d2e6f1fe1043",
  },
  {
    chainId: 1776,
    localEid: 30394n,
    endpointV2: "0x6f475642a6e85809b1c36fa62763669b1b48dd5b",
    receiveUln302: "0x15e51701f245f6d5bd0fee87bcaf55b0841451b3",
  },
  {
    chainId: 1868,
    localEid: 30340n,
    endpointV2: "0x4bcb6a963a9563c33569d7a512d35754221f3a19",
    receiveUln302: "0x364b548d8e6db7ca84aaafa54595919eccf961ea",
  },
  {
    chainId: 1923,
    localEid: 30335n,
    endpointV2: "0xcb566e3b6934fa77258d68ea18e931fa75e1aaaa",
    receiveUln302: "0x377530cda84dfb2673bf4d145dcf0c4d7fdcb5b6",
  },
  {
    chainId: 2741,
    localEid: 30324n,
    endpointV2: "0x5c6cff4b7c49805f8295ff73c204ac83f3bc4ae7",
    receiveUln302: "0x9d799c1935c51ca399e6465ed9841debccec413e",
  },
  {
    chainId: 2818,
    localEid: 30322n,
    endpointV2: "0x6f475642a6e85809b1c36fa62763669b1b48dd5b",
    receiveUln302: "0xe1844c5d63a9543023008d332bd3d2e6f1fe1043",
  },
  {
    chainId: 4114,
    localEid: 30403n,
    endpointV2: "0x6f475642a6e85809b1c36fa62763669b1b48dd5b",
    receiveUln302: "0xc1b621b18187f74c8f6d52a6f709dd2780c09821",
  },
  {
    chainId: 4200,
    localEid: 30266n,
    endpointV2: "0x1a44076050125825900e736c501f859c50fe728c",
    receiveUln302: "0xe1844c5d63a9543023008d332bd3d2e6f1fe1043",
  },
  {
    chainId: 4217,
    localEid: 30410n,
    endpointV2: "0x20bb7c2e2f4e5ca2b4c57060d1ae2615245dcc9c",
    receiveUln302: "0x0b6f08c2d39421acb49c99abce82050e356171e5",
  },
  {
    chainId: 4326,
    localEid: 30398n,
    endpointV2: "0x6f475642a6e85809b1c36fa62763669b1b48dd5b",
    receiveUln302: "0xe1844c5d63a9543023008d332bd3d2e6f1fe1043",
  },
  {
    chainId: 5000,
    localEid: 30181n,
    endpointV2: "0x1a44076050125825900e736c501f859c50fe728c",
    receiveUln302: "0x8da6512de9379fbf4f09bf520caf7a85435ed93e",
  },
  {
    chainId: 7560,
    localEid: 30283n,
    endpointV2: "0x1a44076050125825900e736c501f859c50fe728c",
    receiveUln302: "0xe1844c5d63a9543023008d332bd3d2e6f1fe1043",
  },
  {
    chainId: 8453,
    localEid: 30184n,
    endpointV2: "0x1a44076050125825900e736c501f859c50fe728c",
    receiveUln302: "0xc70ab6f32772f59fbfc23889caf4ba3376c84baf",
  },
  {
    chainId: 9745,
    localEid: 30383n,
    endpointV2: "0x6f475642a6e85809b1c36fa62763669b1b48dd5b",
    receiveUln302: "0xe1844c5d63a9543023008d332bd3d2e6f1fe1043",
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
    chainId: 42170,
    localEid: 30175n,
    endpointV2: "0x1a44076050125825900e736c501f859c50fe728c",
    receiveUln302: "0xb81f326b95e79eac4aba800ae545efb4c602973d",
  },
  {
    chainId: 42220,
    localEid: 30125n,
    endpointV2: "0x1a44076050125825900e736c501f859c50fe728c",
    receiveUln302: "0xadded4478b423d991c21e525cd3638fbce1aad17",
  },
  {
    chainId: 42793,
    localEid: 30292n,
    endpointV2: "0xaab5a48cfc03efa9cc34a2c1aacccb84b4b770e4",
    receiveUln302: "0x377530cda84dfb2673bf4d145dcf0c4d7fdcb5b6",
  },
  {
    chainId: 43114,
    localEid: 30106n,
    endpointV2: "0x1a44076050125825900e736c501f859c50fe728c",
    receiveUln302: "0xbf3521d309642fa9b1c91a08609505ba09752c61",
  },
  {
    chainId: 48900,
    localEid: 30303n,
    endpointV2: "0x6f475642a6e85809b1c36fa62763669b1b48dd5b",
    receiveUln302: "0xe1844c5d63a9543023008d332bd3d2e6f1fe1043",
  },
  {
    chainId: 50104,
    localEid: 30334n,
    endpointV2: "0x5c6cff4b7c49805f8295ff73c204ac83f3bc4ae7",
    receiveUln302: "0x9ab633555e460c01f8c7b8ab24c88dd4986dd5a1",
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
    chainId: 80094,
    localEid: 30362n,
    endpointV2: "0x6f475642a6e85809b1c36fa62763669b1b48dd5b",
    receiveUln302: "0xe1844c5d63a9543023008d332bd3d2e6f1fe1043",
  },
  {
    chainId: 81457,
    localEid: 30243n,
    endpointV2: "0x1a44076050125825900e736c501f859c50fe728c",
    receiveUln302: "0x377530cda84dfb2673bf4d145dcf0c4d7fdcb5b6",
  },
  {
    chainId: 88888,
    localEid: 30409n,
    endpointV2: "0x6f475642a6e85809b1c36fa62763669b1b48dd5b",
    receiveUln302: "0xe1844c5d63a9543023008d332bd3d2e6f1fe1043",
  },
  {
    chainId: 98866,
    localEid: 30370n,
    endpointV2: "0xc1b15d3b262beec0e3565c11c9e0f6134bdacb36",
    receiveUln302: "0x5b19bd330a84c049b62d5b0fc2ba120217a18c1c",
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
    endpointV2: "0x1a44076050125825900e736c501f859c50fe728c",
    receiveUln302: "0x57d9775ee8fec31f1b612a06266f599da167d211",
  },
  {
    chainId: 1313161554,
    localEid: 30211n,
    endpointV2: "0x1a44076050125825900e736c501f859c50fe728c",
    receiveUln302: "0x000cc1a759bc3a15e664ed5379e321be5de1c9b6",
  },
  {
    chainId: 1666600000,
    localEid: 30116n,
    endpointV2: "0x1a44076050125825900e736c501f859c50fe728c",
    receiveUln302: "0x177d36dbe2271a4ddb2ad8304d82628eb921d790",
  },
] as const satisfies readonly LocalChainConfig[];

const LOCAL_EID_BY_CHAIN_ID = new Map<number, bigint>(
  LOCAL_CHAIN_CONFIGS.map((config) => [config.chainId, config.localEid]),
);

const RECEIVE_LIBRARY_BY_LOCAL_EID = new Map<bigint, string>(
  LOCAL_CHAIN_CONFIGS.map((config) => [config.localEid, config.receiveUln302.toLowerCase()]),
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

export const listLocalChainConfigs = (): LocalChainConfig[] => [...LOCAL_CHAIN_CONFIGS];
