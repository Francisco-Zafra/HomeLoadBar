import { mount } from './dc-lite.js';
import Component from './app.js';

// Ajustes por URL para probar: ?celebrar=1&momento=noche&velocidad=rapida&color=5CC8FF
const q = new URLSearchParams(location.search);
const props = {
  accent: q.get('color') ? '#' + q.get('color').replace('#', '') : '#3BE58A',
  celebrar: q.get('celebrar') === '1',
  momento: q.get('momento') || 'real',
  diasSinVisitar: Number(q.get('dias') || 0),
  velocidad: q.get('velocidad') || 'real'
};
mount(Component, document.getElementById('tpl'), props, document.getElementById('app'));
