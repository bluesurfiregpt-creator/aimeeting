"""
pyannoteAI client.

Wraps three endpoints we care about (per blueprint §5.2):
- POST /v1/voiceprint        — pre-meeting enrollment (one persistent encoding)
- POST /v1/identify          — post-meeting "diarize + match against voiceprints"
- GET  /v1/jobs/{jobId}      — poll long-running jobs

The exact wire shape varies by pyannote.ai release; this module isolates that
churn so the rest of the app stays stable.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Any, Optional

import httpx

from .config import get_settings

logger = logging.getLogger(__name__)


class PyannoteError(RuntimeError):
    pass


@dataclass
class IdentifySegment:
    start_ms: int
    end_ms: int
    label: str          # voiceprint label (mapped back to a voiceprint_id by caller)
    confidence: float


class PyannoteClient:
    def __init__(self) -> None:
        s = get_settings()
        self._key = s.pyannote_api_key
        self._base = s.pyannote_base_url.rstrip("/")
        self._timeout = httpx.Timeout(30.0, connect=10.0)

    @property
    def configured(self) -> bool:
        return bool(self._key)

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._key}"}

    async def _post(self, path: str, json: dict[str, Any]) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=self._timeout) as c:
            r = await c.post(f"{self._base}{path}", headers=self._headers(), json=json)
            if r.status_code >= 400:
                raise PyannoteError(f"POST {path} {r.status_code}: {r.text[:300]}")
            return r.json()

    async def _get(self, path: str) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=self._timeout) as c:
            r = await c.get(f"{self._base}{path}", headers=self._headers())
            if r.status_code >= 400:
                raise PyannoteError(f"GET {path} {r.status_code}: {r.text[:300]}")
            return r.json()

    # ---- Voiceprint enrollment ----------------------------------------------

    async def create_voiceprint(self, audio_url: str) -> dict[str, Any]:
        """
        Create a persistent voiceprint from a single-speaker recording (≥ 30s).

        pyannoteAI is async here: POST returns {"jobId": ...}; the actual
        voiceprint payload arrives in GET /v1/jobs/{jobId} once status flips
        to succeeded. We poll inline so callers see the final shape.

        We also handle the (less common) sync response shape, in case the
        API ever returns voiceprint data directly — the call site reads
        `voiceprint`/`voiceprintId`/`id` from whatever we hand back.
        """
        submit = await self._post("/v1/voiceprint", {"url": audio_url})

        job_id = submit.get("jobId")
        if not job_id:
            # Sync response (rare but possible) — pass through as-is.
            return submit

        job = await self.wait_for_job(str(job_id), max_wait_s=120, poll_every_s=3.0)
        output = job.get("output") or {}
        # Normalize: surface the voiceprint payload at the top level so the
        # caller's extraction logic stays the same as for a sync response.
        return {"jobId": str(job_id), **output}

    # ---- Diarize + identify (post-meeting) ----------------------------------

    async def submit_identify(
        self,
        audio_url: str,
        voiceprints: list[dict[str, Any]],
        *,
        num_speakers: Optional[int] = None,
        min_speakers: Optional[int] = None,
        max_speakers: Optional[int] = None,
        threshold: float = 0.5,
        exclusive: bool = True,
        model: str = "precision-2",
    ) -> str:
        """
        Submit a long-running identify job. Returns jobId.

        Defaults to `precision-2` which is markedly more accurate than the
        baseline model (paid tier on pyannoteAI). minSpeakers / maxSpeakers
        are precision-2-only — we pass them when the caller provided either,
        falling back to numSpeakers for the legacy model.
        """
        body: dict[str, Any] = {
            "url": audio_url,
            "voiceprints": voiceprints,
            "matching": {"threshold": threshold},
            "exclusive": exclusive,
            "model": model,
        }
        if model == "precision-2":
            if num_speakers is not None:
                body["numSpeakers"] = num_speakers
            else:
                if min_speakers is not None:
                    body["minSpeakers"] = min_speakers
                if max_speakers is not None:
                    body["maxSpeakers"] = max_speakers
        else:
            if num_speakers is not None:
                body["numSpeakers"] = num_speakers

        resp = await self._post("/v1/identify", body)
        job_id = resp.get("jobId") or resp.get("id")
        if not job_id:
            raise PyannoteError(f"identify response missing jobId: {resp}")
        return str(job_id)

    async def get_job(self, job_id: str) -> dict[str, Any]:
        return await self._get(f"/v1/jobs/{job_id}")

    async def wait_for_job(self, job_id: str, *, max_wait_s: float = 600, poll_every_s: float = 4.0) -> dict[str, Any]:
        """
        Poll until status ∈ {succeeded, failed, canceled} or timeout.
        """
        elapsed = 0.0
        while elapsed < max_wait_s:
            data = await self.get_job(job_id)
            status = (data.get("status") or "").lower()
            if status in {"succeeded", "completed", "done"}:
                return data
            if status in {"failed", "canceled", "cancelled", "error"}:
                raise PyannoteError(f"job {job_id} ended in status={status}: {data}")
            await asyncio.sleep(poll_every_s)
            elapsed += poll_every_s
        raise PyannoteError(f"job {job_id} did not complete within {max_wait_s}s")

    # ---- Result parsing helpers --------------------------------------------

    @staticmethod
    def parse_identify_segments(job_result: dict[str, Any]) -> list[IdentifySegment]:
        """
        Normalize pyannote's identification array.

        Real pyannote v1 shape (observed 2026-05):
            {"speaker": <label>, "start": 0.645, "end": 2.585,
             "diarizationSpeaker": "SPEAKER_01", "match": <label or null>}

        - `match` holds the voiceprint label pyannote matched to (already
          filtered by `matching.threshold` we sent on submit). If `match`
          is present we trust it with confidence 1.0.
        - If `match` is missing/null, pyannote couldn't pin it to one of our
          voiceprints — we leave it as UNKNOWN so the alignment step doesn't
          claim a speaker that wasn't really matched.

        We also keep the older fallbacks (label/identity/confidence/score)
        in case the API rev's again.
        """
        out: list[IdentifySegment] = []
        candidates = (
            job_result.get("output", {}).get("identification")
            or job_result.get("output", {}).get("segments")
            or job_result.get("identification")
            or job_result.get("segments")
            or []
        )
        for seg in candidates:
            start = seg.get("start") if "start" in seg else seg.get("startTime")
            end = seg.get("end") if "end" in seg else seg.get("endTime")
            if start is None or end is None:
                continue
            match = seg.get("match")
            if match:
                label = str(match)
                confidence = 1.0
            else:
                speaker = (
                    seg.get("speaker")
                    or seg.get("label")
                    or seg.get("identity")
                )
                label = str(speaker) if speaker else "UNKNOWN"
                confidence = float(
                    seg.get("confidence", seg.get("score", 0.0)) or 0.0
                )
            # pyannote returns seconds (floats) per their spec.
            if isinstance(start, float) or (isinstance(start, int) and end < 1_000_000):
                start_ms = int(round(float(start) * 1000))
                end_ms = int(round(float(end) * 1000))
            else:
                start_ms = int(start)
                end_ms = int(end)
            out.append(IdentifySegment(start_ms, end_ms, label, confidence))
        return out
