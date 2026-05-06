"""
Tiny audio helpers.

Browser sends raw 16kHz / mono / Int16 PCM (per STT 移植指南). pyannoteAI wants a
playable file (wav). We wrap the PCM in a WAV header — no resampling, no
re-encoding, fastest possible path.
"""

import struct
from io import BytesIO

SAMPLE_RATE = 16000
CHANNELS = 1
SAMPLE_WIDTH = 2  # 16-bit


def pcm_to_wav(pcm: bytes) -> bytes:
    """Wrap raw PCM bytes in a RIFF/WAVE header. Returns the .wav file bytes."""
    data_size = len(pcm)
    byte_rate = SAMPLE_RATE * CHANNELS * SAMPLE_WIDTH
    block_align = CHANNELS * SAMPLE_WIDTH

    buf = BytesIO()
    buf.write(b"RIFF")
    buf.write(struct.pack("<I", 36 + data_size))  # ChunkSize
    buf.write(b"WAVE")
    buf.write(b"fmt ")
    buf.write(struct.pack("<I", 16))   # Subchunk1Size (PCM = 16)
    buf.write(struct.pack("<H", 1))    # AudioFormat (PCM = 1)
    buf.write(struct.pack("<H", CHANNELS))
    buf.write(struct.pack("<I", SAMPLE_RATE))
    buf.write(struct.pack("<I", byte_rate))
    buf.write(struct.pack("<H", block_align))
    buf.write(struct.pack("<H", SAMPLE_WIDTH * 8))  # BitsPerSample
    buf.write(b"data")
    buf.write(struct.pack("<I", data_size))
    buf.write(pcm)
    return buf.getvalue()


def pcm_seconds(pcm: bytes) -> float:
    """Duration in seconds for a PCM byte buffer."""
    return len(pcm) / (SAMPLE_RATE * CHANNELS * SAMPLE_WIDTH)
