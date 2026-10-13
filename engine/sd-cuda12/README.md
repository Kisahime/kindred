# Image engine (optional)

Kindred generates pictures with [stable-diffusion.cpp](https://github.com/leejet/stable-diffusion.cpp).

1. Download a Windows release zip from https://github.com/leejet/stable-diffusion.cpp/releases
   (the `cuda12` build for NVIDIA GPUs, otherwise the `vulkan` or `avx2` CPU build).
2. Unzip it so that `sd-cli.exe` sits in **`%APPDATA%\com.kisahime.kindred\engine\sd-cuda12\`**,
   or anywhere you like and set the path in **Image Studio → Engine**.
3. In Image Studio, add the folder that holds your models (`.safetensors` / `.gguf`).

The app runs fine without it; image features just stay disabled.
