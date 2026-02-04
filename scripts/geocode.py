#!/usr/bin/env python3

from glob import glob
import json
import time
from pprint import pprint
import requests
import requests_cache
from shapely import Point
requests_cache.install_cache('cache', expire_after=3600) # Cache for 1 hour
from timezonefinder import TimezoneFinder
import re
import pandas as pd
import reverse_geocoder as rg
from unidecode import unidecode
import os

SERIES_METADATA_FILE_PATH = 'conf/series_metadata.json'
with open(SERIES_METADATA_FILE_PATH, 'r', encoding="utf-8") as f:
    series_metadata = json.load(f)

EVENT_BLUEPRINTS_FILE_PATH = 'conf/event_blueprints.json'
with open(EVENT_BLUEPRINTS_FILE_PATH, 'r', encoding="utf-8") as f:
    event_blueprints = json.load(f)

EVENT_MARKER_REGEX = r"L.marker\(\[(?P<lat>-?\d+.\d+), (?P<lng>-?\d+.\d+)\]\).bindPopup\('(?P<brand>Shard Skirmish|Anomaly)<br /> ?(?P<name>.+?)<br />(?P<date>.+?)'\)"

PACKAGE_JSON_PATH = os.path.join(os.path.dirname(__file__), '..', 'package.json')
with open(PACKAGE_JSON_PATH, 'r', encoding='utf-8') as f:
    package_version = json.load(f).get('version', '0.0.0')

print(f'Package version: {package_version}:')
# Headers to simulate a real browser request
HEADERS = {
    'User-Agent': f'ingress-shards-map/{package_version}',
    "accept-language": "en-US,en;q=0.9",
}

def get_country_code_offline(row):
    result = rg.search((row['lat'], row['lng']), mode=1)
    country_code = result[0].get('cc')
    return country_code.upper() if country_code else None

def add_timezone_to_date(row):
    """
    Formats a naive datetime object with its IANA timezone identifier
    in ISO 8601 extended format: YYYY-MM-DDTHH:MM:SS[Timezone/Name]
    This format is compatible with Temporal.ZonedDateTime.from()
    """
    dt_naive = row["date"]
    timezone_name = row["timezone"]

    if not timezone_name:
        return dt_naive.strftime('%Y-%m-%dT%H:%M:%S')

    try:
        # Format as ISO 8601 with timezone identifier in brackets
        # Example: 2024-08-17T14:00:00[Asia/Singapore]
        iso_string = dt_naive.strftime('%Y-%m-%dT%H:%M:%S')
        return f"{iso_string}[{timezone_name}]"

    except Exception as e:
        print(f"Error formatting date for {timezone_name}: {e}")
        # Fallback to the original plain ISO string
        return dt_naive.strftime('%Y-%m-%dT%H:%M:%S')

def apply_start_time(row, series_config):
    event_brand_id = row['brand']
    shard_components_list = series_config.get('shardComponents', [])

    # Find the config for this brand in the series
    component_config = next((sc for sc in shard_components_list if sc.get('brand') == event_brand_id), {})
    start_time = component_config.get('startTime', '00:00')

    # Combine date and start_time
    date_str = row['date'].strftime('%Y-%m-%d')
    return pd.to_datetime(f"{date_str} {start_time}")

tf = TimezoneFinder()
start_time = time.time()
series_geocode = {}
total_sites = 0

brand_replacement = {
    "Anomaly": "ANOMALY",
    "Shard Skirmish": "SKIRMISH"
}

for series in series_metadata['series']:
    series_id = series.get("id")
    series_name = series.get("name")
    overview_url = series.get("overviewUrl")
    shard_components = series.get("shardComponents")
    df = {}

    print(f'Series {series_name}:')
    if overview_url:
        print(f'\tRetrieving event map data from {overview_url}...')
        r = requests.get(overview_url, headers=HEADERS)
        df = pd.DataFrame(re.findall(EVENT_MARKER_REGEX, r.text), columns=["lat", "lng", "brand", "name", "date"])
        df["lat"] = df["lat"].astype(float)
        df["lng"] = df["lng"].astype(float)
        df['brand'] = df['brand'].replace(brand_replacement)
        df["date"] = pd.to_datetime(df["date"], format='%d %b %Y')

    if shard_components:
        for component_config in shard_components:
            brand_id = component_config.get("brand")
            schedule = component_config.get("schedule")

            if schedule:
                site_rows = []
                for entry in schedule:
                    entry_date = entry.get("date")
                    sites = entry.get("sites")

                    if sites:
                        for site_config in sites:
                            lat = site_config.get("lat")
                            lng = site_config.get("lng")
                            name = site_config.get("name")
                            if lat is not None and lng is not None:
                                site_rows.append({
                                    "lat": lat,
                                    "lng": lng,
                                    "name": name,
                                    "brand": brand_id,
                                    "date": pd.to_datetime(entry_date, format='%Y-%m-%d')
                                })

                if site_rows:
                    new_rows = pd.DataFrame(site_rows)
                    if isinstance(df, pd.DataFrame):
                        df = pd.concat([df, new_rows], ignore_index=True)
                    else:
                        df = new_rows

    if len(df) > 0 and 'shardComponents' in series:
        print(f'\tApplying start times for {series_name} events...')
        df['date'] = df.apply(lambda row: apply_start_time(row, series), axis=1)

    if len(df) > 0:
        def calculate_base_site_id(row):
            # Extract the primary name (e.g., "Shanghai" from "Shanghai, China")
            primary_name = str(row['name']).split(',')[0].strip()

            # Convert to ASCII and lowercase (e.g., "São Paulo" -> "sao paulo")
            slug_base = unidecode(primary_name).lower()

            # Remove non-alphanumeric chars and convert spaces/underscores to hyphens
            site_slug = re.sub(r'[^\w\s-]', '', slug_base)
            site_slug = re.sub(r'[\s_-]+', '-', site_slug).strip('-')

            return f"{series_id}-{site_slug}"

        df["base_site_id"] = df.apply(calculate_base_site_id, axis=1)

        duplicate_base_site_ids = df["base_site_id"].duplicated(keep=False)

        def finalize_id(row):
            base_site_id = row['base_site_id']
            if duplicate_base_site_ids[row.name]:
                raw_date = str(row['date'])[:10]
                date_suffix = raw_date.replace('-', '')
                return f"{base_site_id}-{date_suffix}"
            else:
                return base_site_id

        df["id"] = df.apply(finalize_id, axis=1)

        df = df.drop(columns=["base_site_id"])

        print(f'\tGeocoding {len(df)} events...')
        df["timezone"] = df.apply(lambda row: tf.timezone_at(lng=row["lng"], lat=row["lat"]), axis=1)
        df["date"] = df.apply(add_timezone_to_date, axis=1)
        df["country_code"] = df.apply(get_country_code_offline, axis=1)

        total_sites += len(df)

    if isinstance(df, pd.DataFrame):
        site_data = df.to_dict(orient="records")
    else:
        site_data = []

    series_geocode[series_id] = { "sites": site_data }

geocode_file_path = os.path.join(os.path.dirname(__file__), '..', 'gen', 'series_geocode.json')
with open(geocode_file_path, 'w', encoding='utf-8') as f:
    json.dump(series_geocode, f, indent=2, ensure_ascii=False)

end_time = time.time()
elapsed_time = end_time - start_time
print(f'Generated {geocode_file_path} with {len(series_metadata["series"])} series and {total_sites} sites in {elapsed_time:.2f} seconds.')
