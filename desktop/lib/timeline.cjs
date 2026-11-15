'use strict';
// Edits use source seconds; counts are interpreted at the selected editing FPS.
function segments(duration, fps, edits = []) {
  const result = []; let cursor = 0;
  for (const e of [...edits].sort((a,b)=>a.at-b.at)) {
    if (e.at < cursor-1e-6 || e.at >= duration) throw Error('Операции кадров пересекаются или выходят за длительность исходника');
    if (e.at > cursor) result.push({start:cursor,end:e.at,hold:false});
    if (e.kind === 'remove') { cursor=e.at+e.count/fps; if(cursor>duration)throw Error('Удаление выходит за конец видео'); }
    else { result.push({start:e.at,end:e.at+e.count/fps,hold:true}); cursor=e.at; }
  }
  if(cursor<duration)result.push({start:cursor,end:duration,hold:false});
  if(!result.length)throw Error('Нельзя удалить все кадры');
  let time=0;return result.map(s=>{const out={...s,outputStart:time};time+=s.end-s.start;return out;});
}
function sourceTime(time, timeline, rate=1) {
 const t=time*rate;let last;
 for(const s of timeline){last=s;if(t<s.outputStart+s.end-s.start)return s.hold?s.start:s.start+Math.max(0,t-s.outputStart);}
 return last?last.hold?last.start:last.end:time*rate;
}
function compile(graph, timeline, fps, audio, offset=0, videoInput='0:v') {
 if(!timeline.length)throw Error('Пустая шкала');
 graph.push(`[${videoInput}]setpts=PTS-STARTPTS,fps=${fps},split=${timeline.length}${timeline.map((_,i)=>`[ev${i}]`).join('')}`);
 if(audio){const delay=offset>0?`,adelay=${Math.round(offset*1000)}:all=1`:offset<0?`,atrim=start=${-offset},asetpts=PTS-STARTPTS`:'';graph.push(`[0:a]asetpts=PTS-STARTPTS${delay},apad,asplit=${timeline.length}${timeline.map((_,i)=>`[ea${i}]`).join('')}`);}
 const inputs=[];
 timeline.forEach((s,i)=>{
   const d=s.end-s.start;
   graph.push(`[ev${i}]trim=start=${s.start}:end=${s.hold?s.start+1/fps:s.end},setpts=PTS-STARTPTS${s.hold?`,tpad=stop_mode=clone:stop_duration=${d},trim=duration=${d}`:''}[tv${i}]`);
   inputs.push(`[tv${i}]`);
   if(audio){graph.push(s.hold?`[ea${i}]atrim=start=0:duration=${d},asetpts=PTS-STARTPTS,volume=0[ta${i}]`:`[ea${i}]atrim=start=${s.start}:end=${s.end},asetpts=PTS-STARTPTS[ta${i}]`);inputs.push(`[ta${i}]`);}
 });
 graph.push(`${inputs.join('')}concat=n=${timeline.length}:v=1:a=${audio?1:0}[editedv]${audio?'[editeda]':''}`);
 return {video:'editedv',audio:'editeda'};
}
module.exports={segments,sourceTime,compile};
