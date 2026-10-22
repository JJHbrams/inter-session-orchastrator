import { createHash } from 'node:crypto';
export const MAX_ATTACHMENT_BYTES=10*1024*1024;
export const MAX_ATTACHMENTS_PER_MESSAGE=5;
export const MAX_STAGED_ATTACHMENTS_PER_ROOM=50;
export const imageMimeFor=bytes=>{const b=Buffer.from(bytes);if(b.length>=8&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';if(b.length>=3&&b.subarray(0,3).equals(Buffer.from([255,216,255])))return 'image/jpeg';if(b.length>=6&&(b.subarray(0,6).toString()==='GIF87a'||b.subarray(0,6).toString()==='GIF89a'))return 'image/gif';if(b.length>=12&&b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP')return 'image/webp';return null;};
export const safeFilename=value=>{if(typeof value!=='string')throw Error('filename is required');const name=value.replace(/[\\/]+/g,'/').split('/').pop().replace(/[\x00-\x1f\x7f]/g,'').trim();if(!name||name.length>255)throw Error('invalid filename');return name;};
export const decodeBase64=value=>{if(typeof value!=='string'||!value.length||value.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))throw Error('invalid base64');const bytes=Buffer.from(value,'base64');if(bytes.toString('base64')!==value)throw Error('invalid base64');if(bytes.length>MAX_ATTACHMENT_BYTES)throw Error('attachment exceeds 10 MiB');return bytes;};
export const attachmentDigest=bytes=>createHash('sha256').update(bytes).digest('hex');
export const textSnippet=bytes=>{if(bytes.length>256*1024)return null;const text=Buffer.from(bytes).toString('utf8');return Buffer.from(text,'utf8').equals(Buffer.from(bytes))?text.slice(0,16000):null;};
