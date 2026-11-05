import { Terminal } from './xterm.mjs';
import { FitAddon } from './fit.mjs';

export const pocketApi = 1;
export default function setup(pocket) {
  pocket.style('terminal.css');
  const { html, useState, useEffect, useRef } = pocket;
  const call = (path, method='GET', body, signal) => pocket.api(path, body, {method, signal});
  function TerminalView({id, onError}) {
    const element = useRef(null);
    useEffect(() => {
      if (!element.current) return;
      const term = new Terminal({cursorBlink:true, fontSize:13, scrollback:5000, theme:{background:'#11151b',foreground:'#e5e7eb'}});
      const fit = new FitAddon(); term.loadAddon(fit); term.open(element.current);
      let alive=true, cursor=0, pending='', sending=false;
      const ctrl = new AbortController();
      const send = async () => {
        if (sending || !pending || !alive) return;
        sending=true;
        const data=pending.slice(0,4096); pending=pending.slice(data.length);
        try { await call(`sessions/${id}/input`,'POST',{data},ctrl.signal); }
        catch(e) { if(alive) onError(e.message); }
        finally { sending=false; if(pending) void send(); }
      };
      const input = term.onData(data=> {pending+=data; void send();});
      const resize = () => {if(!alive)return; try {fit.fit(); void call(`sessions/${id}/resize`,'POST',{cols:term.cols,rows:term.rows},ctrl.signal).catch(()=>{});}catch{}};
      const observer = new ResizeObserver(resize); observer.observe(element.current);
      requestAnimationFrame(resize);
      (async()=>{
        while(alive) {
          try {
            const out=await call(`sessions/${id}/output?cursor=${cursor}`,'GET',undefined,ctrl.signal);
            if(!alive)break;
            if(out.truncated) term.write('\r\n[Ältere Ausgabe verworfen]\r\n');
            if(out.data) term.write(out.data);
            cursor=out.cursor;
            if(out.closed) {term.write('\r\n[Terminal geschlossen]\r\n');break;}
          } catch(e) {if(alive){onError(e.message); await new Promise(r=>setTimeout(r,1500));}}
        }
      })();
      return ()=>{alive=false;ctrl.abort();observer.disconnect();input.dispose();term.dispose();};
    },[id]);
    return html`<div class="pt-terminal" ref=${element} data-no-swipe></div>`;
  }
  function Page() {
    const [tabs,setTabs]=useState([]), [active,setActive]=useState(null), [error,setError]=useState('');
    const [busy,setBusy]=useState(false);
    const refresh=async()=>{try{const result=await call('sessions');setTabs(result.sessions);setActive(prev=>result.sessions.some(s=>s.id===prev)?prev:(result.sessions[0]?.id||null));}catch(e){setError(e.message);}};
    useEffect(()=>{void refresh();},[]);
    const create=async()=>{setBusy(true);setError('');try{const s=await call('sessions','POST',{});await refresh();setActive(s.id);}catch(e){setError(e.message);}finally{setBusy(false);}};
    const remove=async(id)=>{if(!confirm('Terminal und laufende Prozesse wirklich beenden?'))return;try{await call(`sessions/${id}`,'DELETE');await refresh();}catch(e){setError(e.message);}};
    const rename=async(s)=>{const name=prompt('Name des Terminals',s.name);if(name===null)return;try{await call(`sessions/${s.id}`,'PATCH',{name});await refresh();}catch(e){setError(e.message);}};
    return html`<div class="pt-root">
      <div class="pt-toolbar"><div class="pt-tabs">${tabs.map(s=>html`<div class=${'pt-tab '+(active===s.id?'selected':'')} key=${s.id}>
        <button class="pt-select" onClick=${()=>setActive(s.id)}>${s.name}</button>
        <button title="Umbenennen" onClick=${()=>rename(s)}>✎</button><button title="Schließen" onClick=${()=>remove(s.id)}>×</button>
      </div>`)}</div><button class="button" disabled=${busy} onClick=${create}>+ Terminal</button></div>
      ${error && html`<div class="error-box">${error}<button onClick=${()=>setError('')}>×</button></div>`}
      <div class="pt-body">${active ? html`<${TerminalView} key=${active} id=${active} onError=${setError}/>` : html`<div class="pt-empty">Noch kein Terminal geöffnet. Tippe auf „+ Terminal“.</div>`}</div>
      <div class="pt-keys"><button onClick=${()=>document.querySelector('.pt-terminal textarea')?.focus()}>Tastatur</button><span>Für Ctrl, Esc und Tab: externe Tastatur empfohlen.</span></div>
    </div>`;
  }
  pocket.page({id:'terminal',title:'Terminal',component:Page,escape:false,swipe:false});
  pocket.rail({id:'terminal',title:'Terminal',icon:'terminal',page:'terminal'});
  pocket.menu({id:'terminal',label:'Terminal',page:'terminal'});
}
