import argparse
import asyncio
from collections.abc import Iterable
import time

import httpx

CHESS_COM_LEADERBOARDS_URL = "https://api.chess.com/pub/leaderboards"
DEFAULT_API_BASE_URL = "http://localhost:8000"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Fetch Chess.com leaderboards and insert the entries into the local "
            "ratings table via the FastAPI leaderboard endpoints."
        )
    )
    parser.add_argument(
        "--api-base-url",
        default=DEFAULT_API_BASE_URL,
        help="Base URL for the local leaderboard API (default: %(default)s)",
    )
    parser.add_argument(
        "--source-url",
        default=CHESS_COM_LEADERBOARDS_URL,
        help="Chess.com leaderboard source URL (default: %(default)s)",
    )
    parser.add_argument(
        "--categories",
        nargs="*",
        help=(
            "Optional leaderboard categories to import, for example "
            "'live_blitz live_rapid'. Defaults to all categories returned by Chess.com."
        ),
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Optional max entries per category to insert.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be inserted without calling the local API.",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=30.0,
        help="HTTP timeout in seconds for both upstream and local API requests.",
    )
    return parser.parse_args()


def normalize_categories(
    requested: list[str] | None, available: Iterable[str]
) -> list[str]:
    available_list = sorted(available)
    if not requested:
        return available_list

    available_set = set(available_list)
    unknown = sorted(set(requested) - available_set)
    if unknown:
        raise ValueError(
            f"Unknown categories: {', '.join(unknown)}. "
            f"Available categories: {', '.join(available_list)}"
        )
    return requested


async def fetch_leaderboards(client: httpx.AsyncClient, source_url: str) -> dict:
    response = await client.get(
        source_url,
        headers={
            "User-Agent": "luddyhack-ratings-importer/1.0 (contact: local-dev-script)"
        },
    )
    response.raise_for_status()
    return response.json()


def collect_entries(
    payload: dict, categories: list[str], limit: int | None
) -> list[dict[str, int | str]]:
    seen: set[tuple[str, int]] = set()
    entries: list[dict[str, int | str]] = []

    for category in categories:
        category_entries = payload.get(category, [])
        if limit is not None:
            category_entries = category_entries[:limit]

        for item in category_entries:
            username = item.get("username")
            score = item.get("score")
            if not username or not isinstance(score, int):
                continue

            dedupe_key = (username, score)
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)

            entries.append(
                {
                    "category": category,
                    "player_name": username,
                    "rating": score,
                }
            )

    return entries


async def post_entry(
    client: httpx.AsyncClient, api_base_url: str, player_name: str, rating: int
) -> float:
    start = time.perf_counter()
    response = await client.post(
        f"{api_base_url.rstrip('/')}/add",
        json={"player_name": player_name, "rating": rating},
    )
    response.raise_for_status()
    return (time.perf_counter() - start) * 1000


def print_summary(
    entries: list[dict[str, int | str]],
    categories: list[str],
    api_call_times_ms: list[float],
    total_runtime_ms: float,
) -> None:
    print(
        f"Imported {len(entries)} ratings from {len(categories)} categories: "
        f"{', '.join(categories)}"
    )
    print(f"Total runtime: {total_runtime_ms:.3f} ms")
    print("POST /add timing statistics:")
    print(f"  requests: {len(api_call_times_ms)}")
    print(f"  total_ms: {sum(api_call_times_ms):.3f}")
    print(f"  avg_ms: {sum(api_call_times_ms) / len(api_call_times_ms):.3f}")
    print(f"  min_ms: {min(api_call_times_ms):.3f}")
    print(f"  max_ms: {max(api_call_times_ms):.3f}")


async def run() -> int:
    args = parse_args()
    timeout = httpx.Timeout(args.timeout)
    run_start = time.perf_counter()

    async with httpx.AsyncClient(timeout=timeout) as client:
        payload = await fetch_leaderboards(client, args.source_url)
        categories = normalize_categories(args.categories, payload.keys())
        entries = collect_entries(payload, categories, args.limit)

        if not entries:
            print("No importable entries found.")
            return 0

        print(
            f"Prepared {len(entries)} entries from {len(categories)} categories: "
            f"{', '.join(categories)}"
        )

        if args.dry_run:
            for entry in entries:
                print(
                    f"[dry-run] {entry['category']}: "
                    f"{entry['player_name']} -> {entry['rating']}"
                )
            return 0

        api_call_times_ms: list[float] = []
        for entry in entries:
            elapsed_ms = await post_entry(
                client=client,
                api_base_url=args.api_base_url,
                player_name=str(entry["player_name"]),
                rating=int(entry["rating"]),
            )
            api_call_times_ms.append(elapsed_ms)

    total_runtime_ms = (time.perf_counter() - run_start) * 1000
    print_summary(entries, categories, api_call_times_ms, total_runtime_ms)
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(run()))
