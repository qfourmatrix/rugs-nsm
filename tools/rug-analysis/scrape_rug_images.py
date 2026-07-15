import html
import json
import os
import re
import time
from io import BytesIO
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from PIL import Image, ImageDraw, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parent
OUT = ROOT / "downloads"
OUT.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126 Safari/537.36"
}


def get(url):
    r = requests.get(url, headers=HEADERS, timeout=25)
    r.raise_for_status()
    return r.text


def clean_url(url):
    url = html.unescape(url)
    return url.replace("&amp;", "&")


def abs_url(base, url):
    return clean_url(urljoin(base, url))


def extract_img_tags(page_html, base_url):
    tags = []
    for m in re.finditer(r"<img\b([^>]+)>", page_html, re.I):
        attrs = dict(
            (k.lower(), html.unescape(v))
            for k, _, v in re.findall(r'([:\w-]+)\s*=\s*([\"\'])(.*?)\2', m.group(1), re.S)
        )
        src = attrs.get("src") or attrs.get("data-src") or attrs.get("data-lazy")
        srcset = attrs.get("srcset") or attrs.get("data-srcset")
        if srcset:
            # Use the widest candidate in srcset when available.
            parts = [p.strip().split(" ")[0] for p in srcset.split(",") if p.strip()]
            if parts:
                src = parts[-1]
        if not src or src.startswith("data:"):
            continue
        tags.append(
            {
                "src": abs_url(base_url, src),
                "alt": attrs.get("alt", ""),
                "width": attrs.get("width", ""),
                "height": attrs.get("height", ""),
                "class": attrs.get("class", ""),
            }
        )
    return tags


def trc_analysis_size(url):
    # Keep the rendered thumbnail URL. Some generated BigCommerce stencil sizes are slow.
    return clean_url(url)


def classify_trc(img):
    s = (img["alt"] + " " + img["src"]).lower()
    if "flatshot" in s or re.search(r"[-_]f(__|[-_.])", s):
        return "flatshot"
    if "sidepile" in s or "-sp__" in s:
        return "sidepile"
    if "closeup" in s or "-c__" in s:
        return "closeup"
    if "landscape hero roomset" in s or "_r_landscape" in s:
        return "landscape-roomset"
    if "hero roomset" in s or "_r_day" in s or "[roomvo]" in s or "_r_night" in s:
        return "hero-roomset"
    if "roomset inspiration" in s or "incidental" in s or "inspiration" in s or re.search(r"_i\d", s):
        return "lifestyle-detail"
    return "other"


def trc_product_urls(limit=140):
    sitemap = get("https://www.therugcompany.com/xmlsitemap.php?type=products&page=1")
    urls = re.findall(r"<loc>(.*?)</loc>", sitemap)
    urls = [html.unescape(u) for u in urls if u.endswith(".html")]
    return urls[:limit]


def scrape_trc(limit=120):
    rows = []
    for idx, url in enumerate(trc_product_urls(limit), start=1):
        try:
            page = get(url)
        except Exception as e:
            rows.append({"site": "TRC", "url": url, "error": str(e), "images": []})
            continue
        h1 = re.search(r"<h1[^>]*>(.*?)</h1>", page, re.S | re.I)
        name = re.sub(r"<[^>]+>", "", h1.group(1)).strip() if h1 else ""
        imgs = []
        seen = set()
        for img in extract_img_tags(page, url):
            img["src"] = trc_analysis_size(img["src"])
            kind = classify_trc(img)
            if kind == "other":
                continue
            key = re.sub(r"/(?:80|160|240|280|320|640|960|1280)w/", "/SIZE/", img["src"].split("?")[0])
            if key in seen:
                continue
            seen.add(key)
            img["kind"] = kind
            imgs.append(img)
        if any(i["kind"].endswith("roomset") or i["kind"] == "lifestyle-detail" for i in imgs):
            rows.append({"site": "TRC", "url": url, "name": name, "images": imgs})
        time.sleep(0.08)
        if idx % 25 == 0:
            print(f"TRC {idx}/{limit}")
    return rows


def beni_product_urls():
    page = get("https://www.benirugs.com/collections/shop-all")
    hrefs = sorted(set(re.findall(r'href="([^"]*/products/[^"#?]+)', page)))
    return [urljoin("https://www.benirugs.com", h) for h in hrefs]


def classify_beni(img, position):
    s = img["src"].lower()
    if "cdn.shopify.com" in s and position == 0:
        return "flatshot"
    m = re.search(r"-(\d+)x(\d+)\.(?:jpg|png|webp)", s)
    if m:
        w, h = int(m.group(1)), int(m.group(2))
        if h / max(w, 1) < 0.18:
            return "texture-strip"
        if 0.85 <= w / max(h, 1) <= 1.15 and position > 2:
            return "detail-crop"
        return "roomset"
    if "cdn.sanity.io" in s:
        return "roomset"
    return "other"


def beni_analysis_size(url):
    url = clean_url(url)
    if "cdn.sanity.io" in url:
        url = re.sub(r"([?&])w=\d+", r"\1w=700", url)
        url = re.sub(r"([?&])h=\d+", "", url)
        url = url.replace("&&", "&").replace("?&", "?")
    return url


