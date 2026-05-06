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


def pcm_quality_metrics(pcm: bytes, *, frame_ms: int = 20) -> dict[str, float]:
    """
    Lightweight VAD-style metrics for an enrollment recording. Splits the
    PCM into ~20ms frames, computes RMS per frame, and reports:
      - total_seconds:    overall duration
      - speech_seconds:   estimated active speech (RMS above silence floor)
      - speech_ratio:     speech_seconds / total_seconds
      - mean_speech_rms:  loudness of the speech portion (0..1)

    Used to gate enrollment uploads — too short / too quiet / too silent
    enrollments produce poor voiceprints, which is the dominant reason for
    later identify accuracy drops.

    Returns floats instead of raising — the caller can decide what to do
    with each metric.
    """
    import struct

    total_samples = len(pcm) // SAMPLE_WIDTH
    if total_samples == 0:
        return {"total_seconds": 0.0, "speech_seconds": 0.0,
                "speech_ratio": 0.0, "mean_speech_rms": 0.0}

    frame_samples = max(1, SAMPLE_RATE * frame_ms // 1000)
    # Conservative silence floor: pyannoteAI's own VAD treats RMS below ~0.005
    # of full scale as silence. Int16 full scale is 32768.
    silence_rms_int16 = 0.005 * 32768

    speech_frames = 0
    total_frames = 0
    speech_rms_sum = 0.0

    for i in range(0, total_samples, frame_samples):
        chunk = pcm[i * SAMPLE_WIDTH : (i + frame_samples) * SAMPLE_WIDTH]
        if len(chunk) < SAMPLE_WIDTH * 4:
            continue
        samples = struct.unpack(f"<{len(chunk) // SAMPLE_WIDTH}h", chunk)
        sumsq = 0.0
        for s in samples:
            sumsq += s * s
        rms = (sumsq / len(samples)) ** 0.5
        total_frames += 1
        if rms > silence_rms_int16:
            speech_frames += 1
            speech_rms_sum += rms

    total_seconds = total_samples / SAMPLE_RATE
    if total_frames == 0:
        return {"total_seconds": total_seconds, "speech_seconds": 0.0,
                "speech_ratio": 0.0, "mean_speech_rms": 0.0}

    speech_seconds = speech_frames * (frame_samples / SAMPLE_RATE)
    speech_ratio = speech_frames / total_frames
    mean_speech_rms = (speech_rms_sum / max(1, speech_frames)) / 32768.0
    return {
        "total_seconds": total_seconds,
        "speech_seconds": speech_seconds,
        "speech_ratio": speech_ratio,
        "mean_speech_rms": mean_speech_rms,
    }
