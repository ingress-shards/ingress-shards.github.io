# shards

Leaflet map of Ingress shard jump JSON

[<img src="src/assets/screenshot.png">](https://neon-ninja.github.io/shards)

Distances are calculated with the [Haversine formula](https://rosettacode.org/wiki/Haversine_formula), using the Mean Earth Radius (6371km).

The colour of each portal is based on the last relevant action which occurred at that portal. This is either:

-   The same colour of the last link which the shard jumped along.
-   The colour of the portal when the shard spawned (may be neutral).

Portal alignment at the time a shard despawns is deemed to be not relevant for display, however it is included in the history (hover over portal).

## Adding data to project

In order to ensure that new data is processed by the scripts for display on the map, the following changes are required to the project:

-   Add shard jump times file to the _jump-times_ folder.
-   Add a new entry to the _src/js/shard-series-metadata.json_ array, including the series name (to be displayed in the drop-down box), and the filename.
-   (_Optional_) Add the Season Overview URL to the array of URLs at the top of _scripts/geocode.py_ if required.
-   (_Optional_) Add the file name to the _anomaly_jump_files_ in _scripts/geocode.py_ if the new file contains anomalies.
-   (_Optional_) Add the Anomaly series name to _src/js/data/shard-data-processor.js_ if the new file contains anomalies.
