# PDF Editor PWA

Editor de PDF que funciona en el navegador y procesa los archivos localmente.

## Ejecutar

Los Service Workers y módulos ES requieren HTTP/HTTPS. No abras `index.html` directamente con `file://`.

### Windows / macOS / Linux

Con Python instalado:

```bash
python -m http.server 8080
```

Luego abre `http://localhost:8080`.

También se puede publicar la carpeta completa en GitHub Pages, Cloudflare Pages, Netlify o Vercel.

## Funciones

- Abrir PDFs locales sin subirlos a un servidor.
- Renderizado con PDF.js.
- Editar texto existente mediante reemplazo visual (cubre el texto original y escribe el nuevo).
- Agregar texto.
- Whiteout / borrado visual.
- Cubrir contenido en negro (ocultación visual; no es redacción segura).
- Resaltado.
- Dibujo libre.
- Insertar PNG/JPEG.
- Crear y colocar firma manuscrita.
- Rotar, duplicar, eliminar y reordenar páginas.
- Undo/redo.
- Exportar un PDF nuevo.
- PWA instalable y caché offline después de la primera carga de las librerías.

## Límites importantes

Un PDF no es un documento de Word: el texto puede estar fragmentado, convertido a curvas, embebido con fuentes especiales o ser solo una imagen escaneada. Por eso la edición de texto existente se implementa como reemplazo visual. En PDFs escaneados puedes cubrir contenido y agregar texto, pero este build no incluye OCR. Los PDFs cifrados/protegidos pueden requerir desbloqueo previo. Cubrir en negro no elimina el texto subyacente del PDF, así que no debe usarse como redacción segura para información sensible. Los cambios estructurales de páginas pueden no preservar todos los elementos interactivos avanzados del PDF (formularios dinámicos, firmas digitales, adjuntos, JavaScript, etc.).
