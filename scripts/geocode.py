#!/usr/bin/env python3

from glob import glob
import json
import time
from pprint import pprint
import requests
import requests_cache
from shapely import Point
requests_cache.install_cache('cache')
from timezonefinder import TimezoneFinder
from tqdm.auto import tqdm
import re
import pandas as pd
import geopandas as gpd
import os
from pprint import pprint
tf = TimezoneFinder()

start_time = time.time()
dfs = []
for url in ["https://ingress.com/news/2024-sharedmem", "https://ingress.com/news/2024-erasedmem", "https://ingress.com/news/2025-plusalpha", "https://ingress.com/news/2025-plustheta", "https://ingress.com/news/2025-plusbeta"]:
  r = requests.get(url)
  df = pd.DataFrame(re.findall(r"(?P<lat>-?\d+.\d+), (?P<lng>-?\d+.\d+)]\).bindPopup\('(?P<type>Shard Skirmish|Anomaly)<br /> ?(?P<city>.+?)<br />(?P<date>.+?)'", r.text), columns=["lat", "lng", "type", "city", "date"])
  df["series"] = url.split("/")[-1]
  print(df)
  dfs.append(df)

# Hardcoded data for the missing +delta article data
delta_data = [
  {"lat": 2.19, "lng": 102.25, "type": "Anomaly", "city": "Melaka, Malaysia", "date": "16 Aug 2025", "series": "2025-plusdelta"},
  {"lat": 45.52, "lng": -122.68, "type": "Anomaly", "city": "Portland, OR, USA", "date": "16 Aug 2025", "series": "2025-plusdelta"},
  {"lat": 46.81, "lng": -71.21, "type": "Anomaly", "city": "Quebec City, Canada", "date": "23 Aug 2025", "series": "2025-plusdelta"},
  {"lat": 57.71, "lng": 11.97, "type": "Anomaly", "city": "Gothenburg, Sweden", "date": "23 Aug 2025", "series": "2025-plusdelta"},
  {"lat": 52.20, "lng": 0.13, "type": "Anomaly", "city": "Cambridge, United Kingdom", "date": "20 Sep 2025", "series": "2025-plusdelta"},
  {"lat": -8.67, "lng": 115.21, "type": "Anomaly", "city": "Denpasar, Bali, Indonesia", "date": "20 Sep 2025", "series": "2025-plusdelta"},
]
delta_df = pd.DataFrame(delta_data)
dfs.append(delta_df)

# Hardcoded data for the +beta article data
beta_data = [
  {"lat": 39.47452, "lng": -0.37692, "type": "Anomaly", "city": "Valencia, Spain", "date": "18 Oct 2025", "series": "2025-plusbeta"},
  {"lat": -23.58964, "lng": -46.66091, "type": "Anomaly", "city": "Sao Paulo, Brazil", "date": "18 Oct 2025", "series": "2025-plusbeta"},
  {"lat": -41.28564381946367, "lng": 174.7780881775362, "type": "Anomaly", "city": "Wellington, New Zealand", "date": "25 Oct 2025", "series": "2025-plusbeta"},
  {"lat": 29.75457725448469, "lng": -95.37087644288286, "type": "Anomaly", "city": "Houston TX, USA", "date": "25 Oct 2025", "series": "2025-plusbeta"},
  {"lat": 24.99854600681725, "lng": 121.32464005902432, "type": "Anomaly", "city": "Taoyuan, Taiwan", "date": "15 Nov 2025", "series": "2025-plusbeta"},
  {"lat": 52.06993723259916, "lng": 4.2947598478782165, "type": "Anomaly", "city": "The Hague, Netherlands", "date": "15 Nov 2025", "series": "2025-plusbeta"},
]
beta_df = pd.DataFrame(beta_data)
dfs.append(beta_df)


df = pd.concat(dfs)
df["lat"] = df["lat"].astype(float)
df["lng"] = df["lng"].astype(float)
df["date"] = pd.to_datetime(df["date"])
df = gpd.GeoDataFrame(df, geometry=gpd.points_from_xy(df["lng"], df["lat"]), crs="EPSG:4326")
print(df)
df.drop(columns="geometry").sort_values("date").to_csv("../events.csv", index=False)

files = glob("jump-times/*.json")
all_data = {}

anomaly_jump_files = {
  "shard-jump-times-2025.06.16.17.47.43.json",
  "shard-jump-times-2025.08.18.12.11.03.json",
  "shard-jump-times-2025.08.23.22.03.28.json",
  "shard-jump-times-2025.09.20.18.08.35.json",
  "shard-jump-times-2025.10.18.21.05.55.json",
  "shard-jump-times-2025.10.25.23.04.33.json",
  "shard-jump-times-2025.11.15.17.42.27.json",
}

for f in tqdm(files):
  with open(f, "r", encoding="utf-8") as file:
    filename = os.path.basename(f)

    print(f)
    data = json.load(file)
    filtered_data = [d for d in data["artifact"] if d.get("fragment")]
    for d in tqdm(filtered_data):
      if d["id"] == "abaddon1" and filename not in anomaly_jump_files:
        for shard in d["fragment"]:
          samplePortal = shard["history"][-1]["destinationPortalInfo"]
          lat = samplePortal["latE6"] / 1e6
          lng = samplePortal["lngE6"] / 1e6
          df["distance"] = df.distance(Point(lng, lat))
          df = df.sort_values("distance")
          city = df.iloc[0]["city"]
          timezone = tf.timezone_at(lng=lng, lat=lat)
          print(d["name"], city, timezone)
          #shard["city"] = city
          shard["timezone"] = timezone
      else:
        samplePortal = d["fragment"][0]["history"][-1]["destinationPortalInfo"]
        lat = samplePortal["latE6"] / 1e6
        lng = samplePortal["lngE6"] / 1e6
        df["distance"] = df.distance(Point(lng, lat))
        df = df.sort_values("distance")
        city = df.iloc[0]["city"]
        timezone = tf.timezone_at(lng=lng, lat=lat)
        print(d["name"], city, timezone)
        d["city"] = city
        d["timezone"] = timezone
  with open(f, "w", encoding="utf-8") as file:
    json.dump(data, file, indent=2, ensure_ascii=False)

    all_data[filename] = data

# Ensure the data directory exists
data_dir_path = os.path.join(os.path.dirname(__file__), '..', 'data')
if not os.path.exists(data_dir_path):
    os.makedirs(data_dir_path)

file_path = os.path.join(data_dir_path, 'all_data.json')
with open(file_path, "w", encoding="utf-8") as file:
  json.dump(all_data, file, indent=2, ensure_ascii=False)

end_time = time.time()
elapsed_time = end_time - start_time
print(f'Successfully generated {file_path} in {elapsed_time:.2f} seconds.')
