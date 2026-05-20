/**
 * ElevenLabs API helpers + shared constants.
 *
 * Server-only module. The TTS endpoint is called from `lib/gen/narration.ts`
 * (Task 15, Req 9) and the Music endpoint will be called from
 * `lib/gen/music.ts` (Task 16, Req 10). We hit the REST API directly with
 * `fetch` rather than an SDK to keep the dependency surface tight and the
 * build deterministic — neither `@elevenlabs/elevenlabs-js` nor the legacy
 * `elevenlabs` package is installed in this project.
 *
 * Output-format choice (Req 9.2 + 11.4):
 *   The design references "WAV" for narration but the downstream mix step
 *   re-encodes everything via libmp3lame anyway. We request mp3 at
 *   44100 Hz / 128 kbps from ElevenLabs because (a) it transports faster,
 *   (b) the constant bitrate makes a duration estimate from byte size
 *   reliable (`bytes / 16000 ≈ seconds`), and (c) it stays well under the
 *   final mp3's 128–192 kbps band so the mixer can re-encode without
 *   raising bitrate. We document this in `lib/gen/narration.ts` and store
 *   the file as `.mp3` in the storage path, not `.wav`.
 */

/** Base URL for ElevenLabs v1 REST API. */
export const ELEVENLABS_API_BASE = "https://api.elevenlabs.io/v1";

/**
 * Default text-to-speech model id. `eleven_multilingual_v2` covers English
 * comfortably for v1 (Req 2.7 fixes language to `en`) and produces the
 * warm, narration-style voice we want for a lullaby.
 */
export const ELEVENLABS_DEFAULT_TTS_MODEL_ID = "eleven_multilingual_v2";

/**
 * `output_format` query parameter. ElevenLabs supports several mp3
 * variants; `mp3_44100_128` is constant-bitrate 128 kbps at 44.1 kHz so
 * the byte-rate→duration estimate is accurate (≤2 % error in practice).
 */
export const ELEVENLABS_TTS_OUTPUT_FORMAT = "mp3_44100_128";

/** Constant bitrate of the requested output format, in kbps. */
export const ELEVENLABS_TTS_OUTPUT_BITRATE_KBPS = 128;

/** MIME content type returned by `output_format=mp3_*`. */
export const ELEVENLABS_TTS_OUTPUT_CONTENT_TYPE = "audio/mpeg";

/**
 * Music API endpoint path. Append to `ELEVENLABS_API_BASE` to call.
 * Reference: `.kiro/skills/music/references/api_reference.md` — `compose`.
 * Returns audio bytes directly (mp3 by default, controllable via the
 * `output_format` query parameter).
 */
export const ELEVENLABS_MUSIC_PATH = "/music";

/**
 * Default music model. `music_v1` is the production default per the
 * Music API reference — we set it explicitly so the request body is
 * pinned and behaviour doesn't drift if the upstream default changes.
 */
export const ELEVENLABS_DEFAULT_MUSIC_MODEL_ID = "music_v1";

/**
 * Output format for music compose requests. Same constant-bitrate mp3
 * choice as TTS so we can estimate duration from byte size with the
 * same byte-rate→seconds formula used in `lib/gen/narration.ts`.
 */
export const ELEVENLABS_MUSIC_OUTPUT_FORMAT = "mp3_44100_128";

/** Constant bitrate of the requested music output, in kbps. */
export const ELEVENLABS_MUSIC_OUTPUT_BITRATE_KBPS = 128;

/** MIME content type returned by `output_format=mp3_*` for the music endpoint. */
export const ELEVENLABS_MUSIC_OUTPUT_CONTENT_TYPE = "audio/mpeg";
