import { expect, test } from 'vitest';
import { add } from '../src/placeholder.ts';

test('add combines two numbers', () => {
  expect(add(2, 3)).toBe(5);
});
