"""
Aliyun OSS thin wrapper for storing meeting recordings & voiceprint samples.

We hand pyannoteAI a *signed URL* to the object — pyannote pulls the audio,
runs its pipeline, and the URL expires shortly after. Bucket stays private.
"""

import io
import logging
from datetime import timedelta
from typing import Optional

import oss2

from .config import get_settings

logger = logging.getLogger(__name__)


class OSSClient:
    def __init__(self) -> None:
        self.settings = get_settings()
        if not (self.settings.oss_access_key_id and self.settings.oss_bucket):
            self._bucket = None
            return
        auth = oss2.Auth(
            self.settings.oss_access_key_id,
            self.settings.oss_access_key_secret,
        )
        self._bucket = oss2.Bucket(
            auth, self.settings.oss_endpoint, self.settings.oss_bucket
        )

    @property
    def configured(self) -> bool:
        return self._bucket is not None

    def put_bytes(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> str:
        assert self._bucket is not None, "OSS not configured"
        self._bucket.put_object(key, io.BytesIO(data), headers={"Content-Type": content_type})
        return key

    def signed_url(self, key: str, expires_seconds: int = 3600) -> str:
        """
        Return a temporary signed URL pyannoteAI can fetch from. Defaults to 1h —
        identification jobs typically finish in <10 min, but keep a buffer for
        retries.
        """
        assert self._bucket is not None, "OSS not configured"
        return self._bucket.sign_url(
            "GET", key, expires_seconds, slash_safe=True
        )

    def delete(self, key: str) -> None:
        if self._bucket is None:
            return
        try:
            self._bucket.delete_object(key)
        except Exception:
            logger.exception("OSS delete failed for %s", key)
