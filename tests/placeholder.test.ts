import { expect, test } from 'bun:test';
import { add } from '../src/placeholder.ts';

test('add combines two numbers', () => {
  expect(add(2, 3)).toBe(5);
});
