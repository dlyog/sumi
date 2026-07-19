# Local media authoring

1StopQuantum commits production lesson media under `public/`. Kokoro and ComfyUI
are optional authoring services; students do not need either service to run the
app or hear the bundled lessons.

## Curriculum source

`public/data/quantum_curriculum.json` is the versioned source of truth. Each lesson
owns its title, objectives, sections, narration, visual metadata, audio path, and
mapping to an interactive lab. The same file contains a purpose and how-to guide
for every primary workspace. `public/data/podcast_catalog.json` owns long-form
episode transcripts, chapters, audio paths, durations, and provenance.

## Narration

The local authoring API defaults to `http://127.0.0.1:5152`. Set
`KOKORO_API_URL` only when the local voice service uses a different host or port.
With local Kokoro running, use:

```bash
make course-audio
.venv/bin/python scripts/generate_course_audio.py --lesson interference --force
.venv/bin/python scripts/generate_course_audio.py --episode classical-to-quantum --force
```

The generator posts to `/api/speak`, validates each WAV with the
standard library, and records duration, byte count, voice, and a source hash in
`public/audio/audio_manifest.json`. Unchanged narration is validated and skipped.
Long text is split at sentence boundaries, synthesized in bounded chunks, checked
for compatible PCM parameters, and concatenated with short pauses. This prevents
silent endpoint truncation while preserving one reviewed source transcript.

## Course images

Set `COMFYUI_URL` and `COMFYUI_CHECKPOINT`, then run:

```bash
make course-images
.venv/bin/python scripts/generate_course_images.py --lesson interference --force
.venv/bin/python scripts/generate_course_images.py --lesson all --force
```

The script uses a fixed graph: checkpoint loader, positive and negative text
encoders, latent image, sampler, VAE decode, and save node. Its prompts and seeds
are versioned for all 16 lessons. It also records each accepted asset's prompt,
model, and AI-generated status in the curriculum JSON.

This is a maintainer-only authoring path. Learners cannot generate images or
audio from the application, and production pages make no request to Kokoro or
ComfyUI. The older fixed-workflow API remains only as a compatibility surface for
automated tests and internal tooling; do not expose it as a product feature.

Automated checks reject corrupt, wrong-sized, and near-blank images. A person must
still review subject fidelity, unwanted symbols, accessibility, and lesson fit.
Reject pseudo-text and visuals that imply a false physical model. Temporary API
results live under ignored `public/generated/`; accepted per-lesson assets live
under `public/assets/course/lessons/`.
