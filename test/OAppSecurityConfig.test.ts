import assert from "assert";
import {
  TestHelpers,
  OAppSecurityConfig as SecurityConfigEntity,
  PacketDelivered as PacketDeliveredEntity,
  OAppEidPacketStats as PacketStatsEntity,
  DvnMetadata as DvnMetadataEntity,
} from "generated";

const { MockDb, EndpointV2, ReceiveUln302 } = TestHelpers;

const CHAIN_ID = 1;
const TRACKED_RECEIVE_ULN302 =
  "0xc02ab410f0734efa3f14628780e6e695156024c2";
const DEFAULT_REQUIRED_DVN = "0x00000000000000000000000000000000000000aa";
const OPTIONAL_DVNS = [
  "0x00000000000000000000000000000000000000f1",
  "0x00000000000000000000000000000000000000f2",
  "0x00000000000000000000000000000000000000f3",
];
const OAPP_ADDRESS = "0x0000000000000000000000000000000000000abc";
const EID = 1111n;
const SENDER =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const makeEventMeta = (
  blockNumber: number,
  timestamp: number,
  logIndex = 0,
) => ({
  chainId: CHAIN_ID,
  block: {
    number: blockNumber,
    timestamp,
  },
  logIndex,
});

const getSecurityConfigId = (): string =>
  `${CHAIN_ID}_${OAPP_ADDRESS.toLowerCase()}_${EID.toString()}`;

