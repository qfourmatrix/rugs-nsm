#!/usr/bin/env python3
"""Generate GPT Image 2 rug variations through LaoZhang's default image-edit route."""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import time
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_INPUT_ROOT = ROOT / "data" / "legacy-rugs"
DEFAULT_OUTPUT_ROOT = ROOT / "artifacts" / "generated" / "rugs"
API_URL = "https://api.laozhang.ai/v1/images/edits"
MODEL = "gpt-image-2"
DEFAULT_VARIATIONS = 3
EXCLUDED_NAME_PARTS = ("pom-pom", "pom pom", "swatch", "bundle", "candle")
SOURCE_FILENAMES = ("first_image.jpg", "first_image.jpeg", "first_image.png", "first_image.webp")

PROMPT = (
    "A high-fidelity, top-down studio photograph of a premium hand-knotted wool area rug "
    "isolated on a pure white background. The design is a creative variation and alternative "
    "layout that directly plays with the pattern language from the input image. Reconfigure "
    "the original design into a fresh, unique arrangement: allow the lines, shapes, and motifs "
    "to dynamically shift, branch out, or change their intersections to create an entirely new "
    "version of the pattern. The AI must mimic the exact signature style of the input—preserving "
    "organic fluid flows, dense variegated spots, or geometric paths depending entirely on the "
    "source. The color palette, line textures, and overall mood must remain perfectly consistent, "
    "but executed as a sibling design from the same collection. All of this is integrated into "
    "a dense, plush wool pile with visible fiber depth and uniform, neat tassels."
)


@dataclass(frozen=True)
class SourceImage:
    rug_name: str
    source_path: Path
    output_dir: Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Generate three image-edit variations for each included rug using LaoZhang's "
            "$0.03/call default gpt-image-2 route."
        )
    )
    parser.add_argument("--input-root", type=Path, default=DEFAULT_INPUT_ROOT)
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT)
    parser.add_argument("--variations", type=int, default=DEFAULT_VARIATIONS)
    parser.add_argument("--limit", type=int, default=None, help="Process at most N included rugs.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print included/excluded counts and planned outputs without making API calls.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Regenerate outputs even when variation_N.png already exists and is non-empty.",
    )
    parser.add_argument("--timeout", type=int, default=180, help="API request timeout in seconds.")
    parser.add_argument("--retries", type=int, default=3, help="Attempts per variation.")
    parser.add_argument(
        "--batch-size",
        type=int,
        default=10,
        help="Process rugs in batches of this size. Default: 10 rugs per batch.",
    )
    parser.add_argument(
        "--sleep-between-batches",
        type=float,
        default=0.0,
        help="Optional pause between rug batches, in seconds.",
    )
    parser.add_argument(
        "--sleep-between-calls",
        type=float,
        default=0.0,
        help="Optional pause between successful API calls, in seconds.",
    )
    return parser.parse_args()


def is_excluded_folder(name: str) -> bool:
    normalized = name.lower()
    return any(part in normalized for part in EXCLUDED_NAME_PARTS)


def find_source_file(folder: Path) -> Path | None:
    for filename in SOURCE_FILENAMES:
        candidate = folder / filename
        if candidate.is_file():
            return candidate
    return None


def discover_sources(input_root: Path, output_root: Path, limit: int | None) -> tuple[list[SourceImage], list[Path]]:
    if not input_root.is_dir():
        raise FileNotFoundError(f"Input root does not exist or is not a directory: {input_root}")

    sources: list[SourceImage] = []
    excluded: list[Path] = []

    for folder in sorted(path for path in input_root.iterdir() if path.is_dir()):
        if is_excluded_folder(folder.name):
            excluded.append(folder)
            continue

        source_path = find_source_file(folder)
        if source_path is None:
            excluded.append(folder)
            continue

        sources.append(
            SourceImage(
                rug_name=folder.name,
                source_path=source_path,
                output_dir=output_root / folder.name,
            )
        )

        if limit is not None and len(sources) >= limit:
            break

    return sources, excluded


def variation_path(source: SourceImage, variation_number: int) -> Path:
    return source.output_dir / f"variation_{variation_number}.png"


def is_complete(path: Path) -> bool:
    return path.is_file() and path.stat().st_size > 0


def write_log(output_root: Path, record: dict[str, Any]) -> None:
    output_root.mkdir(parents=True, exist_ok=True)
    record = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        **record,
    }
    with (output_root / "run_log.jsonl").open("a", encoding="utf-8") as log_file:
        log_file.write(json.dumps(record, ensure_ascii=False) + "\n")


def decode_b64_image(value: str) -> bytes:
    if value.startswith("data:"):
        value = value.split(",", 1)[1]
    value += "=" * ((4 - len(value) % 4) % 4)
    return base64.b64decode(value)


def save_image_from_response(response_json: dict[str, Any], output_path: Path) -> None:
    data = response_json.get("data")
    if not isinstance(data, list) or not data:
        raise ValueError("API response did not include data[0]")

    first = data[0]
    if not isinstance(first, dict):
        raise ValueError("API response data[0] was not an object")

    b64_value = first.get("b64_json")
    image_url = first.get("url")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = output_path.with_suffix(output_path.suffix + ".tmp")

    if isinstance(b64_value, str) and b64_value:
        temp_path.write_bytes(decode_b64_image(b64_value))
    elif isinstance(image_url, str) and image_url:
        with urllib.request.urlopen(image_url, timeout=180) as response:
            temp_path.write_bytes(response.read())
    else:
        raise ValueError("API response did not include data[0].b64_json or data[0].url")

    if temp_path.stat().st_size == 0:
        temp_path.unlink(missing_ok=True)
        raise ValueError("Generated image was empty")

    temp_path.replace(output_path)


