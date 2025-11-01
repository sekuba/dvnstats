import requests

HASURA_URL = "https://shinken.business/v1/graphql"
HEADERS = {
    "Content-Type": "application/json",
    # Use the right auth for your setup:
    # "x-hasura-admin-secret": "********",
    # or a JWT header, etc.
}

# 1) One round-trip to fetch both lists
query = """
query MyQuery($limit:Int = 1000, $offset:Int = 0) {
  OAppStats(order_by: { totalPacketsReceived: desc }) {
    id
    totalPacketsReceived
  }
  OAppSecurityConfig(
    where: { usesDefaultConfig: { _eq: true } }
    limit: $limit
    offset: $offset
  ) {
    oappId
    # ... add any fields you actually need here
  }
}
"""

payload = {"query": query, "variables": {"limit": 1000000000, "offset": 0}}
resp = requests.post(HASURA_URL, json=payload, headers=HEADERS)
resp.raise_for_status()
data = resp.json()["data"]

stats = data["OAppStats"]
configs = data["OAppSecurityConfig"]

# 2) Build an order index from OAppStats (id -> rank)
order_index = {row["id"]: rank for rank, row in enumerate(stats)}

# 3) Sort the configs by the rank of their oappId (unknown ids go to the end)
configs_sorted = sorted(
    configs,
    key=lambda c: order_index.get(c["oappId"], float("inf"))
)

# If you only want one config per oappId, dedupe (keep the first in stats order):
deduped = {}
for c in configs_sorted:
    deduped.setdefault(c["oappId"], c)
configs_unique_in_stats_order = list(deduped.values())

# 4) Use configs_sorted (or configs_unique_in_stats_order) as needed
print("First 10 in desired order:")
for c in configs_unique_in_stats_order[:10]:
    print(c)
