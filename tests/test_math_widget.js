const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const math = require('../static/vendor/math-12.4.1.min.js');
function setup(algebra = false) {
  const elements = new Map();
  const el = id => {
    if (!elements.has(id)) elements.set(id, {value: '', hidden: false, textContent: '', listeners: {}, addEventListener(k, f) {this.listeners[k] = f;}, setAttribute() {}, append(child) {child.parentElement = this;}, focus() {}});
    return elements.get(id);
  };
  el('topic-select').value = 'expresiones';
  el('math-widget').parentElement = {style: {}, getBoundingClientRect() {return {height: 600};}, append() {}};
  el('math-expression').value = 'sin(x)';
  el('math-dialog').showModal = () => {el('math-dialog').open = true;};
  el('math-dialog').close = () => {el('math-dialog').open = false; el('math-dialog').listeners.close();};
  const charts = [];
  const Plotly = {react: async (...args) => charts.push(args), purge() {charts.length = 0;}, Plots: {resize() {}}};
  const listeners = {};
  const context = {document: {getElementById: id => id === 'algebra-app' && !algebra ? null : el(id), addEventListener: (name, fn) => {listeners[name] = fn;}, documentElement: {}}, window: {math, Plotly}, math, Plotly, getComputedStyle: () => ({getPropertyValue: () => '#fff'}), requestAnimationFrame: f => f(), ResizeObserver: class {observe() {}}, MutationObserver: class {observe() {}}};
  const document = context.document; delete context.document; delete context.math;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('static/vendor/math-12.4.1.min.js', 'utf8'), context);
  context.document = document; context.window.math = context.math;
  vm.runInContext(fs.readFileSync('static/js/math-widget.js', 'utf8'), context);
  return {el, charts, slot: el('math-widget').parentElement, selectTopic: id => listeners['algebra:topic']({detail: {id}}), submit: async () => {el('math-form').listeners.submit({preventDefault() {}}); await Promise.resolve();}};
}
test('plots equations, accepts y=, clears invalid graph, and rejects assignments', async () => {
  const {el, charts, submit} = setup();
  el('math-expression').value = 'y = x^2 - 4'; await submit();
  assert.equal(charts.at(-1)[1][0].y[260], 5);
  el('math-expression').value = 'unknown(x)'; await submit();
  assert.ok(el('math-status').textContent); assert.equal(charts.length, 0);
  el('math-expression').value = 'a = 5'; await submit(); assert.ok(el('math-status').textContent);
});
test('3D and matrix operations, including singular matrix errors', async () => {
  const {el, charts, submit} = setup();
  el('math-mode').value = '3d'; el('math-mode').listeners.change(); await Promise.resolve();
  assert.equal(charts.at(-1)[1][0].type, 'surface');
  assert.equal(charts.at(-1)[1][0].z.length, 41);
  el('math-mode').value = 'matrix'; el('math-mode').listeners.change();
  assert.match(el('math-result').textContent, /-2/);
  el('math-inverse').listeners.click(); assert.match(el('math-result').textContent, /1.5/);
  el('math-expression').value = '[[1,2],[2,4]]'; el('math-inverse').listeners.click(); assert.ok(el('math-status').textContent);
});
test('expands and reduces without losing the entered equation', () => {
  const {el} = setup(); el('math-expression').value = 'x^3';
  el('math-expand').listeners.click(); assert.equal(el('math-dialog').open, true);
  el('math-close').listeners.click(); assert.equal(el('math-dialog').open, false);
  assert.equal(el('math-expression').value, 'x^3');
});

test('shows the graph only in the three supported algebra topics', async () => {
  const {slot, charts, selectTopic} = setup(true);
  assert.equal(slot.hidden, true);
  assert.equal(charts.length, 0);
  for (const id of ['expresiones', 'signos', 'suma_resta', 'multiplicacion', 'productos_notables', 'factorizacion', 'lineales', 'cuadraticas', 'sistemas', 'graficas']) {
    selectTopic(id); await Promise.resolve();
    assert.equal(slot.hidden, !['lineales', 'cuadraticas', 'graficas'].includes(id), id);
  }
});
test('keeps each topic equation when switching and refreshing progress', () => {
  const {el, selectTopic, slot} = setup(true);
  selectTopic('lineales'); assert.equal(el('math-expression').value, 'y = 3*x - 12');
  el('math-expression').value = 'y = 5*x - 10';
  selectTopic('lineales'); assert.equal(el('math-expression').value, 'y = 5*x - 10');
  selectTopic('cuadraticas'); assert.equal(el('math-expression').value, 'y = x^2 - 5*x + 6');
  selectTopic('signos'); assert.equal(slot.hidden, true);
  selectTopic('lineales'); assert.equal(el('math-expression').value, 'y = 5*x - 10');
  el('math-expand').listeners.click();
  selectTopic('sistemas'); assert.equal(el('math-dialog').open, false); assert.equal(slot.hidden, true);
});