def edit_image(api_key: str, source_path: Path, output_path: Path, timeout: int) -> dict[str, Any]:
    headers = {"Authorization": f"Bearer {api_key}"}
    data = {
        "model": MODEL,
        "prompt": PROMPT,
    }

    with source_path.open("rb") as image_file:
        files = {"image": (source_path.name, image_file)}
        response = requests.post(API_URL, headers=headers, data=data, files=files, timeout=timeout)

    response.raise_for_status()
    response_json = response.json()
    save_image_from_response(response_json, output_path)
    return response_json


def run_variation(
    api_key: str,
    source: SourceImage,
    variation_number: int,
    output_root: Path,
    timeout: int,
    retries: int,
    force: bool,
) -> bool:
    output_path = variation_path(source, variation_number)

    if not force and is_complete(output_path):
        print(f"[skip] {source.rug_name} variation {variation_number}: already exists")
        write_log(
            output_root,
            {
                "status": "skipped",
                "reason": "output_exists",
                "rug_name": source.rug_name,
                "source_path": str(source.source_path),
                "output_path": str(output_path),
                "variation": variation_number,
            },
        )
        return True

    for attempt in range(1, retries + 1):
        try:
            print(f"[edit] {source.rug_name} variation {variation_number} attempt {attempt}/{retries}")
            edit_image(api_key, source.source_path, output_path, timeout)
            print(f"[ok]   {output_path}")
            write_log(
                output_root,
                {
                    "status": "ok",
                    "rug_name": source.rug_name,
                    "source_path": str(source.source_path),
                    "output_path": str(output_path),
                    "variation": variation_number,
                    "attempt": attempt,
                },
            )
            return True
        except Exception as exc:  # noqa: BLE001 - keep batch moving and log exact failure.
            wait_seconds = 2 ** (attempt - 1)
            print(f"[warn] {source.rug_name} variation {variation_number}: {exc}", file=sys.stderr)
            write_log(
                output_root,
                {
                    "status": "retrying" if attempt < retries else "failed",
                    "rug_name": source.rug_name,
                    "source_path": str(source.source_path),
                    "output_path": str(output_path),
                    "variation": variation_number,
                    "attempt": attempt,
                    "error": str(exc),
                },
            )
            if attempt < retries:
                time.sleep(wait_seconds)

    return False


def print_dry_run(sources: list[SourceImage], excluded: list[Path], variations: int) -> None:
    total_calls = len(sources) * variations
    estimated_cost = total_calls * 0.03

    print(f"Included rug folders : {len(sources)}")
    print(f"Excluded folders     : {len(excluded)}")
    print(f"Variations per rug   : {variations}")
    print(f"Planned API calls    : {total_calls}")
    print(f"Estimated cost       : ${estimated_cost:.2f}")
    print()
    print("First planned outputs:")
    for source in sources[:10]:
        planned = ", ".join(str(variation_path(source, number)) for number in range(1, variations + 1))
        print(f"- {source.source_path} -> {planned}")


def main() -> int:
    args = parse_args()
    input_root = args.input_root.resolve()
    output_root = args.output_root.resolve()

    if args.variations < 1:
        print("--variations must be at least 1", file=sys.stderr)
        return 2
    if args.retries < 1:
        print("--retries must be at least 1", file=sys.stderr)
        return 2
    if args.batch_size < 1:
        print("--batch-size must be at least 1", file=sys.stderr)
        return 2

    sources, excluded = discover_sources(input_root, output_root, args.limit)

    if args.dry_run:
        print_dry_run(sources, excluded, args.variations)
        return 0

    api_key = os.environ.get("LAOZHANG_API_KEY")
    if not api_key:
        print("LAOZHANG_API_KEY is required for non-dry-run execution.", file=sys.stderr)
        return 2

    print_dry_run(sources, excluded, args.variations)
    output_root.mkdir(parents=True, exist_ok=True)

    ok_count = 0
    failed_count = 0
    total_batches = (len(sources) + args.batch_size - 1) // args.batch_size
    for batch_index, start in enumerate(range(0, len(sources), args.batch_size), start=1):
        batch = sources[start : start + args.batch_size]
        print()
        print(
            f"=== Batch {batch_index}/{total_batches}: "
            f"rugs {start + 1}-{start + len(batch)} of {len(sources)} ==="
        )

        for source in batch:
            for variation_number in range(1, args.variations + 1):
                ok = run_variation(
                    api_key=api_key,
                    source=source,
                    variation_number=variation_number,
                    output_root=output_root,
                    timeout=args.timeout,
                    retries=args.retries,
                    force=args.force,
                )
                if ok:
                    ok_count += 1
                else:
                    failed_count += 1
                if args.sleep_between_calls > 0:
                    time.sleep(args.sleep_between_calls)

        if batch_index < total_batches and args.sleep_between_batches > 0:
            print(f"Sleeping {args.sleep_between_batches} seconds before next batch...")
            time.sleep(args.sleep_between_batches)

    print()
    print(f"Completed/skipped: {ok_count}")
    print(f"Failed           : {failed_count}")
    print(f"Log              : {output_root / 'run_log.jsonl'}")
    return 1 if failed_count else 0


if __name__ == "__main__":
    raise SystemExit(main())
