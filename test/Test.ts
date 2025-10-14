import assert from "assert";
import { 
  TestHelpers,
  EndpointV2_PacketDelivered
} from "generated";
const { MockDb, EndpointV2 } = TestHelpers;

describe("EndpointV2 contract PacketDelivered event tests", () => {
  // Create mock db
  const mockDb = MockDb.createMockDb();

  // Creating mock for EndpointV2 contract PacketDelivered event
  const event = EndpointV2.PacketDelivered.createMockEvent({/* It mocks event fields with default values. You can overwrite them if you need */});

  it("EndpointV2_PacketDelivered is created correctly", async () => {
    // Processing the event
    const mockDbUpdated = await EndpointV2.PacketDelivered.processEvent({
      event,
      mockDb,
    });

    // Getting the actual entity from the mock database
    let actualEndpointV2PacketDelivered = mockDbUpdated.entities.EndpointV2_PacketDelivered.get(
      `${event.chainId}_${event.block.number}_${event.logIndex}`
    );

    // Creating the expected entity
    const expectedEndpointV2PacketDelivered: EndpointV2_PacketDelivered = {
      id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
      origin: event.params.origin,
      origin: event.params.origin,
      origin: event.params.origin,
      receiver: event.params.receiver,
    };
    // Asserting that the entity in the mock database is the same as the expected entity
    assert.deepEqual(actualEndpointV2PacketDelivered, expectedEndpointV2PacketDelivered, "Actual EndpointV2PacketDelivered should be the same as the expectedEndpointV2PacketDelivered");
  });
});
