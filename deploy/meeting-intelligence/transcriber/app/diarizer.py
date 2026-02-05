"""
Speaker Diarization using resemblyzer.

Identifies who spoke when in the audio.
"""

import os
from dataclasses import dataclass
from typing import List, Optional, Tuple

import numpy as np
import soundfile as sf
from resemblyzer import VoiceEncoder, preprocess_wav
from sklearn.cluster import AgglomerativeClustering

import structlog

log = structlog.get_logger()


@dataclass
class SpeakerSegment:
    """A segment attributed to a speaker."""
    start: float
    end: float
    speaker_id: str
    speaker_label: str  # e.g., "Speaker 1"
    confidence: Optional[float] = None


class SpeakerDiarizer:
    """Speaker diarization using voice embeddings."""

    def __init__(
        self,
        min_segment_duration: float = 0.5,
        max_speakers: int = 10,
        embedding_step: float = 0.5  # Step size for embeddings in seconds
    ):
        self.min_segment_duration = min_segment_duration
        self.max_speakers = max_speakers
        self.embedding_step = embedding_step

        # Load voice encoder (this downloads the model on first use)
        log.info("Loading voice encoder model...")
        self.encoder = VoiceEncoder()
        log.info("Voice encoder loaded")

    def diarize(
        self,
        audio_path: str,
        num_speakers: Optional[int] = None,
        transcript_segments: Optional[List[dict]] = None
    ) -> List[SpeakerSegment]:
        """
        Perform speaker diarization on an audio file.

        Args:
            audio_path: Path to audio file (WAV, 16kHz mono)
            num_speakers: Number of speakers (if known), otherwise auto-detected
            transcript_segments: Optional transcript segments to align with

        Returns:
            List of SpeakerSegment with speaker attributions
        """
        if not os.path.exists(audio_path):
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        log.info("Starting speaker diarization", audio_path=audio_path)

        # Load and preprocess audio
        wav, sample_rate = sf.read(audio_path)

        if sample_rate != 16000:
            log.warning(f"Audio sample rate is {sample_rate}, expected 16000")

        # Ensure mono
        if len(wav.shape) > 1:
            wav = wav.mean(axis=1)

        # Preprocess for resemblyzer
        wav = preprocess_wav(wav)

        if len(wav) == 0:
            log.warning("Audio file is empty after preprocessing")
            return []

        # Generate embeddings for sliding windows
        embeddings, timestamps = self._generate_embeddings(wav, sample_rate)

        if len(embeddings) == 0:
            log.warning("No embeddings generated")
            return []

        # Cluster embeddings to identify speakers
        speaker_labels = self._cluster_speakers(
            embeddings,
            num_speakers=num_speakers
        )

        # Convert to speaker segments
        segments = self._create_segments(timestamps, speaker_labels)

        # If transcript segments provided, align them
        if transcript_segments:
            segments = self._align_with_transcript(segments, transcript_segments)

        log.info(
            "Diarization complete",
            num_segments=len(segments),
            num_speakers=len(set(s.speaker_id for s in segments))
        )

        return segments

    def _generate_embeddings(
        self,
        wav: np.ndarray,
        sample_rate: int
    ) -> Tuple[np.ndarray, List[float]]:
        """Generate voice embeddings for sliding windows."""
        embeddings = []
        timestamps = []

        # Window size in samples (1.5 seconds for good speaker representation)
        window_size = int(1.5 * sample_rate)
        step_size = int(self.embedding_step * sample_rate)

        # Slide through audio
        for start_sample in range(0, len(wav) - window_size, step_size):
            end_sample = start_sample + window_size
            window = wav[start_sample:end_sample]

            # Get embedding for this window
            try:
                embedding = self.encoder.embed_utterance(window)
                embeddings.append(embedding)
                timestamps.append(start_sample / sample_rate)
            except Exception as e:
                log.debug(f"Failed to embed window at {start_sample/sample_rate}s: {e}")
                continue

        return np.array(embeddings), timestamps

    def _cluster_speakers(
        self,
        embeddings: np.ndarray,
        num_speakers: Optional[int] = None
    ) -> np.ndarray:
        """Cluster embeddings to identify speakers."""
        if len(embeddings) == 0:
            return np.array([])

        # If number of speakers not specified, estimate it
        if num_speakers is None:
            num_speakers = self._estimate_num_speakers(embeddings)

        # Ensure we don't exceed max speakers or embedding count
        num_speakers = min(num_speakers, self.max_speakers, len(embeddings))
        num_speakers = max(num_speakers, 1)

        log.info(f"Clustering with {num_speakers} speakers")

        # Use agglomerative clustering
        clustering = AgglomerativeClustering(
            n_clusters=num_speakers,
            metric="cosine",
            linkage="average"
        )

        labels = clustering.fit_predict(embeddings)

        return labels

    def _estimate_num_speakers(self, embeddings: np.ndarray) -> int:
        """Estimate the number of speakers from embeddings."""
        if len(embeddings) < 2:
            return 1

        # Try different numbers of clusters and find the best
        best_score = -1
        best_n = 2

        for n in range(2, min(6, len(embeddings))):
            try:
                clustering = AgglomerativeClustering(
                    n_clusters=n,
                    metric="cosine",
                    linkage="average"
                )
                labels = clustering.fit_predict(embeddings)

                # Calculate silhouette-like score
                score = self._cluster_quality_score(embeddings, labels)

                if score > best_score:
                    best_score = score
                    best_n = n
            except Exception:
                continue

        log.info(f"Estimated {best_n} speakers (score: {best_score:.3f})")
        return best_n

    def _cluster_quality_score(
        self,
        embeddings: np.ndarray,
        labels: np.ndarray
    ) -> float:
        """Calculate a simple cluster quality score."""
        unique_labels = np.unique(labels)

        if len(unique_labels) < 2:
            return 0.0

        # Calculate average intra-cluster distance
        intra_distances = []
        for label in unique_labels:
            cluster_embeddings = embeddings[labels == label]
            if len(cluster_embeddings) > 1:
                # Cosine distance within cluster
                for i in range(len(cluster_embeddings)):
                    for j in range(i + 1, len(cluster_embeddings)):
                        dist = 1 - np.dot(cluster_embeddings[i], cluster_embeddings[j])
                        intra_distances.append(dist)

        if not intra_distances:
            return 0.0

        avg_intra = np.mean(intra_distances)

        # Calculate average inter-cluster distance
        inter_distances = []
        cluster_centers = []
        for label in unique_labels:
            cluster_embeddings = embeddings[labels == label]
            center = cluster_embeddings.mean(axis=0)
            cluster_centers.append(center)

        for i in range(len(cluster_centers)):
            for j in range(i + 1, len(cluster_centers)):
                dist = 1 - np.dot(cluster_centers[i], cluster_centers[j])
                inter_distances.append(dist)

        avg_inter = np.mean(inter_distances) if inter_distances else 1.0

        # Score: higher inter-cluster distance, lower intra-cluster distance is better
        return (avg_inter - avg_intra) / max(avg_inter, avg_intra, 0.001)

    def _create_segments(
        self,
        timestamps: List[float],
        labels: np.ndarray
    ) -> List[SpeakerSegment]:
        """Convert clustered timestamps to speaker segments."""
        if len(timestamps) == 0:
            return []

        segments = []
        current_speaker = labels[0]
        segment_start = timestamps[0]

        for i in range(1, len(timestamps)):
            if labels[i] != current_speaker:
                # End current segment
                segment_end = timestamps[i]

                if segment_end - segment_start >= self.min_segment_duration:
                    segments.append(SpeakerSegment(
                        start=segment_start,
                        end=segment_end,
                        speaker_id=f"speaker_{current_speaker}",
                        speaker_label=f"Speaker {current_speaker + 1}"
                    ))

                # Start new segment
                current_speaker = labels[i]
                segment_start = timestamps[i]

        # Add final segment
        if len(timestamps) > 0:
            segment_end = timestamps[-1] + self.embedding_step
            if segment_end - segment_start >= self.min_segment_duration:
                segments.append(SpeakerSegment(
                    start=segment_start,
                    end=segment_end,
                    speaker_id=f"speaker_{current_speaker}",
                    speaker_label=f"Speaker {current_speaker + 1}"
                ))

        return segments

    def _align_with_transcript(
        self,
        speaker_segments: List[SpeakerSegment],
        transcript_segments: List[dict]
    ) -> List[SpeakerSegment]:
        """Align speaker segments with transcript segments."""
        aligned = []

        for trans in transcript_segments:
            trans_start = trans.get("start", 0)
            trans_end = trans.get("end", 0)
            trans_mid = (trans_start + trans_end) / 2

            # Find the speaker segment that best overlaps
            best_speaker = None
            best_overlap = 0

            for speaker in speaker_segments:
                # Calculate overlap
                overlap_start = max(trans_start, speaker.start)
                overlap_end = min(trans_end, speaker.end)
                overlap = max(0, overlap_end - overlap_start)

                if overlap > best_overlap:
                    best_overlap = overlap
                    best_speaker = speaker

            if best_speaker:
                aligned.append(SpeakerSegment(
                    start=trans_start,
                    end=trans_end,
                    speaker_id=best_speaker.speaker_id,
                    speaker_label=best_speaker.speaker_label,
                    confidence=best_overlap / (trans_end - trans_start) if trans_end > trans_start else 0
                ))
            else:
                # No match, assign unknown speaker
                aligned.append(SpeakerSegment(
                    start=trans_start,
                    end=trans_end,
                    speaker_id="speaker_unknown",
                    speaker_label="Unknown Speaker",
                    confidence=0
                ))

        return aligned
