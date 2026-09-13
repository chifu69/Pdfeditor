# Verificación — 2026-09-13

## Resultado

- **7 pruebas unitarias aprobadas** (`node --test tests/unit.test.mjs`).
- **19 comprobaciones de navegador aprobadas** (`node tests/e2e.mjs`).
- Sintaxis de `app.js` y `sw.js` correcta; `git diff --check` sin errores.
- PDF exportado renderizado con Poppler y revisado visualmente: párrafo multilínea y reemplazo de texto girado, sin restos visibles del texto cubierto ni desbordamiento en esos ejemplos.

Entorno usado: macOS 14.2.1 arm64, Node 24.19.0, Playwright 1.62.1, Chrome 116.0.5845.187. Pantalla móvil de 390 × 844 con DPR 2 y eventos táctiles, y escritorio de 1280 × 900. Chrome 116 también ejercita los adaptadores de compatibilidad para APIs modernas.

## Cobertura del navegador

1. Apertura de `test-sample.pdf` y tres bloques separados en su primera página.
2. Edición táctil, reapertura y segunda revisión del mismo bloque; una única anotación persistida.
3. Undo/redo entre revisiones y protección del historial del documento mientras se usa undo en un textarea.
4. Alternancia Seleccionar/Editar texto sin perder el reemplazo.
5. Un gesto de arrastre táctil no abre el diálogo.
6. Exportación, lectura de la copia PDF y comprobación del texto nuevo.
7. Recarga y recuperación de documento, anotaciones e historial desde IndexedDB.
8. Recarga, recuperación, edición y exportación con el contexto del navegador offline; cero solicitudes a CDN.
9. PDF generado con tres líneas de párrafo y dos columnas: agrupación correcta.
10. Mismos saltos de línea y coordenadas de las líneas entre SVG y texto exportado (tolerancia 0,05 píxeles en la vista).
11. Rechazo de caracteres incompatibles antes de guardar.
12. Texto original girado 90°: reemplazo exportado con el mismo ángulo.
13. Edición de una página cuyo `/Rotate` ya es 90°.
14. Página vacía sin cuadros de texto; no requiere ni simula OCR.
15. Ausencia de errores JavaScript no controlados durante el recorrido móvil.
16. Fallo de TextLayer inducido: selección y edición mediante geometría PDF.
17. Rotación/duplicación de páginas: exportación conserva orden, rotación y anotaciones.
18. Undo estructural y cambios rápidos de zoom completan el render.
19. El área seleccionable del texto añadido contiene su centro visible y permite reeditarlo en una página girada.

## Regresiones comprobadas antes de corregir

- Las pruebas de párrafos y columnas fallaban porque cada línea era un bloque separado.
- El navegador encontraba `Iterator` ausente, `Promise.withResolvers` ausente y ReadableStream sin iteración asíncrona con la distribución anterior.
- La medición de TextLayer generaba cuadros superpuestos al depender de dimensiones CSS del visor no disponibles en el navegador.
- Abrir el editor en `pointerup` permitía que el clic táctil siguiente activase un botón del diálogo.
- La prueba de fragmentos ligeramente girados falló al agruparlos y perder su orientación.
- La prueba del texto añadido a una página girada falló porque su área seleccionable seguía siendo horizontal.

## Límites de esta verificación

Se intentó ejecutar la misma suite con WebKit de Playwright. El navegador terminó al arrancar con `Bus error: 10`, antes de cargar la aplicación. **No se afirma validación en Safari ni en un iPhone físico.** La apertura del teclado y la instalación desde Safari necesitan una comprobación en dispositivo real.

La suite no pretende cubrir todos los formatos PDF, fuentes incrustadas, cifrado, formularios, firmas digitales, PDF corruptos o límites de almacenamiento del dispositivo. No se añadió OCR ni eliminación del texto original.

## Repetir

Las instrucciones portables están en `README.md`. Para reutilizar las dependencias del entorno donde se verificó:

```sh
TEST_OUTPUT=/private/tmp/pdf-editor-qa \
PLAYWRIGHT_MODULE=/Users/papy/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright \
CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
/Users/papy/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node tests/e2e.mjs
```

La suite genera PDFs de prueba y capturas en `TEST_OUTPUT` (por defecto `test-results/`, ignorado por Git).
