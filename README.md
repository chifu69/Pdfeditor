# PDF Editor PWA

Editor de PDF para navegador. Los archivos se procesan localmente en el dispositivo.

## Ejecutar / publicar

Los módulos ES y el Service Worker requieren HTTP/HTTPS. No abras `index.html` directamente con `file://`.

Para una prueba local con Python:

```bash
python -m http.server 8080
```

Luego abre `http://localhost:8080`.

La carpeta también se puede publicar directamente en GitHub Pages.

## Funciones

- Abrir PDFs locales sin subirlos a un servidor.
- Renderizado con PDF.js.
- **Seleccionar** texto original del PDF y abrirlo para reemplazo visual.
- **Editar texto** muestra zonas táctiles sobre el texto original.
- Búsqueda del bloque de texto más cercano cuando el toque queda unos píxeles fuera, pensada para iPhone/iPad.
- Agregar texto.
- Borrado visual / whiteout.
- Cubrir en negro (ocultación visual; no es redacción segura).
- Resaltado y dibujo libre.
- Insertar PNG/JPEG.
- Crear y colocar firma manuscrita.
- Rotar, duplicar, eliminar y reordenar páginas.
- Undo/redo; **↩ Deshacer** queda visible en móvil.
- Exportar un PDF nuevo.
- PWA instalable.

## Límites importantes

Un PDF no funciona internamente como Word. El texto puede estar fragmentado, convertido a curvas, usar fuentes especiales o ser una imagen escaneada. La edición de texto existente de este build se hace cubriendo visualmente el texto original y escribiendo el nuevo encima.

Este build **no incluye OCR**. Si un PDF es un escaneo/foto y no contiene capa de texto, no habrá texto original seleccionable. Cubrir en negro tampoco elimina el contenido subyacente y no debe usarse como redacción segura de información sensible.

## v1.3.0 — 2026-09-13

- Corregido un fallo real en la capa de texto: después de extraer el texto, una condición descartaba el modo **Seleccionar** y solo permitía **Editar texto**.
- Añadido fallback por proximidad: si el área táctil del texto queda ligeramente desalineada, el editor busca el bloque de texto más cercano al toque.
- **Seleccionar** y **Editar texto** usan la misma capa de texto original y ambos pueden abrir el editor.
- Diseño de iPhone rehecho: encabezado en dos filas y respetando `safe-area-inset-top`.
- Cambiado el modo de barra de estado de iOS para evitar que hora/señal/batería se monten sobre el encabezado.
- Herramientas móviles en cuadrícula de 4 columnas, sin barra horizontal recortada.
- Pantalla inicial más compacta en móvil.
- **↩ Deshacer** permanece visible.
- Preparado para distribución con una sola carpeta principal y sin subcarpetas.


## Edición de texto v1.3.0

- Al activar **Editar texto**, todos los textos detectados de la página aparecen rodeados por cuadros azules visibles.
- Los fragmentos internos de PDF.js se agrupan en **líneas/bloques** para que sean fáciles de tocar en iPhone.
- Campos o columnas separados por una distancia grande permanecen como bloques distintos.
- Toca un cuadro para abrir el editor del bloque. Después de aplicar el cambio, **Editar texto permanece activo** para seguir con otro bloque.
- No incluye OCR. Los PDFs que sean solo una imagen/escaneo no producirán cuadros de texto.
