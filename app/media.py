from __future__ import annotations

import json
import os
import time
import uuid
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from PIL import Image, ImageStat, UnidentifiedImageError
from pydantic import BaseModel, Field, field_validator


ROOT = Path(__file__).resolve().parents[1]
GENERATED_DIR = ROOT / "public" / "generated"
DEFAULT_MODEL = "DreamShaper_8_pruned.safetensors"


class ImageGenerationRequest(BaseModel):
    prompt: str = Field(min_length=12, max_length=800)
    width: int = Field(default=768, ge=256, le=1536)
    height: int = Field(default=512, ge=256, le=1536)
    seed: int = Field(default=42, ge=0, le=18_446_744_073_709_551_615)

    @field_validator("width", "height")
    @classmethod
    def dimensions_are_model_safe(cls, value: int) -> int:
        if value % 8:
            raise ValueError("image dimensions must be a multiple of 8")
        return value


def _expanded_prompt(prompt: str) -> str:
    return (
        f"{prompt.rstrip('. ')}. Educational quantum computing visual for a beginner. "
        "Minimal high-end editorial illustration, one clear focal relationship, crisp geometry, "
        "bright white background, near-black structure, cobalt blue and restrained teal accents, "
        "generous whitespace, physically coherent visual hierarchy. No visible text is required."
    )


def _workflow(request: ImageGenerationRequest, model: str, prefix: str) -> dict[str, Any]:
    negative = (
        "low quality, blurry, pixelated, distorted geometry, illegible text, letters, captions, "
        "watermark, signature, logo, cluttered background, dark muddy image, purple gradient, "
        "cropped subject, busy infographic, fantasy space background, person, people, human, face, "
        "hands, body, clothing, robot, control panel, user interface, chart labels, numbers"
    )
    return {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": model}},
        "2": {"class_type": "CLIPTextEncode", "inputs": {"text": _expanded_prompt(request.prompt), "clip": ["1", 1]}},
        "3": {"class_type": "CLIPTextEncode", "inputs": {"text": negative, "clip": ["1", 1]}},
        "4": {"class_type": "EmptyLatentImage", "inputs": {"width": request.width, "height": request.height, "batch_size": 1}},
        "5": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["1", 0], "seed": request.seed, "steps": 24, "cfg": 6.5,
                "sampler_name": "dpmpp_2m", "scheduler": "karras", "positive": ["2", 0],
                "negative": ["3", 0], "latent_image": ["4", 0], "denoise": 1.0,
            },
        },
        "6": {"class_type": "VAEDecode", "inputs": {"samples": ["5", 0], "vae": ["1", 2]}},
        "7": {"class_type": "SaveImage", "inputs": {"images": ["6", 0], "filename_prefix": prefix}},
    }


def _json_request(base_url: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    request = Request(
        f"{base_url.rstrip('/')}{path}", body,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST" if payload is not None else "GET",
    )
    try:
        with urlopen(request, timeout=15) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"ComfyUI returned HTTP {error.code}: {detail[:300]}") from error
    except (URLError, TimeoutError) as error:
        raise RuntimeError(f"Cannot reach local ComfyUI at {base_url}: {error}") from error


def _download(base_url: str, remote: dict[str, Any]) -> bytes:
    query = urlencode({
        "filename": str(remote.get("filename", "output.png")),
        "subfolder": str(remote.get("subfolder", "")),
        "type": str(remote.get("type", "output")),
    })
    try:
        with urlopen(f"{base_url.rstrip('/')}/view?{query}", timeout=30) as response:
            return response.read()
    except (HTTPError, URLError, TimeoutError) as error:
        raise RuntimeError(f"Could not download ComfyUI output: {error}") from error


def _assess(path: Path, expected: tuple[int, int]) -> dict[str, Any]:
    warnings: list[str] = []
    try:
        with Image.open(path) as source:
            source.verify()
        with Image.open(path) as source:
            size = source.size
            sample = source.convert("RGB")
            sample.thumbnail((256, 256))
    except (OSError, UnidentifiedImageError) as error:
        return {"passed": False, "warnings": [f"invalid image: {error}"]}
    if size != expected:
        warnings.append(f"dimensions {size} do not match {expected}")
    statistics = ImageStat.Stat(sample)
    if sum(statistics.stddev) / 3 < 4 or sample.entropy() < 2:
        warnings.append("image is near-blank or has insufficient visual variation")
    return {"passed": not warnings, "warnings": warnings, "width": size[0], "height": size[1], "manual_review_required": True}


def generate_lesson_image(request: ImageGenerationRequest) -> dict[str, Any]:
    """Run one fixed ComfyUI graph; callers cannot submit arbitrary workflow nodes."""
    base_url = os.getenv("COMFYUI_URL", "http://127.0.0.1:8188")
    model = os.getenv("COMFYUI_CHECKPOINT", DEFAULT_MODEL)
    client_id = str(uuid.uuid4())
    output_id = uuid.uuid4().hex
    queued = _json_request(
        base_url,
        "/prompt",
        {"prompt": _workflow(request, model, f"1stopquantum/{output_id}"), "client_id": client_id},
    )
    prompt_id = str(queued.get("prompt_id", ""))
    if not prompt_id or queued.get("node_errors"):
        raise RuntimeError(f"ComfyUI rejected the fixed workflow: {queued.get('node_errors') or queued}")

    deadline = time.monotonic() + 300
    entry: dict[str, Any] | None = None
    while time.monotonic() < deadline:
        entry = _json_request(base_url, f"/history/{prompt_id}").get(prompt_id)
        if entry and entry.get("outputs"):
            break
        time.sleep(0.5)
    if not entry or not entry.get("outputs"):
        raise RuntimeError("ComfyUI image generation timed out")

    images = [image for output in entry["outputs"].values() for image in output.get("images", [])]
    if not images:
        raise RuntimeError("ComfyUI completed without returning an image")
    GENERATED_DIR.mkdir(parents=True, exist_ok=True)
    destination = GENERATED_DIR / f"{output_id}.png"
    destination.write_bytes(_download(base_url, images[0]))
    quality = _assess(destination, (request.width, request.height))
    return {
        "image_url": f"/generated/{destination.name}",
        "prompt_id": prompt_id,
        "seed": request.seed,
        "model": model,
        "quality": quality,
    }
