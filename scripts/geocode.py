#!/usr/bin/env python3

import json
import time
import requests
import requests_cache
import re
import pandas as pd
import reverse_geocoder as rg
from unidecode import unidecode
import os
import sys
from timezonefinder import TimezoneFinder
from concurrent.futures import ThreadPoolExecutor

# Ensure UTF-8 output
if sys.stdout.encoding.lower() != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except AttributeError:
        pass # Older python

# Cache for 1 hour
requests_cache.install_cache('cache', expire_after=3600)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SERIES_METADATA_FILE_PATH = os.path.join(SCRIPT_DIR, '..', 'conf', 'series_metadata.json')
with open(SERIES_METADATA_FILE_PATH, 'r', encoding="utf-8") as f:
    series_metadata = json.load(f)

EVENT_BLUEPRINTS_FILE_PATH = os.path.join(SCRIPT_DIR, '..', 'conf', 'event_blueprints.json')
with open(EVENT_BLUEPRINTS_FILE_PATH, 'r', encoding="utf-8") as f:
    event_blueprints = json.load(f)

EVENT_MARKER_REGEX = r"L.marker\(\[(?P<lat>-?\d+.\d+), (?P<lng>-?\d+.\d+)\]\).bindPopup\('(?P<label>Shard Skirmish|Anomaly)<br /> ?(?P<name>.+?)<br />(?P<date>.+?)'\)"

PACKAGE_JSON_PATH = os.path.join(SCRIPT_DIR, '..', 'package.json')
with open(PACKAGE_JSON_PATH, 'r', encoding='utf-8') as f:
    package_version = json.load(f).get('version', '0.0.0')

print(f'Package version: {package_version}')
# Headers to simulate a real browser request
HEADERS = {
    'User-Agent': f'ingress-shards-map/{package_version}',
    "accept-language": "en-US,en;q=0.9",
}

LABEL_TO_EVENT_TYPE = {
    "Anomaly": "ANOMALY",
    "Shard Skirmish": "SKIRMISH"
}

tf = TimezoneFinder()

def get_country_code_offline(row):
    result = rg.search((row['lat'], row['lng']), mode=1)
    country_code = result[0].get('cc')
    return country_code.upper() if country_code else None

def add_timezone_to_date(row):
    dt_naive = row["date"]
    timezone_name = row["timezone"]
    if not timezone_name:
        return dt_naive.strftime('%Y-%m-%dT%H:%M:%S')
    try:
        iso_string = dt_naive.strftime('%Y-%m-%dT%H:%M:%S')
        return f"{iso_string}[{timezone_name}]"
    except Exception as e:
        print(f"Error formatting date for {timezone_name}: {e}")
        return dt_naive.strftime('%Y-%m-%dT%H:%M:%S')

def apply_start_time(row, series_config):
    event_type = row['eventType']
    shard_components_list = series_config.get('shardComponents', [])
    component_config = next((sc for sc in shard_components_list if sc.get('eventType') == event_type), {})
    start_time = component_config.get('startTime', '00:00')
    date_str = row['date'].strftime('%Y-%m-%d')
    return pd.to_datetime(f"{date_str} {start_time}")

def process_series(series):
    try:
        series_id = series.get("id")
        series_name = series.get("name")
        overview_url = series.get("overviewUrl")
        shard_components = series.get("shardComponents")
        df = pd.DataFrame()

        if overview_url:
            r = requests.get(overview_url, headers=HEADERS)
            found = re.findall(EVENT_MARKER_REGEX, r.text)
            if found:
                site_df = pd.DataFrame(found, columns=["lat", "lng", "label", "name", "date"])
                site_df["lat"] = site_df["lat"].astype(float)
                site_df["lng"] = site_df["lng"].astype(float)
                site_df['eventType'] = site_df['label'].map(LABEL_TO_EVENT_TYPE)
                site_df = site_df.drop(columns=['label'])
                site_df["date"] = pd.to_datetime(site_df["date"], format='%d %b %Y')
                df = site_df

        if shard_components:
            site_rows = []
            for component_config in shard_components:
                event_type = component_config.get("eventType")
                schedule = component_config.get("schedule")
                if schedule:
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
                                        "eventType": event_type,
                                        "date": pd.to_datetime(entry_date, format='%Y-%m-%d')
                                    })
            if site_rows:
                schedule_df = pd.DataFrame(site_rows)
                df = pd.concat([df, schedule_df], ignore_index=True)

        if not df.empty:
            if 'shardComponents' in series:
                df['date'] = df.apply(lambda row: apply_start_time(row, series), axis=1)

            def calculate_base_site_id(row):
                primary_name = str(row['name']).split(',')[0].strip()
                slug_base = unidecode(primary_name).lower()
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

            df["timezone"] = df.apply(lambda row: tf.timezone_at(lng=row["lng"], lat=row["lat"]), axis=1)
            df["date"] = df.apply(add_timezone_to_date, axis=1)
            df["country_code"] = df.apply(get_country_code_offline, axis=1)
            print(f'{series_name} - {len(df)} sites geocoded')
            return series_id, df.to_dict(orient="records")
    except Exception as e:
        print(f"Error in process_series {series.get('name')}: {e}")
    
    return series.get("id"), []

def main():
    start_time = time.time()
    
    # Pre-loading reverse geocoder database
    print("Pre-loading geocoder database...")
    rg.search((0, 0), mode=1)

    # Using 1 worker for stability on Windows (cache makes it fast enough)
    with ThreadPoolExecutor(max_workers=1) as executor:
        results = list(executor.map(process_series, series_metadata['series']))

    series_geocode = {}
    total_sites = 0
    for series_id, site_data in results:
        series_geocode[series_id] = { "sites": site_data }
        total_sites += len(site_data)

    geocode_file_path = os.path.join(SCRIPT_DIR, '..', 'gen', 'series_geocode.json')
    os.makedirs(os.path.dirname(geocode_file_path), exist_ok=True)
    with open(geocode_file_path, 'w', encoding='utf-8') as f:
        json.dump(series_geocode, f, indent=2, ensure_ascii=False)

    end_time = time.time()
    elapsed_time = end_time - start_time
    print(f'Generated {geocode_file_path} with {len(series_metadata["series"])} series and {total_sites} sites in {elapsed_time:.2f} seconds.')

if __name__ == '__main__':
    main()
