#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.media import DEFAULT_MODEL, GENERATED_DIR, ImageGenerationRequest, generate_lesson_image


COURSE_DESTINATION = ROOT / "public" / "assets" / "course"
LESSON_DESTINATION = COURSE_DESTINATION / "lessons"
COURSE_PROMPTS = {
    "foundations": "One large translucent cobalt blue glass sphere with one bold near-black state arrow emerging from its center, simple scientific object on white",
    "effects": "Exactly two identical large cobalt blue transparent glass balls side by side, one straight luminous cyan cable connects the center of the first ball to the center of the second ball, no other objects, no stem, no pedestal, on white",
    "algorithms": "One straight horizontal near-black cable from left to right, exactly three large cobalt blue square blocks placed in sequence on the cable, one amber square target at the far right, flat clean top view, no circles, no radial layout, on white",
    "hardware-evidence": "One elegant quantum processor chip in cobalt blue and brushed silver with a restrained evidence timeline beside it, clean technical product illustration on white",
}

LESSON_PROMPTS = {
    "bits-and-qubits": "Exactly two isolated objects centered on white: one small cobalt glass cube on the left and one larger translucent cobalt glass sphere on the right, wide empty gap, no controls or markings",
    "state-and-bloch-sphere": "Exactly one transparent glass sphere isolated on white, one bold cobalt arrow begins at the exact center and points to the upper right, three very thin straight coordinate axes",
    "gates-and-circuits": "Exactly three simple colored glass cubes pierced in sequence by one perfectly straight thin black horizontal rod, cobalt cube, teal cube, amber cube, isolated on white",
    "measurement-and-shots": "One cobalt glass sphere above exactly two shallow white bowls, many tiny black balls collected in the left bowl and many tiny cobalt balls collected in the right bowl",
    "interference": "Two smooth cobalt wave paths entering from opposite sides, overlapping at the center, and leaving as one bright amplified wave and one cancelled flat path",
    "entanglement": "Exactly two separate translucent cobalt spheres connected by one thin luminous teal link, balanced paired composition showing one shared relationship",
    "noise-and-decoherence": "Two identical smooth cobalt glass spheres side by side on white, the left sphere perfectly sharp and clear, the right sphere surrounded by a soft cloud of scattered pale particles, no arrows, no graph, no baseline",
    "error-correction-intuition": "One central cobalt sphere protected by a symmetric ring of small teal sensor nodes, two amber warning pulses detected at the perimeter",
    "algorithm-thinking": "Exactly four smooth thin cobalt curves enter from the left, pass behind three plain black cubes, then merge into one bright amber glass sphere on the right, isolated on white",
    "deutsch-jozsa": "One plain matte black cube centered on white, exactly two cobalt cables enter from the left and exactly two cobalt cables exit to the right, symmetric and isolated",
    "grover-search": "A flat five by five square grid of identical low cobalt glass tiles seen from above, exactly one center tile glowing amber and raised above all other tiles, isolated on white",
    "ghz-and-teleportation": "Exactly three identical translucent cobalt glass spheres in one horizontal line, exactly two thin luminous teal links connect neighboring spheres, one small amber pulse on the second link",
    "computing-paradigms": "A forked technical composition with a gate circuit path on the left and a smooth energy valley landscape on the right, both leading to one neutral result marker",
    "hardware-modalities": "Exactly four distinct abstract quantum chips in a clean two by two arrangement on white: linear silver rail, cobalt square chip, teal dot grid, curved glass waveguide",
    "compilation-and-qpu-fit": "An abstract circuit grid on the left being mapped through arrows onto a sparse connected quantum chip topology on the right, several routing steps visible",
    "benchmarks-and-claims": "Exactly six plain cylinders ascending from short to tall across a white surface, first four solid cobalt, fifth and sixth translucent pale blue, one separate small amber sphere beside them",
}


def sync_curriculum_provenance() -> None:
    curriculum_path = ROOT / "public" / "data" / "quantum_curriculum.json"
    payload = json.loads(curriculum_path.read_text(encoding="utf-8"))
    model = os.getenv("COMFYUI_CHECKPOINT", DEFAULT_MODEL)
    for course in payload["courses"]:
        for lesson in course["lessons"]:
            lesson_id = lesson["id"]
            lesson["visual"]["image"] = f"/assets/course/lessons/{lesson_id}.png"
            lesson["visual"]["provenance"] = {
                "kind": "AI-generated",
                "model": model,
                "prompt": LESSON_PROMPTS[lesson_id],
            }
    curriculum_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate saved course and lesson visuals through local ComfyUI.")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--course", choices=sorted(COURSE_PROMPTS))
    parser.add_argument("--lesson", choices=["all", *sorted(LESSON_PROMPTS)])
    args = parser.parse_args()
    COURSE_DESTINATION.mkdir(parents=True, exist_ok=True)
    LESSON_DESTINATION.mkdir(parents=True, exist_ok=True)
    for index, (course, prompt) in enumerate(COURSE_PROMPTS.items(), start=1):
        if args.lesson:
            continue
        if args.course and course != args.course:
            continue
        target = COURSE_DESTINATION / f"{course}.png"
        if target.is_file() and not args.force:
            print(f"[{index}/4] keep {target}")
            continue
        print(f"[{index}/4] generate {course}")
        result = generate_lesson_image(ImageGenerationRequest(prompt=prompt, seed=20260720 + index))
        source = ROOT / "public" / result["image_url"].removeprefix("/")
        if not result["quality"]["passed"]:
            raise RuntimeError(f"generated image failed automated checks: {result['quality']['warnings']}")
        shutil.copy2(source, target)
        print(f"saved {target}")
    for index, (lesson, prompt) in enumerate(LESSON_PROMPTS.items(), start=1):
        if args.course:
            continue
        if args.lesson and args.lesson != "all" and lesson != args.lesson:
            continue
        target = LESSON_DESTINATION / f"{lesson}.png"
        if target.is_file() and not args.force:
            print(f"[{index}/16] keep {target}")
            continue
        print(f"[{index}/16] generate {lesson}")
        result = generate_lesson_image(ImageGenerationRequest(prompt=prompt, seed=20260800 + index))
        source = ROOT / "public" / result["image_url"].removeprefix("/")
        if not result["quality"]["passed"]:
            raise RuntimeError(f"generated image failed automated checks: {result['quality']['warnings']}")
        shutil.copy2(source, target)
        print(f"saved {target}")
    sync_curriculum_provenance()
    print("Updated curriculum image paths and provenance.")
    print(f"Temporary API outputs remain in {GENERATED_DIR} for manual comparison.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
