# Video Unique Studio v2

## Changes
- Added hue shift, film grain, optional horizontal mirror, vignette and intensity presets.
- Randomized variations now affect additional visual parameters.
- Fixed audio speed/volume processing when using a text overlay.
- Stop button terminates active FFmpeg worker.
- Rejects videos longer than 65 seconds.
- Improved cleanup of object URLs and limited batch confirmation.

## Deployment
Upload the contents of this archive to the root of `hnsik/video-unique-studio` on the `main` branch and replace existing files. Vercel deploys automatically.

## Limitations
- SRT subtitles can be parsed but are not burned in.
- Large batch outputs are still held in browser RAM; process in smaller groups.
- Some codecs/formats may not work with FFmpeg.wasm.
- This is creative video variation, not a guarantee that platforms consider content original.