def scrape_beni(limit=80):
    rows = []
    urls = beni_product_urls()[:limit]
    for idx, url in enumerate(urls, start=1):
        try:
            page = get(url)
        except Exception as e:
            rows.append({"site": "Beni", "url": url, "error": str(e), "images": []})
            continue
        h1 = re.search(r"<h1[^>]*>(.*?)</h1>", page, re.S | re.I)
        name = re.sub(r"<[^>]+>", "", h1.group(1)).strip() if h1 else Path(urlparse(url).path).name
        imgs = []
        seen = set()
        for pos, img in enumerate(extract_img_tags(page, url)):
            if "data:image" in img["src"]:
                continue
            img["src"] = beni_analysis_size(img["src"])
            kind = classify_beni(img, pos)
            if kind == "other":
                continue
            key = img["src"].split("?")[0]
            if key in seen:
                continue
            seen.add(key)
            img["kind"] = kind
            imgs.append(img)
        if any(i["kind"] in {"roomset", "detail-crop"} for i in imgs):
            rows.append({"site": "Beni", "url": url, "name": name, "images": imgs})
        time.sleep(0.08)
        if idx % 20 == 0:
            print(f"Beni {idx}/{len(urls)}")
    return rows


def download_image(url):
    r = requests.get(url, headers=HEADERS, timeout=12)
    r.raise_for_status()
    return Image.open(BytesIO(r.content)).convert("RGB")


def safe_name(text):
    return re.sub(r"[^a-zA-Z0-9._-]+", "-", text).strip("-")[:80]


def make_contact_sheet(rows, site, kinds, max_images=48, thumb=(260, 190)):
    chosen = []
    per_product = {}
    for row in rows:
        count = per_product.get(row["url"], 0)
        for img in row.get("images", []):
            if img["kind"] not in kinds:
                continue
            if count >= 2:
                break
            chosen.append((row, img))
            count += 1
            per_product[row["url"]] = count
            if len(chosen) >= max_images:
                break
        if len(chosen) >= max_images:
            break

    cols = 4
    label_h = 54
    rows_n = (len(chosen) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * thumb[0], rows_n * (thumb[1] + label_h)), "white")
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 12)
    except Exception:
        font = ImageFont.load_default()

    manifest = []
    for n, (row, img) in enumerate(chosen):
        x = (n % cols) * thumb[0]
        y = (n // cols) * (thumb[1] + label_h)
        try:
            im = download_image(img["src"])
            im = ImageOps.contain(im, thumb, Image.Resampling.LANCZOS)
            bg = Image.new("RGB", thumb, (242, 240, 236))
            bg.paste(im, ((thumb[0] - im.width) // 2, (thumb[1] - im.height) // 2))
        except Exception as e:
            bg = Image.new("RGB", thumb, (235, 210, 210))
            draw_err = ImageDraw.Draw(bg)
            draw_err.text((8, 8), str(e)[:120], fill=(80, 0, 0), font=font)
        sheet.paste(bg, (x, y))
        label = f"{len(manifest)+1}. {img['kind']} | {row.get('name','')[:30]}"
        draw.text((x + 6, y + thumb[1] + 6), label, fill=(25, 25, 25), font=font)
        manifest.append({"index": len(manifest) + 1, "site": site, "product": row.get("name"), "product_url": row["url"], **img})

    out_path = OUT / f"{safe_name(site)}-contact-sheet.jpg"
    sheet.save(out_path, quality=88)
    return str(out_path), manifest


def summarize(rows):
    stats = {}
    for row in rows:
        for img in row.get("images", []):
            stats[img["kind"]] = stats.get(img["kind"], 0) + 1
    return {
        "products_with_gallery": len(rows),
        "images_by_kind": stats,
        "sample_products": [
            {"name": r.get("name"), "url": r["url"], "image_count": len(r.get("images", []))}
            for r in rows[:12]
        ],
    }


def main():
    trc = scrape_trc(limit=70)
    beni = scrape_beni(limit=48)
    metadata = {
        "sources": {
            "trc_sitemap": "https://www.therugcompany.com/xmlsitemap.php?type=products&page=1",
            "beni_collection": "https://www.benirugs.com/collections/shop-all",
        },
        "trc": summarize(trc),
        "beni": summarize(beni),
    }
    (ROOT / "rug_image_metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    trc_sheet, trc_manifest = make_contact_sheet(
        trc, "TRC", {"landscape-roomset", "hero-roomset", "lifestyle-detail"}, max_images=28
    )
    beni_sheet, beni_manifest = make_contact_sheet(
        beni, "Beni", {"roomset", "detail-crop"}, max_images=28
    )
    payload = {
        "sources": metadata["sources"],
        "trc": summarize(trc),
        "beni": summarize(beni),
        "contact_sheets": {"trc": trc_sheet, "beni": beni_sheet},
        "manifests": {"trc": trc_manifest, "beni": beni_manifest},
    }
    (ROOT / "rug_image_analysis_data.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(json.dumps({k: payload[k] for k in ["sources", "trc", "beni", "contact_sheets"]}, indent=2))


if __name__ == "__main__":
    main()