describe("OApp security configuration indexing", () => {
  it("resolves sentinel overrides, tracks DVNs, and snapshots packet state", async () => {
    let db = MockDb.createMockDb();

    const defaultLibraryEvent =
      EndpointV2.DefaultReceiveLibrarySet.createMockEvent({
        eid: EID,
        newLib: TRACKED_RECEIVE_ULN302,
        mockEventData: makeEventMeta(100, 1_000, 0),
      });
    db = await EndpointV2.DefaultReceiveLibrarySet.processEvent({
      event: defaultLibraryEvent,
      mockDb: db,
    });

    const defaultConfigEvent =
      ReceiveUln302.DefaultUlnConfigsSet.createMockEvent({
        params: [
          [
            EID,
            [
              1n,
              1n,
              0n,
              0n,
              [DEFAULT_REQUIRED_DVN],
              [],
            ],
          ],
        ],
        mockEventData: makeEventMeta(101, 1_001, 0),
      });
    db = await ReceiveUln302.DefaultUlnConfigsSet.processEvent({
      event: defaultConfigEvent,
      mockDb: db,
    });

    const librarySetEvent = EndpointV2.ReceiveLibrarySet.createMockEvent({
      receiver: OAPP_ADDRESS,
      eid: EID,
      newLib: TRACKED_RECEIVE_ULN302,
      mockEventData: makeEventMeta(102, 1_002, 0),
    });
    db = await EndpointV2.ReceiveLibrarySet.processEvent({
      event: librarySetEvent,
      mockDb: db,
    });

    const overrideConfigEvent = ReceiveUln302.UlnConfigSet.createMockEvent({
      oapp: OAPP_ADDRESS,
      eid: EID,
      config: [
        2n,
        255n,
        BigInt(OPTIONAL_DVNS.length),
        2n,
        [],
        OPTIONAL_DVNS,
      ],
      mockEventData: makeEventMeta(103, 1_003, 0),
    });
    db = await ReceiveUln302.UlnConfigSet.processEvent({
      event: overrideConfigEvent,
      mockDb: db,
    });

    const packetEvent = EndpointV2.PacketDelivered.createMockEvent({
      origin: [EID, SENDER, 99n],
      receiver: OAPP_ADDRESS,
      mockEventData: makeEventMeta(104, 1_004, 0),
    });
    db = await EndpointV2.PacketDelivered.processEvent({
      event: packetEvent,
      mockDb: db,
    });

    const configId = getSecurityConfigId();
    const securityConfig = db.entities.OAppSecurityConfig.get(
      configId,
    ) as SecurityConfigEntity | undefined;
    assert.ok(securityConfig, "expected security config entity");
    assert.strictEqual(
      securityConfig.effectiveReceiveLibrary,
      TRACKED_RECEIVE_ULN302,
    );
    assert.strictEqual(
      securityConfig.effectiveConfirmations?.toString(),
      "2",
    );
    assert.strictEqual(securityConfig.usesRequiredDVNSentinel, true);
    assert.strictEqual(securityConfig.effectiveRequiredDVNCount, 0);
    assert.deepStrictEqual(securityConfig.effectiveRequiredDVNs, []);
    assert.deepStrictEqual(
      securityConfig.effectiveOptionalDVNs,
      [...OPTIONAL_DVNS].sort(),
    );
    assert.strictEqual(securityConfig.effectiveOptionalDVNCount, OPTIONAL_DVNS.length);
    assert.strictEqual(securityConfig.effectiveOptionalDVNThreshold, 2);
    assert.strictEqual(securityConfig.usesDefaultLibrary, true);
    assert.strictEqual(securityConfig.usesDefaultConfig, false);
    assert.strictEqual(securityConfig.isConfigTracked, true);
    assert.deepStrictEqual(securityConfig.fallbackFields, []);

    const packetId = `${CHAIN_ID}_${packetEvent.block.number}_${packetEvent.logIndex}`;
    const packet = db.entities.PacketDelivered.get(
      packetId,
    ) as PacketDeliveredEntity | undefined;
    assert.ok(packet, "expected packet entity");
    assert.strictEqual(packet.securityConfigId, configId);
    assert.strictEqual(packet.usesRequiredDVNSentinel, true);
    assert.deepStrictEqual(packet.effectiveRequiredDVNs, []);
    assert.deepStrictEqual(
      packet.effectiveOptionalDVNs,
      [...OPTIONAL_DVNS].sort(),
    );
    assert.strictEqual(packet.isConfigTracked, true);

    const statsId = configId;
    const stats = db.entities.OAppEidPacketStats.get(
      statsId,
    ) as PacketStatsEntity | undefined;
    assert.ok(stats, "expected packet stats entity");
    assert.strictEqual(stats.packetCount.toString(), "1");
    assert.strictEqual(stats.lastPacketSecurityConfigId, configId);

    for (const address of OPTIONAL_DVNS) {
      const metadataId = `${CHAIN_ID}_${address.toLowerCase()}`;
      const metadata = db.entities.DvnMetadata.get(
        metadataId,
      ) as DvnMetadataEntity | undefined;
      assert.ok(metadata, `expected metadata for ${address}`);
      assert.strictEqual(metadata.address, address.toLowerCase());
      assert.strictEqual(metadata.name, address.toLowerCase());
    }
  });

  it("marks packets delivered via untracked libraries as untracked configs", async () => {
    let db = MockDb.createMockDb();
    const untrackedLibrary =
      "0x0000000000000000000000000000000000000bcd";

    const defaultLibraryEvent =
      EndpointV2.DefaultReceiveLibrarySet.createMockEvent({
        eid: EID,
        newLib: untrackedLibrary,
        mockEventData: makeEventMeta(200, 2_000, 0),
      });
    db = await EndpointV2.DefaultReceiveLibrarySet.processEvent({
      event: defaultLibraryEvent,
      mockDb: db,
    });

    const librarySetEvent = EndpointV2.ReceiveLibrarySet.createMockEvent({
      receiver: OAPP_ADDRESS,
      eid: EID,
      newLib: untrackedLibrary,
      mockEventData: makeEventMeta(201, 2_001, 0),
    });
    db = await EndpointV2.ReceiveLibrarySet.processEvent({
      event: librarySetEvent,
      mockDb: db,
    });

    const packetEvent = EndpointV2.PacketDelivered.createMockEvent({
      origin: [EID, SENDER, 77n],
      receiver: OAPP_ADDRESS,
      mockEventData: makeEventMeta(202, 2_002, 0),
    });
    db = await EndpointV2.PacketDelivered.processEvent({
      event: packetEvent,
      mockDb: db,
    });

    const configId = getSecurityConfigId();
    const securityConfig = db.entities.OAppSecurityConfig.get(
      configId,
    ) as SecurityConfigEntity | undefined;
    assert.ok(securityConfig, "expected security config entity");
    assert.strictEqual(securityConfig.effectiveReceiveLibrary, untrackedLibrary);
    assert.strictEqual(securityConfig.isConfigTracked, false);
    assert.strictEqual(securityConfig.usesDefaultConfig, false);
    assert.strictEqual(securityConfig.effectiveOptionalDVNCount, 0);
    assert.strictEqual(
      securityConfig.effectiveOptionalDVNThreshold,
      undefined,
    );
    assert.deepStrictEqual(securityConfig.effectiveOptionalDVNs, []);

    const packetId = `${CHAIN_ID}_${packetEvent.block.number}_${packetEvent.logIndex}`;
    const packet = db.entities.PacketDelivered.get(
      packetId,
    ) as PacketDeliveredEntity | undefined;
    assert.ok(packet, "expected packet entity");
    assert.strictEqual(packet.isConfigTracked, false);
    assert.strictEqual(packet.effectiveOptionalDVNs.length, 0);
  });
});
