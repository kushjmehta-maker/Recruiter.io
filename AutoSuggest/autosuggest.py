import curses
from dataclasses import dataclass
from typing import Optional

from trie import Suggestion, SuggestionTrie, build_sample_trie
from enrichment_db import EnrichmentDB, EnrichmentEntry

MARKET = "us"


@dataclass
class AnnotatedSuggestion:
    text: str
    score: int
    enriched: bool
    category: Optional[str] = None
    image_url: Optional[str] = None


class AutoSuggestEngine:
    def __init__(self):
        self.trie: SuggestionTrie = build_sample_trie()
        self.enrichment_db: EnrichmentDB = EnrichmentDB()

    def suggest(self, query: str, market: str, limit: int = 10) -> list[AnnotatedSuggestion]:
        raw_suggestions = self.trie.search(query, market, limit)
        results = []

        for s in raw_suggestions:
            enrichment = self.enrichment_db.lookup(s.text, s.market)
            if enrichment:
                results.append(AnnotatedSuggestion(
                    text=s.text,
                    score=s.score,
                    enriched=True,
                    category=enrichment.category,
                    image_url=enrichment.image_url,
                ))
            else:
                results.append(AnnotatedSuggestion(
                    text=s.text,
                    score=s.score,
                    enriched=False,
                ))

        return results


def run_ui(stdscr):
    curses.curs_set(1)
    stdscr.clear()
    engine = AutoSuggestEngine()
    query = ""

    while True:
        stdscr.clear()
        height, width = stdscr.getmaxyx()

        stdscr.attron(curses.A_BOLD)
        stdscr.addstr(0, 0, "AutoSuggest (market: US) | Esc to quit")
        stdscr.attroff(curses.A_BOLD)

        stdscr.addstr(1, 0, "─" * min(width - 1, 50))
        stdscr.addstr(2, 0, f"Search: {query}")

        if query:
            suggestions = engine.suggest(query, MARKET)
            stdscr.addstr(3, 0, "─" * min(width - 1, 50))

            if not suggestions:
                stdscr.addstr(4, 0, "  No suggestions found.")
            else:
                for i, s in enumerate(suggestions, 1):
                    row = 3 + i
                    if row >= height - 1:
                        break
                    if s.enriched:
                        line = f"  {i}. {s.text} (score: {s.score}) [{s.category}]"
                    else:
                        line = f"  {i}. {s.text} (score: {s.score})"
                    stdscr.addstr(row, 0, line[:width - 1])
        else:
            stdscr.addstr(3, 0, "─" * min(width - 1, 50))
            stdscr.addstr(4, 0, "  Start typing to see suggestions...")

        stdscr.move(2, len("Search: ") + len(query))
        stdscr.refresh()

        key = stdscr.getch()

        if key == 27:  # Esc
            break
        elif key in (curses.KEY_BACKSPACE, 127, 8):
            query = query[:-1]
        elif 32 <= key <= 126:
            query += chr(key)


def main():
    curses.wrapper(run_ui)


if __name__ == "__main__":
    main()
