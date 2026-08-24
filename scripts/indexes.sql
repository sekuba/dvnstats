-- Indexes that envio does NOT create, applied after a backfill completes.
--
-- Envio creates exactly the indexes declared via @index in schema.graphql
-- (since 3.5.0 it defers them until the backfill finishes). Anything else has
-- to be applied here, and re-applied after any resync — which every envio
-- version upgrade forces, since the version is pinned in envio_info.config.
--
-- Run with:  pnpm db:indexes
--
-- CONCURRENTLY so a running indexer keeps writing. It cannot run inside a
-- transaction block, hence one statement per psql invocation.

-- scripts/precomputePacketStats.js paginates PacketDelivered with
--   order_by: [{ blockTimestamp: desc }, { id: desc }]
-- and a (blockTimestamp, id) cursor predicate. blockTimestamp is not @index'd,
-- so without this every page is a parallel seq scan over the whole table:
-- 40s per 100k-row page at 20M rows, versus 0.15s with the index.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "PacketDelivered_blockTimestamp_id_desc"
    ON "PacketDelivered" ("blockTimestamp" DESC, "id" DESC);
