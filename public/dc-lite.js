// Mini-motor de plantillas: interpreta el marcado del diseño ({{huecos}}, <sc-for>, <sc-if>)
// y lo pinta con Preact, de modo que la lógica del diseño se reutiliza tal cual.
import { h, render, Component } from './vendor/preact.module.js';

export class DCLogic extends Component {}

const HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
const ONLY_HOLE = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;

function lookup(scope, path) {
  path = path.trim();
  if (path === 'true') return true;
  if (path === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), scope);
}

function interp(str, scope) {
  const m = str.match(ONLY_HOLE);
  if (m) return lookup(scope, m[1]);
  return str.replace(HOLE, (_, p) => {
    const v = lookup(scope, p);
    return v == null ? '' : String(v);
  });
}

function kids(node, scope) {
  const out = [];
  node.childNodes.forEach((c) => {
    const v = conv(c, scope);
    if (Array.isArray(v)) out.push(...v);
    else if (v != null && v !== '') out.push(v);
  });
  return out;
}

function conv(node, scope) {
  if (node.nodeType === 3) {
    const t = node.nodeValue;
    return t.includes('{{') ? interp(t, scope) : t;
  }
  if (node.nodeType !== 1) return null;
  const tag = node.localName;
  if (tag === 'sc-for') {
    const list = interp(node.getAttribute('list') || '', scope) || [];
    const as = node.getAttribute('as') || 'item';
    const out = [];
    list.forEach((item, i) => out.push(...kids(node, { ...scope, [as]: item, $index: i })));
    return out;
  }
  if (tag === 'sc-if') {
    return interp(node.getAttribute('value') || '', scope) ? kids(node, scope) : null;
  }
  const props = {};
  for (const a of node.attributes) {
    const name = a.name;
    if (name.startsWith('hint-')) continue;
    const v = a.value.includes('{{') ? interp(a.value, scope) : a.value;
    if (name === 'ref') { if (typeof v === 'function') props.ref = v; continue; }
    if (name.startsWith('on')) {
      let ev = name.toLowerCase();
      // en campos de texto, "change" del diseño = escribir (input), para que no se pierda lo tecleado
      if (ev === 'onchange' && (tag === 'textarea' || (tag === 'input' && node.getAttribute('type') !== 'file'))) ev = 'oninput';
      if (typeof v === 'function') props[ev] = v;
      continue;
    }
    props[name] = v;
  }
  return h(tag, props, ...kids(node, scope));
}

export function mount(Logic, templateEl, props, container) {
  const root = templateEl.content;
  class Wrapped extends Logic {
    render() {
      const vals = this.renderVals();
      return h('div', { style: 'display: contents' }, ...kids(root, vals));
    }
  }
  render(h(Wrapped, props), container);
}
