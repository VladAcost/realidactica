/* Adapted from Herramienta Educativa Matemática.html, isolated from classroom UI. */
(() => {
  'use strict';
  const widget = document.getElementById('math-widget');
  if (!widget) return;
  const $ = id => document.getElementById(id);
  const mode = $('math-mode'), input = $('math-expression'), plot = $('math-plot');
  const status = $('math-status'), result = $('math-result'), dialog = $('math-dialog');
  const slot = widget.parentElement;
  const values = { '2d': 'sin(x)', '3d': 'sin(x) * cos(y)', matrix: '[[1, 2], [3, 4]]' };
  let current = '2d';
  let drawn = false;
  if (!window.math || !window.Plotly) {
    status.textContent = 'No se pudo cargar la herramienta. Actualiza la página para intentarlo de nuevo.';
    $('math-draw').disabled = true;
    return;
  }
  // Restrict expressions to arithmetic and common scalar functions.
  function compile(text, variables) {
    const node = math.parse(text);
    const functions = new Set(['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'sqrt', 'abs', 'exp', 'log', 'log10', 'floor', 'ceil', 'round']);
    node.traverse(n => {
      if (n.isSymbolNode && !variables.includes(n.name) && !['pi', 'e'].includes(n.name) && !functions.has(n.name)) throw Error('Variable desconocida.');
      if (n.isFunctionNode && !functions.has(n.fn.name)) throw Error('Función no admitida.');
      if (!['OperatorNode', 'ConstantNode', 'SymbolNode', 'FunctionNode', 'ParenthesisNode'].includes(n.type)) throw Error('Usa una función matemática.');
      if (n.isOperatorNode && !['+', '-', '*', '/', '^', '%'].includes(n.op)) throw Error('Operación no admitida.');
    });
    return node.compile();
  }
  function finite(value) { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
  async function draw(operation = 'det') {
    status.textContent = '';
    try {
      if (current === 'matrix') {
        const matrix = JSON.parse(input.value);
        if (!Array.isArray(matrix) || !matrix.length || matrix.length > 10 || !matrix.every(row => Array.isArray(row) && row.length === matrix.length && row.every(n => typeof n === 'number' && Number.isFinite(n)))) throw Error('Ingresa una matriz cuadrada de hasta 10 × 10 con números.');
        const answer = operation === 'inv' ? math.inv(matrix) : math.det(matrix);
        result.textContent = `${operation === 'inv' ? 'Inversa' : 'Determinante'}(A) =\n${math.format(answer, {precision: 6}).replace(/\], \[/g, '],\n [')}`;
        return;
      }
      const expression = input.value.trim().replace(current === '2d' ? /^\s*(?:y|f\(x\))\s*=\s*/i : /^\s*(?:z|f\(x,\s*y\))\s*=\s*/i, '');
      const compiled = compile(expression, current === '2d' ? ['x'] : ['x', 'y']);
      const color = getComputedStyle(widget).getPropertyValue('--text').trim() || '#dddddd';
      const axis = {gridcolor: 'rgba(128,128,128,.25)', zerolinecolor: '#888'};
      const layout = {paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', font: {color}, margin: {l: 42, r: 12, b: 38, t: 15}, autosize: true};
      let traces;
      if (current === '2d') {
        const x = Array.from({length: 401}, (_, i) => -10 + i * .05);
        const y = x.map(x => { const v = finite(compiled.evaluate({x})); return v !== null && Math.abs(v) <= 500 ? v : null; });
        if (y.every(v => v === null)) throw Error('La función no tiene valores reales visibles entre −10 y 10.');
        // Break steep jumps near poles rather than connecting across asymptotes.
        for (let i = y.length - 1; i > 0; i--) if (y[i] !== null && y[i - 1] !== null && Math.abs(y[i] - y[i - 1]) > 100) y[i] = null;
        traces = [{x, y, type: 'scatter', mode: 'lines', connectgaps: false, line: {color: '#8b7cf8', width: 3}}];
        Object.assign(layout, {xaxis: {...axis, title: 'x'}, yaxis: {...axis, title: 'y'}, dragmode: 'pan'});
      } else {
        const x = Array.from({length: 41}, (_, i) => -5 + i * .25);
        const z = x.map(y => x.map(x => finite(compiled.evaluate({x, y}))));
        if (z.every(row => row.every(v => v === null))) throw Error('La superficie no tiene valores reales en este intervalo.');
        traces = [{x, y: x, z, type: 'surface', colorscale: 'Viridis', showscale: false}];
        layout.scene = {xaxis: {...axis, title: 'x'}, yaxis: {...axis, title: 'y'}, zaxis: {...axis, title: 'z'}, bgcolor: 'rgba(0,0,0,0)'};
      }
      await Plotly.react(plot, traces, layout, {responsive: true, displayModeBar: false, displaylogo: false});
      drawn = true;
      plot.setAttribute('aria-label', `Gráfica ${current}: ${expression}`);
    } catch (error) {
      status.textContent = current === 'matrix' ? 'Revisa la matriz: usa [[1,2],[3,4]]. Debe ser cuadrada; para invertirla no puede ser singular.' : (error.message.includes('valores reales') ? error.message : 'Revisa la función. Usa x (y también y en 3D), ^ para potencias y * para multiplicar. Ejemplo: x^2 - 4.');
      // Never leave a previous equation's graph visible after a failed request.
      if (current === 'matrix') result.textContent = '';
      else { Plotly.purge(plot); drawn = false; }
    }
  }
  $('math-form').addEventListener('submit', e => {e.preventDefault(); draw();});
  $('math-inverse').addEventListener('click', () => draw('inv'));
  mode.addEventListener('change', () => {
    values[current] = input.value;
    current = mode.value;
    input.value = values[current];
    const matrix = current === 'matrix';
    $('math-expression-label').textContent = matrix ? 'Matriz A' : (current === '2d' ? 'y = f(x)' : 'z = f(x, y)');
    $('math-help').textContent = matrix ? 'Filas entre corchetes, separadas por comas. Ejemplo: [[1,2],[3,4]]. Hasta 10 × 10.' : (current === '2d' ? 'Usa x, ^ y *. Ejemplos: x^2 - 4, sin(x), y = 2*x + 1.' : 'Usa x e y. Ejemplos: x^2 + y^2, sin(x)*cos(y).');
    $('math-draw').textContent = matrix ? 'Determinante' : 'Graficar';
    $('math-inverse').hidden = !matrix;
    plot.hidden = matrix; result.hidden = !matrix;
    $('math-interaction').hidden = matrix;
    $('math-interaction').textContent = current === '3d' ? 'Arrastra para girar la superficie. Usa la rueda para acercar.' : 'Arrastra para mover la gráfica. Doble clic para restaurar la vista.';
    draw();
  });
  function resize() { if (drawn && !plot.hidden) Plotly.Plots.resize(plot); }
  $('math-expand').addEventListener('click', () => {
    // Reserve the compact panel's space so the tutor and lesson do not jump.
    slot.style.minHeight = `${slot.getBoundingClientRect().height}px`;
    $('math-dialog-content').append(widget);
    dialog.showModal();
    $('math-close').focus();
    requestAnimationFrame(resize);
  });
  $('math-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { slot.append(widget); slot.style.minHeight = ''; $('math-expand').focus(); requestAnimationFrame(resize); });
  new ResizeObserver(resize).observe(plot);
  new MutationObserver(() => { if (!slot.hidden && current !== 'matrix') draw(); }).observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme']});
  const algebraRoot = document.getElementById('algebra-app');
  if (algebraRoot) {
    const topicGraphs = {
      lineales: {equation: 'y = 3*x - 12', help: 'El corte con el eje x muestra la solución. Para 3x + 2 = 14, grafica y = 3*x - 12.'},
      cuadraticas: {equation: 'y = x^2 - 5*x + 6', help: 'Los cortes con el eje x son las raíces. Observa también el vértice y hacia dónde abre la parábola.'},
      graficas: {equation: 'y = 2*x + 1', help: 'Cambia la pendiente y el término independiente para explorar cómo se mueve la recta.'}
    };
    let activeTopic = null;
    const equations = {};
    function selectTopic(id) {
      if (activeTopic === id) return;
      if (activeTopic) equations[activeTopic] = input.value;
      if (dialog.open) dialog.close();
      activeTopic = id;
      const config = topicGraphs[id];
      slot.hidden = !config;
      if (!config) return;
      input.value = equations[id] || config.equation;
      $('math-topic-help').textContent = config.help;
      draw();
    }
    document.addEventListener('algebra:topic', event => selectTopic(event.detail.id));
    selectTopic($('topic-select').value);
  } else {
    draw();
  }
})();
