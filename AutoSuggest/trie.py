from dataclasses import dataclass, field
from typing import Optional


@dataclass
class Suggestion:
    text: str
    market: str
    score: int  # higher = more popular


class TrieNode:
    def __init__(self):
        self.children: dict[str, TrieNode] = {}
        self.suggestions: list[Suggestion] = []


class SuggestionTrie:
    def __init__(self):
        self.root = TrieNode()

    def insert(self, suggestion: Suggestion):
        text_lower = suggestion.text.lower()
        node = self.root
        for char in text_lower:
            if char not in node.children:
                node.children[char] = TrieNode()
            node = node.children[char]
            self._add_to_top_suggestions(node, suggestion)

    def _add_to_top_suggestions(self, node: TrieNode, suggestion: Suggestion, max_size: int = 10):
        node.suggestions.append(suggestion)
        node.suggestions.sort(key=lambda s: s.score, reverse=True)
        node.suggestions = node.suggestions[:max_size]

    def search(self, prefix: str, market: str, limit: int = 10) -> list[Suggestion]:
        node = self.root
        for char in prefix.lower():
            if char not in node.children:
                return []
            node = node.children[char]

        results = [s for s in node.suggestions if s.market == market]
        return results[:limit]


def build_sample_trie() -> SuggestionTrie:
    trie = SuggestionTrie()

    suggestions = [
        # US market
        Suggestion("Apple", "us", 100),
        Suggestion("Apple Inc", "us", 95),
        Suggestion("Apple Music", "us", 80),
        Suggestion("Amazon", "us", 98),
        Suggestion("Amazon Prime", "us", 85),
        Suggestion("Amazon Web Services", "us", 75),
        Suggestion("Amitabh Bachchan", "us", 60),
        Suggestion("Tom Hanks", "us", 90),
        Suggestion("Tom Cruise", "us", 88),
        Suggestion("Tom Holland", "us", 82),
        Suggestion("Taylor Swift", "us", 96),
        Suggestion("Tesla", "us", 92),
        Suggestion("Tesla Model 3", "us", 70),
        Suggestion("Google", "us", 99),
        Suggestion("Google Maps", "us", 88),
        Suggestion("Goldman Sachs", "us", 72),
        # IN market
        Suggestion("Amitabh Bachchan", "in", 99),
        Suggestion("Amazon India", "in", 95),
        Suggestion("Apple", "in", 90),
        Suggestion("Alia Bhatt", "in", 88),
        Suggestion("Anushka Sharma", "in", 82),
        Suggestion("Tata Motors", "in", 91),
        Suggestion("Tata Consultancy Services", "in", 89),
        Suggestion("Tom Cruise", "in", 70),
        Suggestion("Google India", "in", 93),
        Suggestion("Gautam Adani", "in", 85),
    ]

    for s in suggestions:
        trie.insert(s)

    return trie
