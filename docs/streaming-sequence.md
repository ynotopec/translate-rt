# Real-time streaming sequence

This diagram captures the end-to-end flow when the browser records speech, sends audio chunks to the backend and renders the translated output while optionally requesting text-to-speech playback.

```mermaid
sequenceDiagram
    participant User as Speaker
    participant Browser as Browser UI
    participant API as FastAPI backend
    participant Whisper as Whisper STT
    participant GPT as Translation model
    participant TTS as TTS provider

    User->>Browser: Speak into microphone
    Browser->>Browser: Capture Opus chunk<br/>via MediaRecorder
    Browser->>API: POST /upload (chunk, metadata)
    API->>Whisper: Transcribe audio chunk
    Whisper-->>API: Transcript + timing
    API->>GPT: Request translations
    GPT-->>API: Translated text
    API-->>Browser: JSON (transcript + translations)
    Browser->>Browser: Render transcript & translation
    alt Text-to-speech enabled
        Browser->>API: POST /tts-proxy (text)
        API->>TTS: Forward TTS request
        TTS-->>API: Stream Opus audio
        API-->>Browser: Audio response stream
        Browser->>User: Playback translated audio
    end
```

Key takeaways:

* The browser batches microphone audio into discrete Opus chunks before sending them to the `/upload` endpoint.
* The backend fans out to the transcription, translation and optional diarisation services before responding.
* When TTS is enabled, the browser issues an additional request per translation and streams the generated audio back to the user.
