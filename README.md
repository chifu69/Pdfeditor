# PDF Editor PWA 1.7.1

Editor PDF local, privado y preparado para funcionar completamente offline después de instalar/cargar todos sus recursos. El PDF se procesa en el dispositivo; no hay CDN ni backend de ejecución.

## Esta versión

- **Más espacio en iPhone**: el logo PDF se oculta en móvil y el botón `⋯` de controles ocupa esa esquina.
- **Zoom/Página abajo**: la barra de navegación, zoom, Ajustar y Página queda debajo del área del documento en móvil.
- **Controles móviles configurables**: herramientas arriba, a la izquierda o a la derecha; la preferencia queda guardada en el dispositivo.
- **Modo compacto y barra ocultable** para maximizar el área útil del PDF en iPhone.
- El panel móvil de **Propiedades/Página** queda completamente invisible e inerte cuando está cerrado; ya no deja bordes asomados ni intercepta toques.
- La barra superior móvil se redujo a una sola fila para liberar espacio vertical.
- **Editar texto** detecta bloques seleccionables, conserva párrafos/columnas de forma conservadora y permite volver a editar el mismo reemplazo sin apilar copias.
- Safari/iPhone usa `getTextContent()` y, si falla la iteración del stream de PDF.js, cambia a un lector explícito con `getReader()`.
- Vista previa y exportación comparten el mismo cálculo de texto y geometría; los bloques girados conservan su orientación.
- Seleccionar/Editar texto permiten pan y zoom táctil; el toque se distingue de un arrastre antes de abrir el editor.
- Deshacer y Rehacer quedan visibles en móvil.
- Imágenes y firmas se guardan una sola vez en la sesión local; el historial conserva referencias en vez de repetir el mismo `data:` hasta 60 veces.
- Las sesiones v1 anteriores se migran automáticamente a la estructura v2 al recuperarlas.
- PDF.js, pdf-lib, CMaps, fuentes estándar y WASM están incluidos localmente.
- El paquete de distribución es **plano**: una carpeta principal y cero subcarpetas.

## Uso

Publica todos los archivos de esta carpeta juntos por HTTPS (por ejemplo, GitHub Pages). Abre `index.html` desde la URL publicada. En iPhone, abre la página en Safari y usa **Compartir → Añadir a pantalla de inicio**.

Después de que el service worker termina de almacenar los recursos, la aplicación puede abrirse sin conexión. Las actualizaciones no se activan automáticamente: aparece **Actualizar**, se guarda la sesión actual y luego se activa la nueva caché.

## Editar texto

1. Abre un PDF que contenga texto real.
2. Pulsa **Editar texto**.
3. Toca el cuadro del bloque que quieras cambiar.
4. Edita texto, tamaño, fuente o color y pulsa **Aplicar**.
5. Usa ↩ / ↷ para deshacer o rehacer.
6. Pulsa **Exportar PDF** para crear la copia editada.

La edición de texto es visual: cubre el texto original y dibuja el nuevo. No reescribe los operadores internos del PDF como un editor PDF de escritorio completo. Tampoco incluye OCR; los documentos escaneados necesitan OCR para convertir la imagen en texto seleccionable.

## Recuperación local

IndexedDB conserva el PDF abierto, páginas, anotaciones, historial y recursos de imagen/firma. **Recuperar trabajo** restaura la sesión. **Borrar copia guardada** elimina la copia local. El navegador puede borrar su almacenamiento, así que exporta cualquier trabajo que necesites conservar permanentemente.

Los PDF cifrados pueden visualizarse si PDF.js los abre con la contraseña, pero este build no guarda ni exporta una copia editada de un PDF cifrado.

## Compatibilidad

La lógica específica de Safari/iPhone está incluida. Editar texto ya fue validado físicamente en iPhone sobre la base v1.6.0; esta v1.7.0 conserva ese motor y modifica únicamente la interfaz móvil alrededor de él. Las pruebas automatizadas de este entorno validan la lógica, rutas offline, migración de sesiones y estructura del paquete; no sustituyen esa prueba física.

## Archivos clave

`app.js` contiene el editor; `pdf-text.js` el fallback de extracción; `text-blocks.js` agrupa texto; `text-layout.js` comparte geometría entre preview/export; `storage.js` maneja IndexedDB y migración v2; `sw.js` y `offline-assets.js` manejan el modo offline. Los demás archivos PDF.js/pdf-lib, CMaps, fuentes y WASM son dependencias locales necesarias para compatibilidad completa.
