/*
 * Please refer to https://docs.envio.dev for a thorough guide on all Envio indexer features
 */
import {
  EndpointV2,
  EndpointV2_DefaultReceiveLibrarySet,
  EndpointV2_ReceiveLibrarySet,
  ReceiveUln302,
  ReceiveUln302_UlnConfigSet,
} from "generated";

EndpointV2.DefaultReceiveLibrarySet.handler(async ({ event, context }) => {
  const entity: EndpointV2_DefaultReceiveLibrarySet = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    eid: event.params.eid,
    newLib: event.params.newLib,
  };

  context.EndpointV2_DefaultReceiveLibrarySet.set(entity);
});

EndpointV2.ReceiveLibrarySet.handler(async ({ event, context }) => {
  const entity: EndpointV2_ReceiveLibrarySet = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    receiver: event.params.receiver,
    eid: event.params.eid,
    newLib: event.params.newLib,
  };

  context.EndpointV2_ReceiveLibrarySet.set(entity);
});

ReceiveUln302.UlnConfigSet.handler(async ({ event, context }) => {
  const entity: ReceiveUln302_UlnConfigSet = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    oapp: event.params.oapp,
    eid: event.params.eid,
    config_0: event.params.config
        [0]
    ,
    config_1: event.params.config
        [1]
    ,
    config_2: event.params.config
        [2]
    ,
    config_3: event.params.config
        [3]
    ,
    config_4: event.params.config
        [4]
    ,
    config_5: event.params.config
        [5]
    ,
  };

  context.ReceiveUln302_UlnConfigSet.set(entity);
});