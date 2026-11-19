'use strict';
/* =========================================================
   RegeneCure Journey — extraction stream parsing (browser + Node tests)
   Reads the Claude Messages API Server-Sent Events relayed by /api/extract,
   keeps only the record_journey tool input and coerces it into the shape
   mergeExtraction() expects.
   ========================================================= */
(function(root){
  const TOOL_NAME = 'record_journey';
  const LIST_KEYS = ['biomarkers', 'supplements', 'peptides'];
  const OBJ_KEYS = ['patient', 'report'];
  const ITEM_ARRAYS = ['timing', 'days_of_week'];

  function createExtractionParser(onProgress){
    let buf = '';
    const st = { blocks:{}, json:'', toolSeen:false, toolInput:null, stop:null, error:null, text:'' };

    function handleEvent(ev){
      if(!ev || typeof ev !== 'object') return;
      switch(ev.type){
        case 'content_block_start': {
          const b = ev.content_block || {};
          st.blocks[ev.index] = { type:b.type, name:b.name };
          if(b.type === 'tool_use' && b.name === TOOL_NAME && !st.toolSeen){
            st.toolSeen = true; st.toolIndex = ev.index;
            // Some responses carry the full input on the start event instead of deltas.
            if(b.input && typeof b.input === 'object' && Object.keys(b.input).length) st.toolInput = b.input;
          }
          break;
        }
        case 'content_block_delta': {
          const d = ev.delta || {};
          if(d.type === 'input_json_delta' && st.toolSeen && ev.index === st.toolIndex){
            st.json += d.partial_json || '';
            if(onProgress) onProgress(st.json.length);
          } else if(d.type === 'text_delta'){
            st.text += d.text || '';
          }
          break;
        }
        case 'message_delta': if(ev.delta && ev.delta.stop_reason) st.stop = ev.delta.stop_reason; break;
        case 'error': st.error = (ev.error && ev.error.message) || 'stream error'; break;
      }
    }

    function handleRaw(raw){
      const data = raw.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).replace(/^ /, '')).join('\n').trim();
      if(!data || data === '[DONE]') return;
      let ev; try{ ev = JSON.parse(data); }catch(e){ return; }
      handleEvent(ev);
    }

    return {
      push(chunk){
        buf += String(chunk).replace(/\r\n?/g, '\n');
        let i;
        while((i = buf.indexOf('\n\n')) >= 0){ const raw = buf.slice(0, i); buf = buf.slice(i + 2); handleRaw(raw); }
      },
      // Flush the last event even when the stream ends without a blank line.
      finish(){
        if(buf.trim()) handleRaw(buf); buf = '';
        if(st.error) return { ok:false, reason:'error', message:st.error };
        if(st.stop === 'max_tokens') return { ok:false, reason:'truncated' };
        if(st.stop === 'refusal') return { ok:false, reason:'refusal' };
        let input = null;
        if(st.json.trim()){
          try{ input = JSON.parse(st.json); }catch(e){ return { ok:false, reason:'truncated' }; }
        } else if(st.toolInput) input = st.toolInput;
        else if(st.text) input = jsonFromText(st.text);
        if(!input || typeof input !== 'object') return { ok:false, reason:'empty' };
        return { ok:true, data:coerceExtraction(input) };
      },
      state:st
    };
  }

  // Fallback when the model wrote the record as text (optionally in a ```json fence)
  // instead of calling the tool. Only accepts an object that looks like a journey record.
  function jsonFromText(text){
    const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
    const candidates = [];
    if(fence) candidates.push(fence[1]);
    const a = text.indexOf('{'), b = text.lastIndexOf('}');
    if(a >= 0 && b > a) candidates.push(text.slice(a, b + 1));
    for(const s of candidates){
      try{
        const o = JSON.parse(s.trim());
        if(o && typeof o === 'object' && !Array.isArray(o) && ['biomarkers', 'supplements', 'peptides', 'patient'].some(k => k in o)) return o;
      }catch(e){}
    }
    return null;
  }

  // Models occasionally return nested arrays/objects as JSON strings; normalise them.
  function parseMaybe(v){
    if(typeof v !== 'string') return v;
    const s = v.trim(); if(!/^[\[{]/.test(s)) return v;
    try{ return JSON.parse(s); }catch(e){ return v; }
  }
  function asArray(v){
    v = parseMaybe(v);
    if(Array.isArray(v)) return v;
    if(v && typeof v === 'object') return [v];
    return [];
  }
  function coerceExtraction(input){
    let d = parseMaybe(input);
    if(!d || typeof d !== 'object' || Array.isArray(d)) d = {};
    if(d.input && typeof d.input === 'object' && !d.biomarkers && !d.supplements && !d.peptides) d = d.input;
    const out = { ...d };
    OBJ_KEYS.forEach(k => { const v = parseMaybe(d[k]); out[k] = v && typeof v === 'object' && !Array.isArray(v) ? v : {}; });
    LIST_KEYS.forEach(k => {
      out[k] = asArray(d[k]).map(parseMaybe).filter(x => x && typeof x === 'object' && !Array.isArray(x)).map(x => {
        const y = { ...x };
        if(typeof y.name === 'string') y.name = y.name.trim();
        ITEM_ARRAYS.forEach(a => { if(a in y){ const v = parseMaybe(y[a]); y[a] = Array.isArray(v) ? v : (typeof v === 'string' && v ? v.split(/[\s,;]+/).filter(Boolean) : []); } });
        ['duration_days', 'every_n_days', 'start_offset_days', 'cycle_length_days'].forEach(n => {
          if(typeof y[n] === 'string' && /^\d+$/.test(y[n].trim())) y[n] = parseInt(y[n], 10);
        });
        if(y.value !== undefined && y.value !== null && typeof y.value !== 'string') y.value = String(y.value);
        return y;
      }).filter(x => typeof x.name === 'string' && x.name);
    });
    return out;
  }

  const api = { createExtractionParser, coerceExtraction, TOOL_NAME };
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
