# 1StopQuantum Podcast API

The podcast is pre-generated and read-only. Learners never invoke Kokoro.

```text
GET /api/v1/podcast/catalog
GET /api/v1/podcast/episodes/{episode_id}/transcript
GET /api/v1/podcast/feed.xml
```

The catalog returns schema version, publisher, language, generation provenance,
episode ID/title/summary, date, duration, bytes, audio URL, transcript URL, and
chapters. RSS contains one WAV enclosure per episode. The PWA caches all episode
audio for offline listening after installation.

```bash
curl http://localhost:8000/api/v1/podcast/catalog
curl http://localhost:8000/api/v1/podcast/feed.xml
```

Third-party clients should use episode IDs as stable identifiers, preserve
1StopQuantum and source attribution, cache by schema version, and display the
educational and independent-verification boundary. Breaking changes use a new API
namespace instead of silently changing `/api/v1`.

Maintainers regenerate media with:

```bash
KOKORO_API_URL=http://127.0.0.1:5152 .venv/bin/python scripts/generate_course_audio.py
```

Long transcripts are split at sentence boundaries, synthesized in bounded chunks,
concatenated as compatible PCM WAV, validated, and written with duration, byte
size, transcript hash, voice, and speed provenance.
