import importlib.util
import os
from pathlib import Path
import threading
import unittest
from unittest.mock import patch


os.environ.setdefault('AUDIO_API_KEY', 'test-audio-key')
os.environ.setdefault('OPENAI_API_KEY', 'test-openai-key')
os.environ.setdefault('OPENAI_API_BASE', 'https://openai.invalid/v1')

APP_PATH = Path(__file__).resolve().parents[1] / 'app.py'
SPEC = importlib.util.spec_from_file_location('translate_rt_api', APP_PATH)
api = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(api)


class ProcessAudioChunkTests(unittest.TestCase):
    def test_translation_starts_while_diarization_is_in_flight(self):
        diarization_started = threading.Event()
        release_diarization = threading.Event()
        translation_started = threading.Event()

        def diarize(*_args):
            diarization_started.set()
            self.assertTrue(release_diarization.wait(timeout=1))
            return {'identifier': 'speaker-1'}

        def translate(*_args):
            self.assertTrue(diarization_started.wait(timeout=1))
            translation_started.set()
            release_diarization.set()
            return {'translation_fr': 'Bonjour'}

        with (
            patch.object(api, 'call_diarization', side_effect=diarize),
            patch.object(api, 'call_whisper', return_value={'text': 'Hello world'}),
            patch.object(api, 'detect_language', return_value='en'),
            patch.object(api, 'build_translations', side_effect=translate),
        ):
            result = api.process_audio_chunk('audio.webm', 'audio/webm', b'audio', 'en', 'fr')

        self.assertTrue(translation_started.is_set())
        self.assertEqual(result['translation_fr'], 'Bonjour')
        self.assertEqual(result['diarization'], {'identifier': 'speaker-1'})

    def test_filtered_transcript_skips_translation_and_keeps_diarization(self):
        with (
            patch.object(api, 'call_diarization', return_value={'identifier': 'speaker-1'}),
            patch.object(api, 'call_whisper', return_value={'text': 'Thank you.'}),
            patch.object(api, 'build_translations') as translate,
        ):
            result = api.process_audio_chunk('audio.webm', 'audio/webm', b'audio', 'en', 'fr')

        translate.assert_not_called()
        self.assertEqual(
            result,
            {
                'transcription': '',
                'detected_lang': '',
                'diarization': {'identifier': 'speaker-1'},
            },
        )


if __name__ == '__main__':
    unittest.main()
