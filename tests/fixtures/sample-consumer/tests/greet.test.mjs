import { test } from 'node:test';
import assert from 'node:assert/strict';
import { greet } from '../src/greet.mjs';

test('greet returns hello message', () => {
  assert.equal(greet('World'), 'Hello, World');
});
