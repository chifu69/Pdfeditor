// Safari <17.4 / older installed browsers. Also loaded inside the PDF worker.
if (!Promise.withResolvers) {
  Promise.withResolvers = function () {
    let resolve, reject;
    const promise = new this((res, rej) => { resolve=res; reject=rej; });
    return {promise, resolve, reject};
  };
}
if (globalThis.ReadableStream && !ReadableStream.prototype[Symbol.asyncIterator]) {
  ReadableStream.prototype[Symbol.asyncIterator] = async function* ({preventCancel=false} = {}) {
    const reader=this.getReader();let completed=false;
    try {while(true){const {value,done}=await reader.read();if(done){completed=true;return;}yield value;}}
    finally {try {if(!completed && !preventCancel)await reader.cancel();}finally {reader.releaseLock();}}
  };
}
