/*
 * Please refer to https://docs.envio.dev for a thorough guide on all Envio indexer features
 */
import {
  EndpointV2,
  EndpointV2_PacketDelivered,
} from "generated";

EndpointV2.PacketDelivered.handler(async ({ event, context }) => {
  const entity: EndpointV2_PacketDelivered = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    origin_0: event.params.origin
        [0]
    ,
    origin_1: event.params.origin
        [1]
    ,
    origin_2: event.params.origin
        [2]
    ,
    receiver: event.params.receiver,
  };

  context.EndpointV2_PacketDelivered.set(entity);
});
