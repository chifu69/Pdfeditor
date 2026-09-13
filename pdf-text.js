export async function collectTextContentFromReader(stream) {
  const reader = stream.getReader();
  const textContent = { items: [], styles: Object.create(null), lang: null };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      if (textContent.lang == null && value.lang != null) textContent.lang = value.lang;
      if (value.styles) Object.assign(textContent.styles, value.styles);
      if (Array.isArray(value.items) && value.items.length) textContent.items.push(...value.items);
    }
  } finally {
    try { reader.releaseLock?.(); } catch {}
  }
  return textContent;
}

export async function getTextContentCompat(page, params = {}) {
  try {
    return await page.getTextContent(params);
  } catch (error) {
    // Safari 26.x can throw while PDF.js iterates the ReadableStream with
    // `for await...of`, even though the same stream works through getReader().
    const stream = page.streamTextContent(params);
    if (!stream?.getReader) throw error;
    return collectTextContentFromReader(stream);
  }
}
