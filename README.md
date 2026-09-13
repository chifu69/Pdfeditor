# PDF Editor PWA 1.5.0

Editor local de PDF para navegador, instalable y utilizable sin conexión después de completar la primera carga. No envía los documentos a un servidor.

## Ejecutar

Sirve **esta carpeta completa**, incluido `vendor/`, por HTTP/HTTPS:

```sh
python3 -m http.server 8080
```

Abre `http://localhost:8080`. Para usarlo desde un iPhone, publica la carpeta en un hosting HTTPS y abre la URL en Safari. En Compartir, elige **Añadir a pantalla de inicio**. `file://` no admite módulos ni service workers.

## Editar texto

1. Abre un PDF con texto seleccionable.
2. Pulsa **Editar texto**. Los cuadros representan líneas o párrafos detectados; las columnas separadas conservan sus propios cuadros.
3. Toca un cuadro, cambia su texto, tamaño, fuente o color y pulsa **Aplicar**.
4. Toca de nuevo el mismo bloque para modificar el reemplazo actual. No se añaden reemplazos duplicados.
5. Usa **Deshacer/Rehacer** para revertir revisiones. Ambos botones están disponibles en móvil. Dentro de un campo, Ctrl/Cmd+Z conserva el undo nativo del campo.
6. Pulsa **Exportar PDF** para obtener una copia con los cambios.

El texto se distribuye en líneas y reduce su tamaño si hace falta para caber. La vista previa y la exportación comparten las mismas métricas, saltos y posiciones. Un texto que no cabe ni a 4 pt, o contiene caracteres no admitidos por la fuente, muestra un error antes de aplicarlo.

Seleccionar y Editar texto permiten desplazar la página con el dedo. Borrar, Cubrir negro, Resaltar y Dibujar capturan el gesto para crear la anotación. El recuadro de selección no bloquea la reedición.

## Guardado local y offline

- IndexedDB conserva el último documento abierto, sus anotaciones, las páginas y hasta 60 pasos de historial. El indicador **Guardado en este dispositivo** confirma la escritura.
- Tras recargar, pulsa **Recuperar trabajo**. **Borrar copia guardada** elimina esa copia local. Abrir otro documento sustituye la copia anterior.
- El navegador puede borrar su almacenamiento; exporta los documentos que quieras conservar permanentemente. Si se agota el espacio, el indicador lo comunica.
- Los PDF cifrados pueden visualizarse, pero no se guardan para recuperación ni se exportan editados.
- PDF.js, pdf-lib, worker, CMaps, fuentes estándar y WASM están incluidos en `vendor/`. La instalación offline solo se completa cuando todos los recursos están almacenados.
- Una actualización espera a que pulses **Actualizar**; se guarda el trabajo antes de activarla y recargar. La caché utiliza una huella del contenido para distinguir builds.

Después de cualquier cambio en archivos de la aplicación, actualiza el inventario offline:

```sh
node scripts/update-offline.mjs
```

Publica todos los archivos juntos. No se necesita backend, bundler ni CDN en tiempo de ejecución.

## Límites del motor

- La edición es **visual**: cubre el texto original con blanco y dibuja el nuevo. El texto original permanece en el PDF y puede aparecer al buscar/copiar. Cubrir negro no es redacción segura.
- No incluye OCR: texto escaneado, imágenes y letras convertidas en curvas no se detectan como texto editable.
- El editor utiliza Helvetica, Times o Courier. No reconstruye fuentes incrustadas, estilos mixtos ni todos los alfabetos Unicode. Valida los caracteres antes de exportar.
- La agrupación de párrafos es geométrica y conservadora. Tablas complejas, texto vertical y diseños con fuentes mezcladas pueden quedar divididos en varios cuadros. Los fragmentos girados se pueden editar individualmente.
- El reemplazo usa fondo blanco; documentos con fondos ilustrados o coloreados necesitan otra estrategia de edición.
- La edición se realiza en un diálogo; no es un editor de contenido PDF equivalente a Acrobat ni un procesador de texto.

## Archivos principales

- `app.js`: apertura, render cancelable, TextLayer canónica, selección, edición, anotaciones, historial y exportación.
- `text-blocks.js`: fragmentos → líneas → párrafos, manteniendo columnas separadas.
- `text-layout.js`: composición en puntos PDF compartida por SVG y exportación.
- `storage.js`: transacciones IndexedDB.
- `compat.js`, `pdf-worker.js`: compatibilidad de navegador y arranque del worker.
- `sw.js`, `offline-assets.js`, `manifest.webmanifest`: instalación y caché offline.
- `vendor/`: PDF.js 6.3.289 (legacy), pdf-lib 1.17.1 y sus licencias.

## Pruebas

Node.js 20 o superior para las pruebas; la aplicación no requiere Node en producción.

```sh
npm install
npx playwright install chromium
npm test
# Con el servidor en localhost:8080:
npm run test:e2e
```

Para probar WebKit en un sistema compatible:

```sh
npx playwright install webkit
TEST_BROWSER=webkit npm run test:e2e
```

`TEST_URL` cambia la URL del servidor; `TEST_OUTPUT` cambia la carpeta de PDF/capturas. `CHROME_PATH` permite usar un Chrome instalado. `PLAYWRIGHT_MODULE` permite usar una instalación de Playwright existente.

La suite prueba PDF real, párrafos, columnas, toques, reedición, undo/redo, exportación y coordenadas, rotación, páginas vacías, recuperación, offline, fallback geométrico y cambios estructurales. Resultados y limitaciones de la verificación en `docs/verification.md`.
