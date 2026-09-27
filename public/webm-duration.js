// MediaRecorder's streaming WebM omits duration. Finalize Segment/Info so
// downloaded movies have a finite timeline and can seek in a normal player.
// https://www.matroska.org/technical/elements.html (Duration / TimestampScale)
function vint(bytes,offset,keepMarker=false){
  const first=bytes[offset];if(!first)throw Error('无效 WebM 头');let length=1;while(length<=8&&!(first&(1<<(8-length))))length++;
  if(length>8||offset+length>bytes.length)throw Error('WebM 数据被截断');
  let value=BigInt(keepMarker?first:first&((1<<(8-length))-1));for(let i=1;i<length;i++)value=value*256n+BigInt(bytes[offset+i]);
  return {length,value,unknown:!keepMarker&&value===(1n<<BigInt(7*length))-1n};
}
function element(bytes,offset){const id=vint(bytes,offset,true),sizeAt=offset+id.length,size=vint(bytes,sizeAt),data=sizeAt+size.length,end=size.unknown?bytes.length:data+Number(size.value);if(end>bytes.length)throw Error('WebM 元素不完整');return {id:Number(id.value),start:offset,sizeAt,sizeWidth:size.length,unknown:size.unknown,data,end,size:Number(size.value)};}
function sizeBytes(value,width=1){let n=BigInt(value);while(n>=(1n<<BigInt(7*width))-1n)width++;const out=new Uint8Array(width);for(let i=width-1;i>=0;i--){out[i]=Number(n&255n);n>>=8n;}out[0]|=1<<(8-width);return out;}
function uint(bytes,start,end){let n=0;for(let p=start;p<end;p++)n=n*256+bytes[p];return n;}
export async function finalizeWebM(blob,fallbackMs){
  const bytes=new Uint8Array(await blob.arrayBuffer()),header=element(bytes,0);if(header.id!==0x1a45dfa3)throw Error('不是有效的 WebM 视频');const segment=element(bytes,header.end);if(segment.id!==0x18538067)throw Error('缺少 WebM Segment');
  let info=null,duration=null,scale=1000000,clusterTime=0,lastTick=0,indexed=false;
  for(let p=segment.data;p<bytes.length;){const e=element(bytes,p);
    if(e.id===0x1549a966){info=e;for(let q=e.data;q<e.end;){const c=element(bytes,q);if(c.id===0x2ad7b1)scale=uint(bytes,c.data,c.end);if(c.id===0x4489)duration=c;q=c.end;}}
    if(e.id===0x114d9b74||e.id===0x1c53bb6b)indexed=true;
    if(e.id===0x1f43b675){clusterTime=0;p=e.data;continue;}
    if(e.id===0xe7)clusterTime=uint(bytes,e.data,e.end);
    if(e.id===0xa3){const track=vint(bytes,e.data);const at=e.data+track.length;if(at+2<e.end){const relative=new DataView(bytes.buffer).getInt16(at,false);lastTick=Math.max(lastTick,clusterTime+relative);}}
    if(e.unknown)throw Error('无法处理的 WebM 流结构');p=e.end;
  }
  if(!info||!scale)throw Error('视频缺少时间信息');
  const durationMs=lastTick>0?lastTick*scale/1000000+1000/30:fallbackMs;if(!Number.isFinite(durationMs)||durationMs<=0)throw Error('无法确定视频时长');
  const ticks=durationMs*1000000/scale;
  if(duration){const copy=bytes.slice(),view=new DataView(copy.buffer);if(duration.size===8)view.setFloat64(duration.data,ticks,false);else if(duration.size===4)view.setFloat32(duration.data,ticks,false);else throw Error('无效时长字段');return {blob:new Blob([copy],{type:blob.type}),duration:durationMs/1000};}
  if(indexed)throw Error('视频包含预建索引，无法安全写入时长');
  const value=new Uint8Array(11);value.set([0x44,0x89,0x88]);new DataView(value.buffer).setFloat64(3,ticks,false);
  const infoSize=sizeBytes(info.size+value.length,info.sizeWidth),delta=value.length+infoSize.length-info.sizeWidth;
  const segmentSize=segment.unknown?bytes.slice(segment.sizeAt,segment.data):sizeBytes(segment.size+delta,segment.sizeWidth);
  return {blob:new Blob([bytes.slice(0,segment.sizeAt),segmentSize,bytes.slice(segment.data,info.sizeAt),infoSize,bytes.slice(info.data,info.end),value,bytes.slice(info.end)],{type:blob.type}),duration:durationMs/1000};
}
