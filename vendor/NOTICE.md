# Speech recognition assets

Sherpa-ONNX 1.12.28, from the official k2-fsa/sherpa-onnx release:
https://github.com/k2-fsa/sherpa-onnx/releases/tag/v1.12.28

Package: sherpa-onnx-wasm-simd-v1.12.28-zh-cantonese-en-asr-paraformer.tar.bz2

Upstream runtime source and license: https://github.com/k2-fsa/sherpa-onnx

Model: streaming Paraformer, Mandarin/Cantonese/English; original model information:
https://k2-fsa.github.io/sherpa/onnx/pretrained_models/online-paraformer/index.html

The packaged model filesystem is distributed as byte-identical 32 MiB parts under
`models/` so each file can be hosted by GitHub Pages without Git LFS. The model is
reconstructed and decoded on the user's device. Microphone audio is not uploaded.

The runtime and wrapper files are unmodified. `asr-assets.json` records each part's
size and SHA-256 digest. The source package can be imported with
`node scripts/import-sherpa.cjs <extracted-package-directory>`.
