# Dependencias distribuidas

- PDF.js / pdfjs-dist **6.3.289**: distribución `legacy/build` minificada, CMaps, standard_fonts y WASM. Fuente: https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-6.3.289.tgz. Licencia Apache-2.0 en `pdfjs/LICENSE`; los directorios de recursos conservan sus licencias.
- pdf-lib **1.17.1**: `dist/pdf-lib.min.js`, licencia MIT en `pdf-lib/LICENSE.md`.

No se modifican los archivos de terceros. `compat.js` añade las APIs de Promise y ReadableStream necesarias en navegadores anteriores. `pdf-worker.js` aplica la misma compatibilidad en el worker.
