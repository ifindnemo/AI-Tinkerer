import os
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv


BACKEND_DIR = Path(__file__).resolve().parents[2]
LOCATIONIQ_NEARBY_URL = "https://us1.locationiq.com/v1/nearby"
LOCATIONIQ_MAP_STYLE_URL = "https://tiles.locationiq.com/v3/streets/vector.json"

load_dotenv(BACKEND_DIR / ".env")


def _validate_search_input(
    latitude: float,
    longitude: float,
    radius_meters: int,
    max_results: int,
) -> None:
    if not -90 <= latitude <= 90:
        raise ValueError("latitude must be between -90 and 90")
    if not -180 <= longitude <= 180:
        raise ValueError("longitude must be between -180 and 180")
    if not 1 <= radius_meters <= 30_000:
        raise ValueError("radius_meters must be between 1 and 30000")
    if not 1 <= max_results <= 50:
        raise ValueError("max_results must be between 1 and 50")


def _raise_locationiq_error(response: httpx.Response) -> None:
    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as error:
        try:
            payload = response.json()
            message = payload.get("error") or payload.get("message")
        except (TypeError, ValueError):
            message = None
        raise RuntimeError(
            message or "LocationIQ rejected the nearby garage search"
        ) from error


def _map_zoom(radius_meters: int) -> int:
    if radius_meters <= 1_000:
        return 15
    if radius_meters <= 5_000:
        return 13
    if radius_meters <= 15_000:
        return 11
    return 10


def _osm_url(latitude: float, longitude: float) -> str:
    return (
        "https://www.openstreetmap.org/"
        f"?mlat={latitude}&mlon={longitude}#map=18/{latitude}/{longitude}"
    )


def search_nearby_garages(
    latitude: float,
    longitude: float,
    radius_meters: int = 5_000,
    max_results: int = 5,
) -> dict[str, Any]:
    """Find nearby car-repair garages and return map-ready marker data."""
    _validate_search_input(latitude, longitude, radius_meters, max_results)

    access_token = os.getenv("LOCATIONIQ_ACCESS_TOKEN")
    if not access_token:
        raise RuntimeError("LOCATIONIQ_ACCESS_TOKEN is not configured")

    nearby_url = os.getenv("LOCATIONIQ_NEARBY_URL", LOCATIONIQ_NEARBY_URL)
    response = httpx.get(
        nearby_url,
        params={
            "key": access_token,
            "lat": latitude,
            "lon": longitude,
            "tag": "shop:car_repair",
            "radius": radius_meters,
            "limit": max_results,
            "dedupe": 1,
            "format": "json",
        },
        timeout=20,
    )
    _raise_locationiq_error(response)

    places = response.json()
    if not isinstance(places, list):
        raise RuntimeError("LocationIQ returned an unexpected response")

    garages = []
    markers = [
        {
            "id": "vehicle",
            "type": "vehicle",
            "label": "Vị trí xe",
            "latitude": latitude,
            "longitude": longitude,
        }
    ]
    for place in places:
        try:
            garage_latitude = float(place["lat"])
            garage_longitude = float(place["lon"])
            distance_meters = float(place["distance"])
        except (KeyError, TypeError, ValueError):
            continue

        garage = {
            "place_id": str(place.get("place_id", "")),
            "name": place.get("name") or "Garage chưa có tên",
            "address": place.get("display_name"),
            "latitude": garage_latitude,
            "longitude": garage_longitude,
            "distance_meters": round(distance_meters),
            "distance_km": round(distance_meters / 1_000, 2),
            "category": place.get("tag_type") or place.get("type"),
            "osm_url": _osm_url(garage_latitude, garage_longitude),
        }
        garages.append(garage)
        markers.append(
            {
                "id": garage["place_id"],
                "type": "garage",
                "label": garage["name"],
                "latitude": garage_latitude,
                "longitude": garage_longitude,
                "popup": {
                    "address": garage["address"],
                    "distance_km": garage["distance_km"],
                    "osm_url": garage["osm_url"],
                },
            }
        )

    garages.sort(key=lambda garage: garage["distance_meters"])
    return {
        "gps": {"latitude": latitude, "longitude": longitude},
        "radius_meters": radius_meters,
        "total_results": len(garages),
        "options": garages,
        "map": {
            "provider": "locationiq",
            "center": {"latitude": latitude, "longitude": longitude},
            "zoom": _map_zoom(radius_meters),
            "style_url_template": (
                f"{LOCATIONIQ_MAP_STYLE_URL}?key={{public_access_token}}"
            ),
            "markers": markers,
            "attribution": "© LocationIQ © OpenStreetMap contributors",
        },
    }

if __name__ == "__main__":
    # Example usage
    latitude = 16.0544
    longitude = 108.2022
    radius_meters = 1000
    max_results = 5

    try:
        result = search_nearby_garages(latitude, longitude, radius_meters, max_results)
        print(result)
    except Exception as e:
        print(f"Error: {e}")
