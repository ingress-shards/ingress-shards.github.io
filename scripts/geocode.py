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

EVENT_MARKER_REGEX = r"L.marker\(\[(?P<lat>-?\d+.\d+), (?P<lng>-?\d+.\d+)\]\).bindPopup\('(?P<type>Shard Skirmish|Anomaly)<br /> ?(?P<location>.+?)<br />(?P<date>.+?)'\)"

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

def get_flag_emoji(country_code: str) -> str:
    if not country_code or len(country_code) != 2:
        return "🏳️"
    code = country_code.upper()

    # The Unicode offset for Regional Indicator Symbols
    RIS_BASE = 127397

    code_points = [
        RIS_BASE + ord(char)
        for char in code
    ]
    return "".join(chr(cp) for cp in code_points)

def add_offset_to_date(row):
    """
    Localizes a naive datetime object to its timezone and returns an
    ISO 8601 string including the correct UTC offset (+HH:MM).
    This relies on the 'timezone' column being set first.
    """
    dt_naive = row["date"]
    timezone_name = row["timezone"]

    if not timezone_name:
        return dt_naive.strftime('%Y-%m-%dT%H:%M:%S')

    try:
        dt_localized = dt_naive.tz_localize(
            timezone_name,
            ambiguous='NaT',
            nonexistent='shift_forward'
        )
        return dt_localized.isoformat()

    except Exception as e:
        print(f"Error localizing date for {timezone_name}: {e}")
        # Fallback to the original plain ISO string
        return dt_naive.strftime('%Y-%m-%dT%H:%M:%S')

def apply_start_time(row, series_config):
    event_type = row['type']
    event_types_config = series_config.get('eventTypes', {})

    start_time = event_types_config.get(event_type, {}).get('startTime', '00:00')

    # Combine date and start_time
    date_str = row['date'].strftime('%Y-%m-%d')
    return pd.to_datetime(f"{date_str} {start_time}")

tf = TimezoneFinder()
start_time = time.time()
series_geocode = {}
total_sites = 0

type_replacement = {
    "Anomaly": "ANOMALY",
    "Shard Skirmish": "SKIRMISH"
}

for series in series_metadata['series']:
    series_id = series.get("id")
    series_name = series.get("name")
    overview_url = series.get("overviewUrl")
    event_types = series.get("eventTypes")
    df = {}

    print(f'Series {series_name}:')
    if overview_url:
        print(f'\tRetrieving event map data from {overview_url}...')
        r = requests.get(overview_url, headers=HEADERS)
        df = pd.DataFrame(re.findall(EVENT_MARKER_REGEX, r.text), columns=["lat", "lng", "type", "location", "date"])
        df["lat"] = df["lat"].astype(float)
        df["lng"] = df["lng"].astype(float)
        df['type'] = df['type'].replace(type_replacement)
        df["date"] = pd.to_datetime(df["date"], format='%d %b %Y')

    if event_types:
        for event_type, event_data in event_types.items():
            events = event_data.get("events")

            if events:
                event_locations_rows = []
                for event in events:
                    event_date = event.get("date")
                    event_locations = event.get("locations")

                    if event_locations:
                        for event_location in event_locations:
                            lat = event_location.get("lat")
                            lng = event_location.get("lng")
                            location = event_location.get("location")
                            if lat is not None and lng is not None:
                                event_locations_rows.append({
                                    "lat": lat,
                                    "lng": lng,
                                    "location": location,
                                    "type": event_type,
                                    "date": pd.to_datetime(event_date, format='%Y-%m-%d')
                                })

                if event_locations_rows:
                    new_rows = pd.DataFrame(event_locations_rows)
                    if isinstance(df, pd.DataFrame):
                        df = pd.concat([df, new_rows], ignore_index=True)
                    else:
                        df = new_rows

    if len(df) > 0 and 'eventTypes' in series:
        print(f'\tApplying start times for {series_name} events...')
        df['date'] = df.apply(lambda row: apply_start_time(row, series), axis=1)

    if len(df) > 0:
        def calculate_base_id(row):
            base_location = str(row['location']).split(',')[0].strip()
            normalized_location = unidecode(base_location).lower()
            sanitized_location = re.sub(r'[^\w\s-]', '', normalized_location)
            sanitized_location = re.sub(r'[\s_-]+', '-', sanitized_location)
            sanitized_location = sanitized_location.strip('-')
            return f"{series_id}-{sanitized_location}"

        df["base_id"] = df.apply(calculate_base_id, axis=1)

        duplicate_base_ids = df["base_id"].duplicated(keep=False)

        def finalize_id(row):
            base_id = row['base_id']
            if duplicate_base_ids[row.name]:
                raw_date = str(row['date'])[:10]
                date_suffix = raw_date.replace('-', '')
                return f"{base_id}-{date_suffix}"
            else:
                return base_id

        df["id"] = df.apply(finalize_id, axis=1)

        df = df.drop(columns=["base_id"])

        print(f'\tGeocoding {len(df)} events...')
        df["timezone"] = df.apply(lambda row: tf.timezone_at(lng=row["lng"], lat=row["lat"]), axis=1)
        df["date"] = df.apply(add_offset_to_date, axis=1)
        df["country_code"] = df.apply(get_country_code_offline, axis=1)
        df["flag"] = df["country_code"].apply(get_flag_emoji)

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
