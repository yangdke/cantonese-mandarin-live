# 港言港语

Live site: https://yangdke.github.io/cantonese-mandarin-live/

## Continuous speech

The microphone is opened once per listening session with `getUserMedia`. An
AudioWorklet sends every audio block to a dedicated worker. The worker runs
Sherpa-ONNX streaming Paraformer locally, supporting Cantonese, Mandarin and
English. `SpeechRecognition`/`webkitSpeechRecognition` are not used.

Recognition runs independently of the speech synthesis queue. Playing, stopping
or queueing translated speech does not disconnect the microphone. Silent periods
reset the model's utterance state without reopening the device. Interim hypotheses
replace the current segment rather than being appended. Stable initial text can
start speech after 11 characters; following speech follows utterance boundaries.
Short finalized utterances are also read without waiting for 11 characters.

The first preparation downloads approximately 250 MB. Cache Storage is used when
available. If device storage prevents caching, that session can still run but the
files may need to be downloaded again. Preparation finishes before the page opens
the microphone, so users should wait for the listening status before speaking.

No API key, paid recognition service or voice upload is required. Translation
continues to use the existing phrase mappings and OpenCC; the speech engine change
does not turn the phrase mappings into a general semantic translation model.

Use headphones to prevent speaker playback from reaching the microphone. Echo
cancellation is requested but its effectiveness depends on the device. Keep the
page in the foreground: mobile operating systems may suspend background audio.
Model inference also depends on the phone's available memory and processing speed.

## Development checks

```
python -m http.server 4174 --bind 127.0.0.1
node --test tests/continuous-streaming.test.cjs
node scripts/verify-model.cjs <local-16kHz-mono-f32le-audio>
```

`verify-model.cjs` executes the production worker with real model files and reports
timing and transcript lengths. Audio stays local. `--show-text` explicitly enables
transcript output; do not use that flag when logs should exclude private speech.

Model provenance, file hashes and license information are in `vendor/`.
