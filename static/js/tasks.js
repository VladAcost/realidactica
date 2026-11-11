(() => {
  'use strict';
  const root = document.getElementById('tasks-app'), approvals = document.getElementById('approvals-app');
  if (!root && !approvals) return;
  const $ = id => document.getElementById(id);
  const node = (tag,text) => { const n=document.createElement(tag); if(text !== undefined) n.textContent=text; return n; };
  async function api(url,data) {
    const response=await fetch(url,{method:data === undefined ? 'GET' : 'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':document.querySelector('meta[name="csrf-token"]').content},...(data === undefined ? {} : {body:JSON.stringify(data)})});
    const body=await response.json().catch(()=>({})); if(!response.ok) throw Error(body.error || 'No se pudo completar. Intenta de nuevo.'); return body;
  }
  async function load() {
    $('task-status').textContent='Cargando…';
    try {
      const data=await api('/api/tareas'); $('task-list').replaceChildren();
      if ($('task-groups')) { const group=$('task-groups'), selected=group.value; group.replaceChildren(...data.grupos.map(g=>{const option=node('option',g.nombre_grupo);option.value=g.id_grupo;return option;})); if (selected) group.value=selected; $('task-create').querySelector('button').disabled=!data.grupos.length; }
      if ($('enroll-group')) { $('enroll-group').replaceChildren(...data.grupos.map(g=>{const option=node('option',g.nombre_grupo);option.value=g.id_grupo;return option;})); }
      $('task-status').textContent=data.tareas.length ? '' : (root.dataset.role==='maestro' ? 'Aún no has creado tareas. Necesitas un grupo para asignarlas.' : 'No tienes tareas asignadas en Realidáctica. ¡Un buen momento para repasar!');
      for(const task of data.tareas) {
        const card=node('article'); card.className='task-card'; card.append(node('h3',task.title),node('small',`Entrega: ${task.due} · ${task.submitted ? 'Entregada ✓' : 'Pendiente'}`),node('pre',task.instructions));
        if(root.dataset.role==='alumno') {
          const form=node('form'), label=node('label','Mi respuesta'), text=node('textarea'), button=node('button',task.submitted ? 'Actualizar entrega' : 'Entregar tarea'), feedback=node('p');
          text.required=true;text.maxLength=8000;text.rows=4;text.value=task.response || ''; label.append(text);button.className='btn btn-primary';button.type='submit'; feedback.setAttribute('role','status');form.append(label,button,feedback);
          form.addEventListener('submit',async e=>{e.preventDefault();button.disabled=true;try {await api(`/api/tareas/${task.id}/entregar`,{respuesta:text.value});await load();}catch(error){feedback.textContent=error.message;}finally{button.disabled=false;}});card.append(form);
        } else {
          card.querySelector('small').textContent=`Entrega: ${task.due} · ${task.entregas.length} entregas`;
          for(const submission of task.entregas) {const detail=node('details');detail.append(node('summary',`${submission.nombre || submission.student} · ${new Date(submission.submitted).toLocaleString('es-MX')}`),node('pre',submission.response));card.append(detail);}
        }
        $('task-list').append(card);
      }
    } catch(error) { $('task-status').textContent=error.message; }
  }
  if(root) {
    $('refresh-tasks').addEventListener('click',load);
    $('task-create')?.addEventListener('submit',async e=>{e.preventDefault();const form=e.target,button=form.querySelector('button');button.disabled=true;const data=Object.fromEntries(new FormData(form));data.grupo=Number(data.grupo);try{await api('/api/tareas',data);form.reset();await load();}catch(error){$('task-status').textContent=error.message;}finally{button.disabled=false;}});
    $('enroll-student')?.addEventListener('submit',async e=>{e.preventDefault();const form=e.target,button=form.querySelector('button');button.disabled=true;const data=Object.fromEntries(new FormData(form));data.grupo=Number(data.grupo);try{await api('/api/grupos/inscribir',data);$('enroll-status').textContent='Estudiante inscrito. Ya puede ver las tareas de su grupo.';}catch(error){$('enroll-status').textContent=error.message;}finally{button.disabled=false;}});
    load();
  }
  async function loadApprovals() {
    try {const data=await api('/api/docentes/pendientes');$('approval-list').replaceChildren();$('approval-status').textContent=data.docentes.length ? '' : 'No hay solicitudes pendientes.';
      data.docentes.forEach(user=>{const row=node('article'),button=node('button','Aprobar cuenta docente');row.className='task-card';row.append(node('h3',`${user.nombre} ${user.apellido}`),node('p',user.correo));button.className='btn btn-primary';button.addEventListener('click',async()=>{button.disabled=true;try{await api('/api/docentes/pendientes',{id:user.id});await loadApprovals();}catch(error){$('approval-status').textContent=error.message;button.disabled=false;}});row.append(button);$('approval-list').append(row);});
    } catch(error){$('approval-status').textContent=error.message;}
  }
  if(approvals) loadApprovals();
})();
