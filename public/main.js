import { mount } from './dc-lite.js';
import Component from './app.js';

// Color principal opcional por URL: ?color=5CC8FF
const q = new URLSearchParams(location.search);
const props = { accent: q.get('color') ? '#' + q.get('color').replace('#', '') : '#3BE58A' };
mount(Component, document.getElementById('tpl'), props, document.getElementById('app'));
