(() => {
  'use strict';
  const root = document.getElementById('algebra-app');
  if (!root) return;
  const $ = id => document.getElementById(id);
  let topics = JSON.parse(root.dataset.topics);
  const kinds = JSON.parse(root.dataset.kinds);
  let current = null;
  let busy = false;
  let initialReady = false, initialIndex = 0;
  const modeNames = { inicial: 'Mi punto de partida', diagnostico: 'Diagnóstico', practica: 'Práctica', final: 'Evaluación final' };
  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const selectedTopic = () => topics.find(topic => topic.id === $('topic-select').value);
  async function api(url, body) {
    const response = await fetch(url, { method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]').content },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    let result;
    try { result = await response.json(); } catch { throw new Error('El servidor no respondió como esperábamos. Intenta de nuevo.'); }
    if (!response.ok) throw new Error(result.error || 'No se pudo completar la solicitud.');
    return result;
  }
  function updateControls() {
    const topic = selectedTopic();
    root.querySelectorAll('[data-mode]').forEach(button => {
      button.disabled = busy || !initialReady || !topic.habilitado || (button.dataset.mode !== 'diagnostico' && !topic.diagnostico);
    });
    $('topic-select').disabled = busy || !initialReady;
    $('level-select').disabled = busy;
    $('kind-select').disabled = busy;
  }
  function renderTopic(reset = true) {
    const topic = selectedTopic();
    document.dispatchEvent(new CustomEvent('algebra:topic', { detail: { id: topic.id } }));
    $('topic-title').textContent = topic.titulo;
    $('topic-explanation').textContent = topic.explicacion;
    $('topic-example').textContent = topic.ejemplo;
    const formulas = {expresiones:'3x + 2 → 3(4) + 2 = 14', signos:'(−4)(−3) + (−5) = 7', suma_resta:'(3x + 2) − (x − 4) = 2x + 6', multiplicacion:'2x(3x + 4) = 6x² + 8x', productos_notables:'(x + 3)² = x² + 6x + 9', factorizacion:'x² + 5x + 6 = (x + 2)(x + 3)', lineales:'3x + 2 = 14 → x = 4', cuadraticas:'x² − 5x + 6 = 0', sistemas:'x + y = 7   ·   x − y = 1', graficas:'y = 2x + 1'};
    $('topic-equation').textContent = formulas[topic.id];
    $('topic-steps').replaceChildren(...topic.pasos.map(step => element('li', step)));
    $('learning-state').textContent = !topic.habilitado ? 'Aprueba el tema anterior para comenzar sus actividades.' :
      topic.aprobado ? `Tema aprobado. Mejor evaluación: ${topic.mejor_final}%.` :
      topic.diagnostico ? `Diagnóstico registrado: ${topic.diagnostico.porcentaje}%. Ya puedes practicar y evaluarte.` :
      'Comienza con el diagnóstico para orientar tu práctica.';
    $('recommendation').textContent = `${topic.recomendacion} Nivel sugerido: ${({basico:'Básico',intermedio:'Intermedio',avanzado:'Avanzado'})[topic.nivel_recomendado]}. Puedes elegir otro.`;
    if (reset) {
      $('level-select').value = topic.nivel_recomendado;
      $('kind-select').replaceChildren(...topic.tipos.map(kind => {
        const option = element('option', kinds[kind]); option.value = kind; return option;
      }));
      current = null;
      $('attempt-panel').hidden = true;
      $('algebra-status').textContent = '';
    }
    $('course-progress').textContent = `Clase ${topics.indexOf(topic) + 1}/${topics.length}`;
    $('journey-progress').value = topics.filter(item => item.aprobado).length;
    $('topic-progress').replaceChildren(...topics.map(item => {
      const li = element('li'); const link = element('button', item.titulo, 'topic-jump'); link.type = 'button'; link.disabled = !initialReady; link.addEventListener('click', () => { if (busy) return; $('topic-select').value = item.id; renderTopic(); }); li.append(link);
      li.append(element('small', item.acreditado_inicial ? 'Acreditado en diagnóstico inicial ✓' : item.aprobado ? `Aprobado · ${item.mejor_final}%` : item.habilitado ? 'Disponible' : 'Explicación disponible'));
      return li;
    }));
    updateControls();
  }
  function drawGraph(data, container) {
    const figure = element('figure');
    const canvas = document.createElement('canvas'); canvas.width = 900; canvas.height = 440;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `Gráfica de ${data.ecuacion}. Hay una tabla de puntos a continuación.`);
    figure.append(canvas, element('figcaption', data.explicacion));
    const table = element('table');
    table.append(element('caption', 'Puntos de referencia'));
    const head = element('tr'); head.append(element('th', 'x'), element('th', 'y')); table.append(head);
    data.puntos.filter((_, index) => index % 25 === 0).forEach(point => {
      const row = element('tr'); row.append(element('td', String(point[0])), element('td', String(point[1]))); table.append(row);
    });
    figure.append(table); container.append(figure);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const style = getComputedStyle(root);
    const color = name => style.getPropertyValue(name).trim();
    const padding = 58, width = canvas.width - padding * 2, height = canvas.height - padding * 2;
    const values = data.puntos.map(point => point[1]);
    let minY = Math.min(0, ...values), maxY = Math.max(0, ...values);
    const margin = Math.max(1, (maxY - minY) * .1); minY -= margin; maxY += margin;
    const px = x => padding + (x + 10) / 20 * width;
    const py = y => padding + (maxY - y) / (maxY - minY) * height;
    ctx.fillStyle = color('--surface'); ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = '14px sans-serif'; ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const x = -10 + i * 5, y = minY + i / 4 * (maxY - minY);
      ctx.strokeStyle = color('--border-strong'); ctx.beginPath(); ctx.moveTo(px(x), padding); ctx.lineTo(px(x), padding + height); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(padding, py(y)); ctx.lineTo(padding + width, py(y)); ctx.stroke();
      ctx.fillStyle = color('--muted-strong'); ctx.fillText(String(x), px(x) - 7, canvas.height - 22); ctx.fillText(y.toPrecision(3), 2, py(y) + 4);
    }
    ctx.strokeStyle = color('--muted-strong'); ctx.beginPath(); ctx.moveTo(px(0), padding); ctx.lineTo(px(0), padding + height);
    ctx.moveTo(padding, py(0)); ctx.lineTo(padding + width, py(0)); ctx.stroke();
    ctx.fillStyle = color('--text'); ctx.fillText('x', canvas.width - 25, py(0)); ctx.fillText('y', px(0) + 8, 22);
    ctx.strokeStyle = color('--primary'); ctx.lineWidth = 3; ctx.beginPath();
    data.puntos.forEach((point, index) => index ? ctx.lineTo(px(point[0]), py(point[1])) : ctx.moveTo(px(point[0]), py(point[1]))); ctx.stroke();
  }
  function renderResult(result) {
    $('attempt-form').hidden = true;
    window.Kady?.announce(result.mensaje);
    const output = $('attempt-feedback'); output.replaceChildren();
    output.append(element('h3', `${result.aciertos}/${result.total} · ${result.porcentaje}%`, result.aprobado ? 'correct' : ''), element('p', result.mensaje));
    if (result.temas_acreditados) {
      const actions = element('div', undefined, 'algebra-actions');
      const go = (id, advanced) => { $('topic-select').value = id; renderTopic(); if (advanced) { $('level-select').value = 'avanzado'; root.querySelector('[data-mode="practica"]').click(); } $('topic-title').scrollIntoView({block:'center',behavior:'smooth'}); };
      if (result.temas_acreditados.length) {
        const next = element('button', 'Continuar con productos notables →', 'btn btn-primary'); next.type='button'; next.addEventListener('click', () => go('productos_notables', false));
        const challenge = element('button', 'Probar un reto avanzado', 'btn btn-secondary'); challenge.type='button'; challenge.addEventListener('click', () => go('multiplicacion', true));
        actions.append(next, challenge);
      } else {
        const review = element('button', 'Repasar juntos desde el principio →', 'btn btn-primary'); review.type='button'; review.addEventListener('click', () => go('expresiones', false)); actions.append(review);
      }
      output.append(actions);
    }
    for (const question of result.revision) {
      const detail = element('details');
      detail.append(element('summary', `${question.acierto ? 'Correcto' : 'Para repasar'}: ${question.enunciado}`, question.acierto ? 'correct' : 'incorrect'));
      detail.append(element('p', `Tu respuesta: ${[].concat(question.respuesta).join(', ')}. Resultado: ${[].concat(question.correcta).join(', ')}.`));
      const list = element('ol'); list.append(...question.pasos.map(step => element('li', step))); detail.append(list); output.append(detail);
    }
  }
  function renderAttempt(attempt) {
    current = attempt; initialIndex = 0; $('submit-attempt').hidden = false;
    $('attempt-panel').hidden = false;
    $('attempt-title').textContent = `${modeNames[attempt.modo]} · ${attempt.preguntas.length} ${attempt.preguntas.length === 1 ? 'ejercicio' : 'preguntas'}`;
    $('attempt-feedback').replaceChildren(); $('questions').replaceChildren();
    $('procedure').value = '';
    $('procedure-label').hidden = attempt.tipo !== 'resolver';
    $('attempt-form').hidden = false;
    if (attempt.completado) { renderResult(attempt.resultado); return; }
    for (const question of attempt.preguntas) {
      const fieldset = element('fieldset'); fieldset.dataset.question = question.id;
      fieldset.append(element('legend', `${question.id + 1}. ${question.enunciado}`));
      if (question.ecuacion) fieldset.append(element('div', question.ecuacion, 'equation-display question-equation'));
      else fieldset.classList.add('math-question');
      if (question.grafica) drawGraph(question.grafica, fieldset);
      if (question.tipo === 'opcion_multiple') {
        question.opciones.forEach((option, index) => {
          const label = element('label', undefined, 'algebra-option');
          const radio = document.createElement('input'); radio.type = 'radio'; radio.name = `q${question.id}`; radio.value = option; radio.required = true;
          label.append(radio, element('span', `${String.fromCharCode(65 + index)}. ${option}`)); fieldset.append(label);
        });
      } else if (question.tipo === 'relacionar') {
        question.elementos.forEach(prompt => {
          const label = element('label', prompt), select = document.createElement('select'); select.required = true;
          const empty = element('option', 'Selecciona un resultado'); empty.value = ''; select.append(empty);
          question.opciones.forEach(value => { const option = element('option', value); option.value = value; select.append(option); });
          label.append(select); fieldset.append(label);
        });
      } else {
        const label = element('label', 'Resultado numérico (también puedes usar una fracción como 1/2)');
        const input = document.createElement('input'); input.type = 'text'; input.required = true; input.maxLength = 60;
        label.append(input); fieldset.append(label);
      }
      $('questions').append(fieldset);
    }
    $('initial-navigation').hidden = attempt.modo !== 'inicial';
    $('question-progress').hidden = attempt.modo !== 'inicial';
    if (attempt.modo === 'inicial') showInitialQuestion();
    if (attempt.pista) $('attempt-feedback').append(element('p', attempt.pista));
    if (attempt.primer_intento && attempt.tipo === 'resolver') $('procedure').value = attempt.primer_intento.procedimiento || '';
    $('attempt-title').focus();
  }
  async function refreshProgress() {
    topics = (await api('/api/algebra/progreso')).temas;
    renderTopic(false);
  }
  async function loadHistory() {
    const output = $('history-output');
    try {
      const data = await api('/api/algebra/historial'); output.replaceChildren();
      if (!data.historial.length) output.append(element('p', 'Aún no hay actividades registradas. Comienza con tu diagnóstico.'));
      data.historial.forEach(item => {
        const row = element('div', undefined, 'history-record');
        const date = new Date(item.fecha).toLocaleString('es-MX');
        row.append(element('p', `${item.titulo} · ${modeNames[item.modo]} · ${date} · ${item.resultado ? `${item.resultado.porcentaje}%` : 'En curso'}`));
        const button = element('button', item.completado ? 'Revisar' : 'Reanudar', 'btn btn-ghost'); button.type = 'button';
        button.addEventListener('click', async () => {
          if (busy) return;
          busy = true; updateControls();
          try {
            const attempt = await api(`/api/algebra/intentos/${item.id}`);
            $('topic-select').value = attempt.tema; renderTopic(); renderAttempt(attempt);
          } catch (error) { $('algebra-status').textContent = error.message; }
          finally { busy = false; updateControls(); }
        }); row.append(button); output.append(row);
      });
    } catch (error) { output.textContent = error.message; }
  }
  root.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', async () => {
    if (busy) return;
    busy = true; updateControls(); $('algebra-status').textContent = 'Preparando tu actividad…';
    try {
      renderAttempt(await api('/api/algebra/intentos', { tema: selectedTopic().id, modo: button.dataset.mode, nivel: $('level-select').value, tipo: $('kind-select').value }));
      $('algebra-status').textContent = 'Tu actividad queda guardada para que puedas retomarla.';
      await loadHistory();
    } catch (error) { $('algebra-status').textContent = error.message; }
    finally { busy = false; updateControls(); }
  }));
  $('attempt-form').addEventListener('submit', async event => {
    event.preventDefault(); if (!current || busy) return;
    const answers = current.preguntas.map(question => {
      const field = $('questions').querySelector(`[data-question="${question.id}"]`);
      if (question.tipo === 'relacionar') return [...field.querySelectorAll('select')].map(select => select.value);
      return field.querySelector(question.tipo === 'opcion_multiple' ? 'input:checked' : 'input').value;
    });
    busy = true; updateControls(); $('submit-attempt').disabled = true;
    try {
      const result = await api(`/api/algebra/intentos/${current.id}/respuestas`, { respuestas: answers, procedimiento: $('procedure').value });
      if (result.completado) {
        if (current.modo === 'inicial') { initialReady = true; $('initial-intro').hidden = true; $('topic-guide').hidden = false; $('activity-controls').hidden = false; }
        renderResult(result.resultado);
        $('algebra-status').textContent = 'Respuestas y resultado guardados.';
        try { await refreshProgress(); await loadHistory(); } catch { $('algebra-status').textContent = 'El resultado quedó guardado. Actualiza la página para ver el avance.'; }
      } else {
        $('attempt-feedback').replaceChildren(element('p', `${result.mensaje} ${result.pista}`, 'incorrect'));
      }
    } catch (error) { $('algebra-status').textContent = error.message; }
    finally { busy = false; updateControls(); $('submit-attempt').disabled = false; }
  });
  $('topic-select').addEventListener('change', () => renderTopic());
  $('load-history').addEventListener('click', loadHistory);
  function showInitialQuestion() {
    [...$('questions').children].forEach((field, index) => { field.hidden = index !== initialIndex; });
    $('initial-back').disabled = initialIndex === 0;
    $('initial-next').hidden = initialIndex === current.preguntas.length - 1;
    $('submit-attempt').hidden = initialIndex !== current.preguntas.length - 1;
    $('initial-counter').textContent = `${initialIndex + 1} / ${current.preguntas.length}`;
    $('question-progress').value = initialIndex + 1;
    $('questions').children[initialIndex].querySelector('input')?.focus();
  }
  $('initial-next').addEventListener('click', () => {
    const field = $('questions').children[initialIndex];
    if (!field.querySelector('input:checked')) { field.querySelector('input').reportValidity(); return; }
    initialIndex++; showInitialQuestion();
  });
  $('initial-back').addEventListener('click', () => { if (initialIndex > 0) { initialIndex--; showInitialQuestion(); } });
  $('begin-initial').addEventListener('click', async () => {
    if (busy) return;
    busy = true; $('begin-initial').disabled = true;
    try { renderAttempt((await api('/api/algebra/inicial', {})).intento); $('initial-intro').hidden = true; }
    catch (error) { $('algebra-status').textContent = error.message; }
    finally { busy = false; $('begin-initial').disabled = false; updateControls(); }
  });
  renderTopic(); loadHistory();
  api('/api/algebra/inicial').then(data => {
    initialReady = !!data.intento?.completado;
    $('topic-guide').hidden = !initialReady; $('activity-controls').hidden = !initialReady;
    $('initial-intro').hidden = initialReady || !!data.intento;
    if (data.intento && !data.intento.completado) renderAttempt(data.intento);
    renderTopic(false);
  }).catch(error => { $('algebra-status').textContent = error.message; });
})();
