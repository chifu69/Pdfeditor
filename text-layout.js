// All layout values are PDF points. Preview and export consume the same result.
export function layoutText(ann, font) {
  const text = String(ann.text ?? '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
  try { for (const line of text.split('\n')) font.encodeText(line); }
  catch { throw new Error('La fuente no admite uno de estos caracteres. Usa texto compatible con Helvetica, Times o Courier.'); }
  const frame = ann.frame || (ann.rect ? {x:ann.rect.x, y:ann.rect.y+ann.rect.height, width:ann.rect.width,height:ann.rect.height,angle:0} : null);
  const requested = Math.max(4, Math.min(144, Number(ann.fontSize) || 12));
  const width = frame ? Math.max(1,frame.width-2) : Infinity;
  const height = frame ? Math.max(1,frame.height) : Infinity;
  const wrap = size => {
    const lines=[];
    for (const paragraph of text.split('\n')) {
      let line='';
      for (const word of paragraph.split(/( +)/)) {
        if (font.widthOfTextAtSize(line+word,size)<=width) { line+=word; continue; }
        if (line.trim()) {lines.push(line.trimEnd());line='';}
        if (!word.trim()) continue;
        for (const char of word) {
          if (line && font.widthOfTextAtSize(line+char,size)>width) {lines.push(line);line='';}
          line+=char;
        }
      }
      lines.push(line.trimEnd());
    }
    return lines;
  };
  let size=requested, lines, ascent, descent, lineHeight;
  while (true) {
    lines=wrap(size);
    ascent=font.heightAtSize(size,{descender:false});
    descent=font.heightAtSize(size)-ascent;
    lineHeight=size*1.2;
    const fits=lines.every(line=>font.widthOfTextAtSize(line,size)<=width+0.01) && ascent+descent+(lines.length-1)*lineHeight<=height+0.01;
    if (fits) break;
    if (size<=4) throw new Error('El texto no cabe en el bloque. Acórtalo o usa Agregar texto en otra zona.');
    size=Math.max(4, Math.round((size-.25)*100)/100);
  }
  const angle=frame?.angle || 0, c=Math.cos(angle), s=Math.sin(angle);
  return {size, angle, lines:lines.map((value,i)=>{
    const down=ascent+i*lineHeight;
    return {text:value,width:font.widthOfTextAtSize(value,size),x:frame ? frame.x+c+s*down : ann.x+s*i*lineHeight,y:frame ? frame.y+s-c*down : ann.y-c*i*lineHeight};
  })};
}

export function frameCorners(frame) {
 const c=Math.cos(frame.angle||0),s=Math.sin(frame.angle||0);
 return [[frame.x,frame.y],[frame.x+c*frame.width,frame.y+s*frame.width],[frame.x+c*frame.width+s*frame.height,frame.y+s*frame.width-c*frame.height],[frame.x+s*frame.height,frame.y-c*frame.height]];
}
