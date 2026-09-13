# PDF Editor: edición y PWA funcional

Alcance autorizado: corregir los problemas de la revisión y verificar edición, selección táctil, historial y exportación. Se conserva el reemplazo visual; OCR y edición de operadores originales no forman parte de este motor.

1. Escribir pruebas que reproduzcan párrafos separados y reedición duplicada; añadir integración en navegador con PDF real.
2. Agrupar texto en coordenadas independientes del zoom, conservando líneas, orientación e identidad estable; separar columnas y encabezados.
3. Unificar selección y reedición de anotaciones, distinguir tap/scroll y respetar undo nativo en campos. Cancelar renders anteriores.
4. Compartir composición de texto entre SVG y PDF: fuentes, tamaño, saltos, ancho, altura y orientación. Validar texto antes de aplicar.
5. Guardar documento e historial en IndexedDB; recuperar tras recargar. Incluir PDF.js/pdf-lib y todos sus recursos en la distribución, caché versionada y actualización controlada.
6. Probar agrupación, reedición, undo/redo, exportación/reapertura, rotación, fallback, móvil, recuperación y offline. Documentar límites y comandos reproducibles.
