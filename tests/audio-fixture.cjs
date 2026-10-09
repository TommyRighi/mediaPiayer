// A real PCM WAV with ID3 tags, independent of the machine's FFmpeg installation.
function audioFixture({ title='Tagged song',artist='Tagged artist',album='Tagged album',picture,duration=2 } = {}) {
  const chunk = (name,data) => { const header=Buffer.alloc(8);header.write(name);header.writeUInt32LE(data.length,4);return Buffer.concat([header,data,...(data.length%2 ? [Buffer.alloc(1)] : [])]); };
  const frame = (name,data) => { const header=Buffer.alloc(10);header.write(name);header.writeUInt32BE(data.length,4);return Buffer.concat([header,data]); };
  const text = (name,value) => frame(name,Buffer.concat([Buffer.from([0]),Buffer.from(value)]));
  const frames=[text('TIT2',title),text('TPE1',artist),text('TALB',album),text('TRCK','3'),text('TYER','2024'),text('TCON','Jazz')];
  if (picture) frames.push(frame('APIC',Buffer.concat([Buffer.from([0]),Buffer.from('image/png\0'),Buffer.from([3,0]),picture])));
  const body=Buffer.concat(frames),id3=Buffer.alloc(10);id3.write('ID3');id3[3]=3;
  for(let i=0;i<4;i++)id3[6+i]=(body.length >> (7*(3-i)))&127;
  const fmt=Buffer.alloc(16);fmt.writeUInt16LE(1,0);fmt.writeUInt16LE(1,2);fmt.writeUInt32LE(8000,4);fmt.writeUInt32LE(16000,8);fmt.writeUInt16LE(2,12);fmt.writeUInt16LE(16,14);
  const pcm=Buffer.alloc(16000*duration);
  for(let i=0;i<pcm.length/2;i++)pcm.writeInt16LE(Math.round(Math.sin(i/8000*2*Math.PI*220)*3000),i*2);
  const wave=Buffer.concat([Buffer.from('WAVE'),chunk('fmt ',fmt),chunk('id3 ',Buffer.concat([id3,body])),chunk('data',pcm)]);
  const header=Buffer.alloc(8);header.write('RIFF');header.writeUInt32LE(wave.length,4);
  return Buffer.concat([header,wave]);
}
module.exports={ audioFixture };
