# shards

Leaflet map of Ingress shard jump JSON

[<img src="screenshot.png">](https://neon-ninja.github.io/shards)

Distances are calculated with the [Haversine formula](https://rosettacode.org/wiki/Haversine_formula), using the Mean Earth Radius (6371km).

The colour of each portal is based on the last action which occurred at that portal. This is either:

-   The same colour of the last link which the shard jumped along.
-   The colour of the portal when the shard despawned (may be neutral).
