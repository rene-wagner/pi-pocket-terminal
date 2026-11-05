import assert from 'node:assert/strict';
import { test } from 'node:test';
import createTerminal from '../terminal.ts';
import { DEFAULT_SETTINGS, normalizeSettings } from '../terminal/preferences.mjs';

test('settings defaults and invalid values are normalized without storage side effects', () => {
  assert.deepEqual(normalizeSettings(), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings({ keybarVisibility: 'bad', extendedKeys: 'yes', lockModifiers: 1 }), DEFAULT_SETTINGS);
  assert.equal(normalizeSettings({ keybarVisibility: 'always', extendedKeys: true }).extendedKeys, true);
});
test('the extension registers only its existing owner-only routes and documented settings', () => {
  const routes = []; let fields, client, cleanup;
  createTerminal({}, {
    route(method, path, handler, options) { routes.push({ method, path, handler, options }); },
    settings(value) { fields = value; }, client(value) { client = value; }, onDispose(value) { cleanup = value; },
  });
  assert.equal(client, 'terminal'); assert.equal(routes.length, 7);
  for (const route of routes) assert.equal(route.options.access, 'owner');
  assert.deepEqual(Object.fromEntries(fields.map(field => [field.name, field.default])), DEFAULT_SETTINGS);
  assert.deepEqual(fields.map(field => field.label), [
    'Show extra key toolbar', 'Show extended keys on opening', 'Highlight active modifiers',
    'Haptic feedback', 'Lock modifiers on double-tap',
  ]);
  const visibility = fields.find(field => field.name === 'keybarVisibility');
  assert.deepEqual(visibility.choices.map(choice => choice.value), ['auto', 'always', 'never']);
  assert.deepEqual(visibility.choices.map(choice => choice.label), ['Auto (touch devices)', 'Always', 'Never']);
  assert.equal(fields.find(field => field.name === 'hapticFeedback').description, 'Only in browsers that support vibration.');
  cleanup();
});
