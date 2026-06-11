from dataclasses import dataclass
from typing import Optional


@dataclass
class EnrichmentEntry:
    image_url: str
    category: str  # "actor", "organization", etc.


class EnrichmentDB:
    """Local database that maps (suggestion_text, market) -> image enrichment data."""

    def __init__(self):
        self._store: dict[tuple[str, str], EnrichmentEntry] = {}
        self._load_sample_data()

    def _load_sample_data(self):
        entries = {
            # Actors
            ("Tom Hanks", "us"): EnrichmentEntry(
                image_url="https://images.example.com/tom_hanks.jpg",
                category="actor",
            ),
            ("Tom Cruise", "us"): EnrichmentEntry(
                image_url="https://images.example.com/tom_cruise.jpg",
                category="actor",
            ),
            ("Tom Holland", "us"): EnrichmentEntry(
                image_url="https://images.example.com/tom_holland.jpg",
                category="actor",
            ),
            ("Taylor Swift", "us"): EnrichmentEntry(
                image_url="https://images.example.com/taylor_swift.jpg",
                category="actor",
            ),
            ("Amitabh Bachchan", "us"): EnrichmentEntry(
                image_url="https://images.example.com/amitabh_bachchan.jpg",
                category="actor",
            ),
            ("Amitabh Bachchan", "in"): EnrichmentEntry(
                image_url="https://images.example.com/amitabh_bachchan.jpg",
                category="actor",
            ),
            ("Alia Bhatt", "in"): EnrichmentEntry(
                image_url="https://images.example.com/alia_bhatt.jpg",
                category="actor",
            ),
            ("Anushka Sharma", "in"): EnrichmentEntry(
                image_url="https://images.example.com/anushka_sharma.jpg",
                category="actor",
            ),
            ("Tom Cruise", "in"): EnrichmentEntry(
                image_url="https://images.example.com/tom_cruise.jpg",
                category="actor",
            ),
            ("Gautam Adani", "in"): EnrichmentEntry(
                image_url="https://images.example.com/gautam_adani.jpg",
                category="person",
            ),
            # Organizations
            ("Apple Inc", "us"): EnrichmentEntry(
                image_url="https://images.example.com/apple_logo.png",
                category="organization",
            ),
            ("Amazon", "us"): EnrichmentEntry(
                image_url="https://images.example.com/amazon_logo.png",
                category="organization",
            ),
            ("Tesla", "us"): EnrichmentEntry(
                image_url="https://images.example.com/tesla_logo.png",
                category="organization",
            ),
            ("Google", "us"): EnrichmentEntry(
                image_url="https://images.example.com/google_logo.png",
                category="organization",
            ),
            ("Goldman Sachs", "us"): EnrichmentEntry(
                image_url="https://images.example.com/goldman_sachs_logo.png",
                category="organization",
            ),
            ("Tata Motors", "in"): EnrichmentEntry(
                image_url="https://images.example.com/tata_motors_logo.png",
                category="organization",
            ),
            ("Tata Consultancy Services", "in"): EnrichmentEntry(
                image_url="https://images.example.com/tcs_logo.png",
                category="organization",
            ),
            ("Google India", "in"): EnrichmentEntry(
                image_url="https://images.example.com/google_logo.png",
                category="organization",
            ),
        }
        self._store = entries

    def lookup(self, suggestion_text: str, market: str) -> Optional[EnrichmentEntry]:
        return self._store.get((suggestion_text, market))
