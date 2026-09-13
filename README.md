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

## v1.4.0 — 2026-09-13

- Rehecha la edición de texto existente sobre la **TextLayer oficial de PDF.js** en vez de reconstruir manualmente las coordenadas de cada texto.
- Los cuadros de **Editar texto** se calculan a partir de las posiciones reales de los spans que renderiza el navegador, lo que mejora especialmente Safari/iPhone.
- Se desactiva el autoajuste de tamaño de texto de iOS dentro de la capa de medición para evitar desplazamientos.
- Los fragmentos siguen agrupándose en **líneas/bloques** y columnas lejanas permanecen separadas.
- Cambiar de herramienta ya no vuelve a renderizar todo el canvas PDF; solo reconstruye la capa interactiva, evitando carreras de render en móvil.
- Si PDF.js encuentra texto pero la medición DOM falla, queda un fallback de geometría en vez de mostrar silenciosamente cero cuadros.
- **↩ Deshacer** permanece visible y no se añadió OCR.
- Distribución: una sola carpeta principal y sin subcarpetas.

## Edición de texto v1.4.0

1. Abre un PDF que contenga texto real.
2. Pulsa **Editar texto**.
3. Deben aparecer cuadros azules alrededor de las líneas/bloques detectados.
4. Toca un cuadro para editar ese bloque.
5. Después de aplicar el cambio, **Editar texto permanece activo** para seguir con otro bloque.

Este build no incluye OCR.
