# Datos de "Sin Explicación"

Cada capítulo/episodio (002, 003, ...) tiene su propio par de archivos:
`captions-{id}.json` + `clips-{id}.json`, más una entrada en
`remotion/lib/episodes.ts` (narración, pools de video/imagen, chapterNumber).
`chapters.json` es aparte: alimenta la tarjeta `Chapter-{N}` (kicker + título +
año), no la narración larga.

## captions-{id}.json
Generado por transcripción real de `public/assets/audio/{narrationFile}` (Whisper local).
No editar los tiempos a mano salvo para corregir errores de transcripción.

```ts
{ start: number /* seg */, end: number /* seg */, text: string, type: "normal" | "hook" | "reveal",
  sfx?: { file: string, volume?: number, fadeInFrames?: number, fadeOutFrames?: number } }
```

- `type: "reveal"` dispara el efecto glitch/flash en vez del fade normal.
- `sfx.file` es un nombre de archivo dentro de `public/assets/audio/sfx/` — asignalo a mano
  en las líneas donde quieras un susto/sting/drone.

## clips-{id}.json
Vacío a propósito — estas son las marcas manuales de los mejores momentos, en frames
(30fps) del timeline de `MainDocumentary-{id}`. Cada entrada genera una composition
`Short-{id}-{i}`.

```ts
{ startFrame: number, endFrame: number, hookText: string, objectPosition?: string }
```

- `objectPosition` (opcional) controla el recorte a 9:16, ej. `"30% 50%"` para desplazar
  el encuadre hacia la izquierda del video original. Por defecto `"50% 50%"`.

## Agregar un capítulo nuevo
1. Copiar los assets a `public/assets/video/{id}/`, `public/assets/images/{id}/`,
   `public/assets/audio/narracion-{id}.mp3`.
2. Transcribir: `whisper <mp3> --model medium --language Spanish --output_format json`,
   luego `node scripts/build-captions.mjs <whisper.json> <id>`.
3. Agregar la entrada del episodio en `remotion/lib/episodes.ts` (pools de video/imagen
   medidos con ffprobe, `narrationDurationSeconds`, `reelOptions.imagesPerVideo` si hay
   pocos videos y hace falta apoyarse más en imágenes).
4. Crear `data/clips-{id}.json` (vacío hasta marcar los mejores momentos).
5. `npm run render:main -- {id}` y `npm run render:shorts -- {id}`.
