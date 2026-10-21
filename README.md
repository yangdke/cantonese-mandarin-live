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

## Mobile microphone recovery

Capture uses the device's native sample rate (usually 44.1 or 48 kHz), not a forced
16 kHz hardware format. The worker converts that input to the model's 16 kHz rate;
the AudioWorklet batches 80 ms regardless of the input rate. Old capture events
and pending permission failures cannot close a newer connection.

An unexpected track end can reconnect once in the foreground, preserving the
recognizer and speech queue. There is no repeated retry loop. Revoked permissions,
hidden pages, or a second disconnect stop capture and show a persistent message.
Audio during an actual device disconnect cannot be recovered. Temporary system
mute retains the input, and suspended/interrupted audio can be resumed using the
recovery button without reopening the microphone or downloading the model again.

The page distinguishes denied permission, unavailable/busy input, missing devices,
and `MIC_ENDED`. If an in-app browser does not support microphone capture, open the
same HTTPS address in an up-to-date system Chrome, Edge or Safari browser. Physical
phone/audio-route behavior still needs validation on the affected phone.

## Development checks

```
python -m http.server 4174 --bind 127.0.0.1
node --test tests/continuous-streaming.test.cjs
node scripts/verify-model.cjs <local-16kHz-mono-f32le-audio>
node scripts/verify-model.cjs <local-16kHz-mono-f32le-audio> --capture-rate=48000
```

`verify-model.cjs` executes the production worker with real model files and reports
timing and transcript lengths. Audio stays local. `--show-text` explicitly enables
transcript output; do not use that flag when logs should exclude private speech.

Model provenance, file hashes and license information are in `vendor/`.
